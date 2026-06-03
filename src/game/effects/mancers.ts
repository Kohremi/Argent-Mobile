// Mancers of the University effect implementations.

import { getEffect, hasEffect, registerEffect } from './registry';
import {
  affordableVaultCards,
  applyGainMark,
  applyVaultPurchaseMaybeWaived,
  buildBurnTargets,
  buildReactionQueue,
  eligibleVotersForMark,
  gainResourcePatch,
  healMageToSpace,
  woundMage,
} from './helpers';
import type {
  ActionSpaceId,
  ChoiceOption,
  EffectContext,
  EffectResult,
  GameState,
  GameStatePatch,
  MageColor,
  OwnedMage,
  PlayerId,
  ResolutionSource,
  SerializableContext,
} from '../types';

// ============================================================================
// Laboratory — each slot's reward depends on the colour of the placed Mage.
// Slot 1 (merit) doubles the reward; slots 2 and 3 give it once. Both
// sides use the same chain handler, parameterised by the colour→reward
// table for that side.
//
// Side A — INSTANT room. Reward fires at PLACE_WORKER time:
//   Divinity (blue)  → Heal + Move a Mage from the Infirmary
//   Mysticism (grey) → Gain a Mark
//   Natural Magick   → Gain 4 Gold
//   Planar Studies   → Gain 1 Research
//   Sorcery (red)    → Gain 2 Mana
//   Technomancy (—)  → Gain a Buy  (Technomancy colour not in MageColor yet)
//
// Side B — non-instant. Reward fires during normal resolution:
//   Divinity (blue)  → Gain 3 Mana
//   Mysticism (grey) → Gain a Mark
//   Natural Magick   → Gain 1 INT
//   Planar Studies   → Gain 1 WIS
//   Sorcery (red)    → Gain a Research
//   Technomancy (—)  → Gain 2 Buys (unreachable until Technomancy mages land)
//
// `total` (1 or 2) only matters on first entry — every per-step
// continuation just decrements `remaining`. The "fizzle silently" path
// is taken when:
//   * the placed Mage's colour has no mapped reward (off-white today),
//   * the chain step has no eligible target (no infirmary mage to heal,
//     no eligible voter to mark, no affordable Vault Card to buy).
// ============================================================================

type LabColorKind =
  | { kind: 'gold'; amount: number }
  | { kind: 'mana'; amount: number }
  | { kind: 'intelligence'; amount: number }
  | { kind: 'wisdom'; amount: number }
  | { kind: 'research'; amount: number }
  | { kind: 'mark'; count: number }
  | { kind: 'heal-move'; count: number }
  | { kind: 'buy'; count: number }
  | { kind: 'none' };

type RewardForColor = (color: MageColor, total: 1 | 2) => LabColorKind;

const rewardForColorA: RewardForColor = (color, total) => {
  switch (color) {
    case 'blue':
      return { kind: 'heal-move', count: total };
    case 'grey':
      return { kind: 'mark', count: total };
    case 'green':
      return { kind: 'gold', amount: 4 * total };
    case 'purple':
      return { kind: 'research', amount: 1 * total };
    case 'red':
      return { kind: 'mana', amount: 2 * total };
    case 'orange':
      // Technomancy (Mancers): Gain a Buy (×total).
      return { kind: 'buy', count: total };
    case 'rainbow':
      // Archmage's Apprentice — has all mage powers but no department-
      // tied reward of its own. Fizzle silently.
      return { kind: 'none' };
    case 'off-white':
      // Neutral mages don't map to a department reward.
      return { kind: 'none' };
  }
};

const rewardForColorB: RewardForColor = (color, total) => {
  switch (color) {
    case 'blue':
      return { kind: 'mana', amount: 3 * total };
    case 'grey':
      return { kind: 'mark', count: total };
    case 'green':
      return { kind: 'intelligence', amount: 1 * total };
    case 'purple':
      return { kind: 'wisdom', amount: 1 * total };
    case 'red':
      return { kind: 'research', amount: 1 * total };
    case 'orange':
      // Technomancy (Mancers): Gain 2 Buys (×total).
      return { kind: 'buy', count: 2 * total };
    case 'rainbow':
      // Archmage's Apprentice — has all mage powers but no department-
      // tied reward.
      return { kind: 'none' };
    case 'off-white':
      return { kind: 'none' };
  }
};

/**
 * Looks up the Mage that the placing player just put on `spaceId`. Picks
 * the occupant (base or shadow) whose `ownerId` matches the player.
 * Returns null if no such mage exists — that shouldn't happen in normal
 * play but lets the effect fizzle quietly rather than throwing.
 */
function findPlacedMage(
  state: GameState,
  spaceId: string,
  triggeringPlayerId: PlayerId,
): OwnedMage | null {
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.id !== spaceId) continue;
      const matches: { mageId: string; ownerId: string }[] = [];
      if (s.occupant && s.occupant.ownerId === triggeringPlayerId) {
        matches.push(s.occupant);
      }
      if (
        s.shadowOccupant &&
        s.shadowOccupant.ownerId === triggeringPlayerId
      ) {
        matches.push(s.shadowOccupant);
      }
      for (const occ of matches) {
        const owner = state.players.find((p) => p.id === occ.ownerId);
        const m = owner?.mages.find((mm) => mm.id === occ.mageId);
        if (m) return m;
      }
    }
  }
  return null;
}

function appendResearchQueueInline(
  state: GameState,
  playerId: PlayerId,
  source: ResolutionSource,
  count: number,
): GameStatePatch {
  if (count <= 0) return {};
  const entries: GameState['researchQueue'] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ playerId, source });
  }
  return { researchQueue: [...state.researchQueue, ...entries] };
}

function listInfirmaryMages(state: GameState): string[] {
  const ids: string[] = [];
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind === 'infirmary' && m.isWounded) ids.push(m.id);
    }
  }
  return ids;
}

function listOpenBaseSlots(state: GameState): string[] {
  const out: string[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    for (const s of r.actionSpaces) {
      if (!s.occupant) out.push(s.id);
    }
  }
  return out;
}

function laboratoryChain(
  ctx: EffectContext,
  selfEffectId: string,
  total: 1 | 2,
  rewardForColor: RewardForColor,
): EffectResult {
  const step = ctx.resumeContext?.['step'];
  const remainingRaw = ctx.resumeContext?.['remaining'];
  const colorRaw = ctx.resumeContext?.['color'];

  // First entry — figure out colour + reward. The slot's spaceId lives on
  // `ctx.source.id` (set by describeSpaceSource for room-action sources).
  if (step === undefined) {
    if (ctx.source.kind !== 'room-action') {
      return { kind: 'done', patch: {} };
    }
    const mage = findPlacedMage(
      ctx.state,
      ctx.source.id,
      ctx.triggeringPlayerId,
    );
    if (!mage) return { kind: 'done', patch: {} };
    const reward = rewardForColor(mage.color, total);
    return runReward(ctx, selfEffectId, reward);
  }

  // Sub-step continuations.
  const remaining =
    typeof remainingRaw === 'number' ? remainingRaw : 0;
  const color =
    typeof colorRaw === 'string' ? (colorRaw as MageColor) : 'off-white';

  if (step === 'after-mark') {
    if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
      throw new Error(`${selfEffectId} after-mark expected voter-chosen`);
    }
    const patch = applyGainMark(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.voterId,
    );
    const working = { ...ctx.state, ...patch };
    if (remaining <= 0) {
      return { kind: 'done', patch: diffPatch(ctx.state, working) };
    }
    return runReward(
      { ...ctx, state: working },
      selfEffectId,
      { kind: 'mark', count: remaining },
      diffPatch(ctx.state, working),
    );
  }
  if (step === 'after-heal-source') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${selfEffectId} after-heal-source expected mage-chosen`);
    }
    const woundedId = ctx.resumeAnswer.mageId;
    const dests = listOpenBaseSlots(ctx.state);
    if (dests.length === 0) {
      // Nothing to move to — fizzle this iteration, continue chain.
      if (remaining <= 0) return { kind: 'done', patch: {} };
      return runReward(
        ctx,
        selfEffectId,
        { kind: 'heal-move', count: remaining },
      );
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: dests,
        },
        resume: {
          effectId: selfEffectId,
          context: {
            step: 'after-heal-dest',
            remaining,
            color,
            woundedMageId: woundedId,
          },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'after-heal-dest') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${selfEffectId} after-heal-dest expected space-chosen`);
    }
    const woundedIdRaw = ctx.resumeContext?.['woundedMageId'];
    if (typeof woundedIdRaw !== 'string') {
      throw new Error(`${selfEffectId} after-heal-dest: missing woundedMageId`);
    }
    const patch = healMageToSpace(
      ctx.state,
      woundedIdRaw,
      ctx.resumeAnswer.spaceId as ActionSpaceId,
    );
    const working = { ...ctx.state, ...patch };
    if (remaining <= 0) {
      return { kind: 'done', patch: diffPatch(ctx.state, working) };
    }
    return runReward(
      { ...ctx, state: working },
      selfEffectId,
      { kind: 'heal-move', count: remaining },
      diffPatch(ctx.state, working),
    );
  }
  if (step === 'after-buy-or-skip') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} after-buy-or-skip expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'skip') {
      if (remaining <= 0) return { kind: 'done', patch: {} };
      return runReward(
        ctx,
        selfEffectId,
        { kind: 'buy', count: remaining },
      );
    }
    if (ctx.resumeAnswer.optionId !== 'buy') {
      throw new Error(
        `${selfEffectId} after-buy-or-skip unknown option ${ctx.resumeAnswer.optionId}`,
      );
    }
    const affordable = affordableVaultCards(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (affordable.length === 0) {
      if (remaining <= 0) return { kind: 'done', patch: {} };
      return runReward(
        ctx,
        selfEffectId,
        { kind: 'buy', count: remaining },
      );
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: affordable,
        },
        resume: {
          effectId: selfEffectId,
          context: { step: 'after-buy-card', remaining, color },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'after-buy-card') {
    if (ctx.resumeAnswer?.kind !== 'card-chosen') {
      throw new Error(`${selfEffectId} after-buy-card expected card-chosen`);
    }
    const patch = applyVaultPurchaseMaybeWaived(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.cardId,
    );
    const working = { ...ctx.state, ...patch };
    if (remaining <= 0) {
      return {
        kind: 'done',
        patch: {
          players: working.players,
          vaultTableau: working.vaultTableau,
        },
      };
    }
    return runReward(
      { ...ctx, state: working },
      selfEffectId,
      { kind: 'buy', count: remaining },
      { players: working.players, vaultTableau: working.vaultTableau },
    );
  }

  throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
}

/**
 * Computes a "what changed between `before` and `after`" patch over the
 * GameState slices our chain may touch. `rooms` is critical for heal-move:
 * `healMageToSpace` updates both the mage's `location` (players) and the
 * slot's `occupant` (rooms) — drop either and the mage "disappears".
 */
function diffPatch(before: GameState, after: GameState): GameStatePatch {
  const patch: GameStatePatch = {};
  if (after.players !== before.players) patch.players = after.players;
  if (after.rooms !== before.rooms) patch.rooms = after.rooms;
  if (after.voterMarks !== before.voterMarks)
    patch.voterMarks = after.voterMarks;
  if (after.nextSequenceId !== before.nextSequenceId)
    patch.nextSequenceId = after.nextSequenceId;
  if (after.researchQueue !== before.researchQueue)
    patch.researchQueue = after.researchQueue;
  return patch;
}

/**
 * Dispatches the actual reward. For instant rewards (gold/mana/research)
 * returns `kind: 'done'` with the patch. For chain-style rewards
 * (mark / heal-move / buy) pauses on the next sub-prompt. `carryPatch`
 * preserves any accumulated chain progress.
 */
function runReward(
  ctx: EffectContext,
  selfEffectId: string,
  reward: LabColorKind,
  carryPatch: GameStatePatch = {},
): EffectResult {
  if (reward.kind === 'none') return { kind: 'done', patch: carryPatch };
  if (reward.kind === 'gold') {
    const patch = gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'gold',
      reward.amount,
    );
    return {
      kind: 'done',
      patch: mergePlayerPatch(carryPatch, patch),
    };
  }
  if (reward.kind === 'mana') {
    const patch = gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'mana',
      reward.amount,
    );
    return {
      kind: 'done',
      patch: mergePlayerPatch(carryPatch, patch),
    };
  }
  if (reward.kind === 'intelligence' || reward.kind === 'wisdom') {
    const patch = gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      reward.kind,
      reward.amount,
    );
    return {
      kind: 'done',
      patch: mergePlayerPatch(carryPatch, patch),
    };
  }
  if (reward.kind === 'research') {
    const patch = appendResearchQueueInline(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.source,
      reward.amount,
    );
    return {
      kind: 'done',
      patch: {
        ...carryPatch,
        ...patch,
      },
    };
  }
  if (reward.kind === 'mark') {
    const eligible = eligibleVotersForMark(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (eligible.length === 0) {
      return { kind: 'done', patch: carryPatch };
    }
    const remaining = reward.count - 1;
    const context: SerializableContext = {
      step: 'after-mark',
      remaining,
      color: 'grey',
    };
    return {
      kind: 'pause',
      patch: carryPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-voter',
          eligibleVoterIds: eligible.map((v) => v.id),
        },
        resume: { effectId: selfEffectId, context },
        source: ctx.source,
      },
    };
  }
  if (reward.kind === 'heal-move') {
    const wounded = listInfirmaryMages(ctx.state);
    if (wounded.length === 0) {
      return { kind: 'done', patch: carryPatch };
    }
    const dests = listOpenBaseSlots(ctx.state);
    if (dests.length === 0) {
      return { kind: 'done', patch: carryPatch };
    }
    const remaining = reward.count - 1;
    const context: SerializableContext = {
      step: 'after-heal-source',
      remaining,
      color: 'blue',
    };
    return {
      kind: 'pause',
      patch: carryPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: wounded,
        },
        resume: { effectId: selfEffectId, context },
        source: ctx.source,
      },
    };
  }
  if (reward.kind === 'buy') {
    const affordable = affordableVaultCards(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    const remaining = reward.count - 1;
    if (affordable.length === 0) {
      // Nothing affordable — fizzle this iteration, but keep chaining.
      if (remaining <= 0) return { kind: 'done', patch: carryPatch };
      return runReward(
        ctx,
        selfEffectId,
        { kind: 'buy', count: remaining },
        carryPatch,
      );
    }
    const options: ChoiceOption[] = [
      { id: 'buy', label: 'Gain a Buy', payload: {} },
      { id: 'skip', label: 'Skip the Buy', payload: {} },
    ];
    const context: SerializableContext = {
      step: 'after-buy-or-skip',
      remaining,
      color: 'off-white',
    };
    return {
      kind: 'pause',
      patch: carryPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: selfEffectId, context },
        source: ctx.source,
      },
    };
  }
  return { kind: 'done', patch: carryPatch };
}

function mergePlayerPatch(
  a: GameStatePatch,
  b: GameStatePatch,
): GameStatePatch {
  return {
    ...a,
    ...b,
  };
}

registerEffect(
  'mancers.room.laboratory-a.slot-double',
  (ctx: EffectContext): EffectResult =>
    laboratoryChain(
      ctx,
      'mancers.room.laboratory-a.slot-double',
      2,
      rewardForColorA,
    ),
);
registerEffect(
  'mancers.room.laboratory-a.slot-single',
  (ctx: EffectContext): EffectResult =>
    laboratoryChain(
      ctx,
      'mancers.room.laboratory-a.slot-single',
      1,
      rewardForColorA,
    ),
);
registerEffect(
  'mancers.room.laboratory-b.slot-double',
  (ctx: EffectContext): EffectResult =>
    laboratoryChain(
      ctx,
      'mancers.room.laboratory-b.slot-double',
      2,
      rewardForColorB,
    ),
);
registerEffect(
  'mancers.room.laboratory-b.slot-single',
  (ctx: EffectContext): EffectResult =>
    laboratoryChain(
      ctx,
      'mancers.room.laboratory-b.slot-single',
      1,
      rewardForColorB,
    ),
);

// ============================================================================
// Technomancer (orange) mage power — Side A: "Spend 3 Gold when placing
// this Mage to gain a Research." The trigger is queued at PLACE_WORKER
// time onto `pendingTechnomancyTrigger` and drained by the engine pump
// once the placement chain settles (mirroring the Mysticism post-cast
// pattern). This effect is the resume target for the drained prompt.
// ============================================================================

registerEffect(
  'mancers.mage.technomancy.place-after',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `technomancy.place-after expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    if (ctx.resumeAnswer.optionId === 'skip') {
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId !== 'pay') {
      throw new Error(
        `technomancy.place-after: unknown option ${ctx.resumeAnswer.optionId}`,
      );
    }
    // Defence-in-depth: the drain check already gated on 3 Gold, but
    // state may have shifted (other resolutions, etc.) — recheck and
    // fizzle silently if the player can't pay now.
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    if (!player || player.resources.gold < 3) {
      return { kind: 'done', patch: {} };
    }
    const goldPatch = gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'gold',
      -3,
    );
    const afterGold: GameState = { ...ctx.state, ...goldPatch };
    const researchPatch = appendResearchQueueInline(
      afterGold,
      ctx.triggeringPlayerId,
      ctx.source,
      1,
    );
    return {
      kind: 'done',
      patch: {
        ...goldPatch,
        ...researchPatch,
      },
    };
  },
);

// ============================================================================
// Technomancy leader (unique) spells.
//
// Arcane Surge (Sophica Sentavra) — Free / Fast Action: "Give an
// opponent 1 Mana and wound one of their Mages." Pick an opponent's
// mage; that opponent gains 1 Mana, then the chosen mage is wounded
// (standard wound → reaction window → infirmary-bonus chain).
//
// Arcane Investigation (Riflam Lenshear) — 1 Mana / Action: "Gain a
// Research OR gain a Mark."
// ============================================================================

registerEffect(
  'mancers.spell.arcane-surge.l1',
  (ctx: EffectContext): EffectResult => {
    const self = 'mancers.spell.arcane-surge.l1';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      // Only an OPPONENT's mage is a valid target ("one of THEIR Mages").
      const targets = buildBurnTargets(ctx.state, ctx.triggeringPlayerId).filter(
        (mid) => {
          const owner = ctx.state.players.find((p) =>
            p.mages.some((m) => m.id === mid),
          );
          return owner !== undefined && owner.id !== ctx.triggeringPlayerId;
        },
      );
      if (targets.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }

    if (step !== 'apply') {
      throw new Error(`${self}: unexpected resume step ${String(step)}`);
    }
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(
        `${self} apply expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const mageId = ctx.resumeAnswer.mageId;
    const owner = ctx.state.players.find((p) =>
      p.mages.some((m) => m.id === mageId),
    );
    if (!owner) return { kind: 'done', patch: {} };
    // Give the opponent 1 Mana first, then wound their mage against the
    // post-grant state so both updates land in `players`.
    const manaPatch = gainResourcePatch(ctx.state, owner.id, 'mana', 1);
    const afterMana: GameState = { ...ctx.state, ...manaPatch };
    const wounded = woundMage(afterMana, mageId, ctx.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          afterMana,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.system.post-wound-bonus',
          context: {
            triggerEvent:
              wounded.triggerEvent as unknown as SerializableContext,
          },
        },
        source: ctx.source,
      },
    };
  },
);

registerEffect(
  'mancers.spell.arcane-investigation.l1',
  (ctx: EffectContext): EffectResult => {
    const self = 'mancers.spell.arcane-investigation.l1';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'research', label: 'Gain a Research', payload: {} },
              { id: 'mark', label: 'Gain a Mark', payload: {} },
            ],
          },
          resume: { effectId: self, context: { step: 'choose' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'choose') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(
          `${self} choose expected option-chosen, got ${ctx.resumeAnswer.kind}`,
        );
      }
      if (ctx.resumeAnswer.optionId === 'research') {
        return {
          kind: 'done',
          patch: appendResearchQueueInline(
            ctx.state,
            ctx.triggeringPlayerId,
            ctx.source,
            1,
          ),
        };
      }
      if (ctx.resumeAnswer.optionId !== 'mark') {
        throw new Error(
          `${self}: unknown option ${ctx.resumeAnswer.optionId}`,
        );
      }
      // Gain a Mark — open the voter pick (fizzles if every voter is
      // already marked by this player).
      const eligible = eligibleVotersForMark(ctx.state, ctx.triggeringPlayerId);
      if (eligible.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-voter',
            eligibleVoterIds: eligible.map((v) => v.id),
          },
          resume: { effectId: self, context: { step: 'after-voter' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'after-voter') {
      if (ctx.resumeAnswer.kind !== 'voter-chosen') {
        throw new Error(
          `${self} after-voter expected voter-chosen, got ${ctx.resumeAnswer.kind}`,
        );
      }
      return {
        kind: 'done',
        patch: applyGainMark(
          ctx.state,
          ctx.triggeringPlayerId,
          ctx.resumeAnswer.voterId,
        ),
      };
    }

    throw new Error(`${self}: unexpected step ${String(step)}`);
  },
);

// Re-export to satisfy the module's existing `export {}` shape.
export {};

// Touch unused imports to keep tsc happy when the chain doesn't exercise
// every code path — these are part of the effect's surface area.
void getEffect;
void hasEffect;
