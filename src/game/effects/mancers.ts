// Mancers of the University effect implementations.

import { getEffect, hasEffect, registerEffect } from './registry';
import {
  actsAsColor,
  affordableVaultCards,
  applyGainMark,
  applyRoomLockPatch,
  applyVaultDraft,
  applyVaultPurchaseMaybeWaived,
  banishMage,
  buildBanishTargets,
  buildBurnTargets,
  buildReactionQueue,
  bumpInfluencePatch,
  canArsMagnaTakeSpace,
  eligibleVotersForMark,
  gainResourcePatch,
  gainResourcesPatch,
  healMageToSpace,
  isRoomLocked,
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
  woundMage,
} from './helpers';
import { nextRandom } from '../../utils/rng';
import {
  listPlaceWithoutPowersMages,
  listPlaceWithoutPowersSlots,
} from './base';
import {
  ALL_SYNTHESIS_IDS,
  SYNTHESIS_BY_DEPARTMENT,
} from '../../content/packs/mancers';
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
  ReactionTriggerEvent,
  ResolutionSource,
  SerializableContext,
  WorkerOccupancy,
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

// ============================================================================
// Research Archive Side A — Gain Research, then "move Research": relocate a WIS
// token from one learned Spell (taking its top token — L3 first, else L2 —
// which lowers that Spell's level) onto another learned Spell to unlock its
// next level (L1→L2, or L2→L3).
//   Slot 1 (merit): Gain 1 INT + 1 WIS, then rearrange freely (unlimited).
//   Slot 2:         Gain 2 Research, then move up to 3 Research.
//   Slot 3:         Gain 1 Research, then move up to 2 Research.
//
// Both the gained Research and the moves run through the shared research
// queue: the slot queues N normal Research entries followed by one move-only
// entry (`moveOnly`, carrying a `moveBudget`). The queue drains in order, so
// the Research is gained FIRST (matching the card text), then the move-only
// entry surfaces the board's "click a W box, then an empty box" UI — the same
// machinery as `base.system.spend-research`, looping until the budget is
// spent, no legal move remains, or the player clicks "Done".
// ============================================================================

// "Unlimited" rearrange (slot 1) is modeled as a very large move budget; the
// player ends it by clicking "Done", and the prompt self-terminates once no
// legal move remains, so the cap is never actually reached in practice.
const RESEARCH_ARCHIVE_UNLIMITED_MOVES = 99;

function researchArchiveSlot(
  ctx: EffectContext,
  cfg: {
    gainInt?: number;
    gainWis?: number;
    gainResearch?: number;
    moves: number;
  },
): EffectResult {
  let working = ctx.state;
  let patch: GameStatePatch = {};

  const intGain = cfg.gainInt ?? 0;
  const wisGain = cfg.gainWis ?? 0;
  if (intGain > 0 || wisGain > 0) {
    const gainPatch = gainResourcesPatch(working, ctx.triggeringPlayerId, {
      intelligence: intGain,
      wisdom: wisGain,
    });
    working = { ...working, ...gainPatch };
    patch = { ...patch, ...gainPatch };
  }

  // Queue the gained Research first, then the move-only opportunity — order in
  // the queue is the order they resolve.
  const entries: GameState['researchQueue'] = [];
  for (let i = 0; i < (cfg.gainResearch ?? 0); i++) {
    entries.push({ playerId: ctx.triggeringPlayerId, source: ctx.source });
  }
  if (cfg.moves > 0) {
    entries.push({
      playerId: ctx.triggeringPlayerId,
      source: ctx.source,
      moveOnly: true,
      moveBudget: cfg.moves,
    });
  }
  if (entries.length > 0) {
    const qPatch: GameStatePatch = {
      researchQueue: [...working.researchQueue, ...entries],
    };
    patch = { ...patch, ...qPatch };
  }

  return { kind: 'done', patch };
}

registerEffect('mancers.room.research-archive-a.slot-1', (ctx): EffectResult =>
  researchArchiveSlot(ctx, {
    gainInt: 1,
    gainWis: 1,
    moves: RESEARCH_ARCHIVE_UNLIMITED_MOVES,
  }),
);

registerEffect('mancers.room.research-archive-a.slot-2', (ctx): EffectResult =>
  researchArchiveSlot(ctx, { gainResearch: 2, moves: 3 }),
);

registerEffect('mancers.room.research-archive-a.slot-3', (ctx): EffectResult =>
  researchArchiveSlot(ctx, { gainResearch: 1, moves: 2 }),
);

// ============================================================================
// Research Archive Side B
//   Slot 1: OR choice — Gain 1 INT + 1 Research, OR Gain 2 WIS.
//   Slot 2: Gain 2 Research, then move up to 3 Research (reuses side A).
//   Slot 3: Swap one of your (non-leader) Spells with one from the Tableau,
//           transferring all its Research. Routed through spend-research's
//           `swap-spell` action so the board UI (click your Spell, then the
//           Tableau Spell) drives it.
// ============================================================================

registerEffect('mancers.room.research-archive-b.slot-1', (ctx): EffectResult => {
  // Step 2: apply the chosen option.
  if (ctx.resumeContext?.['step'] === 'choose') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-archive-b slot-1 expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'wis2') {
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'wisdom', 2),
      };
    }
    // 'int-research': gain 1 INT now and queue 1 Research.
    const intPatch = gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'intelligence',
      1,
    );
    const working: GameState = { ...ctx.state, ...intPatch };
    const rPatch = appendResearchQueueInline(
      working,
      ctx.triggeringPlayerId,
      ctx.source,
      1,
    );
    return { kind: 'done', patch: { ...intPatch, ...rPatch } };
  }
  // Step 1: surface the OR prompt.
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'int-research', label: 'Gain 1 INT and 1 Research', payload: {} },
          { id: 'wis2', label: 'Gain 2 WIS', payload: {} },
        ],
      },
      resume: {
        effectId: 'mancers.room.research-archive-b.slot-1',
        context: { step: 'choose' },
      },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.room.research-archive-b.slot-2', (ctx): EffectResult =>
  researchArchiveSlot(ctx, { gainResearch: 2, moves: 3 }),
);

registerEffect('mancers.room.research-archive-b.slot-3', (ctx): EffectResult => {
  // Fizzle silently if there's no legal swap (no non-leader Spell owned, or
  // an empty Tableau). Otherwise surface the swap menu through spend-research
  // so the board UI drives the two clicks (own Spell → Tableau Spell).
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player || ctx.state.spellTableau.length === 0) {
    return { kind: 'done', patch: {} };
  }
  const hasSwappable = player.ownedSpells.some(
    (s) => !lookupSpellCardDef(ctx.state, s.cardId)?.unique,
  );
  if (!hasSwappable) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'swap-spell', label: 'Swap a Spell with the Tableau', payload: {} },
          { id: 'discard', label: 'Skip — no swap', payload: {} },
        ],
      },
      resume: {
        effectId: 'base.system.spend-research',
        context: { swapOnly: true },
      },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Golem Lab Side A — INSTANT room. Each slot conjures a temporary "golem"
// Mage that ignores placement limits, has no powers (off-white), and vanishes
// at end of round (`isTemporary`). Golems are created from nothing — they do
// NOT draw from any colour supply — so they ignore mage-count limits.
//   Slot 1: Pay 1 Mana → place a golem in any open slot → lock that room.
//   Slot 2: Place a golem in any open SHADOW slot (free).
//   Slot 3: Pay 3 Mana → place a golem in any open slot → take another action.
// ============================================================================

const GOLEM_CARD_ID = 'mancers.mage.golem';

/** Open base slots ignoring per-player room caps (temporary Mages ignore
 *  limits). Locked rooms and non-placeable rooms are still excluded. */
function openBaseSlotsForGolem(state: GameState): ActionSpaceId[] {
  const out: ActionSpaceId[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    if (isRoomLocked(state, r.id)) continue;
    for (const s of r.actionSpaces) if (!s.occupant) out.push(s.id);
  }
  return out;
}

/** Open shadow slots ignoring per-player room caps. */
function openShadowSlotsForGolem(state: GameState): ActionSpaceId[] {
  const out: ActionSpaceId[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    if (isRoomLocked(state, r.id)) continue;
    for (const s of r.actionSpaces) if (!s.shadowOccupant) out.push(s.id);
  }
  return out;
}

/**
 * Conjures a temporary golem Mage onto `spaceId` (base or shadow position)
 * owned by `playerId`. Body-only — no instant-room reward is triggered for
 * the golem's own landing (which also avoids a free self-recursion when the
 * golem lands on another Golem Lab slot).
 */
function summonGolemPatch(
  state: GameState,
  playerId: PlayerId,
  spaceId: ActionSpaceId,
  asShadow: boolean,
  color: MageColor = 'off-white',
): GameStatePatch {
  const seq = state.nextSequenceId;
  const golem: OwnedMage = {
    id: `m-${seq}`,
    cardId: GOLEM_CARD_ID,
    color,
    location: { kind: 'action-space', spaceId },
    isShadowing: asShadow,
    isWounded: false,
    isTemporary: true,
  };
  const occ: WorkerOccupancy = {
    mageId: golem.id,
    ownerId: playerId,
    isShadowing: asShadow,
  };
  return {
    nextSequenceId: seq + 1,
    players: state.players.map((p) =>
      p.id !== playerId ? p : { ...p, mages: [...p.mages, golem] },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId
          ? s
          : asShadow
            ? { ...s, shadowOccupant: occ }
            : { ...s, occupant: occ },
      ),
    })),
  };
}

/**
 * Conjures a golem into the player's OFFICE (not on a slot) and returns its
 * id. Used by the Side B slot-1 Sorcery (red) golem so it can place via the
 * standard Ars Magna chain (wound the occupant, then `ars-magna.complete`
 * moves THIS golem out of the office into the vacated slot).
 */
function conjureGolemInOfficePatch(
  state: GameState,
  playerId: PlayerId,
  color: MageColor,
): { patch: GameStatePatch; golemId: string } {
  const seq = state.nextSequenceId;
  const golemId = `m-${seq}`;
  const golem: OwnedMage = {
    id: golemId,
    cardId: GOLEM_CARD_ID,
    color,
    location: { kind: 'office', playerId },
    isShadowing: false,
    isWounded: false,
    isTemporary: true,
  };
  return {
    patch: {
      nextSequenceId: seq + 1,
      players: state.players.map((p) =>
        p.id !== playerId ? p : { ...p, mages: [...p.mages, golem] },
      ),
    },
    golemId,
  };
}

/** Shared first-step gate for the pay-then-place golem slots (1 and 3): check
 *  Mana affordability + an open destination, then prompt for the slot. */
function golemPlacePrompt(
  ctx: EffectContext,
  selfEffectId: string,
  manaCost: number,
): EffectResult {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player || player.resources.mana < manaCost) {
    return { kind: 'done', patch: {} };
  }
  const slots = openBaseSlotsForGolem(ctx.state);
  if (slots.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-action-space', eligibleSpaceIds: slots },
      resume: { effectId: selfEffectId, context: { step: 'apply', manaCost } },
      source: ctx.source,
    },
  };
}

// Slot 1 — Pay 1 Mana, place a golem, lock the room it lands in.
registerEffect('mancers.room.golem-lab-a.slot-1', (ctx): EffectResult => {
  const self = 'mancers.room.golem-lab-a.slot-1';
  if (ctx.resumeContext?.['step'] !== 'apply') {
    return golemPlacePrompt(ctx, self, 1);
  }
  if (ctx.resumeAnswer?.kind !== 'space-chosen') {
    throw new Error(`${self} apply expected space-chosen`);
  }
  const spaceId = ctx.resumeAnswer.spaceId;
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (
    !player ||
    player.resources.mana < 1 ||
    !openBaseSlotsForGolem(ctx.state).includes(spaceId)
  ) {
    return { kind: 'done', patch: {} };
  }
  let working: GameState = {
    ...ctx.state,
    ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -1),
  };
  working = {
    ...working,
    ...summonGolemPatch(working, ctx.triggeringPlayerId, spaceId, false),
  };
  const room = working.rooms.find((r) =>
    r.actionSpaces.some((s) => s.id === spaceId),
  );
  if (room && !room.cannotBeLocked) {
    working = { ...working, ...applyRoomLockPatch(working, room.id) };
  }
  return {
    kind: 'done',
    patch: {
      players: working.players,
      rooms: working.rooms,
      nextSequenceId: working.nextSequenceId,
      roomLocks: working.roomLocks,
    },
  };
});

// Slot 2 — Place a golem into any open shadow slot (free).
registerEffect('mancers.room.golem-lab-a.slot-2', (ctx): EffectResult => {
  const self = 'mancers.room.golem-lab-a.slot-2';
  if (ctx.resumeContext?.['step'] !== 'apply') {
    const slots = openShadowSlotsForGolem(ctx.state);
    if (slots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-action-space', eligibleSpaceIds: slots },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer?.kind !== 'space-chosen') {
    throw new Error(`${self} apply expected space-chosen`);
  }
  const spaceId = ctx.resumeAnswer.spaceId;
  if (!openShadowSlotsForGolem(ctx.state).includes(spaceId)) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'done',
    patch: summonGolemPatch(ctx.state, ctx.triggeringPlayerId, spaceId, true),
  };
});

// Slot 3 — Pay 3 Mana, place a golem, take another action.
registerEffect('mancers.room.golem-lab-a.slot-3', (ctx): EffectResult => {
  const self = 'mancers.room.golem-lab-a.slot-3';
  if (ctx.resumeContext?.['step'] !== 'apply') {
    return golemPlacePrompt(ctx, self, 3);
  }
  if (ctx.resumeAnswer?.kind !== 'space-chosen') {
    throw new Error(`${self} apply expected space-chosen`);
  }
  const spaceId = ctx.resumeAnswer.spaceId;
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (
    !player ||
    player.resources.mana < 3 ||
    !openBaseSlotsForGolem(ctx.state).includes(spaceId)
  ) {
    return { kind: 'done', patch: {} };
  }
  let working: GameState = {
    ...ctx.state,
    ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -3),
  };
  working = {
    ...working,
    ...summonGolemPatch(working, ctx.triggeringPlayerId, spaceId, false),
  };
  const patch: GameStatePatch = {
    players: working.players,
    rooms: working.rooms,
    nextSequenceId: working.nextSequenceId,
  };
  // "Take another action" — +1 to the errands extra-action counter so the
  // turn stays open for one more Action.
  if (working.phase.kind === 'errands') {
    patch.phase = {
      ...working.phase,
      extraActions: (working.phase.extraActions ?? 0) + 1,
    };
  }
  return { kind: 'done', patch };
});

// ============================================================================
// Golem Lab Side B — INSTANT room.
//   Slot 1 (merit): place a golem that takes a chosen Mage power (any type),
//                   so its on-place ability is available when conjured. The
//                   immediately-usable procs are Technomancy (orange → pay 3
//                   Gold for a Research) and Sorcery (red → Ars Magna, wound
//                   an opposing Mage). Other colours are carried on the golem
//                   for a later normal re-placement (e.g. after heal).
//   Slot 2:         Pay 2 Mana → banish a Mage → drop a golem into its slot.
//   Slot 3:         Pay 2 Mana → wound a Mage → drop a golem into its slot.
// ============================================================================

const GOLEM_COLOR_OPTIONS: { color: MageColor; label: string; pack?: string }[] = [
  { color: 'red', label: 'Sorcery (red) — Ars Magna wound' },
  { color: 'blue', label: 'Divinity (blue)' },
  { color: 'grey', label: 'Mysticism (grey)' },
  { color: 'green', label: 'Natural Magick (green)' },
  { color: 'purple', label: 'Planar Studies (purple)' },
  { color: 'orange', label: 'Technomancy (orange) — Research', pack: 'mancers' },
];

/** Opposing, currently-PLACED targets (a golem can only seize a slot that a
 *  Mage actually occupies). Filters a target-id list to opponents' Mages
 *  sitting in an action space. */
function opposingPlacedTargets(
  ids: string[],
  state: GameState,
  playerId: PlayerId,
): string[] {
  return ids.filter((mid) => {
    const owner = state.players.find((p) => p.mages.some((m) => m.id === mid));
    if (!owner || owner.id === playerId) return false;
    const m = owner.mages.find((mm) => mm.id === mid);
    return m?.location.kind === 'action-space';
  });
}

// Slot 1 — place a golem that takes a chosen Mage power. The golem places like
// a normal Mage of that colour: a Sorcery (red) golem may use Ars Magna —
// place on top of a vulnerable opponent's Mage, pay 1 Mana, wound it, and take
// its slot — exactly like the normal red Mage power.
registerEffect('mancers.room.golem-lab-b.slot-1', (ctx): EffectResult => {
  const self = 'mancers.room.golem-lab-b.slot-1';
  const step = ctx.resumeContext?.['step'];

  // A destination was chosen — place the golem of the chosen colour.
  if (step === 'place') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} place expected space-chosen`);
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const color = (ctx.resumeContext?.['color'] as MageColor) ?? 'off-white';
    const space = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === spaceId);

    // Sorcery (red) Ars Magna: the chosen slot holds a vulnerable opponent's
    // Mage. Conjure the red golem in the office, then run the standard wound →
    // reaction-window → ars-magna.complete chain (which pays nothing further —
    // the 1 Mana is spent here — and moves the golem into the vacated slot).
    if (
      color === 'red' &&
      space?.occupant &&
      canArsMagnaTakeSpace(ctx.state, ctx.triggeringPlayerId, space)
    ) {
      const targetMageId = space.occupant.mageId;
      const { patch: conjurePatch, golemId } = conjureGolemInOfficePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'red',
      );
      let working: GameState = { ...ctx.state, ...conjurePatch };
      working = {
        ...working,
        ...gainResourcePatch(working, ctx.triggeringPlayerId, 'mana', -1),
      };
      const wounded = woundMage(working, targetMageId, ctx.triggeringPlayerId);
      working = { ...working, ...wounded.patch };
      const source: ResolutionSource = {
        kind: 'mage-power',
        id: golemId,
        triggeringPlayerId: ctx.triggeringPlayerId,
        description: 'Ars Magna (Golem Lab)',
      };
      return {
        kind: 'open-reaction',
        patch: {
          players: working.players,
          rooms: working.rooms,
          nextSequenceId: working.nextSequenceId,
          pendingRevivalChecks: working.pendingRevivalChecks,
        },
        window: {
          triggerEvents: [wounded.triggerEvent],
          pendingResponderIds: buildReactionQueue(working, ctx.triggeringPlayerId),
          reactedPlayerIds: [],
          afterResume: {
            effectId: 'base.mage.sorcery.ars-magna.complete',
            context: {
              sourceMageId: golemId,
              targetSpaceId: spaceId,
              triggerEvent:
                wounded.triggerEvent as unknown as SerializableContext,
            },
          },
          source,
        },
      };
    }

    // Otherwise a normal placement into an open slot.
    if (!openBaseSlotsForGolem(ctx.state).includes(spaceId)) {
      return { kind: 'done', patch: {} };
    }
    const placePatch = summonGolemPatch(
      ctx.state,
      ctx.triggeringPlayerId,
      spaceId,
      false,
      color,
    );
    const working: GameState = { ...ctx.state, ...placePatch };

    // Technomancy (orange): queue the "pay 3 Gold → Research" trigger.
    if (color === 'orange') {
      const room = working.rooms.find((r) =>
        r.actionSpaces.some((s) => s.id === spaceId),
      );
      return {
        kind: 'done',
        patch: {
          ...placePatch,
          pendingTechnomancyTrigger: [
            ...working.pendingTechnomancyTrigger,
            { playerId: ctx.triggeringPlayerId, roomId: room?.id ?? '' },
          ],
        },
      };
    }

    return { kind: 'done', patch: placePatch };
  }

  // A colour was chosen — prompt for the destination slot. Open slots are
  // always offered; a red golem ALSO offers vulnerable opponent slots (Ars
  // Magna targets).
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} pick-slot expected option-chosen`);
    }
    const color = ctx.resumeAnswer.optionId;
    const slots = [...openBaseSlotsForGolem(ctx.state)];
    if (color === 'red') {
      for (const r of ctx.state.rooms) {
        if (r.cannotBePlacedInDirectly) continue;
        if (isRoomLocked(ctx.state, r.id)) continue;
        for (const s of r.actionSpaces) {
          if (
            s.occupant &&
            canArsMagnaTakeSpace(ctx.state, ctx.triggeringPlayerId, s) &&
            !slots.includes(s.id)
          ) {
            slots.push(s.id);
          }
        }
      }
    }
    if (slots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-action-space', eligibleSpaceIds: slots },
        resume: { effectId: self, context: { step: 'place', color } },
        source: ctx.source,
      },
    };
  }

  // Initial: choose the golem's colour / power.
  const options: ChoiceOption[] = GOLEM_COLOR_OPTIONS.filter(
    (o) => !o.pack || ctx.state.activePackIds.includes(o.pack),
  ).map((o) => ({ id: o.color, label: o.label, payload: {} }));
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'pick-slot' } },
      source: ctx.source,
    },
  };
});

// Slot 2 — Pay 2 Mana, banish a Mage, put a golem into its slot.
registerEffect('mancers.room.golem-lab-b.slot-2', (ctx): EffectResult => {
  const self = 'mancers.room.golem-lab-b.slot-2';
  const COST = 2;
  if (ctx.resumeContext?.['step'] === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const mageId = ctx.resumeAnswer.mageId;
    const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
    const owner = ctx.state.players.find((p) => p.mages.some((m) => m.id === mageId));
    const target = owner?.mages.find((m) => m.id === mageId);
    if (
      !player ||
      player.resources.mana < COST ||
      !target ||
      target.location.kind !== 'action-space'
    ) {
      return { kind: 'done', patch: {} };
    }
    const spaceId = target.location.spaceId;
    let working: GameState = {
      ...ctx.state,
      ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -COST),
    };
    const ban = banishMage(working, mageId, ctx.triggeringPlayerId);
    working = { ...working, ...ban.patch };
    working = {
      ...working,
      ...summonGolemPatch(working, ctx.triggeringPlayerId, spaceId, false),
    };
    return {
      kind: 'open-reaction',
      patch: {
        players: working.players,
        rooms: working.rooms,
        nextSequenceId: working.nextSequenceId,
      },
      window: {
        triggerEvents: [ban.triggerEvent],
        pendingResponderIds: buildReactionQueue(working, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player || player.resources.mana < COST) return { kind: 'done', patch: {} };
  const targets = opposingPlacedTargets(
    buildBanishTargets(ctx.state, ctx.triggeringPlayerId),
    ctx.state,
    ctx.triggeringPlayerId,
  );
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: targets,
        label: 'Banish a Mage — a golem seizes its slot',
      },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

// Slot 3 — Pay 2 Mana, wound a Mage, put a golem into its slot.
registerEffect('mancers.room.golem-lab-b.slot-3', (ctx): EffectResult => {
  const self = 'mancers.room.golem-lab-b.slot-3';
  const COST = 2;
  if (ctx.resumeContext?.['step'] === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const mageId = ctx.resumeAnswer.mageId;
    const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
    const owner = ctx.state.players.find((p) => p.mages.some((m) => m.id === mageId));
    const target = owner?.mages.find((m) => m.id === mageId);
    if (
      !player ||
      player.resources.mana < COST ||
      !target ||
      target.location.kind !== 'action-space'
    ) {
      return { kind: 'done', patch: {} };
    }
    const spaceId = target.location.spaceId;
    let working: GameState = {
      ...ctx.state,
      ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -COST),
    };
    const wounded = woundMage(working, mageId, ctx.triggeringPlayerId);
    working = { ...working, ...wounded.patch };
    working = {
      ...working,
      ...summonGolemPatch(working, ctx.triggeringPlayerId, spaceId, false),
    };
    return {
      kind: 'open-reaction',
      patch: {
        players: working.players,
        rooms: working.rooms,
        nextSequenceId: working.nextSequenceId,
        pendingRevivalChecks: working.pendingRevivalChecks,
      },
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(working, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.system.post-wound-bonus',
          context: {
            triggerEvent: wounded.triggerEvent as unknown as SerializableContext,
          },
        },
        source: ctx.source,
      },
    };
  }
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player || player.resources.mana < COST) return { kind: 'done', patch: {} };
  const targets = opposingPlacedTargets(
    buildBurnTargets(ctx.state, ctx.triggeringPlayerId),
    ctx.state,
    ctx.triggeringPlayerId,
  );
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: targets,
        label: 'Wound a Mage — a golem seizes its slot',
      },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// University Tavern Side A — shared slot effect (mirrors base.room.vault-a.slot
// for Supporters). The first occupied slot to resolve seeds `tavernARevealed`
// with the top 3 of the Supporter Deck; each occupant then drafts one in slot
// order. The resolution pump returns any leftovers to the top of the deck once
// it leaves the room (see advanceResolutionPointer). Fizzles silently once the
// pool is empty.
// ============================================================================

registerEffect('mancers.room.university-tavern-a.slot', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    let working = ctx.state;
    if (working.tavernARevealed === null) {
      const popped = working.supporterDeck.slice(0, 3);
      working = {
        ...working,
        tavernARevealed: popped,
        supporterDeck: working.supporterDeck.slice(popped.length),
      };
    }
    const pool = working.tavernARevealed ?? [];
    const seedPatch: GameStatePatch =
      working === ctx.state
        ? {}
        : {
            tavernARevealed: working.tavernARevealed,
            supporterDeck: working.supporterDeck,
          };
    if (pool.length === 0) {
      // Deck exhausted (or fewer cards than occupants) — nothing to draft.
      return { kind: 'done', patch: seedPatch };
    }
    return {
      kind: 'pause',
      patch: seedPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-peeked-supporter', eligibleCardIds: [...pool] },
        resume: { effectId: 'mancers.room.university-tavern-a.slot', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `university-tavern-a.slot expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const cardId = ctx.resumeAnswer.cardId;
  const pool = ctx.state.tavernARevealed ?? [];
  if (!pool.includes(cardId)) {
    throw new Error(`university-tavern-a.slot: ${cardId} not in revealed pool`);
  }
  return {
    kind: 'done',
    patch: {
      tavernARevealed: pool.filter((id) => id !== cardId),
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, supporters: [...p.supporters, cardId] },
      ),
    },
  };
});

// ============================================================================
// University Tavern Side B — per-slot peek-and-keep (Mystic Lantern style, but
// the kept card is a normal Supporter). Each slot independently reveals the
// top N of the Supporter Deck; the occupant keeps one and the unchosen cards
// go to the BOTTOM of the deck. Slot 3 (reveal 1) is a no-choice "draw & keep".
// No shared pool — prompts block deck mutations, so each slot peeks the live
// top in resolution order.
// ============================================================================

/** Builds the patch that grants `chosen` to the player and cycles the rest of
 *  the `peeked` cards to the bottom of the Supporter Deck. */
function tavernBKeepPatch(
  state: GameState,
  playerId: PlayerId,
  peeked: string[],
  chosen: string,
): GameStatePatch {
  const unchosen = peeked.filter((id) => id !== chosen);
  return {
    supporterDeck: [...state.supporterDeck.slice(peeked.length), ...unchosen],
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : { ...p, supporters: [...p.supporters, chosen] },
    ),
  };
}

function universityTavernBDraft(
  ctx: EffectContext,
  selfEffectId: string,
  revealCount: number,
): EffectResult {
  if (!ctx.resumeAnswer) {
    const peeked = ctx.state.supporterDeck.slice(0, revealCount);
    if (peeked.length === 0) return { kind: 'done', patch: {} };
    // A single card (or a reveal-1 slot) is just drawn and kept — no choice.
    if (peeked.length === 1) {
      return {
        kind: 'done',
        patch: tavernBKeepPatch(
          ctx.state,
          ctx.triggeringPlayerId,
          peeked,
          peeked[0]!,
        ),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-peeked-supporter', eligibleCardIds: [...peeked] },
        resume: { effectId: selfEffectId, context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `${selfEffectId} expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const chosen = ctx.resumeAnswer.cardId;
  // Re-peek (prompts block deck mutations, so this matches the original peek).
  const peeked = ctx.state.supporterDeck.slice(0, revealCount);
  if (!peeked.includes(chosen)) {
    throw new Error(`${selfEffectId}: ${chosen} not among the revealed cards`);
  }
  return {
    kind: 'done',
    patch: tavernBKeepPatch(ctx.state, ctx.triggeringPlayerId, peeked, chosen),
  };
}

registerEffect('mancers.room.university-tavern-b.slot-1', (ctx): EffectResult =>
  universityTavernBDraft(ctx, 'mancers.room.university-tavern-b.slot-1', 3),
);
registerEffect('mancers.room.university-tavern-b.slot-2', (ctx): EffectResult =>
  universityTavernBDraft(ctx, 'mancers.room.university-tavern-b.slot-2', 2),
);
registerEffect('mancers.room.university-tavern-b.slot-3', (ctx): EffectResult =>
  universityTavernBDraft(ctx, 'mancers.room.university-tavern-b.slot-3', 1),
);

// ============================================================================
// Atelier Side A.
//   Slots 1 & 2 — pick ONE exchange direction (Gold→Mana or Mana→Gold), then
//   swap up to N times in that direction only (no back-and-forth). Each swap
//   spends 1 of the source resource for the configured amount of the other.
//   Slot 3 — draft a Consumable from the Vault tableau, or (if none are shown)
//   draw a random Consumable from the Vault deck.
// ============================================================================

/** Builds the "swap again? / stop" prompt for the chosen direction. */
function atelierAsk(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: { goldToMana: number; manaToGold: number; total: number },
  dir: 'g2m' | 'm2g',
  remaining: number,
  carryPatch: GameStatePatch,
): EffectResult {
  const label =
    dir === 'g2m'
      ? `Swap 1 Gold for ${cfg.goldToMana} Mana`
      : `Swap 1 Mana for ${cfg.manaToGold} Gold`;
  return {
    kind: 'pause',
    patch: carryPatch,
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'swap', label: `${label} (${remaining} left)`, payload: {} },
          { id: 'stop', label: 'Stop swapping', payload: {} },
        ],
      },
      resume: { effectId: selfEffectId, context: { step: 'ask', dir, remaining } },
      source: ctx.source,
    },
  };
}

function atelierSwapSlot(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: { goldToMana: number; manaToGold: number; total: number },
): EffectResult {
  const step = ctx.resumeContext?.['step'];
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  if (step === 'ask') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} ask expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') return { kind: 'done', patch: {} };
    const dir = ctx.resumeContext?.['dir'] === 'm2g' ? 'm2g' : 'g2m';
    const remaining = Number(ctx.resumeContext?.['remaining'] ?? 0);
    const src = dir === 'g2m' ? 'gold' : 'mana';
    const tgt = dir === 'g2m' ? 'mana' : 'gold';
    const tgtAmt = dir === 'g2m' ? cfg.goldToMana : cfg.manaToGold;
    if (player.resources[src] < 1) return { kind: 'done', patch: {} };
    let working: GameState = {
      ...ctx.state,
      ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, src, -1),
    };
    working = {
      ...working,
      ...gainResourcePatch(working, ctx.triggeringPlayerId, tgt, tgtAmt),
    };
    const patch: GameStatePatch = { players: working.players };
    const next = remaining - 1;
    const after = working.players.find((p) => p.id === ctx.triggeringPlayerId)!;
    if (next > 0 && after.resources[src] >= 1) {
      return atelierAsk(
        { ...ctx, state: working },
        selfEffectId,
        cfg,
        dir,
        next,
        patch,
      );
    }
    return { kind: 'done', patch };
  }

  if (step === 'direction') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} direction expected option-chosen`);
    }
    const opt = ctx.resumeAnswer.optionId;
    if (opt === 'skip') return { kind: 'done', patch: {} };
    const dir = opt === 'mana-to-gold' ? 'm2g' : 'g2m';
    return atelierAsk(ctx, selfEffectId, cfg, dir, cfg.total, {});
  }

  // Initial: offer the affordable direction(s).
  const options: ChoiceOption[] = [];
  if (player.resources.gold >= 1) {
    options.push({
      id: 'gold-to-mana',
      label: `Swap 1 Gold for ${cfg.goldToMana} Mana (up to ${cfg.total}×)`,
      payload: {},
    });
  }
  if (player.resources.mana >= 1) {
    options.push({
      id: 'mana-to-gold',
      label: `Swap 1 Mana for ${cfg.manaToGold} Gold (up to ${cfg.total}×)`,
      payload: {},
    });
  }
  if (options.length === 0) return { kind: 'done', patch: {} };
  options.push({ id: 'skip', label: 'Skip', payload: {} });
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: selfEffectId, context: { step: 'direction' } },
      source: ctx.source,
    },
  };
}

registerEffect('mancers.room.atelier-a.slot-1', (ctx): EffectResult =>
  atelierSwapSlot(ctx, 'mancers.room.atelier-a.slot-1', {
    goldToMana: 3,
    manaToGold: 4,
    total: 3,
  }),
);
registerEffect('mancers.room.atelier-a.slot-2', (ctx): EffectResult =>
  atelierSwapSlot(ctx, 'mancers.room.atelier-a.slot-2', {
    goldToMana: 2,
    manaToGold: 3,
    total: 4,
  }),
);

// Slot 3 — draft a Consumable from the Vault tableau, else draw one from the
// deck at random.
registerEffect('mancers.room.atelier-a.slot-3', (ctx): EffectResult => {
  const isConsumable = (id: string) =>
    lookupVaultCardDef(ctx.state, id)?.type === 'consumable';
  if (!ctx.resumeAnswer) {
    const shown = ctx.state.vaultTableau.filter(isConsumable);
    if (shown.length > 0) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-vault-card', eligibleCardIds: [...shown] },
          resume: {
            effectId: 'mancers.room.atelier-a.slot-3',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    // None on the tableau — draw a random Consumable from the deck.
    const deckConsumables = ctx.state.vaultDeck.filter(isConsumable);
    if (deckConsumables.length === 0) return { kind: 'done', patch: {} };
    const { value, state: nextRng } = nextRandom(ctx.state.rng);
    const pick =
      deckConsumables[Math.floor(value * deckConsumables.length)] ??
      deckConsumables[0]!;
    return {
      kind: 'done',
      patch: {
        rng: nextRng,
        vaultDeck: ctx.state.vaultDeck.filter((id) => id !== pick),
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : { ...p, vaultCards: [...p.vaultCards, { cardId: pick, exhausted: false }] },
        ),
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `atelier-a.slot-3 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const cardId = ctx.resumeAnswer.cardId;
  if (!ctx.state.vaultTableau.includes(cardId) || !isConsumable(cardId)) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'done',
    patch: applyVaultDraft(ctx.state, ctx.triggeringPlayerId, cardId),
  };
});

// ============================================================================
// Atelier Side B — trade in a Consumable (unused from the office OR a used one
// from the discard pile) plus optional Mana for a reward.
//   Slot 1 (merit): Consumable → 6 Mana.
//   Slot 2:         Consumable + 2 Mana → 4 IP.
//   Slot 3:         Consumable + 4 Mana → 12 Gold.
// ============================================================================

/** Every Consumable the player can trade in: unused cards in their office plus
 *  used ones in their discard pile. Returns each id with a `used` flag for the
 *  prompt label. */
function eligibleSwapConsumables(
  state: GameState,
  player: GameState['players'][number],
): { cardId: string; used: boolean }[] {
  const out: { cardId: string; used: boolean }[] = [];
  for (const v of player.vaultCards) {
    if (lookupVaultCardDef(state, v.cardId)?.type === 'consumable') {
      out.push({ cardId: v.cardId, used: false });
    }
  }
  for (const e of player.personalDiscard) {
    if (e.kind === 'consumable') out.push({ cardId: e.cardId, used: true });
  }
  return out;
}

/** Removes the given Consumable from wherever the player holds it (office or
 *  discard) — the card is traded away and leaves the player entirely. */
function removeConsumablePatch(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): GameStatePatch {
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            vaultCards: p.vaultCards.filter((v) => v.cardId !== cardId),
            personalDiscard: p.personalDiscard.filter(
              (e) => !(e.kind === 'consumable' && e.cardId === cardId),
            ),
          },
    ),
  };
}

function atelierBSwapSlot(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: { manaCost: number; reward: (state: GameState, pid: PlayerId) => GameStatePatch },
): EffectResult {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  if (!ctx.resumeAnswer) {
    // Need the extra Mana AND at least one Consumable to trade.
    if (player.resources.mana < cfg.manaCost) return { kind: 'done', patch: {} };
    const eligible = eligibleSwapConsumables(ctx.state, player);
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    const options: ChoiceOption[] = eligible.map(({ cardId, used }) => ({
      id: cardId,
      label: `${lookupVaultCardDef(ctx.state, cardId)?.name ?? cardId}${used ? ' (used)' : ''}`,
      payload: {},
    }));
    options.push({ id: 'skip', label: 'Skip', payload: {} });
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: selfEffectId, context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(`${selfEffectId} expected option-chosen`);
  }
  const opt = ctx.resumeAnswer.optionId;
  if (opt === 'skip') return { kind: 'done', patch: {} };
  // Re-validate against the live state.
  const stillEligible = eligibleSwapConsumables(ctx.state, player).some(
    (e) => e.cardId === opt,
  );
  if (!stillEligible || player.resources.mana < cfg.manaCost) {
    return { kind: 'done', patch: {} };
  }
  let working: GameState = {
    ...ctx.state,
    ...removeConsumablePatch(ctx.state, ctx.triggeringPlayerId, opt),
  };
  if (cfg.manaCost > 0) {
    working = {
      ...working,
      ...gainResourcePatch(working, ctx.triggeringPlayerId, 'mana', -cfg.manaCost),
    };
  }
  working = { ...working, ...cfg.reward(working, ctx.triggeringPlayerId) };
  return {
    kind: 'done',
    patch: { players: working.players, nextSequenceId: working.nextSequenceId },
  };
}

registerEffect('mancers.room.atelier-b.slot-1', (ctx): EffectResult =>
  atelierBSwapSlot(ctx, 'mancers.room.atelier-b.slot-1', {
    manaCost: 0,
    reward: (state, pid) => gainResourcePatch(state, pid, 'mana', 6),
  }),
);
registerEffect('mancers.room.atelier-b.slot-2', (ctx): EffectResult =>
  atelierBSwapSlot(ctx, 'mancers.room.atelier-b.slot-2', {
    manaCost: 2,
    reward: (state, pid) => bumpInfluencePatch(state, pid, 4),
  }),
);
registerEffect('mancers.room.atelier-b.slot-3', (ctx): EffectResult =>
  atelierBSwapSlot(ctx, 'mancers.room.atelier-b.slot-3', {
    manaCost: 4,
    reward: (state, pid) => gainResourcePatch(state, pid, 'gold', 12),
  }),
);

// ============================================================================
// Synthesis Workshop Side A — convert an UNUSED Treasure + an UNUSED Supporter
// (and 2 Mana for slot 2) into the Synthesis Treasure matching the Supporter's
// department. A 'wild' (all-department) Supporter lets the player pick any.
// Multi-step: pick Treasure → pick Supporter → (maybe pick item) → apply.
// ============================================================================

/** Unused Treasures the player owns (unexhausted, type 'treasure'). */
function unusedTreasures(state: GameState, player: GameState['players'][number]) {
  return player.vaultCards.filter(
    (v) => !v.exhausted && lookupVaultCardDef(state, v.cardId)?.type === 'treasure',
  );
}

function applySynthesisSwap(
  state: GameState,
  playerId: PlayerId,
  treasureId: string,
  supporterId: string,
  synthesisId: string,
  manaCost: number,
): GameStatePatch {
  let working: GameState = state;
  if (manaCost > 0) {
    working = {
      ...working,
      ...gainResourcePatch(working, playerId, 'mana', -manaCost),
    };
  }
  working = {
    ...working,
    players: working.players.map((p) => {
      if (p.id !== playerId) return p;
      // Remove the first unexhausted copy of the traded Treasure and the first
      // copy of the traded Supporter; add the gained Synthesis Treasure.
      let removedTreasure = false;
      const vaultCards = p.vaultCards.filter((v) => {
        if (!removedTreasure && v.cardId === treasureId && !v.exhausted) {
          removedTreasure = true;
          return false;
        }
        return true;
      });
      let removedSupporter = false;
      const supporters = p.supporters.filter((id) => {
        if (!removedSupporter && id === supporterId) {
          removedSupporter = true;
          return false;
        }
        return true;
      });
      return {
        ...p,
        vaultCards: [...vaultCards, { cardId: synthesisId, exhausted: false }],
        supporters,
      };
    }),
  };
  return { players: working.players };
}

function synthesisWorkshopSlot(
  ctx: EffectContext,
  selfEffectId: string,
  manaCost: number,
): EffectResult {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  const step = ctx.resumeContext?.['step'];

  // Apply the swap with a player-picked Synthesis item (wild Supporter path).
  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} apply expected option-chosen`);
    }
    const synthesisId = ctx.resumeAnswer.optionId;
    const treasureId = ctx.resumeContext?.['treasureId'];
    const supporterId = ctx.resumeContext?.['supporterId'];
    if (
      typeof treasureId !== 'string' ||
      typeof supporterId !== 'string' ||
      !ALL_SYNTHESIS_IDS.includes(synthesisId)
    ) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'done',
      patch: applySynthesisSwap(
        ctx.state,
        ctx.triggeringPlayerId,
        treasureId,
        supporterId,
        synthesisId,
        manaCost,
      ),
    };
  }

  // A Supporter was chosen — resolve its department to a Synthesis item.
  if (step === 'supporter') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} supporter expected option-chosen`);
    }
    const supporterId = ctx.resumeAnswer.optionId;
    const treasureId = ctx.resumeContext?.['treasureId'];
    if (typeof treasureId !== 'string') return { kind: 'done', patch: {} };
    const dept = lookupSupporterCardDef(ctx.state, supporterId)?.department;
    const mapped = dept ? SYNTHESIS_BY_DEPARTMENT[dept] : undefined;
    if (mapped) {
      return {
        kind: 'done',
        patch: applySynthesisSwap(
          ctx.state,
          ctx.triggeringPlayerId,
          treasureId,
          supporterId,
          mapped,
          manaCost,
        ),
      };
    }
    // 'wild' (or any non-magic department) — let the player pick any item.
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: ALL_SYNTHESIS_IDS.map((id) => ({
            id,
            label: lookupVaultCardDef(ctx.state, id)?.name ?? id,
            payload: {},
          })),
        },
        resume: {
          effectId: selfEffectId,
          context: { step: 'apply', treasureId, supporterId },
        },
        source: ctx.source,
      },
    };
  }

  // A Treasure was chosen — prompt for the Supporter to trade.
  if (step === 'treasure') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} treasure expected option-chosen`);
    }
    const treasureId = ctx.resumeAnswer.optionId;
    if (player.supporters.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: player.supporters.map((id) => ({
            id,
            label: lookupSupporterCardDef(ctx.state, id)?.name ?? id,
            payload: {},
          })),
        },
        resume: { effectId: selfEffectId, context: { step: 'supporter', treasureId } },
        source: ctx.source,
      },
    };
  }

  // Initial: require an unused Treasure, an unused Supporter, and the Mana.
  const treasures = unusedTreasures(ctx.state, player);
  if (
    treasures.length === 0 ||
    player.supporters.length === 0 ||
    player.resources.mana < manaCost
  ) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: treasures.map((v) => ({
          id: v.cardId,
          label: lookupVaultCardDef(ctx.state, v.cardId)?.name ?? v.cardId,
          payload: {},
        })),
      },
      resume: { effectId: selfEffectId, context: { step: 'treasure' } },
      source: ctx.source,
    },
  };
}

registerEffect('mancers.room.synthesis-workshop-a.slot-1', (ctx): EffectResult =>
  synthesisWorkshopSlot(ctx, 'mancers.room.synthesis-workshop-a.slot-1', 0),
);
registerEffect('mancers.room.synthesis-workshop-a.slot-2', (ctx): EffectResult =>
  synthesisWorkshopSlot(ctx, 'mancers.room.synthesis-workshop-a.slot-2', 2),
);

// ============================================================================
// Synthesis Treasure — Endless Well of Mana (Technomancy): Fast Action, gain
// 2 Mana. (The other synthesis item effects are wired separately.)
// ============================================================================

registerEffect('mancers.vault.endless-well-of-mana', (ctx): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 2),
}));

// ============================================================================
// Synthesis Treasure — Sword of Flame (Sorcery): Fast Action, spend 1 Mana to
// wound a Mage and place one of yours in its slot. Reuses the standard Ars
// Magna completion (wound → reaction window → move your Mage into the slot +
// Infirmary bonus).
// ============================================================================

registerEffect('mancers.vault.sword-of-flame', (ctx): EffectResult => {
  const self = 'mancers.vault.sword-of-flame';
  const step = ctx.resumeContext?.['step'];
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') return { kind: 'done', patch: {} };
    const placer = player.mages.find((m) => m.id === placerMageId);
    const target = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (
      !placer ||
      placer.location.kind !== 'office' ||
      !target ||
      target.location.kind !== 'action-space' ||
      player.resources.mana < 1
    ) {
      return { kind: 'done', patch: {} };
    }
    const targetSpaceId = target.location.spaceId;
    let working: GameState = {
      ...ctx.state,
      ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -1),
    };
    const wound = woundMage(working, targetMageId, ctx.triggeringPlayerId);
    working = { ...working, ...wound.patch };
    return {
      kind: 'open-reaction',
      patch: {
        players: working.players,
        rooms: working.rooms,
        nextSequenceId: working.nextSequenceId,
        pendingRevivalChecks: working.pendingRevivalChecks,
      },
      window: {
        triggerEvents: [wound.triggerEvent],
        pendingResponderIds: buildReactionQueue(working, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.mage.sorcery.ars-magna.complete',
          context: {
            sourceMageId: placerMageId,
            targetSpaceId,
            triggerEvent: wound.triggerEvent as unknown as SerializableContext,
          },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-placer') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-placer expected mage-chosen`);
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const officeMages = player.mages
      .filter((m) => m.location.kind === 'office')
      .map((m) => m.id);
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: officeMages,
          label: 'Place which of your Mages into the slot?',
        },
        resume: { effectId: self, context: { step: 'apply', targetMageId } },
        source: ctx.source,
      },
    };
  }

  // Initial: need 1 Mana, an office Mage to place, and a wound target on a slot.
  if (player.resources.mana < 1) return { kind: 'done', patch: {} };
  if (!player.mages.some((m) => m.location.kind === 'office')) {
    return { kind: 'done', patch: {} };
  }
  const targets = opposingPlacedTargets(
    buildBurnTargets(ctx.state, ctx.triggeringPlayerId),
    ctx.state,
    ctx.triggeringPlayerId,
  );
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: targets,
        label: 'Wound which Mage (you take its slot)?',
      },
      resume: { effectId: self, context: { step: 'pick-placer' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Synthesis Treasure — Vanishing Staff (Mysticism): Action, spend 1 Mana to
// shadow any space (including your own Mage or an empty slot) with one of your
// office Mages. Shadowing an opponent's Mage opens the standard mage-shadowed
// reaction window.
// ============================================================================

registerEffect('mancers.vault.vanishing-staff', (ctx): EffectResult => {
  const self = 'mancers.vault.vanishing-staff';
  const step = ctx.resumeContext?.['step'];
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const mageId = ctx.resumeContext?.['mageId'];
    if (typeof mageId !== 'string') return { kind: 'done', patch: {} };
    const mage = player.mages.find((m) => m.id === mageId);
    const space = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === spaceId);
    if (
      !mage ||
      mage.location.kind !== 'office' ||
      !space ||
      space.shadowOccupant ||
      player.resources.mana < 1
    ) {
      return { kind: 'done', patch: {} };
    }
    let working: GameState = {
      ...ctx.state,
      ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -1),
    };
    const occ: WorkerOccupancy = {
      mageId,
      ownerId: ctx.triggeringPlayerId,
      isShadowing: true,
    };
    working = {
      ...working,
      players: working.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              mages: p.mages.map((m) =>
                m.id !== mageId
                  ? m
                  : {
                      ...m,
                      location: { kind: 'action-space', spaceId },
                      isShadowing: true,
                    },
              ),
            },
      ),
      rooms: working.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== spaceId ? s : { ...s, shadowOccupant: occ },
        ),
      })),
    };
    const patch: GameStatePatch = {
      players: working.players,
      rooms: working.rooms,
    };
    // Shadowing an opponent's base Mage opens a mage-shadowed reaction window.
    const baseOcc = space.occupant;
    if (baseOcc && baseOcc.ownerId !== ctx.triggeringPlayerId) {
      const event: ReactionTriggerEvent = {
        kind: 'mage-shadowed',
        mageId: baseOcc.mageId,
        ownerId: baseOcc.ownerId,
        byPlayerId: ctx.triggeringPlayerId,
        spaceId,
      };
      return {
        kind: 'open-reaction',
        patch,
        window: {
          triggerEvents: [event],
          pendingResponderIds: buildReactionQueue(working, ctx.triggeringPlayerId),
          reactedPlayerIds: [],
          afterResume: { effectId: 'base.system.noop', context: {} },
          source: ctx.source,
        },
      };
    }
    return { kind: 'done', patch };
  }

  if (step === 'space') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} space expected mage-chosen`);
    }
    const mageId = ctx.resumeAnswer.mageId;
    const spaces = openShadowSlotsForGolem(ctx.state);
    if (spaces.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-action-space', eligibleSpaceIds: spaces },
        resume: { effectId: self, context: { step: 'apply', mageId } },
        source: ctx.source,
      },
    };
  }

  // Initial: need 1 Mana, an office Mage, and an open shadow position.
  if (player.resources.mana < 1) return { kind: 'done', patch: {} };
  const officeMages = player.mages
    .filter((m) => m.location.kind === 'office')
    .map((m) => m.id);
  if (officeMages.length === 0) return { kind: 'done', patch: {} };
  if (openShadowSlotsForGolem(ctx.state).length === 0) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: officeMages,
        label: 'Shadow a space with which of your Mages?',
      },
      resume: { effectId: self, context: { step: 'space' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Synthesis Treasure — Lightning Totem (Natural Magick): Fast Action, spend 1
// Mana to wound up to 2 Mages in the same room. Wounds open a single batch
// reaction window (each affected owner reacts once); Infirmary bonuses are
// surfaced afterward via the engine's `base.system.batch-post-wound-bonus`.
// ============================================================================

/** The id of the room a placed Mage occupies (base or shadow position). */
function roomIdOfMage(state: GameState, mageId: string): string | null {
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.occupant?.mageId === mageId || s.shadowOccupant?.mageId === mageId) {
        return r.id;
      }
    }
  }
  return null;
}

registerEffect('mancers.vault.lightning-totem', (ctx): EffectResult => {
  const self = 'mancers.vault.lightning-totem';
  const step = ctx.resumeContext?.['step'];
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  // A first target was chosen — offer a same-room second (or wound just one).
  if (step === 'second') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} second expected mage-chosen`);
    }
    const firstId = ctx.resumeAnswer.mageId;
    const secondCandidates = opposingPlacedTargets(
      buildBurnTargets(ctx.state, ctx.triggeringPlayerId),
      ctx.state,
      ctx.triggeringPlayerId,
    ).filter(
      (id) =>
        id !== firstId &&
        roomIdOfMage(ctx.state, id) === roomIdOfMage(ctx.state, firstId),
    );
    if (secondCandidates.length > 0) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: secondCandidates,
            canPass: true,
            label: 'Wound a second Mage in the same room (or pass)',
          },
          resume: { effectId: self, context: { step: 'apply', firstId } },
          source: ctx.source,
        },
      };
    }
    // No same-room second target — wound just the first.
    return lightningApply(ctx, [firstId]);
  }

  // The optional second target resolved (or was passed) — wound them.
  if (step === 'apply') {
    const firstId = ctx.resumeContext?.['firstId'];
    if (typeof firstId !== 'string') return { kind: 'done', patch: {} };
    const mageIds = [firstId];
    if (ctx.resumeAnswer?.kind === 'mage-chosen') {
      mageIds.push(ctx.resumeAnswer.mageId);
    }
    return lightningApply(ctx, mageIds);
  }

  // Initial: need 1 Mana and a woundable opposing Mage on a slot.
  if (player.resources.mana < 1) return { kind: 'done', patch: {} };
  const targets = opposingPlacedTargets(
    buildBurnTargets(ctx.state, ctx.triggeringPlayerId),
    ctx.state,
    ctx.triggeringPlayerId,
  );
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: targets,
        label: 'Wound which Mage (up to 2 in one room)?',
      },
      resume: { effectId: self, context: { step: 'second' } },
      source: ctx.source,
    },
  };
});

/** Pays 1 Mana, wounds the chosen Mages, and opens one batch reaction window
 *  whose afterResume surfaces per-owner Infirmary bonuses. */
function lightningApply(ctx: EffectContext, mageIds: string[]): EffectResult {
  const playerId = ctx.triggeringPlayerId;
  const player = ctx.state.players.find((p) => p.id === playerId);
  if (!player || player.resources.mana < 1) return { kind: 'done', patch: {} };
  let working: GameState = {
    ...ctx.state,
    ...gainResourcePatch(ctx.state, playerId, 'mana', -1),
  };
  // Wound each (skip any that slipped off a slot since selection).
  const events: ReactionTriggerEvent[] = [];
  for (const mageId of mageIds) {
    const m = working.players.flatMap((p) => p.mages).find((mm) => mm.id === mageId);
    if (!m || m.location.kind !== 'action-space') continue;
    const wound = woundMage(working, mageId, playerId);
    working = { ...working, ...wound.patch };
    events.push(wound.triggerEvent);
  }
  if (events.length === 0) {
    return { kind: 'done', patch: { players: working.players } };
  }
  // Reactor queue: affected owners (excluding the caster) in turn order.
  const affected = new Set(
    events.map((e) => ('ownerId' in e ? e.ownerId : '')).filter(Boolean),
  );
  affected.delete(playerId);
  const reactorQueue = buildReactionQueue(working, playerId).filter((pid) =>
    affected.has(pid),
  );
  // Order events by reactor turn order for the Infirmary-bonus walk.
  const rank = new Map(reactorQueue.map((pid, i) => [pid, i] as const));
  const ordered = [...events].sort((a, b) => {
    const ar = 'ownerId' in a ? (rank.get(a.ownerId) ?? 9999) : 9999;
    const br = 'ownerId' in b ? (rank.get(b.ownerId) ?? 9999) : 9999;
    return ar - br;
  });
  return {
    kind: 'open-reaction',
    patch: {
      players: working.players,
      rooms: working.rooms,
      nextSequenceId: working.nextSequenceId,
      pendingRevivalChecks: working.pendingRevivalChecks,
    },
    window: {
      triggerEvents: events,
      pendingResponderIds: reactorQueue,
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.batch-post-wound-bonus',
        context: {
          events: ordered as unknown as SerializableContext['events'],
          queueIndex: 0,
        },
      },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Synthesis Treasure — Hourglass of Fate (Planar Studies): Reaction. When the
// last Bell Tower Offering is taken by ANOTHER player, place one of your
// office Mages — WITH its Mage powers (unlike Tardy / Stop Time, which place
// without powers). The two immediate placement powers are Sorcery (red → Ars
// Magna, place onto a vulnerable opponent and wound it) and Technomancy
// (orange → pay 3 Gold for a Research). The card exhausts on use.
// ============================================================================

registerEffect('mancers.vault.hourglass-of-fate.react', (ctx): EffectResult => {
  const self = 'mancers.vault.hourglass-of-fate.react';
  const step = ctx.resumeContext?.['step'];
  const playerId = ctx.triggeringPlayerId;
  const player = ctx.state.players.find((p) => p.id === playerId);
  if (!player) return { kind: 'done', patch: {} };

  // Place the chosen office Mage into the chosen slot, firing its power.
  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const mageId = ctx.resumeContext?.['mageId'];
    if (typeof mageId !== 'string') return { kind: 'done', patch: {} };
    const mage = player.mages.find((m) => m.id === mageId);
    if (!mage || mage.location.kind !== 'office') return { kind: 'done', patch: {} };
    const space = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === spaceId);

    // Sorcery (red) Ars Magna: place onto a vulnerable opponent's slot.
    if (
      actsAsColor(mage, 'red') &&
      space?.occupant &&
      canArsMagnaTakeSpace(ctx.state, playerId, space)
    ) {
      const targetMageId = space.occupant.mageId;
      let working: GameState = {
        ...ctx.state,
        ...gainResourcePatch(ctx.state, playerId, 'mana', -1),
      };
      const wound = woundMage(working, targetMageId, playerId);
      working = { ...working, ...wound.patch };
      return {
        kind: 'open-reaction',
        patch: {
          players: working.players,
          rooms: working.rooms,
          nextSequenceId: working.nextSequenceId,
          pendingRevivalChecks: working.pendingRevivalChecks,
        },
        window: {
          triggerEvents: [wound.triggerEvent],
          pendingResponderIds: buildReactionQueue(working, playerId),
          reactedPlayerIds: [],
          afterResume: {
            effectId: 'base.mage.sorcery.ars-magna.complete',
            context: {
              sourceMageId: mageId,
              targetSpaceId: spaceId,
              triggerEvent: wound.triggerEvent as unknown as SerializableContext,
            },
          },
          source: ctx.source,
        },
      };
    }

    // Normal placement into an open slot (cap/lock aware).
    if (!listPlaceWithoutPowersSlots(ctx.state, playerId, undefined).includes(spaceId)) {
      return { kind: 'done', patch: {} };
    }
    const occ: WorkerOccupancy = { mageId, ownerId: playerId, isShadowing: false };
    let working: GameState = {
      ...ctx.state,
      players: ctx.state.players.map((p) =>
        p.id !== playerId
          ? p
          : {
              ...p,
              mages: p.mages.map((m) =>
                m.id !== mageId
                  ? m
                  : { ...m, location: { kind: 'action-space', spaceId } },
              ),
            },
      ),
      rooms: ctx.state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== spaceId ? s : { ...s, occupant: occ },
        ),
      })),
    };
    const patch: GameStatePatch = { players: working.players, rooms: working.rooms };
    // Technomancy (orange): queue the "pay 3 Gold → Research" trigger.
    if (actsAsColor(mage, 'orange')) {
      const room = working.rooms.find((r) =>
        r.actionSpaces.some((s) => s.id === spaceId),
      );
      patch.pendingTechnomancyTrigger = [
        ...working.pendingTechnomancyTrigger,
        { playerId, roomId: room?.id ?? '' },
      ];
    }
    return { kind: 'done', patch };
  }

  // A Mage was chosen — prompt for the destination (open slots + Ars Magna
  // targets when the Mage is red).
  if (step === 'slot') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} slot expected mage-chosen`);
    }
    const mageId = ctx.resumeAnswer.mageId;
    const mage = player.mages.find((m) => m.id === mageId);
    const slots = [...listPlaceWithoutPowersSlots(ctx.state, playerId, undefined)];
    if (mage && actsAsColor(mage, 'red')) {
      for (const r of ctx.state.rooms) {
        if (r.cannotBePlacedInDirectly || isRoomLocked(ctx.state, r.id)) continue;
        for (const s of r.actionSpaces) {
          if (
            s.occupant &&
            canArsMagnaTakeSpace(ctx.state, playerId, s) &&
            !slots.includes(s.id)
          ) {
            slots.push(s.id);
          }
        }
      }
    }
    if (slots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: playerId,
        prompt: { kind: 'choose-target-action-space', eligibleSpaceIds: slots },
        resume: { effectId: self, context: { step: 'apply', mageId } },
        source: ctx.source,
      },
    };
  }

  // Reaction entry: exhaust the card, then prompt for which Mage to place.
  const exhaustPatch: GameStatePatch = {
    players: ctx.state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            vaultCards: p.vaultCards.map((v) =>
              v.cardId === 'mancers.vault.hourglass-of-fate' && !v.exhausted
                ? { ...v, exhausted: true }
                : v,
            ),
          },
    ),
  };
  const mages = listPlaceWithoutPowersMages(ctx.state, playerId);
  if (mages.length === 0) return { kind: 'done', patch: exhaustPatch };
  return {
    kind: 'pause',
    patch: exhaustPatch,
    pending: {
      responderId: playerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: mages,
        label: 'Place which Mage (with its powers)?',
      },
      resume: { effectId: self, context: { step: 'slot' } },
      source: ctx.source,
    },
  };
});

// Re-export to satisfy the module's existing `export {}` shape.
export {};

// Touch unused imports to keep tsc happy when the chain doesn't exercise
// every code path — these are part of the effect's surface area.
void getEffect;
void hasEffect;
