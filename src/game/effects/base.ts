// Base game effect implementations. Currently scoped to the Vertical Slice
// targets: Library A slot 1, Burn L1, Phase Steppers reaction.

import { getEffect, hasEffect, registerEffect } from './registry';
import { computeFinalScoring, playerOwnsWildSupporter } from '../scoring';
import { getPack } from '../../content/registry';
import { getOrthogonallyAdjacentRoomIds } from '../setup';
import {
  affordableVaultCards,
  applyAddWisToSpell,
  applyDiscardOwnedSpell,
  applyDraftLegendarySpell,
  applyDraftSpell,
  applyGainMark,
  applyGoldForMageSwap,
  applyInfirmaryBonusPatch,
  applyMoveWisBetweenSpells,
  applySecretSupporterDraw,
  applySupporterDraft,
  applyVaultDraft,
  applyVaultPurchaseMaybeWaived,
  banishMage,
  buildArsMagnaTargets,
  buildBanishTargets,
  buildBurnTargets,
  buildMageShadowedEvent,
  buildNonSpellHarmfulTargets,
  buildReactionQueue,
  bumpInfluencePatch,
  checkInfirmaryBonusApplies,
  eligibleVotersForMark,
  findActionSpace,
  findRoomBySpaceId,
  gainResourcePatch,
  gainResourcesPatch,
  buildRefreshOwnedSpellPrompt,
  healMageToSpace,
  applyRoomLockPatch,
  buildSpellMoveTargets,
  buildSpellShadowTargets,
  findMageSlotPosition,
  isLegendarySpell,
  isRoomAtPlayerCap,
  isRoomLocked,
  lookupSpellCardDef,
  moveMageToSpace,
  placeOfficeMageAsShadow,
  refreshOwnedSpellPatch,
  returnMageToOfficePatch,
  playerHasAuricCatalyst,
  spellLabel,
  unclaimedLegendaryBooks,
  woundMage,
} from './helpers';
import type {
  ActionSpaceId,
  ChoiceOption,
  Department,
  EffectContext,
  EffectResult,
  GameState,
  GameStatePatch,
  HarmfulEffectKind,
  MageColor,
  MageImmunityBuff,
  MagesLosePowersBuff,
  PlacementsBlockedBuff,
  ShadowOnPlaceBuff,
  OwnedMage,
  OwnedMageId,
  PendingResolutionInput,
  Player,
  PlayerId,
  ReactionTriggerEvent,
  ResolutionSource,
  ResumeContinuation,
  SerializableContext,
  SpellCardId,
  WorkerOccupancy,
} from '../types';

const PHASE_STEPPERS_ID = 'base.vault.phase-steppers';

// ============================================================================
// Library A — four slots per the room file
// ============================================================================

/** Slot 1 (merit, costs 1 MB): Gain 1 WIS AND Draft a Vault Card. */
registerEffect('base.room.library-a.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    if (ctx.state.vaultTableau.length === 0) {
      // No card to draft; still gain the WIS.
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'wisdom', 1),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...ctx.state.vaultTableau],
        },
        resume: { effectId: 'base.room.library-a.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `library-a.slot-1 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  let working = ctx.state;
  working = {
    ...working,
    ...applyVaultDraft(working, ctx.triggeringPlayerId, ctx.resumeAnswer.cardId),
  };
  working = {
    ...working,
    ...gainResourcePatch(working, ctx.triggeringPlayerId, 'wisdom', 1),
  };
  return {
    kind: 'done',
    patch: { players: working.players, vaultTableau: working.vaultTableau },
  };
});

/** Slot 2 (merit, costs 1 MB): Gain 1 INT AND gain 1 Research. */
registerEffect('base.room.library-a.slot-2', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    // Apply the +INT patch first, then build the research prompt against
    // the post-grant state so the player can see the new INT as an
    // available option (e.g. 'draft a Spell').
    const intPatch = gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'intelligence',
      1,
    );
    const afterInt: GameState = { ...ctx.state, ...intPatch };
    return {
      kind: 'pause',
      patch: intPatch,
      pending: spawnResearchPrompt(afterInt, ctx.triggeringPlayerId, ctx.source),
    };
  }
  throw new Error('library-a.slot-2 should not be re-invoked (research handles its own resume)');
});

/**
 * Slot 3 (regular): Gain a Buy AND Gain 1 Research.
 *
 * "Gain a Buy" = the player MAY purchase a vault card at its gold cost
 * (unlike "Draft", which is free). Flow:
 *   1. If no affordable card → skip Buy, go to Research.
 *   2. Otherwise prompt Buy/Skip (small in-banner choice).
 *   3. On Buy → `choose-vault-card` (clickable tableau, filtered to
 *      affordable). On card-chosen → applyVaultPurchase + Research.
 *   4. On Skip → Research only.
 */
registerEffect('base.room.library-a.slot-3', (ctx: EffectContext): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  // step='after-buy' is re-entered from a reaction-window's afterResume
  // — there's no resumeAnswer in that case. Handle it BEFORE the
  // first-call short-circuit below.
  if (step === 'after-buy') {
    const vaultCardId = ctx.resumeContext?.['vaultCardId'];
    if (typeof vaultCardId !== 'string') {
      throw new Error('library-a.slot-3 after-buy: missing vaultCardId');
    }
    const buyPatch = applyVaultPurchaseMaybeWaived(
      ctx.state,
      ctx.triggeringPlayerId,
      vaultCardId,
    );
    const working = { ...ctx.state, ...buyPatch };
    return {
      kind: 'pause',
      patch: { players: working.players, vaultTableau: working.vaultTableau },
      pending: spawnResearchPrompt(
        working,
        ctx.triggeringPlayerId,
        ctx.source,
      ),
    };
  }
  if (!ctx.resumeAnswer) {
    const affordable = affordableVaultCards(ctx.state, ctx.triggeringPlayerId);
    if (affordable.length === 0) {
      // Nothing affordable — skip Buy entirely, go to Research.
      return {
        kind: 'pause',
        pending: spawnResearchPrompt(ctx.state, ctx.triggeringPlayerId, ctx.source),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'buy', label: 'Gain a Buy', payload: {} },
            { id: 'skip', label: 'Skip the Buy', payload: {} },
          ],
        },
        resume: {
          effectId: 'base.room.library-a.slot-3',
          context: { step: 'buy-or-skip' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'buy-or-skip') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('library-a.slot-3 buy-or-skip expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'skip') {
      return {
        kind: 'pause',
        pending: spawnResearchPrompt(ctx.state, ctx.triggeringPlayerId, ctx.source),
      };
    }
    if (ctx.resumeAnswer.optionId !== 'buy') {
      throw new Error(
        `library-a.slot-3 buy-or-skip unknown option: ${ctx.resumeAnswer.optionId}`,
      );
    }
    const affordable = affordableVaultCards(ctx.state, ctx.triggeringPlayerId);
    if (affordable.length === 0) {
      // Affordability could shift between prompts (reactions, etc.); guard
      // by routing straight to research.
      return {
        kind: 'pause',
        pending: spawnResearchPrompt(ctx.state, ctx.triggeringPlayerId, ctx.source),
      };
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
          effectId: 'base.room.library-a.slot-3',
          context: { step: 'pick-card' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-card') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error('library-a.slot-3 pick-card expected card-chosen');
    }
    // Open the gold-payment reaction window (Auric Catalyst opportunity).
    // afterResume re-enters this effect at step='after-buy' (handled
    // above the resumeAnswer guard) which applies the buy and spawns the
    // Research prompt.
    return spawnVaultBuyReactionWindow(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.cardId,
      ctx.source,
      {
        effectId: 'base.room.library-a.slot-3',
        context: {
          step: 'after-buy',
          vaultCardId: ctx.resumeAnswer.cardId,
        },
      },
    );
  }
  throw new Error(`library-a.slot-3 unexpected step ${String(step)}`);
});

/** Slot 4 (regular): Gain 1 INT OR 1 WIS OR 1 Research. */
registerEffect('base.room.library-a.slot-4', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'int', label: 'Gain 1 INT', payload: { resource: 'intelligence' } },
            { id: 'wis', label: 'Gain 1 WIS', payload: { resource: 'wisdom' } },
            { id: 'research', label: 'Gain 1 Research', payload: { resource: 'research' } },
          ],
        },
        resume: { effectId: 'base.room.library-a.slot-4', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `library-a.slot-4 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const playerId = ctx.triggeringPlayerId;
  switch (ctx.resumeAnswer.optionId) {
    case 'int':
      return { kind: 'done', patch: gainResourcePatch(ctx.state, playerId, 'intelligence', 1) };
    case 'wis':
      return { kind: 'done', patch: gainResourcePatch(ctx.state, playerId, 'wisdom', 1) };
    case 'research':
      return {
        kind: 'pause',
        pending: spawnResearchPrompt(ctx.state, playerId, ctx.source),
      };
    default:
      throw new Error(`library-a.slot-4 unknown option: ${ctx.resumeAnswer.optionId}`);
  }
});

/**
 * Research is transient — the player spends it immediately on one of two
 * actions (or discards it):
 *   - draft   : draft a new Spell from the tableau using 1 unspent INT
 *   - add-wis : place 1 unspent WIS onto a learned Spell to unlock its
 *               next level (L2, then L3)
 *
 * Each option is only listed when its prerequisites are satisfied. 'discard'
 * is always available as a fallback.
 *
 * NOTE: The published Argent base game has only the two actions above. Two
 * additional actions — `move-int` (discard a learned Spell, draft another)
 * and `move-wis` (shift 1 WIS between owned Spells) — were planned but are
 * NOT part of the rulebook. Their underlying effects + sub-prompts are
 * still registered (so the wiring stays warm in case the rules ever change),
 * but they are intentionally not offered here. The two associated tests
 * (move-INT, move-WIS) are skipped for the same reason.
 */
function spawnResearchPrompt(
  state: GameState,
  playerId: string,
  source: ResolutionSource,
  restrictDepartment?: Department,
  contractChain?: boolean,
): PendingResolutionInput {
  const player = state.players.find((p) => p.id === playerId);
  const intPool = player?.resources.intelligence ?? 0;
  const wisPool = player?.resources.wisdom ?? 0;
  const learned = player?.ownedSpells.filter((s) => s.intPlaced) ?? [];
  const upgradable = learned.filter(
    (s) => !(s.wisPlacedLevel2 && s.wisPlacedLevel3),
  );
  const matches = (cardId: string): boolean => {
    if (!restrictDepartment) return true;
    const def = lookupSpellCardDef(state, cardId);
    return def?.department === restrictDepartment;
  };
  const tableauHasMatch = state.spellTableau.some(matches);
  const upgradableHasMatch = upgradable.some((s) => matches(s.cardId));

  const options: ChoiceOption[] = [];
  if (tableauHasMatch && intPool >= 1) {
    options.push({
      id: 'draft',
      label: restrictDepartment
        ? `Draft a ${departmentLabel(restrictDepartment)} Spell (spend 1 INT)`
        : 'Draft a Spell from the tableau (spend 1 INT)',
      payload: {},
    });
  }
  if (wisPool >= 1 && upgradableHasMatch) {
    options.push({
      id: 'add-wis',
      label: restrictDepartment
        ? `Place 1 WIS on a ${departmentLabel(restrictDepartment)} Spell (unlock next level)`
        : 'Place 1 WIS to unlock the next level of an owned Spell',
      payload: {},
    });
  }
  options.push({ id: 'discard', label: 'Discard 1 Research', payload: {} });

  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options',
      options,
    },
    resume: {
      effectId: 'base.system.spend-research',
      context: {
        ...(restrictDepartment ? { restrictDepartment } : {}),
        ...(contractChain ? { contractChain: true } : {}),
      },
    },
    source,
  };
}

function departmentLabel(d: Department): string {
  switch (d) {
    case 'sorcery':
      return 'Sorcery';
    case 'mysticism':
      return 'Mysticism';
    case 'natural-magick':
      return 'Natural Magick';
    case 'planar-studies':
      return 'Planar Studies';
    case 'divinity':
      return 'Divinity';
    case 'students':
      return 'Student';
    case 'wild':
      return 'Wild';
  }
}

/**
/**
 * Surfaces a fresh Research prompt for the triggering player against the
 * current state. Used by the engine's "drain one research from the queue"
 * pump (see `drainResearchQueueIfIdle` in engine.ts) so cards that grant
 * N Research can append N queue entries and have each one surface a
 * up-to-date menu (correct option visibility based on the state AFTER
 * the previous research was spent).
 */
registerEffect('base.system.spawn-research-prompt', (ctx): EffectResult => {
  const restrictRaw = ctx.resumeContext?.['restrictDepartment'];
  const restrict =
    typeof restrictRaw === 'string' ? (restrictRaw as Department) : undefined;
  const contractChain = ctx.resumeContext?.['contractChain'] === true;
  return {
    kind: 'pause',
    pending: spawnResearchPrompt(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.source,
      restrict,
      contractChain,
    ),
  };
});

/**
 * Router for the research-spend prompt. Dispatches to a per-action effect
 * (each a multi-step prompt chain) based on the chosen option, or fizzles
 * if the option is no longer viable (e.g. INT pool went to 0 between
 * prompt spawn and resolution).
 */
registerEffect('base.system.spend-research', (ctx): EffectResult => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error(
      `spend-research expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
    );
  }
  const restrictRaw = ctx.resumeContext?.['restrictDepartment'];
  const restrict =
    typeof restrictRaw === 'string' ? (restrictRaw as Department) : undefined;
  const contractChain = ctx.resumeContext?.['contractChain'] === true;
  const matches = (cardId: string): boolean => {
    if (!restrict) return true;
    const def = lookupSpellCardDef(ctx.state, cardId);
    return def?.department === restrict;
  };
  const optionId = ctx.resumeAnswer.optionId;
  if (optionId === 'discard') return { kind: 'done', patch: {} };
  // Re-evaluate prerequisites and forward to the action-specific chain.
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player) return { kind: 'done', patch: {} };

  if (optionId === 'draft') {
    if (player.resources.intelligence < 1) return { kind: 'done', patch: {} };
    const eligibleTableau = ctx.state.spellTableau.filter(matches);
    if (eligibleTableau.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligibleTableau.map((cid) => ({
            id: cid,
            label: `Draft ${spellLabel(ctx.state, cid)}`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-draft',
          context: {
            ...(restrict ? { restrictDepartment: restrict } : {}),
            ...(contractChain ? { contractChain: true } : {}),
          },
        },
        source: ctx.source,
      },
    };
  }
  if (optionId === 'move-int') {
    const learned = player.ownedSpells.filter((s) => s.intPlaced);
    if (learned.length === 0) return { kind: 'done', patch: {} };
    if (ctx.state.spellTableau.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: learned.map((s) => ({
            id: s.cardId,
            label: `Discard ${spellLabel(ctx.state, s.cardId)}`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-move-int',
          context: { step: 'pick-dest' },
        },
        source: ctx.source,
      },
    };
  }
  if (optionId === 'add-wis') {
    if (player.resources.wisdom < 1) return { kind: 'done', patch: {} };
    const upgradable = player.ownedSpells.filter(
      (s) =>
        s.intPlaced &&
        !(s.wisPlacedLevel2 && s.wisPlacedLevel3) &&
        matches(s.cardId),
    );
    if (upgradable.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: upgradable.map((s) => ({
            id: s.cardId,
            label: `${spellLabel(ctx.state, s.cardId)} → ${
              s.wisPlacedLevel2 ? 'L3' : 'L2'
            }`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-add-wis',
          context: {
            ...(restrict ? { restrictDepartment: restrict } : {}),
            ...(contractChain ? { contractChain: true } : {}),
          },
        },
        source: ctx.source,
      },
    };
  }
  if (optionId === 'move-wis') {
    const withWis = player.ownedSpells.filter(
      (s) => s.wisPlacedLevel2 || s.wisPlacedLevel3,
    );
    const destCandidates = player.ownedSpells.filter(
      (s) =>
        s.intPlaced &&
        !(s.wisPlacedLevel2 && s.wisPlacedLevel3) &&
        // Source and destination must differ; but if source loses its only
        // WIS, the same card cannot also be the dest (filter applied at
        // step 'pick-dest' once source is chosen).
        true,
    );
    if (withWis.length === 0 || destCandidates.length === 0) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: withWis.map((s) => ({
            id: s.cardId,
            label: `Take WIS from ${spellLabel(ctx.state, s.cardId)}`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-move-wis',
          context: { step: 'pick-dest' },
        },
        source: ctx.source,
      },
    };
  }
  throw new Error(`spend-research: unknown optionId ${optionId}`);
});

/** Spell-research action: draft a tableau spell using 1 INT. */
registerEffect('base.system.research-draft', (ctx): EffectResult => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error('research-draft expected option-chosen');
  }
  const spellCardId = ctx.resumeAnswer.optionId;
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.intelligence < 1) {
    return { kind: 'done', patch: {} };
  }
  if (!ctx.state.spellTableau.includes(spellCardId)) {
    return { kind: 'done', patch: {} };
  }
  const restrictRaw = ctx.resumeContext?.['restrictDepartment'];
  if (typeof restrictRaw === 'string') {
    const def = lookupSpellCardDef(ctx.state, spellCardId);
    if (def?.department !== restrictRaw) return { kind: 'done', patch: {} };
  }
  const patch = applyDraftSpell(
    ctx.state,
    ctx.triggeringPlayerId,
    spellCardId,
  );
  // The Contract: if this draft was sourced from the contract chain, lock
  // the remaining picks to the drafted spell's department.
  const contractChain = ctx.resumeContext?.['contractChain'] === true;
  if (contractChain) {
    const lockPatch = maybeLockContractDepartment(
      ctx.state,
      ctx.triggeringPlayerId,
      spellCardId,
    );
    if (lockPatch) patch.pendingContractResearch = lockPatch;
  }
  return { kind: 'done', patch };
});

/** Returns the updated `pendingContractResearch` (with `lockedDepartment`
 *  set) if the chain is active for `playerId` and doesn't yet have a
 *  locked department. Returns `null` to signal "no update needed". */
function maybeLockContractDepartment(
  state: GameState,
  playerId: string,
  spellCardId: string,
): GameState['pendingContractResearch'] | null {
  const chain = state.pendingContractResearch;
  if (!chain) return null;
  if (chain.playerId !== playerId) return null;
  if (chain.lockedDepartment !== undefined) return null;
  const def = lookupSpellCardDef(state, spellCardId);
  if (!def) return null;
  return { ...chain, lockedDepartment: def.department };
}

/**
 * Spell-research action: discard a learned spell (refunding its INT + any
 * placed WIS) and immediately draft a new tableau spell with the moved
 * INT. Two steps: pick source (already done before this resume; comes in
 * resumeAnswer with step='pick-dest'); next prompt is pick destination
 * from tableau; final step applies both.
 */
registerEffect('base.system.research-move-int', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (step === 'pick-dest') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-move-int pick-dest expected option-chosen');
    }
    const sourceCardId = ctx.resumeAnswer.optionId;
    // Refill the tableau snapshot AFTER the source is discarded — but we
    // need to present tableau options now, before the apply. Just use the
    // current tableau; the actual draft uses post-discard state.
    if (ctx.state.spellTableau.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: ctx.state.spellTableau.map((cid) => ({
            id: cid,
            label: `Draft ${spellLabel(ctx.state, cid)}`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-move-int',
          context: { step: 'apply', sourceCardId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-move-int apply expected option-chosen');
    }
    const destCardId = ctx.resumeAnswer.optionId;
    const sourceCardId = ctx.resumeContext?.['sourceCardId'];
    if (typeof sourceCardId !== 'string') {
      throw new Error('research-move-int apply: missing sourceCardId');
    }
    const discardPatch = applyDiscardOwnedSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      sourceCardId,
    );
    const afterDiscard: GameState = { ...ctx.state, ...discardPatch };
    if (!afterDiscard.spellTableau.includes(destCardId)) {
      return { kind: 'done', patch: discardPatch };
    }
    const draftPatch = applyDraftSpell(
      afterDiscard,
      ctx.triggeringPlayerId,
      destCardId,
    );
    return {
      kind: 'done',
      patch: { ...discardPatch, ...draftPatch },
    };
  }
  throw new Error(`research-move-int unexpected step ${String(step)}`);
});

/** Spell-research action: add 1 WIS to a learned spell (L2 then L3). */
registerEffect('base.system.research-add-wis', (ctx): EffectResult => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error('research-add-wis expected option-chosen');
  }
  const spellCardId = ctx.resumeAnswer.optionId;
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.wisdom < 1) {
    return { kind: 'done', patch: {} };
  }
  const owned = player.ownedSpells.find((s) => s.cardId === spellCardId);
  if (!owned || !owned.intPlaced) return { kind: 'done', patch: {} };
  if (owned.wisPlacedLevel2 && owned.wisPlacedLevel3) {
    return { kind: 'done', patch: {} };
  }
  const restrictRaw = ctx.resumeContext?.['restrictDepartment'];
  if (typeof restrictRaw === 'string') {
    const def = lookupSpellCardDef(ctx.state, spellCardId);
    if (def?.department !== restrictRaw) return { kind: 'done', patch: {} };
  }
  const patch = applyAddWisToSpell(
    ctx.state,
    ctx.triggeringPlayerId,
    spellCardId,
  );
  const contractChain = ctx.resumeContext?.['contractChain'] === true;
  if (contractChain) {
    const lockPatch = maybeLockContractDepartment(
      ctx.state,
      ctx.triggeringPlayerId,
      spellCardId,
    );
    if (lockPatch) patch.pendingContractResearch = lockPatch;
  }
  return { kind: 'done', patch };
});

/**
 * Spell-research action: move 1 WIS from one owned spell's L2/L3 slot to
 * another's. Two steps: pick source (step='pick-dest' on resume); next
 * prompt is destination; final step applies.
 */
registerEffect('base.system.research-move-wis', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (step === 'pick-dest') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-move-wis pick-dest expected option-chosen');
    }
    const sourceCardId = ctx.resumeAnswer.optionId;
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    if (!player) return { kind: 'done', patch: {} };
    const candidates = player.ownedSpells.filter(
      (s) =>
        s.cardId !== sourceCardId &&
        s.intPlaced &&
        !(s.wisPlacedLevel2 && s.wisPlacedLevel3),
    );
    if (candidates.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: candidates.map((s) => ({
            id: s.cardId,
            label: `Place WIS on ${spellLabel(ctx.state, s.cardId)} → ${
              s.wisPlacedLevel2 ? 'L3' : 'L2'
            }`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-move-wis',
          context: { step: 'apply', sourceCardId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-move-wis apply expected option-chosen');
    }
    const destCardId = ctx.resumeAnswer.optionId;
    const sourceCardId = ctx.resumeContext?.['sourceCardId'];
    if (typeof sourceCardId !== 'string') {
      throw new Error('research-move-wis apply: missing sourceCardId');
    }
    return {
      kind: 'done',
      patch: applyMoveWisBetweenSpells(
        ctx.state,
        ctx.triggeringPlayerId,
        sourceCardId,
        destCardId,
      ),
    };
  }
  throw new Error(`research-move-wis unexpected step ${String(step)}`);
});

// ============================================================================
// Burn — L1 (target a Mage; wound it; open reaction window)
// ============================================================================

registerEffect('base.spell.burn.l1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    const eligibleMageIds = buildBurnTargets(ctx.state, ctx.triggeringPlayerId);
    if (eligibleMageIds.length === 0) {
      // No legal targets — spell fizzles. Caller has already paid and
      // exhausted the spell per CAST_SPELL handler.
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds },
        resume: { effectId: 'base.spell.burn.l1', context: { step: 'apply-wound' } },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step !== 'apply-wound') {
    throw new Error(`base.spell.burn.l1: unexpected resume step ${String(step)}`);
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `base.spell.burn.l1 apply-wound expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }

  const wounded = woundMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  return {
    kind: 'open-reaction',
    patch: wounded.patch,
    window: {
      triggerEvents: [wounded.triggerEvent],
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.spell.burn.l1.complete',
        context: { triggerEvent: triggerEventToContext(wounded.triggerEvent) },
      },
      source: ctx.source,
    },
  };
});

/**
 * Generic post-wound check — fires after every wound source's reaction
 * window closes. If the mage is STILL wounded and STILL in the infirmary
 * (i.e. no reaction undid the wound, e.g. Phase Steppers), and the wound
 * was inflicted by an opponent, prompt that owner for their bonus.
 *
 * Wired up via `afterResume: { effectId: 'base.system.post-wound-bonus',
 * context: { triggerEvent } }` on the open-reaction window.
 *
 * Sources that need follow-up steps after the bonus (e.g. Ars Magna places
 * a mage after the bonus; Bottled Rage places a mage after the bonus;
 * Malefic Torch loops) use their own .complete effects and call into
 * `bonusPromptFor` directly so they can supply a custom resume.
 */
registerEffect('base.system.post-wound-bonus', (ctx) => {
  const event = readTriggerEvent(ctx);
  if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
    return {
      kind: 'pause',
      pending: bonusPromptFor(event, ctx.triggeringPlayerId),
    };
  }
  return { kind: 'done', patch: {} };
});

/** Backwards-compatible alias used by Burn L1's open-reaction window. */
registerEffect('base.spell.burn.l1.complete', (ctx) => {
  const event = readTriggerEvent(ctx);
  if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
    return {
      kind: 'pause',
      pending: bonusPromptFor(event, ctx.triggeringPlayerId),
    };
  }
  // TODO: Mysticism placement follow-up when caster is grey.
  return { kind: 'done', patch: {} };
});

// ============================================================================
// Phase Steppers — reaction: shadow original slot instead of being affected
// ============================================================================

registerEffect('base.vault.phase-steppers.react', (ctx: EffectContext): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Phase Steppers: missing triggerEvent in resumeContext');
  }
  const event = raw as unknown as ReactionTriggerEvent;

  if (
    event.kind !== 'mage-wounded' &&
    event.kind !== 'mage-banished' &&
    event.kind !== 'mage-moved'
  ) {
    throw new Error(`Phase Steppers cannot react to ${event.kind}`);
  }

  const ownerId = event.ownerId;
  const reactorId = ctx.triggeringPlayerId;
  if (ownerId !== reactorId) {
    throw new Error('Phase Steppers can only react to your own Mage being affected');
  }

  const mageId = event.mageId;
  const originalSpaceId =
    event.kind === 'mage-moved' ? event.fromSpaceId : event.originalSpaceId;
  if (!originalSpaceId) {
    // Mage wasn't on a space (shouldn't happen given how we filter options),
    // so Phase Steppers has nothing to do.
    return { kind: 'done', patch: {} };
  }
  // Returning to the mage's original slot is always allowed — even if the
  // room is now locked, the mage was already there before being wounded,
  // so the lock isn't being "crossed". A reaction that puts the mage back
  // in its original spot effectively undoes the wound; the lock then just
  // prevents the mage from leaving the room later.

  return {
    kind: 'done',
    patch: applyPhaseSteppers(ctx.state, mageId, ownerId, reactorId, originalSpaceId),
  };
});

function applyPhaseSteppers(
  state: GameState,
  mageId: string,
  ownerId: string,
  reactorId: string,
  originalSpaceId: string,
) {
  return applyReactionReposition(state, {
    mageId,
    ownerId,
    reactorId,
    destinationSpaceId: originalSpaceId,
    asShadow: true,
    cardId: PHASE_STEPPERS_ID,
    disposal: 'consumable',
  });
}

/**
 * Shared "react by repositioning your mage" helper. Used by:
 *   - Phase Steppers (consumable; shadow at original)
 *   - Invisibility Cloak (treasure; shadow at original)
 *   - Shield Potion (consumable; place at original, no shadow)
 *   - Ancient Armor (treasure; place at original, no shadow)
 *   - Mystic Amulet (treasure; place at original, no shadow)
 *
 * Note: until reactions support sub-prompts, "destinationSpaceId" is always
 * the trigger's `originalSpaceId` (or `fromSpaceId` for move events). The
 * "any open slot" choice promised by Shield Potion / Ancient Armor / Mystic
 * Amulet is deferred to the reaction-sub-prompt refactor.
 *
 * `disposal: 'consumable'` moves the card to the reactor's personalDiscard;
 * `disposal: 'exhaust'` marks the owned vault card exhausted (treasures
 * refresh at round-setup like spells).
 */
function applyReactionReposition(
  state: GameState,
  args: {
    mageId: string;
    ownerId: string;
    reactorId: string;
    destinationSpaceId: string;
    asShadow: boolean;
    cardId: string;
    disposal: 'consumable' | 'exhaust';
  },
): { players: Player[]; rooms: GameState['rooms'] } {
  const {
    mageId,
    ownerId,
    reactorId,
    destinationSpaceId,
    asShadow,
    cardId,
    disposal,
  } = args;
  const players = state.players.map((p): Player => {
    let updated = p;
    if (p.id === ownerId) {
      updated = {
        ...updated,
        mages: updated.mages.map((m) =>
          m.id !== mageId
            ? m
            : {
                ...m,
                isWounded: false,
                isShadowing: asShadow,
                location: {
                  kind: 'action-space' as const,
                  spaceId: destinationSpaceId,
                },
              },
        ),
      };
    }
    if (p.id === reactorId) {
      const idx = updated.vaultCards.findIndex((v) => v.cardId === cardId);
      if (idx === -1) {
        throw new Error(`${cardId}: reactor does not own the card`);
      }
      if (disposal === 'consumable') {
        updated = {
          ...updated,
          vaultCards: updated.vaultCards.filter((_, i) => i !== idx),
          personalDiscard: [
            ...updated.personalDiscard,
            { kind: 'consumable' as const, cardId },
          ],
        };
      } else {
        updated = {
          ...updated,
          vaultCards: updated.vaultCards.map((v, i) =>
            i !== idx ? v : { ...v, exhausted: true },
          ),
        };
      }
    }
    return updated;
  });

  // Shadowing reactions (Phase Steppers / Invisibility Cloak) land the
  // mage in the slot's SHADOW position with isShadowing=true; the base
  // position is left untouched. Non-shadowing reactions (Shield Potion /
  // Ancient Armor / Mystic Amulet) replace the base occupant unflagged.
  const occupancy: WorkerOccupancy = {
    mageId,
    ownerId,
    isShadowing: asShadow,
  };
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) =>
      s.id !== destinationSpaceId
        ? s
        : asShadow
          ? { ...s, shadowOccupant: occupancy }
          : { ...s, occupant: occupancy },
    ),
  }));

  return { players, rooms };
}

/**
 * Pulls the relevant "place the mage back here" space id from a trigger
 * event. For wound/banish it's `originalSpaceId`; for move it's the
 * `fromSpaceId` (the slot the mage was moved out of); for shadow it's the
 * `spaceId` (still occupied). Returns null if the event has no usable
 * spaceId (rare — wounded mage that was never on a slot etc.).
 */
function originalSpaceFromEvent(event: ReactionTriggerEvent): string | null {
  if (event.kind === 'mage-wounded' || event.kind === 'mage-banished') {
    return event.originalSpaceId;
  }
  if (event.kind === 'mage-moved') return event.fromSpaceId;
  if (event.kind === 'mage-shadowed') return event.spaceId;
  return null;
}

/**
 * Invisibility Cloak (treasure, reaction) — reusable Phase Steppers:
 * mage shadows the original slot instead of being wounded / banished /
 * moved. Card exhausts (refreshed at round-setup).
 */
registerEffect('base.vault.invisibility-cloak.react', (ctx): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invisibility Cloak: missing triggerEvent');
  }
  const event = raw as unknown as ReactionTriggerEvent;
  if (
    event.kind !== 'mage-wounded' &&
    event.kind !== 'mage-banished' &&
    event.kind !== 'mage-moved'
  ) {
    throw new Error(`Invisibility Cloak cannot react to ${event.kind}`);
  }
  if (event.ownerId !== ctx.triggeringPlayerId) {
    throw new Error('Invisibility Cloak: only protects your own Mage');
  }
  const originalSpaceId = originalSpaceFromEvent(event);
  if (!originalSpaceId) return { kind: 'done', patch: {} };
  // Returning to the mage's original slot is always allowed (see Phase
  // Steppers comment): the mage was already in that room before being
  // affected, so the lock isn't being crossed.
  return {
    kind: 'done',
    patch: applyReactionReposition(ctx.state, {
      mageId: event.mageId,
      ownerId: event.ownerId,
      reactorId: ctx.triggeringPlayerId,
      destinationSpaceId: originalSpaceId,
      asShadow: true,
      cardId: 'base.vault.invisibility-cloak',
      disposal: 'exhaust',
    }),
  };
});

/**
 * Resolves the destination slot for a "reposition your mage" reaction:
 *   1. Honor `reactionContext.destinationSpaceId` if the UI supplied one
 *      AND it points to an empty (non-shadow-placement) base slot in a
 *      placeable room — this is the "any open slot on the board" path.
 *   2. Fall back to the trigger's original slot id otherwise.
 *   3. Return null if neither yields a valid destination (the reaction
 *      then fizzles silently).
 */
function resolveReactionDestination(
  state: GameState,
  event: ReactionTriggerEvent,
  reactionContext: SerializableContext | undefined,
): string | null {
  // Per rulebook: a reaction's movement cannot cross a lock. The mage's
  // original slot lives in some "from" room; the requested destination
  // lives in a "to" room. Movement is allowed iff:
  //   - from === to (returning to the original room, no lock crossed), or
  //   - neither the "from" nor the "to" room is locked.
  // The fallback to the original slot is always allowed: the mage was
  // already there before being affected (the lock applied AFTER the wound),
  // so restoring them isn't "entering" the locked room.
  const original = originalSpaceFromEvent(event);
  const fromRoomId = original ? findRoomIdForSpace(state, original) : null;
  const requested = reactionContext?.['destinationSpaceId'];
  if (typeof requested === 'string') {
    const found = state.rooms
      .find((r) => !r.cannotBePlacedInDirectly && r.actionSpaces.some((s) => s.id === requested))
      ?.actionSpaces.find((s) => s.id === requested);
    if (found && !found.occupant) {
      const toRoomId = findRoomIdForSpace(state, requested);
      const sameRoom = fromRoomId && toRoomId === fromRoomId;
      if (sameRoom) return requested;
      const fromLocked = fromRoomId
        ? state.roomLocks.some((l) => l.roomId === fromRoomId)
        : false;
      const toLocked =
        toRoomId !== null
          ? state.roomLocks.some((l) => l.roomId === toRoomId)
          : false;
      if (!fromLocked && !toLocked) return requested;
      // Movement would cross a lock — fall through to the original-slot
      // fallback below.
    }
  }
  return original;
}

function findRoomIdForSpace(
  state: GameState,
  spaceId: string,
): string | null {
  for (const r of state.rooms) {
    if (r.actionSpaces.some((s) => s.id === spaceId)) return r.id;
  }
  return null;
}

/**
 * Shield Potion (consumable, reaction) — place the mage at an empty slot
 * "instead" of the harmful event. The UI may surface a slot picker (the
 * reaction option is flagged `requiresSlotPick`); the picked slot id
 * arrives in `reactionContext.destinationSpaceId`. Falls back to the
 * trigger's original slot if the UI didn't supply one or the supplied
 * slot is invalid. Card consumed.
 */
registerEffect('base.vault.shield-potion.react', (ctx): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Shield Potion: missing triggerEvent');
  }
  const event = raw as unknown as ReactionTriggerEvent;
  if (
    event.kind !== 'mage-wounded' &&
    event.kind !== 'mage-banished' &&
    event.kind !== 'mage-moved'
  ) {
    throw new Error(`Shield Potion cannot react to ${event.kind}`);
  }
  if (event.ownerId !== ctx.triggeringPlayerId) {
    throw new Error('Shield Potion: only protects your own Mage');
  }
  const destinationSpaceId = resolveReactionDestination(
    ctx.state,
    event,
    ctx.resumeContext,
  );
  if (!destinationSpaceId) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: applyReactionReposition(ctx.state, {
      mageId: event.mageId,
      ownerId: event.ownerId,
      reactorId: ctx.triggeringPlayerId,
      destinationSpaceId,
      asShadow: false,
      cardId: 'base.vault.shield-potion',
      disposal: 'consumable',
    }),
  };
});

/**
 * Ancient Armor (treasure, reaction) — "after" an opponent wounds or
 * moves your Mage, move your Mage to any open slot on the board. The UI
 * collects the slot id via `requiresSlotPick`; if absent the reaction
 * falls back to the trigger's original slot. Card exhausts.
 */
registerEffect('base.vault.ancient-armor.react', (ctx): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Ancient Armor: missing triggerEvent');
  }
  const event = raw as unknown as ReactionTriggerEvent;
  if (event.kind !== 'mage-wounded' && event.kind !== 'mage-moved') {
    throw new Error(`Ancient Armor cannot react to ${event.kind}`);
  }
  if (event.ownerId !== ctx.triggeringPlayerId) {
    throw new Error('Ancient Armor: only protects your own Mage');
  }
  if (event.byPlayerId === event.ownerId) {
    throw new Error('Ancient Armor: trigger must be from an opponent');
  }
  const destinationSpaceId = resolveReactionDestination(
    ctx.state,
    event,
    ctx.resumeContext,
  );
  if (!destinationSpaceId) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: applyReactionReposition(ctx.state, {
      mageId: event.mageId,
      ownerId: event.ownerId,
      reactorId: ctx.triggeringPlayerId,
      destinationSpaceId,
      asShadow: false,
      cardId: 'base.vault.ancient-armor',
      disposal: 'exhaust',
    }),
  };
});

/**
 * Mystic Amulet (treasure, reaction) — "after" an opponent banishes or
 * shadows your Mage, move your Mage to any open slot on the board. UI
 * supplies the slot id via `requiresSlotPick`; falls back to original
 * slot if absent. Card exhausts.
 */
registerEffect('base.vault.mystic-amulet.react', (ctx): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Mystic Amulet: missing triggerEvent');
  }
  const event = raw as unknown as ReactionTriggerEvent;
  if (event.kind !== 'mage-banished' && event.kind !== 'mage-shadowed') {
    throw new Error(`Mystic Amulet cannot react to ${event.kind}`);
  }
  if (event.ownerId !== ctx.triggeringPlayerId) {
    throw new Error('Mystic Amulet: only protects your own Mage');
  }
  if (event.byPlayerId === event.ownerId) {
    throw new Error('Mystic Amulet: trigger must be from an opponent');
  }
  const destinationSpaceId = resolveReactionDestination(
    ctx.state,
    event,
    ctx.resumeContext,
  );
  if (!destinationSpaceId) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: applyReactionReposition(ctx.state, {
      mageId: event.mageId,
      ownerId: event.ownerId,
      reactorId: ctx.triggeringPlayerId,
      destinationSpaceId,
      asShadow: false,
      cardId: 'base.vault.mystic-amulet',
      disposal: 'exhaust',
    }),
  };
});

/**
 * Auric Catalyst (consumable, reaction) — Reduce any Gold cost (not a
 * swap) you would pay to zero. Triggered by a `gold-payment-pending`
 * reaction window opened just before a vault buy. Sets the buyer's
 * `nextGoldCostWaived` flag and consumes the card. The actual zero-cost
 * application happens later in `applyVaultPurchaseMaybeWaived`.
 */
registerEffect('base.vault.auric-catalyst.react', (ctx): EffectResult => {
  const reactorId = ctx.triggeringPlayerId;
  return {
    kind: 'done',
    patch: {
      players: ctx.state.players.map((p) => {
        if (p.id !== reactorId) return p;
        const idx = p.vaultCards.findIndex(
          (v) => v.cardId === 'base.vault.auric-catalyst' && !v.exhausted,
        );
        if (idx === -1) return p;
        return {
          ...p,
          nextGoldCostWaived: true,
          vaultCards: p.vaultCards.filter((_, i) => i !== idx),
          personalDiscard: [
            ...p.personalDiscard,
            { kind: 'consumable' as const, cardId: 'base.vault.auric-catalyst' },
          ],
        };
      }),
    },
  };
});

/**
 * Opens a `gold-payment-pending` reaction window before a vault buy.
 * Used by BUY_VAULT_CARD and "Gain a Buy" sites. The window's
 * afterResume points back to the caller's "after-buy" continuation,
 * which applies the buy via `applyVaultPurchaseMaybeWaived`.
 *
 * If the buyer has no Auric Catalyst available to react with, the window
 * opens with an empty responder queue and the engine immediately fires
 * afterResume — the buy proceeds as normal.
 */
function spawnVaultBuyReactionWindow(
  state: GameState,
  buyerId: string,
  vaultCardId: string,
  source: ResolutionSource,
  afterResume: ResumeContinuation,
): EffectResult {
  const buyer = state.players.find((p) => p.id === buyerId);
  if (!buyer) return { kind: 'done', patch: {} };
  let card: { goldCost: number } | undefined;
  for (const pid of state.activePackIds) {
    const pack = getPack(pid);
    if (!pack) continue;
    const found = pack.vaultCards.find((v) => v.id === vaultCardId);
    if (found) {
      card = found;
      break;
    }
  }
  if (!card) return { kind: 'done', patch: {} };
  const canReact = playerHasAuricCatalyst(buyer);
  return {
    kind: 'open-reaction',
    patch: {},
    window: {
      triggerEvents: [
        {
          kind: 'gold-payment-pending',
          payingPlayerId: buyerId,
          amount: card.goldCost,
          purpose: 'vault-purchase',
        },
      ],
      pendingResponderIds: canReact ? [buyerId] : [],
      reactedPlayerIds: [],
      afterResume,
      source,
    },
  };
}

/**
 * Wraps a vault buy through a reaction window. First invocation opens
 * the window (responder = the buyer only). When the window closes, the
 * effect is re-entered with step='complete' and applies the buy via
 * `applyVaultPurchaseMaybeWaived`. Used directly by BUY_VAULT_CARD; the
 * Gain-a-Buy sites bypass this and call `spawnVaultBuyReactionWindow`
 * with their own after-buy step so they can chain follow-ups (research).
 */
registerEffect('base.system.vault-buy', (ctx): EffectResult => {
  const vaultCardId = ctx.resumeContext?.['vaultCardId'];
  const buyerId = ctx.resumeContext?.['buyerId'];
  const step = ctx.resumeContext?.['step'];
  if (typeof vaultCardId !== 'string' || typeof buyerId !== 'string') {
    throw new Error('base.system.vault-buy: missing context');
  }
  if (step === 'complete') {
    return {
      kind: 'done',
      patch: applyVaultPurchaseMaybeWaived(ctx.state, buyerId, vaultCardId),
    };
  }
  return spawnVaultBuyReactionWindow(
    ctx.state,
    buyerId,
    vaultCardId,
    ctx.source,
    {
      effectId: 'base.system.vault-buy',
      context: { vaultCardId, buyerId, step: 'complete' },
    },
  );
});

// ============================================================================
// Vault A — three slots per the room file:
//   Slot 1 (merit, costs 1 MB to place): Draft a Vault Card AND Gain 4 Gold
//   Slot 2 (regular):                    Draft a Vault Card OR Gain 5 Gold
//   Slot 3 (regular):                    Gain 3 Gold
// ============================================================================

/** Vault A slot 1 — merit. Draft + 4 gold. Merit cost paid at placement. */
registerEffect('base.room.vault-a.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    if (ctx.state.vaultTableau.length === 0) {
      // No card to draft — still get the gold.
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 4),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...ctx.state.vaultTableau],
        },
        resume: { effectId: 'base.room.vault-a.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `vault-a.slot-1 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  let working = ctx.state;
  working = {
    ...working,
    ...applyVaultDraft(working, ctx.triggeringPlayerId, ctx.resumeAnswer.cardId),
  };
  working = {
    ...working,
    ...gainResourcePatch(working, ctx.triggeringPlayerId, 'gold', 4),
  };
  return {
    kind: 'done',
    patch: { players: working.players, vaultTableau: working.vaultTableau },
  };
});

/** Vault A slot 2 — regular. Draft a Vault Card OR Gain 5 Gold. */
registerEffect('base.room.vault-a.slot-2', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'draft', label: 'Draft a Vault Card', payload: {} },
            { id: 'gold', label: 'Gain 5 Gold', payload: {} },
          ],
        },
        resume: { effectId: 'base.room.vault-a.slot-2', context: { step: 'or' } },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step === 'or') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`vault-a.slot-2 OR expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'gold') {
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 5),
      };
    }
    if (ctx.resumeAnswer.optionId === 'draft') {
      if (ctx.state.vaultTableau.length === 0) {
        // No tableau cards — silently no-op. (Player already passed on gold.)
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-vault-card',
            eligibleCardIds: [...ctx.state.vaultTableau],
          },
          resume: {
            effectId: 'base.room.vault-a.slot-2',
            context: { step: 'pick' },
          },
          source: ctx.source,
        },
      };
    }
    throw new Error(`vault-a.slot-2 unknown option: ${ctx.resumeAnswer.optionId}`);
  }
  if (step === 'pick') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error(`vault-a.slot-2 pick expected card-chosen`);
    }
    return {
      kind: 'done',
      patch: applyVaultDraft(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.cardId,
      ),
    };
  }
  throw new Error(`vault-a.slot-2 unexpected step: ${String(step)}`);
});

/** Vault A slot 3 — regular. Gain 3 Gold. */
registerEffect('base.room.vault-a.slot-3', (ctx: EffectContext): EffectResult => {
  return {
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 3),
  };
});

// ============================================================================
// Training Fields A — flat resource gains
// ============================================================================

/** Slot 1 (merit, 1 MB): Gain 1 INT AND Gain 1 WIS. */
registerEffect('base.room.training-fields-a.slot-1', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainResourcesPatch(ctx.state, ctx.triggeringPlayerId, {
    intelligence: 1,
    wisdom: 1,
  }),
}));

/** Slot 2 (regular): Gain 1 INT. */
registerEffect('base.room.training-fields-a.slot-2', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'intelligence', 1),
}));

/** Slot 3 (regular): Gain 1 WIS. */
registerEffect('base.room.training-fields-a.slot-3', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'wisdom', 1),
}));

// ============================================================================
// Guilds A — INSTANT room. Pick gold OR mana per slot.
// ============================================================================

function guildsOrPrompt(
  ctx: EffectContext,
  goldAmount: number,
  manaAmount: number,
  effectId: string,
): EffectResult {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'gold', label: `Gain ${goldAmount} Gold`, payload: {} },
            { id: 'mana', label: `Gain ${manaAmount} Mana`, payload: {} },
          ],
        },
        resume: { effectId, context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(`${effectId} expected option-chosen`);
  }
  if (ctx.resumeAnswer.optionId === 'gold') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', goldAmount),
    };
  }
  if (ctx.resumeAnswer.optionId === 'mana') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', manaAmount),
    };
  }
  throw new Error(`${effectId} unknown option ${ctx.resumeAnswer.optionId}`);
}

registerEffect('base.room.guilds-a.slot-1', (ctx) =>
  guildsOrPrompt(ctx, 6, 3, 'base.room.guilds-a.slot-1'),
);
registerEffect('base.room.guilds-a.slot-2', (ctx) =>
  guildsOrPrompt(ctx, 4, 2, 'base.room.guilds-a.slot-2'),
);
registerEffect('base.room.guilds-a.slot-3', (ctx) =>
  guildsOrPrompt(ctx, 2, 1, 'base.room.guilds-a.slot-3'),
);

// ============================================================================
// Courtyard A — Mana scaling with WIS
// ============================================================================

function manaForCourtyard(
  ctx: EffectContext,
  bonus: number,
): EffectResult {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) throw new Error('courtyard: player not found');
  const amount = player.resources.wisdom + bonus;
  if (amount <= 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', amount),
  };
}

/** Slot 1 (merit, 1 MB): Gain Mana equal to your WIS + 2. */
registerEffect('base.room.courtyard-a.slot-1', (ctx) => manaForCourtyard(ctx, 2));

/** Slot 2 (regular): Gain Mana equal to your WIS. */
registerEffect('base.room.courtyard-a.slot-2', (ctx) => manaForCourtyard(ctx, 0));

/** Slot 3 (regular): Gain 3 Mana. */
registerEffect('base.room.courtyard-a.slot-3', (ctx) => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 3),
}));

// ============================================================================
// Infirmary on-wound bonus — used by every wound source via afterResume
// ============================================================================
//
// Pattern: each wound source's open-reaction passes the trigger event into
// its afterResume's context. The source's "complete" effect calls
// `checkInfirmaryBonusApplies(state, event)` and, if true, pauses with
// `bonusPromptFor(...)`. Sources with no follow-up steps (Burn L1) use the
// shared system resume; sources that need to chain more work (Ars Magna)
// supply a custom resume that handles the bonus inline.

const INFIRMARY_BONUS_OPTIONS: ChoiceOption[] = [
  { id: 'gold', label: 'Gain 2 Gold', payload: {} },
  { id: 'mana', label: 'Gain 1 Mana', payload: {} },
  { id: 'ip', label: 'Gain 1 IP', payload: {} },
];

function readTriggerEvent(ctx: EffectContext): ReactionTriggerEvent | null {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as unknown as ReactionTriggerEvent;
}

/** Casts a trigger event to a SerializableContext for storage in resume context. */
function triggerEventToContext(event: ReactionTriggerEvent): SerializableContext {
  return event as unknown as SerializableContext;
}

function bonusPromptFor(
  event: ReactionTriggerEvent,
  casterId: PlayerId,
  customResume?: ResumeContinuation,
): PendingResolutionInput {
  if (event.kind !== 'mage-wounded') {
    throw new Error('bonusPromptFor: only mage-wounded events trigger the bonus');
  }
  return {
    responderId: event.ownerId,
    prompt: {
      kind: 'choose-from-options',
      options: INFIRMARY_BONUS_OPTIONS,
    },
    resume: customResume ?? {
      effectId: 'base.system.infirmary-bonus',
      context: { recipientPlayerId: event.ownerId },
    },
    source: {
      kind: 'system',
      id: 'base.system.infirmary-bonus',
      triggeringPlayerId: casterId,
      description: 'Infirmary bonus (wound by opponent)',
    },
  };
}

// ============================================================================
// Resolution-choice — fired before every space's effect runs.
// ============================================================================
//
// Gives the active player two options:
//   * Take the reward — deduct the merit cost (if any) and invoke the slot's
//     real effect. Available only if they can afford the cost.
//   * Forfeit for 1 IP — grant 1 Influence and skip the effect.
//
// Players can place on merit-cost slots without enough Merit Badges (the cost
// is no longer enforced upfront), so this prompt is also the safety net for
// "I placed here on speculation but never came up with the badges in time."

registerEffect('base.system.resolution-choice', (ctx: EffectContext): EffectResult => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error(
      `resolution-choice expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
    );
  }
  const optionId = ctx.resumeAnswer.optionId;
  const innerEffectIdRaw = ctx.resumeContext?.['innerEffectId'];
  const meritCostRaw = ctx.resumeContext?.['meritCost'];
  if (
    typeof innerEffectIdRaw !== 'string' ||
    typeof meritCostRaw !== 'number'
  ) {
    throw new Error('resolution-choice: missing context fields');
  }
  const playerId = ctx.triggeringPlayerId;

  if (optionId === 'forfeit') {
    return {
      kind: 'done',
      patch: bumpInfluencePatch(ctx.state, playerId, 1),
    };
  }
  if (optionId !== 'reward') {
    throw new Error(`resolution-choice: unknown optionId ${optionId}`);
  }

  // Deduct the merit cost up front, then run the slot's effect against the
  // post-deduction state so the inner effect's player-patch already reflects
  // the spent badges.
  let working: GameState = ctx.state;
  if (meritCostRaw > 0) {
    const player = working.players.find((p) => p.id === playerId);
    if (!player) throw new Error('resolution-choice: player not found');
    if (player.resources.meritBadges < meritCostRaw) {
      // Should never happen — the prompt's "reward" option is unavailable in
      // this case. Belt-and-suspenders.
      throw new Error(
        'resolution-choice: cannot take reward without sufficient Merit Badges',
      );
    }
    working = {
      ...working,
      players: working.players.map((p) =>
        p.id !== playerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                meritBadges: p.resources.meritBadges - meritCostRaw,
                meritBadgesSpent: p.resources.meritBadgesSpent + meritCostRaw,
              },
            },
      ),
    };
  }

  // Invoke the slot's real effect AS A FRESH CALL (no resumeAnswer/Context),
  // so it doesn't mistake the resolution-choice's answer for its own resume.
  const innerEffect = getEffect(innerEffectIdRaw);
  const innerResult = innerEffect({
    state: working,
    source: ctx.source,
    triggeringPlayerId: ctx.triggeringPlayerId,
    allowReactions: ctx.allowReactions,
  });
  const meritPatch: GameStatePatch =
    meritCostRaw > 0 ? { players: working.players } : {};
  const innerPatch = innerResult.patch ?? {};
  const combined: GameStatePatch = { ...meritPatch, ...innerPatch };

  switch (innerResult.kind) {
    case 'done':
      return { kind: 'done', patch: combined };
    case 'pause':
      return { kind: 'pause', patch: combined, pending: innerResult.pending };
    case 'open-reaction':
      return {
        kind: 'open-reaction',
        patch: combined,
        window: innerResult.window,
      };
  }
});

registerEffect('base.system.infirmary-bonus', (ctx) => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error(
      `infirmary-bonus expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
    );
  }
  const recipientId = ctx.resumeContext?.['recipientPlayerId'];
  if (typeof recipientId !== 'string') {
    throw new Error('infirmary-bonus: missing recipientPlayerId');
  }
  return {
    kind: 'done',
    patch: applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    ),
  };
});

// ============================================================================
// Marks — system effect used by every "gain a Mark" prompt
// ============================================================================

/**
 * Builds the prompt to gain a Mark, or returns `null` if the player has
 * already marked every voter (no eligible target — the effect fizzles).
 */
function spawnGainMarkPrompt(
  state: GameState,
  playerId: string,
  source: ResolutionSource,
): PendingResolutionInput | null {
  const eligible = eligibleVotersForMark(state, playerId);
  if (eligible.length === 0) return null;
  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-voter',
      eligibleVoterIds: eligible.map((v) => v.id),
    },
    resume: { effectId: 'base.system.gain-mark', context: {} },
    source,
  };
}

// ============================================================================
// Initial Mark placement (game-start, one per player)
//
// Triggered from `enterInitialMarkPlacement` in engine.ts. Each player, in
// turn order from `firstPlayerIndex`, gets a choose-voter prompt that resumes
// here. We apply the chosen mark, then either push the next player's prompt
// or transition to round-setup once everyone has placed.
// ============================================================================

registerEffect('base.system.initial-mark', (ctx) => {
  if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
    throw new Error(
      `initial-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
    );
  }
  if (ctx.state.phase.kind !== 'initial-mark-placement') {
    throw new Error(
      `initial-mark: state is not in initial-mark-placement (current: ${ctx.state.phase.kind})`,
    );
  }
  const markPatch = applyGainMark(
    ctx.state,
    ctx.triggeringPlayerId,
    ctx.resumeAnswer.voterId,
  );
  const afterMark: GameState = { ...ctx.state, ...markPatch };

  // Find the next player (in clockwise order from current) who hasn't yet
  // placed their starting mark. Players who have placed have resources.marks
  // strictly greater than 0; the starting bundle sets marks=0.
  const N = afterMark.players.length;
  const startIdx = afterMark.phase.kind === 'initial-mark-placement'
    ? afterMark.phase.activePlayerIndex
    : 0;
  let nextIdx = -1;
  for (let step = 1; step <= N; step++) {
    const idx = (startIdx + step) % N;
    const candidate = afterMark.players[idx];
    if (candidate && candidate.resources.marks === 0) {
      nextIdx = idx;
      break;
    }
  }

  if (nextIdx === -1) {
    // Everyone placed → transition to round-setup.
    return {
      kind: 'done',
      patch: { ...markPatch, phase: { kind: 'round-setup', round: 1 } },
    };
  }

  // Push the next player's choose-voter prompt and update the phase.
  const nextPlayer = afterMark.players[nextIdx]!;
  return {
    kind: 'pause',
    patch: {
      ...markPatch,
      phase: {
        kind: 'initial-mark-placement',
        activePlayerIndex: nextIdx,
      },
    },
    pending: {
      responderId: nextPlayer.id,
      prompt: {
        kind: 'choose-voter',
        eligibleVoterIds: eligibleVotersForMark(afterMark, nextPlayer.id).map(
          (v) => v.id,
        ),
      },
      resume: { effectId: 'base.system.initial-mark', context: {} },
      source: {
        kind: 'system',
        id: 'base.system.initial-mark',
        triggeringPlayerId: nextPlayer.id,
        description: 'Place your starting Mark',
      },
    },
  };
});

registerEffect('base.system.gain-mark', (ctx) => {
  if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
    throw new Error(
      `gain-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
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
});

// ============================================================================
// Council Chamber A — five slots, each "Draft a supporter OR gain a Mark"
// ============================================================================

registerEffect('base.room.council-chamber-a.slot', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'draft', label: 'Draft a Supporter', payload: {} },
            { id: 'mark', label: 'Gain a Mark', payload: {} },
          ],
        },
        resume: {
          effectId: 'base.room.council-chamber-a.slot',
          context: { step: 'or' },
        },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step === 'or') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('council-chamber-a.slot OR expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'draft') {
      if (ctx.state.supporterTableau.length === 0) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-supporter-card',
            eligibleCardIds: [...ctx.state.supporterTableau],
          },
          resume: {
            effectId: 'base.room.council-chamber-a.slot',
            context: { step: 'draft-pick' },
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.optionId === 'mark') {
      const prompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (prompt === null) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    throw new Error(
      `council-chamber-a.slot OR unknown option ${ctx.resumeAnswer.optionId}`,
    );
  }
  if (step === 'draft-pick') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error('council-chamber-a.slot draft-pick expected card-chosen');
    }
    return {
      kind: 'done',
      patch: applySupporterDraft(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.cardId,
      ),
    };
  }
  throw new Error(`council-chamber-a.slot unexpected step ${String(step)}`);
});

// ============================================================================
// Catacombs A
// ============================================================================

/** Slot 1 (merit, 1 MB): Draw a Secret Supporter, then gain a Mark. */
registerEffect('base.room.catacombs-a.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    const drawPatch = applySecretSupporterDraw(ctx.state, ctx.triggeringPlayerId);
    const afterDraw = { ...ctx.state, ...drawPatch };
    const markPrompt = spawnGainMarkPrompt(
      afterDraw,
      ctx.triggeringPlayerId,
      ctx.source,
    );
    if (markPrompt === null) {
      return { kind: 'done', patch: drawPatch };
    }
    return { kind: 'pause', patch: drawPatch, pending: markPrompt };
  }
  throw new Error('catacombs-a.slot-1 should not be re-invoked (mark handles its own resume)');
});

/** Slot 2 (regular): Gain 2 IP. */
registerEffect('base.room.catacombs-a.slot-2', (ctx) => ({
  kind: 'done',
  patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
}));

/** Slot 3 (regular): Gain 1 IP for each player with more IP than you. */
registerEffect('base.room.catacombs-a.slot-3', (ctx) => {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) throw new Error('catacombs-a.slot-3: caster not found');
  const myIP = player.resources.influence;
  const ahead = ctx.state.players.filter(
    (p) => p.id !== ctx.triggeringPlayerId && p.resources.influence > myIP,
  ).length;
  if (ahead === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, ahead),
  };
});

// ============================================================================
// Sorcery Mage — Ars Magna (fast action: spend 1 Mana, wound a Mage, take its slot)
// ============================================================================

registerEffect('base.mage.sorcery.ars-magna', (ctx: EffectContext): EffectResult => {
  const sourceMageId = ctx.source.id;
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) throw new Error('Ars Magna: caster not found');

  if (!ctx.resumeAnswer) {
    // First call — validate, spend mana, prompt for target.
    const redMage = player.mages.find((m) => m.id === sourceMageId);
    if (!redMage) {
      throw new Error(`Ars Magna: source mage ${sourceMageId} not owned`);
    }
    if (redMage.color !== 'red') {
      throw new Error('Ars Magna: source mage must be red (Sorcery)');
    }
    if (redMage.location.kind !== 'office') {
      throw new Error(
        `Ars Magna: red mage must be in office (location=${redMage.location.kind})`,
      );
    }
    if (redMage.isWounded) {
      throw new Error('Ars Magna: red mage is wounded; heal first');
    }
    if (player.resources.mana < 1) {
      throw new Error('Ars Magna: requires 1 Mana');
    }

    const eligibleMageIds = buildArsMagnaTargets(ctx.state, ctx.triggeringPlayerId);
    if (eligibleMageIds.length === 0) {
      throw new Error('Ars Magna: no legal targets');
    }

    return {
      kind: 'pause',
      patch: {
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                resources: { ...p.resources, mana: p.resources.mana - 1 },
              },
        ),
      },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds },
        resume: {
          effectId: 'base.mage.sorcery.ars-magna',
          context: { step: 'wound', sourceMageId },
        },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step !== 'wound') {
    throw new Error(`Ars Magna: unexpected resume step ${String(step)}`);
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `Ars Magna wound expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }

  const sourceMageIdRaw = ctx.resumeContext?.['sourceMageId'];
  if (typeof sourceMageIdRaw !== 'string') {
    throw new Error('Ars Magna: missing sourceMageId in resumeContext');
  }
  const wounded = woundMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  const triggerEvent = wounded.triggerEvent;
  if (triggerEvent.kind !== 'mage-wounded') {
    throw new Error('Ars Magna: woundMage produced unexpected event kind');
  }
  const targetSpaceId = triggerEvent.originalSpaceId;
  if (!targetSpaceId) {
    // Target wasn't on a space — shouldn't happen given target filter.
    return { kind: 'done', patch: wounded.patch };
  }

  return {
    kind: 'open-reaction',
    patch: wounded.patch,
    window: {
      triggerEvents: [triggerEvent],
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.mage.sorcery.ars-magna.complete',
        context: {
          sourceMageId: sourceMageIdRaw,
          targetSpaceId,
          triggerEvent: triggerEventToContext(triggerEvent),
        },
      },
      source: ctx.source,
    },
  };
});

/**
 * After-reaction continuation for Ars Magna.
 *
 * Steps:
 *   1. If the wound stuck and was inflicted by an opponent, prompt the
 *      wounded player for the Infirmary bonus. The custom resume chains
 *      back to this effect with `step: 'after-bonus'`, where the bonus
 *      patch is applied inline and the red Mage move runs against the
 *      post-bonus state.
 *   2. Otherwise (or after the bonus), if the targeted slot is now empty,
 *      the caster's red Mage takes it. If a reaction (Phase Steppers)
 *      re-occupied the slot, the red Mage stays in office and the Mana
 *      paid up front is forfeit.
 */
registerEffect('base.mage.sorcery.ars-magna.complete', (ctx: EffectContext): EffectResult => {
  const sourceMageIdRaw = ctx.resumeContext?.['sourceMageId'];
  const targetSpaceIdRaw = ctx.resumeContext?.['targetSpaceId'];
  if (typeof sourceMageIdRaw !== 'string' || typeof targetSpaceIdRaw !== 'string') {
    throw new Error('Ars Magna complete: missing context fields');
  }
  const sourceMageId = sourceMageIdRaw as OwnedMageId;
  const targetSpaceId = targetSpaceIdRaw as ActionSpaceId;

  // Resume from bonus prompt — apply the chosen bonus, then move the Mage.
  if (ctx.resumeContext?.['step'] === 'after-bonus') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('ars-magna.complete after-bonus expected option-chosen');
    }
    const recipientId = ctx.resumeContext['recipientPlayerId'];
    const casterId = ctx.resumeContext['casterPlayerId'];
    if (typeof recipientId !== 'string' || typeof casterId !== 'string') {
      throw new Error('ars-magna.complete after-bonus: missing context fields');
    }
    const bonusPatch = applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    const placePatch = moveRedMagePatch(
      afterBonus,
      sourceMageId,
      targetSpaceId,
      casterId,
    );
    return patchWithMaybeInstantReward(
      afterBonus,
      { ...bonusPatch, ...placePatch },
      targetSpaceId,
      casterId,
      'base',
    );
  }

  // First call from afterResume.
  const event = readTriggerEvent(ctx);
  if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
    return {
      kind: 'pause',
      pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
        effectId: 'base.mage.sorcery.ars-magna.complete',
        context: {
          step: 'after-bonus',
          recipientPlayerId: event.ownerId,
          casterPlayerId: ctx.triggeringPlayerId,
          sourceMageId,
          targetSpaceId,
        },
      }),
    };
  }

  // No infirmary bonus needed — apply the placement and route through
  // the instant-room check (Guilds A etc.).
  return patchWithMaybeInstantReward(
    ctx.state,
    moveRedMagePatch(
      ctx.state,
      sourceMageId,
      targetSpaceId,
      ctx.triggeringPlayerId,
    ),
    targetSpaceId,
    ctx.triggeringPlayerId,
    'base',
  );
});

/**
 * Patch that moves the caster's red Mage onto the targeted slot, if the
 * slot is empty. Returns an empty patch if the slot was reclaimed (e.g.,
 * Phase Steppers shadow).
 */
function moveRedMagePatch(
  state: GameState,
  sourceMageId: OwnedMageId,
  targetSpaceId: ActionSpaceId,
  casterId: PlayerId,
): GameStatePatch {
  const lookup = findActionSpace(state, targetSpaceId);
  if (!lookup) return {};
  if (lookup.space.occupant !== null) return {};

  return {
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== targetSpaceId
          ? s
          : {
              ...s,
              occupant: {
                mageId: sourceMageId,
                ownerId: casterId,
                isShadowing: false,
              },
            },
      ),
    })),
    players: state.players.map((p) =>
      p.id !== casterId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== sourceMageId
                ? m
                : {
                    ...m,
                    location: { kind: 'action-space' as const, spaceId: targetSpaceId },
                    isShadowing: false,
                  },
            ),
          },
    ),
  };
}

// ============================================================================
// Bell Tower offerings (base pack, 2-player game)
// ============================================================================

/** First-player Token — claimer becomes first player next round. */
registerEffect('base.bell.first-player', (ctx: EffectContext): EffectResult => {
  const idx = ctx.state.players.findIndex((p) => p.id === ctx.triggeringPlayerId);
  if (idx === -1) {
    throw new Error('base.bell.first-player: claimer not found');
  }
  return { kind: 'done', patch: { firstPlayerIndex: idx } };
});

/** Gold or Mana — claimer chooses 2 Gold OR 1 Mana. */
registerEffect('base.bell.gold-or-mana', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'gold', label: 'Gain 2 Gold', payload: {} },
            { id: 'mana', label: 'Gain 1 Mana', payload: {} },
          ],
        },
        resume: { effectId: 'base.bell.gold-or-mana', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `base.bell.gold-or-mana expected option-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  if (ctx.resumeAnswer.optionId === 'gold') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 2),
    };
  }
  if (ctx.resumeAnswer.optionId === 'mana') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 1),
    };
  }
  throw new Error(
    `base.bell.gold-or-mana unknown option ${ctx.resumeAnswer.optionId}`,
  );
});

/** Influence Point — claimer gains 1 IP. */
registerEffect('base.bell.gain-ip', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 1),
}));

// ============================================================================
// Supporters — simple resource-gain effects.
//
// The remaining base supporters (gold-swap loops, mage manipulation, mage
// supply swaps, custom voter logic, endgame-only metaeffects) are not yet
// registered; PLAY_SUPPORTER on those will throw "effect not registered" and
// the engine will surface a clear error in the UI.
// ============================================================================

/** Allys Mehrmus — Gain 3 IP. */
registerEffect(
  'base.supporter.allys-mehrmus',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 3),
  }),
);

/** Andrus Dochartaigh — Gain 2 Mana. */
registerEffect(
  'base.supporter.andrus-dochartaigh',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 2),
  }),
);

/** Kallistar Flarechild — Gain 1 IP. */
registerEffect(
  'base.supporter.kallistar-flarechild',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 1),
  }),
);

/** Quan Gon Kall — Gain 2 IP. */
registerEffect(
  'base.supporter.quan-gon-kall',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
  }),
);

/** Salem Silver — Gain 3 Mana. */
registerEffect(
  'base.supporter.salem-silver',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 3),
  }),
);

/** St. Mikhail Isen — Gain 4 Mana. */
registerEffect(
  'base.supporter.st-mikhail-isen',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 4),
  }),
);

/** Jasper Haekel — Gain a Mark (one voter prompt). */
registerEffect(
  'base.supporter.jasper-haekel',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (prompt === null) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    throw new Error(
      'jasper-haekel should not be re-invoked (gain-mark handles its own resume)',
    );
  },
);

// ---------------------------------------------------------------------------
// Multi-grant loop helpers (Gain N Marks, Gain N Research).
//
// Each loop is driven by the calling effect re-invoking itself with a
// {remaining} resume context. Apply-this-tick logic lives in the helper so
// callers stay declarative.
// ---------------------------------------------------------------------------

function marksLoop(
  ctx: EffectContext,
  total: number,
  selfEffectId: string,
): EffectResult {
  const remaining =
    (ctx.resumeContext?.['remaining'] as number | undefined) ?? total;
  // If we arrived back here with a voter chosen, apply it BEFORE deciding
  // whether to ask for the next mark.
  let working = ctx.state;
  let appliedRemaining = remaining;
  if (ctx.resumeAnswer?.kind === 'voter-chosen') {
    working = {
      ...working,
      ...applyGainMark(working, ctx.triggeringPlayerId, ctx.resumeAnswer.voterId),
    };
    appliedRemaining = remaining - 1;
  }
  if (appliedRemaining <= 0) {
    return { kind: 'done', patch: { players: working.players } };
  }
  const prompt = spawnGainMarkPrompt(working, ctx.triggeringPlayerId, ctx.source);
  if (prompt === null) {
    // No more eligible voters — emit what we already applied and stop.
    return { kind: 'done', patch: { players: working.players } };
  }
  return {
    kind: 'pause',
    patch: { players: working.players },
    pending: {
      ...prompt,
      resume: {
        effectId: selfEffectId,
        context: { remaining: appliedRemaining },
      },
    },
  };
}

/**
 * Pushes N Research opportunities onto `state.researchQueue`. Each entry
 * surfaces a full research menu (Draft / Add-WIS / Discard) one at a time
 * via the engine's `drainResearchQueueIfIdle` pump, generated against the
 * then-current state so option visibility (INT/WIS pools, upgradable spell
 * list, etc.) is up to date after each spend.
 *
 * `restrictDepartment` pins each queued entry to a single department — the
 * draft prompt only offers spells of that department, and the WIS-upgrade
 * prompt only offers owned spells of that department. Used by Adelaide
 * Chivers, Jaimes Kalin, Jance Eylon, Kas Karrowary, and Vellimoor Cantz.
 */
function appendResearchQueue(
  state: GameState,
  playerId: string,
  source: ResolutionSource,
  count: number,
  restrictDepartment?: Department,
): GameStatePatch {
  if (count <= 0) return {};
  const entries: GameState['researchQueue'] = [];
  for (let i = 0; i < count; i++) {
    entries.push(
      restrictDepartment
        ? { playerId, source, restrictDepartment }
        : { playerId, source },
    );
  }
  return {
    researchQueue: [...state.researchQueue, ...entries],
  };
}

/** Alumis — Gain 2 Marks. */
registerEffect('base.supporter.alumis', (ctx): EffectResult =>
  marksLoop(ctx, 2, 'base.supporter.alumis'),
);

/** Rixia Van Sorrel — Gain 1 Research. */
registerEffect('base.supporter.rixia-van-sorrel', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(ctx.state, ctx.triggeringPlayerId, ctx.source, 1),
}));

/** Welsie Acktern — Gain 2 Research. */
registerEffect('base.supporter.welsie-acktern', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(ctx.state, ctx.triggeringPlayerId, ctx.source, 2),
}));

/** Batrov Wargrave — Gain 3 Research. */
registerEffect('base.supporter.batrov-wargrave', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(ctx.state, ctx.triggeringPlayerId, ctx.source, 3),
}));

/** Adelaide Chivers — Gain 2 Research, Planar (Purple) Spells only. */
registerEffect('base.supporter.adelaide-chivers', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(
    ctx.state,
    ctx.triggeringPlayerId,
    ctx.source,
    2,
    'planar-studies',
  ),
}));

/** Jaimes Kalin — Gain 2 Research, Natural Magick (Green) Spells only. */
registerEffect('base.supporter.jaimes-kalin', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(
    ctx.state,
    ctx.triggeringPlayerId,
    ctx.source,
    2,
    'natural-magick',
  ),
}));

/** Jance Eylon — Gain 2 Research, Mysticism (Grey) Spells only. */
registerEffect('base.supporter.jance-eylon', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(
    ctx.state,
    ctx.triggeringPlayerId,
    ctx.source,
    2,
    'mysticism',
  ),
}));

/** Kas Karrowary — Gain 2 Research, Divinity (Blue) Spells only. */
registerEffect('base.supporter.kas-karrowary', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(
    ctx.state,
    ctx.triggeringPlayerId,
    ctx.source,
    2,
    'divinity',
  ),
}));

/** Vellimoor Cantz — Gain 2 Research, Sorcery (Red) Spells only. */
registerEffect('base.supporter.vellimoor-cantz', (ctx): EffectResult => ({
  kind: 'done',
  patch: appendResearchQueue(
    ctx.state,
    ctx.triggeringPlayerId,
    ctx.source,
    2,
    'sorcery',
  ),
}));

// ---------------------------------------------------------------------------
// Mage-manipulation supporters — direct analogs of the leader spells, with
// the same eligibility filters (green-immune; opposing-blue exempt only for
// spells, but supporter cards are still exemption-aware because the helpers
// were originally written for spells — confirm with the rulebook later if
// the supporter cards should ignore blue immunity).
// ---------------------------------------------------------------------------

/** Andros DuValt — Banish a Mage. (Fast Action, supporter source.) */
registerEffect('base.supporter.andros-duvalt', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildNonSpellHarmfulTargets(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: 'base.supporter.andros-duvalt', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `andros-duvalt expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const banished = banishMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  return {
    kind: 'open-reaction',
    patch: banished.patch,
    window: {
      triggerEvents: [banished.triggerEvent],
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: { effectId: 'base.system.noop', context: {} },
      source: ctx.source,
    },
  };
});

/** Letum Conspicere — Wound a Mage. (Fast Action, supporter source.) */
registerEffect('base.supporter.letum-conspicere', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildNonSpellHarmfulTargets(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: 'base.supporter.letum-conspicere', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `letum-conspicere expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const wound = woundMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  return {
    kind: 'open-reaction',
    patch: wound.patch,
    window: {
      triggerEvents: [wound.triggerEvent],
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.post-wound-bonus',
        context: { triggerEvent: triggerEventToContext(wound.triggerEvent) },
      },
      source: ctx.source,
    },
  };
});

/** Rennel Pedrigor — Shadow an opponent's Mage. (Fast Action) */
/**
 * Rennel Pedrigor (Fast Action): pick an opponent's placed mage, then pick
 * one of YOUR office mages to place in that slot's shadow position. The
 * opponent's mage is unaffected; your shadow mage claims the slot's
 * reward right after the opponent does (color ability suppressed).
 */
registerEffect('base.supporter.rennel-pedrigor', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];

  // step='after-shadow-window' is re-entered from the mage-shadowed
  // reaction window's afterResume — no resumeAnswer. Handle BEFORE the
  // first-call short-circuit so the instant-reward check runs.
  if (step === 'after-shadow-window') {
    const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
    if (typeof targetSpaceId !== 'string') {
      throw new Error('rennel-pedrigor after-shadow-window: missing targetSpaceId');
    }
    return patchWithMaybeInstantReward(
      ctx.state,
      {},
      targetSpaceId,
      ctx.triggeringPlayerId,
      'shadow',
    );
  }

  // Step 1: pick the opponent target. Exclude targets whose containing
  // room is at the caster's per-round placement cap (shadow placement
  // counts as placement).
  if (!ctx.resumeAnswer) {
    const targets: string[] = [];
    for (const p of ctx.state.players) {
      if (p.id === ctx.triggeringPlayerId) continue;
      for (const m of p.mages) {
        if (
          m.location.kind !== 'action-space' ||
          m.isWounded ||
          m.isShadowing
        ) {
          continue;
        }
        const room = ctx.state.rooms.find((r) =>
          r.actionSpaces.some(
            (s) =>
              s.id ===
              (m.location as { kind: 'action-space'; spaceId: string }).spaceId,
          ),
        );
        if (
          room &&
          isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, room.id)
        ) {
          continue;
        }
        targets.push(m.id);
      }
    }
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.supporter.rennel-pedrigor',
          context: { step: 'pick-shadow-mage' },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-shadow-mage') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(
        `rennel-pedrigor pick-shadow-mage expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!targetMage || targetMage.location.kind !== 'action-space') {
      throw new Error('rennel-pedrigor: target no longer on a slot');
    }
    const targetSpaceId = targetMage.location.spaceId;
    const targetSpace = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === targetSpaceId);
    if (targetSpace?.shadowOccupant) {
      return { kind: 'done', patch: {} };
    }
    const caster = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const officeMages =
      caster?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
        resume: {
          effectId: 'base.supporter.rennel-pedrigor',
          context: { step: 'apply', targetMageId, targetSpaceId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('rennel-pedrigor apply expected mage-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
    if (
      typeof targetMageId !== 'string' ||
      typeof targetSpaceId !== 'string'
    ) {
      throw new Error('rennel-pedrigor apply: missing context fields');
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const patch = placeOfficeMageAsShadow(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      targetSpaceId,
    );
    const event = buildMageShadowedEvent(
      { ...ctx.state, ...patch },
      targetMageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch,
      window: {
        triggerEvents: [event],
        pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.supporter.rennel-pedrigor',
          context: { step: 'after-shadow-window', targetSpaceId },
        },
        source: ctx.source,
      },
    };
  }

  throw new Error(`rennel-pedrigor unexpected step ${String(step)}`);
});

// ---------------------------------------------------------------------------
// One-shot Gold→Mage swap supporters. Each fizzles silently if the player
// can't pay 3 Gold, the supply for that color is empty, or the player is
// already at the 2-per-color cap.
// ---------------------------------------------------------------------------

function goldForMageSupporter(
  ctx: EffectContext,
  color: MageColor,
): EffectResult {
  const patch = applyGoldForMageSwap(
    ctx.state,
    ctx.triggeringPlayerId,
    color,
    3,
  );
  if (patch === null) return { kind: 'done', patch: {} };
  return { kind: 'done', patch };
}

/** Arec Russel Zane — Swap 3 Gold for a Sorcery (Red) Mage. */
registerEffect('base.supporter.arec-russel-zane', (ctx): EffectResult =>
  goldForMageSupporter(ctx, 'red'),
);

/** Kavri Shi Shorec — Swap 3 Gold for a Divinity (Blue) Mage. */
registerEffect('base.supporter.kavri-shi-shorec', (ctx): EffectResult =>
  goldForMageSupporter(ctx, 'blue'),
);

/** Lesandra Machan — Swap 3 Gold for a Mysticism (Grey) Mage. */
registerEffect('base.supporter.lesandra-machan', (ctx): EffectResult =>
  goldForMageSupporter(ctx, 'grey'),
);

/** Pendros Schalla — Swap 3 Gold for a Natural Magick (Green) Mage. */
registerEffect('base.supporter.pendros-schalla', (ctx): EffectResult =>
  goldForMageSupporter(ctx, 'green'),
);

/** Wilhelm Barts — Swap 3 Gold for a Planar Studies (Purple) Mage. */
registerEffect('base.supporter.wilhelm-barts', (ctx): EffectResult =>
  goldForMageSupporter(ctx, 'purple'),
);

// ---------------------------------------------------------------------------
// Multi-tap "Swap X Gold for Y, up to N times" supporters. Each loop runs
// the same Yes/No prompt against a `remaining` counter; the affirmative
// branch either applies an immediate resource swap or pauses on a sub-prompt
// (e.g. voter pick for Mark).
// ---------------------------------------------------------------------------

function swapLoop(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: {
    label: string;
    goldCost: number;
    /** Direct resource gain branch (no sub-prompt). */
    immediateGain?: (state: GameState) => GameStatePatch;
    /** Pause-for-sub-prompt branch (used by Mark loops). */
    subPrompt?: (
      state: GameState,
      playerId: PlayerId,
      source: ResolutionSource,
    ) => PendingResolutionInput | null;
    /** Apply after a sub-prompt resolves; receives the resume answer. */
    applySubAnswer?: (
      state: GameState,
      playerId: PlayerId,
      answer: NonNullable<EffectContext['resumeAnswer']>,
    ) => GameStatePatch;
    total: number;
  },
): EffectResult {
  const step = ctx.resumeContext?.['step'];
  const remaining =
    (ctx.resumeContext?.['remaining'] as number | undefined) ?? cfg.total;

  // Apply sub-prompt answer (Mark voter, etc.) then loop back to "ask".
  if (step === 'sub-apply') {
    if (!ctx.resumeAnswer || !cfg.applySubAnswer) {
      throw new Error(`${selfEffectId}: sub-apply missing answer`);
    }
    const patch = cfg.applySubAnswer(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer,
    );
    return askForNextSwap(
      { ...ctx, state: { ...ctx.state, ...patch } },
      selfEffectId,
      cfg,
      remaining,
    );
  }

  // Top-level Swap / Stop choice.
  if (step === 'ask') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId}: ask expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId !== 'swap') {
      throw new Error(
        `${selfEffectId}: ask got unknown option ${ctx.resumeAnswer.optionId}`,
      );
    }
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    if (!player || player.resources.gold < cfg.goldCost) {
      // Can't afford — bail.
      return { kind: 'done', patch: {} };
    }
    const deductedState: GameState = {
      ...ctx.state,
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                gold: p.resources.gold - cfg.goldCost,
              },
            },
      ),
    };
    // Immediate-gain branch: apply, then loop back to "ask".
    if (cfg.immediateGain) {
      const gained: GameState = {
        ...deductedState,
        ...cfg.immediateGain(deductedState),
      };
      return askForNextSwap(
        { ...ctx, state: gained },
        selfEffectId,
        cfg,
        remaining - 1,
      );
    }
    // Sub-prompt branch (e.g. voter pick).
    if (cfg.subPrompt) {
      const subPending = cfg.subPrompt(
        deductedState,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (subPending === null) {
        // Sub-prompt unavailable (no eligible target); refund and stop.
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        patch: { players: deductedState.players },
        pending: {
          ...subPending,
          resume: {
            effectId: selfEffectId,
            context: { step: 'sub-apply', remaining: remaining - 1 },
          },
        },
      };
    }
    throw new Error(`${selfEffectId}: cfg missing immediateGain/subPrompt`);
  }

  // First entry (no step yet) — open the loop with an "ask".
  return askForNextSwap(ctx, selfEffectId, cfg, remaining);
}

function askForNextSwap(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: { label: string; goldCost: number; total: number },
  remaining: number,
): EffectResult {
  if (remaining <= 0) return { kind: 'done', patch: { players: ctx.state.players } };
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.gold < cfg.goldCost) {
    return { kind: 'done', patch: { players: ctx.state.players } };
  }
  const indexLabel = `${cfg.total - remaining + 1} of ${cfg.total}`;
  return {
    kind: 'pause',
    patch: { players: ctx.state.players },
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'swap', label: `${cfg.label} (${indexLabel})`, payload: {} },
          { id: 'stop', label: 'Stop swapping', payload: {} },
        ],
      },
      resume: {
        effectId: selfEffectId,
        context: { step: 'ask', remaining },
      },
      source: ctx.source,
    },
  };
}

/** Hai of Noirwood — Swap 2 Gold for a Mark, up to 3 times. */
registerEffect('base.supporter.hai-of-noirwood', (ctx): EffectResult =>
  swapLoop(ctx, 'base.supporter.hai-of-noirwood', {
    label: 'Swap 2 Gold for a Mark',
    goldCost: 2,
    total: 3,
    subPrompt: (state, playerId, source) =>
      spawnGainMarkPrompt(state, playerId, source),
    applySubAnswer: (state, playerId, answer) => {
      if (answer.kind !== 'voter-chosen') {
        throw new Error('hai-of-noirwood expected voter-chosen');
      }
      return applyGainMark(state, playerId, answer.voterId);
    },
  }),
);

/** Lynssara Yuuno — Swap 2 Gold for 1 IP, up to 4 times. */
registerEffect('base.supporter.lynssara-yuuno', (ctx): EffectResult =>
  swapLoop(ctx, 'base.supporter.lynssara-yuuno', {
    label: 'Swap 2 Gold for 1 IP',
    goldCost: 2,
    total: 4,
    immediateGain: (state) =>
      bumpInfluencePatch(state, ctx.triggeringPlayerId, 1),
  }),
);

/** Raffique Van Anzel — Swap 2 Gold for 1 Research, up to 4 times. */
registerEffect('base.supporter.raffique-van-anzel', (ctx): EffectResult =>
  swapLoop(ctx, 'base.supporter.raffique-van-anzel', {
    label: 'Swap 2 Gold for 1 Research',
    goldCost: 2,
    total: 4,
    // Research is a transient resource (the spend/discard step lives on its
    // own prompt). For now we treat the gain as no-op since the research
    // system is still a TODO; the gold cost is real, the research tick is
    // pending future research-system work.
    immediateGain: () => ({}),
  }),
);

/** Tanis Trilives — Swap 1 Gold for 1 Mana, up to 5 times. */
registerEffect('base.supporter.tanis-trilives', (ctx): EffectResult =>
  swapLoop(ctx, 'base.supporter.tanis-trilives', {
    label: 'Swap 1 Gold for 1 Mana',
    goldCost: 1,
    total: 5,
    immediateGain: (state) =>
      gainResourcePatch(state, ctx.triggeringPlayerId, 'mana', 1),
  }),
);

/**
 * Luras Wythe-Cariolis — Choose a Voter. Each player may place a Mark on
 * that Voter if they have not already done so. Per user guidance: assume
 * all non-caster players opt in (a free Mark is never refused).
 */
registerEffect('base.supporter.luras-wythe-cariolis', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    // Voter must be one the CASTER doesn't already have marked, since the
    // caster also gets a Mark. (Other players are filtered per-player below.)
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
        resume: {
          effectId: 'base.supporter.luras-wythe-cariolis',
          context: {},
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'voter-chosen') {
    throw new Error('luras-wythe-cariolis expected voter-chosen');
  }
  const voterId = ctx.resumeAnswer.voterId;
  let working = ctx.state;
  for (const p of ctx.state.players) {
    const alreadyMarked = working.voterMarks.some(
      (m) => m.voterId === voterId && m.playerId === p.id,
    );
    if (alreadyMarked) continue;
    working = { ...working, ...applyGainMark(working, p.id, voterId) };
  }
  return {
    kind: 'done',
    patch: { players: working.players, voterMarks: working.voterMarks },
  };
});

/**
 * Yinsei Arlington — Move a Mage into another slot in the same room.
 * Two-step: pick mage → pick destination in same room.
 */
registerEffect('base.supporter.yinsei-arlington', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const targets: string[] = [];
    for (const p of ctx.state.players) {
      for (const m of p.mages) {
        if (m.location.kind === 'action-space' && !m.isWounded) {
          targets.push(m.id);
        }
      }
    }
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.supporter.yinsei-arlington',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('yinsei-arlington pick-slot expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!targetMage || targetMage.location.kind !== 'action-space') {
      throw new Error('yinsei-arlington: target is no longer on a slot');
    }
    const fromSpaceId = targetMage.location.spaceId;
    const room = findRoomBySpaceId(ctx.state, fromSpaceId);
    if (!room) throw new Error('yinsei-arlington: room for target not found');
    const openSlots = room.actionSpaces
      .filter((s) => !s.occupant && s.id !== fromSpaceId)
      .map((s) => s.id);
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.supporter.yinsei-arlington',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('yinsei-arlington apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('yinsei-arlington apply: missing targetMageId');
    }
    const moved = moveMageToSpace(
      ctx.state,
      targetMageId,
      ctx.resumeAnswer.spaceId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: moved.patch,
      window: {
        triggerEvents: [moved.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`yinsei-arlington unexpected step ${String(step)}`);
});

// ============================================================================
// System effects shared by multiple spells / abilities.
// ============================================================================

/** No-op effect used as `afterResume` when a reaction window has no
 *  follow-up step (the action's only job was to fire its trigger). */
registerEffect('base.system.noop', () => ({ kind: 'done', patch: {} }));

/**
 * Wild-department choice (White Ash) — fires once per White Ash owner
 * during the 'final-scoring' phase, before voters are revealed. The
 * prompt's optionId is the chosen Department. We save the choice on the
 * responder; if this was the last White Ash owner waiting to declare, we
 * finalize the game inline (reveal voters + compute scoring + flip phase
 * to 'complete'). Otherwise the next pending in the queue takes over.
 */
registerEffect(
  'base.system.wild-department-choice',
  (ctx): EffectResult => {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        'wild-department-choice expected option-chosen',
      );
    }
    const dept = ctx.resumeAnswer.optionId;
    const valid: readonly Department[] = [
      'sorcery',
      'mysticism',
      'natural-magick',
      'planar-studies',
      'divinity',
      'students',
    ];
    if (!valid.includes(dept as Department)) {
      throw new Error(
        `wild-department-choice: ${dept} is not a real department`,
      );
    }
    const chosen = dept as Department;
    const playersWithChoice = ctx.state.players.map((p) =>
      p.id !== ctx.triggeringPlayerId
        ? p
        : { ...p, wildDepartmentChoice: chosen },
    );
    const afterChoice: GameState = {
      ...ctx.state,
      players: playersWithChoice,
    };
    // If anyone else still needs to choose, just emit the patch — the
    // next pending in the stack will fire when this one pops.
    const stillNeed = afterChoice.players.some(
      (p) => playerOwnsWildSupporter(afterChoice, p) && !p.wildDepartmentChoice,
    );
    if (stillNeed) {
      return { kind: 'done', patch: { players: playersWithChoice } };
    }
    // Last choice — finalize the game inline.
    const revealedVoters = afterChoice.voters.map((v) => ({
      ...v,
      revealed: true,
    }));
    const finalState: GameState = { ...afterChoice, voters: revealedVoters };
    const result = computeFinalScoring(finalState);
    return {
      kind: 'done',
      patch: {
        players: playersWithChoice,
        voters: revealedVoters,
        phase: { kind: 'complete', archmage: result.archmage },
      },
    };
  },
);

/**
 * Grey (Mysticism) mage ability — when a player casts a spell as a
 * (full) Action, they MAY place one of their grey office mages onto any
 * open base slot. The opportunity fires AFTER the spell resolves: the
 * engine pushes a Yes/No pending at the bottom of the stack before
 * invoking the spell effect, so the spell's own prompts / reactions /
 * follow-ups resolve first.
 *
 * Steps: 'choose' (Yes/No) → 'pick-mage' (which grey, if multiple) →
 * 'pick-slot' (which open base slot) → 'apply'.
 */
registerEffect(
  'base.system.mysticism-place-after-cast',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    if (step === 'choose') {
      if (ctx.resumeAnswer?.kind !== 'option-chosen') {
        throw new Error(
          'mysticism-place-after-cast choose expected option-chosen',
        );
      }
      if (ctx.resumeAnswer.optionId === 'skip') {
        return { kind: 'done', patch: {} };
      }
      if (ctx.resumeAnswer.optionId !== 'place') {
        throw new Error(
          `mysticism-place-after-cast unknown option ${ctx.resumeAnswer.optionId}`,
        );
      }
      const player = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      const greyMages =
        player?.mages
          .filter(
            (m) =>
              m.color === 'grey' &&
              m.location.kind === 'office' &&
              !m.isWounded,
          )
          .map((m) => m.id) ?? [];
      if (greyMages.length === 0) return { kind: 'done', patch: {} };
      // Single grey → skip the mage-pick prompt and go straight to slot.
      if (greyMages.length === 1) {
        return openSlotPrompt(ctx, greyMages[0] as string);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: greyMages },
          resume: {
            effectId: 'base.system.mysticism-place-after-cast',
            context: { step: 'pick-slot' },
          },
          source: ctx.source,
        },
      };
    }
    if (step === 'pick-slot') {
      if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
        throw new Error(
          'mysticism-place-after-cast pick-slot expected mage-chosen',
        );
      }
      return openSlotPrompt(ctx, ctx.resumeAnswer.mageId);
    }
    if (step === 'apply') {
      if (ctx.resumeAnswer?.kind !== 'space-chosen') {
        throw new Error(
          'mysticism-place-after-cast apply expected space-chosen',
        );
      }
      const placerMageId = ctx.resumeContext?.['placerMageId'];
      if (typeof placerMageId !== 'string') {
        throw new Error(
          'mysticism-place-after-cast apply: missing placerMageId',
        );
      }
      const spaceId = ctx.resumeAnswer.spaceId;
      const placePatch = placeOfficeMageOnSpace(
        ctx.state,
        ctx.triggeringPlayerId,
        placerMageId,
        spaceId,
      );
      return patchWithMaybeInstantReward(
        ctx.state,
        placePatch,
        spaceId,
        ctx.triggeringPlayerId,
        'base',
      );
    }
    throw new Error(
      `mysticism-place-after-cast unexpected step ${String(step)}`,
    );
  },
);

/**
 * Per-room cap + cannotBePlacedInDirectly aware list of empty base slots
 * for the responder. Used by the Mysticism place-after-cast prompt so
 * Council Chamber's "1 mage per player per round" rule is respected and
 * the Infirmary (non-placeable) is excluded.
 */
function listEligiblePlacementSlots(
  state: GameState,
  playerId: string,
): string[] {
  const openSlots: string[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    if (isRoomAtPlayerCap(state, playerId, r.id)) continue;
    for (const s of r.actionSpaces) {
      if (!s.occupant) openSlots.push(s.id);
    }
  }
  return openSlots;
}

/**
 * Builds the standard forfeit-or-reward PendingResolutionInput for an
 * instant-room placement triggered by a mage power or shadow effect.
 * Mirrors `pushResolutionChoicePrompt` in `engine.ts` — kept in sync.
 * Shadow occupants pay no merit cost (matching engine semantics).
 */
function buildResolutionChoicePromptInput(
  state: GameState,
  room: GameState['rooms'][number],
  space: GameState['rooms'][number]['actionSpaces'][number],
  playerId: string,
  position: 'base' | 'shadow' = 'base',
): PendingResolutionInput {
  const player = state.players.find((p) => p.id === playerId);
  const meritCost =
    position === 'base' && space.slotType === 'merit'
      ? (space.costToActivate?.meritBadges ?? 0)
      : 0;
  const canAffordReward =
    meritCost === 0 || (player?.resources.meritBadges ?? 0) >= meritCost;
  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        canAffordReward
          ? {
              id: 'reward',
              label:
                meritCost > 0
                  ? `Take reward (spend ${meritCost} MB)`
                  : 'Take reward',
              payload: {},
              available: true,
            }
          : {
              id: 'reward',
              label: `Take reward (spend ${meritCost} MB)`,
              payload: {},
              available: false,
              unavailableReason: `requires ${meritCost} Merit Badge${meritCost === 1 ? '' : 's'} (you have ${player?.resources.meritBadges ?? 0})`,
            },
        { id: 'forfeit', label: 'Forfeit for 1 IP', payload: {} },
      ],
    },
    resume: {
      effectId: 'base.system.resolution-choice',
      context: {
        spaceId: space.id,
        innerEffectId: space.effectId,
        meritCost,
      },
    },
    source: {
      kind: 'room-action',
      id: space.id,
      triggeringPlayerId: playerId,
      description: `${room.name} (${room.side}) — slot ${space.index + 1}`,
    },
  };
}

/**
 * If `spaceId` lives in an instant room with a registered slot effect,
 * returns 'pause' with the forfeit-or-reward prompt for `playerId` (so
 * the placement fires its bonus). Otherwise returns 'done' with the
 * original patch unchanged. Used by Ars Magna, Shadow Potion, and the
 * Paralocation/Rennel after-shadow-window step. Per the rulebook,
 * MOVE actions don't get instant bonuses — those sites don't call this.
 */
function patchWithMaybeInstantReward(
  state: GameState,
  patch: GameStatePatch,
  spaceId: string,
  playerId: string,
  position: 'base' | 'shadow' = 'base',
): EffectResult {
  const working: GameState = { ...state, ...patch };
  const room = working.rooms.find((r) =>
    r.actionSpaces.some((s) => s.id === spaceId),
  );
  const space = room?.actionSpaces.find((s) => s.id === spaceId);
  if (room && space && room.isInstantRoom && hasEffect(space.effectId)) {
    return {
      kind: 'pause',
      patch,
      pending: buildResolutionChoicePromptInput(
        working,
        room,
        space,
        playerId,
        position,
      ),
    };
  }
  return { kind: 'done', patch };
}

function openSlotPrompt(
  ctx: EffectContext,
  placerMageId: string,
): EffectResult {
  const openSlots = listEligiblePlacementSlots(
    ctx.state,
    ctx.triggeringPlayerId,
  );
  if (openSlots.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-action-space',
        eligibleSpaceIds: openSlots,
      },
      resume: {
        effectId: 'base.system.mysticism-place-after-cast',
        context: { step: 'apply', placerMageId },
      },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Faction leader (unique) spells
//
// Each candidate's starter spell. One level only, castable from turn 1 (no
// research required). Exhausted after cast; refreshed at round-setup.
// ============================================================================

/** Byron Krane — Trance: gain 2 mana. */
registerEffect('base.spell.trance.l1', (ctx): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 2),
}));

/** Trias Blackwind — Living Image: place a Neutral Mage from the supply
 *  into an empty slot of the caster's choice. The mage is flagged
 *  `isSummoned: true` and returned to the supply at the start of the
 *  next round-setup (see `endOfRoundCleanupForSummons`). Fizzles
 *  silently if the supply is empty or no eligible slots exist. */
registerEffect('base.spell.living-image.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.living-image.l1';

  if (!ctx.resumeAnswer) {
    if ((ctx.state.mageDraftPool['off-white'] ?? 0) === 0) {
      return { kind: 'done', patch: {} };
    }
    const slots = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (slots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: slots,
        },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const poolNow = ctx.state.mageDraftPool['off-white'] ?? 0;
    if (poolNow === 0) return { kind: 'done', patch: {} };
    const seq = ctx.state.nextSequenceId;
    const newMage: OwnedMage = {
      id: `m-${seq}`,
      cardId: 'base.mage.neutral',
      color: 'off-white',
      location: { kind: 'action-space' as const, spaceId },
      isShadowing: false,
      isWounded: false,
      isSummoned: true,
    };
    const occupancy: WorkerOccupancy = {
      mageId: newMage.id,
      ownerId: ctx.triggeringPlayerId,
      isShadowing: false,
    };
    const patch: GameStatePatch = {
      nextSequenceId: seq + 1,
      mageDraftPool: {
        ...ctx.state.mageDraftPool,
        'off-white': poolNow - 1,
      },
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, mages: [...p.mages, newMage] },
      ),
      rooms: ctx.state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== spaceId ? s : { ...s, occupant: occupancy },
        ),
      })),
    };
    return patchWithMaybeInstantReward(
      ctx.state,
      patch,
      spaceId,
      ctx.triggeringPlayerId,
      'base',
    );
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** Larimore Burman — Flash of Light: prompt for a banish target, then
 *  banish + open reaction window. */
registerEffect('base.spell.flash-of-light.l1', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildBanishTargets(ctx.state, ctx.triggeringPlayerId);
    if (targets.length === 0) {
      // No legal targets — spell fizzles (cost already paid by CAST_SPELL).
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.flash-of-light.l1',
          context: { step: 'apply' },
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `flash-of-light expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const banished = banishMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  return {
    kind: 'open-reaction',
    patch: banished.patch,
    window: {
      triggerEvents: [banished.triggerEvent],
      pendingResponderIds: buildReactionQueue(
        ctx.state,
        ctx.triggeringPlayerId,
      ),
      reactedPlayerIds: [],
      afterResume: { effectId: 'base.system.noop', context: {} },
      source: ctx.source,
    },
  };
});

/** Rheye Cal — Bless: move a wounded mage from the Infirmary to any open
 *  action space. Prompts: pick infirmary mage → pick open slot. */
registerEffect('base.spell.bless.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const infirmaryMages: string[] = [];
    for (const p of ctx.state.players) {
      for (const m of p.mages) {
        if (m.location.kind === 'infirmary') infirmaryMages.push(m.id);
      }
    }
    if (infirmaryMages.length === 0) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: infirmaryMages,
        },
        resume: {
          effectId: 'base.spell.bless.l1',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('bless pick-slot expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const openSlots: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant) openSlots.push(s.id);
      }
    }
    if (openSlots.length === 0) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.spell.bless.l1',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('bless apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('bless apply: missing targetMageId');
    }
    return {
      kind: 'done',
      patch: healMageToSpace(
        ctx.state,
        targetMageId,
        ctx.resumeAnswer.spaceId,
      ),
    };
  }
  throw new Error(`bless: unexpected step ${String(step)}`);
});

/** Exhufern Le Marigras — Strength of Earth: move an opponent's mage to
 *  another open slot in the SAME room. Prompts: pick opponent mage →
 *  pick open slot in that room → open reaction window for the move. */
registerEffect('base.spell.strength-of-earth.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    // Move is not wound — green mages are valid targets. Opposing blue
    // remains spell-immune. Restrict to opponents per spell text.
    const targets = buildSpellMoveTargets(
      ctx.state,
      ctx.triggeringPlayerId,
    ).filter((mageId) => {
      const owner = ctx.state.players.find((p) =>
        p.mages.some((m) => m.id === mageId),
      );
      return owner !== undefined && owner.id !== ctx.triggeringPlayerId;
    });
    if (targets.length === 0) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.strength-of-earth.l1',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('strength-of-earth pick-slot expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!targetMage || targetMage.location.kind !== 'action-space') {
      throw new Error('strength-of-earth: target is no longer on a slot');
    }
    const fromSpaceId = targetMage.location.spaceId;
    const room = findRoomBySpaceId(ctx.state, fromSpaceId);
    if (!room) throw new Error('strength-of-earth: room for target not found');
    const openSlots = room.actionSpaces
      .filter((s) => !s.occupant && s.id !== fromSpaceId)
      .map((s) => s.id);
    if (openSlots.length === 0) {
      // No other open slot in the same room — spell fizzles.
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.spell.strength-of-earth.l1',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('strength-of-earth apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('strength-of-earth apply: missing targetMageId');
    }
    const moved = moveMageToSpace(
      ctx.state,
      targetMageId,
      ctx.resumeAnswer.spaceId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: moved.patch,
      window: {
        triggerEvents: [moved.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`strength-of-earth: unexpected step ${String(step)}`);
});

/** Xal Ezra — Paralocation: shadow an opponent's mage on its current slot.
 *  The slot remains occupied but the occupant is now flagged as shadowing. */
/**
 * Paralocation: pick an opponent's placed mage, then pick one of YOUR
 * office mages to drop into that slot's shadow position. The opponent's
 * mage is unaffected — it keeps the base slot and will still collect the
 * reward at resolution; your shadow mage collects the same reward right
 * after. Your shadow mage loses its color-based ability while shadowing.
 */
/**
 * Shadow-opponent-mage: caster picks an opponent's placed mage, then picks
 * one of their own office mages to drop into the slot's shadow position.
 *
 * Used by:
 *  - base.spell.paralocation.l1 (Xal Ezra leader)
 *  - base.spell.parallel-synchronicity.l1 'Flicker' (Wave 7)
 *
 * Caster's per-round cap is respected at target eligibility — shadow
 * placement counts as a placement.
 */
function shadowOpponentMageEffect(selfEffectId: string) {
  return (ctx: EffectContext): EffectResult => {
    const step = ctx.resumeContext?.['step'];

    // step='after-shadow-window' is re-entered from the mage-shadowed
    // reaction window's afterResume — no resumeAnswer. Handle BEFORE the
    // first-call short-circuit so the instant-reward check runs.
    if (step === 'after-shadow-window') {
      const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
      if (typeof targetSpaceId !== 'string') {
        throw new Error(
          `${selfEffectId} after-shadow-window: missing targetSpaceId`,
        );
      }
      return patchWithMaybeInstantReward(
        ctx.state,
        {},
        targetSpaceId,
        ctx.triggeringPlayerId,
        'shadow',
      );
    }

    // Step 1: pick the opponent target. Shadow is not wound — green mages
    // are valid shadow targets. Opposing blue remains spell-immune.
    // Exclude targets whose containing room is at the caster's per-round
    // placement cap (the caster's mage will land there as a shadow).
    if (!ctx.resumeAnswer) {
      const all = buildSpellShadowTargets(
        ctx.state,
        ctx.triggeringPlayerId,
      ).filter((mageId) => {
        const owner = ctx.state.players.find((p) =>
          p.mages.some((m) => m.id === mageId),
        );
        return owner !== undefined && owner.id !== ctx.triggeringPlayerId;
      });
      const targets = all.filter((mageId) => {
        const mage = ctx.state.players
          .flatMap((p) => p.mages)
          .find((m) => m.id === mageId);
        if (!mage || mage.location.kind !== 'action-space') return false;
        const spaceId = mage.location.spaceId;
        const room = ctx.state.rooms.find((r) =>
          r.actionSpaces.some((s) => s.id === spaceId),
        );
        if (
          room &&
          isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, room.id)
        ) {
          return false;
        }
        return true;
      });
      if (targets.length === 0) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: {
            effectId: selfEffectId,
            context: { step: 'pick-shadow-mage' },
          },
          source: ctx.source,
        },
      };
    }

    // Step 2: pick one of YOUR office mages to place as shadow.
    if (step === 'pick-shadow-mage') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(
          `${selfEffectId} pick-shadow-mage expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
        );
      }
      const targetMageId = ctx.resumeAnswer.mageId;
      const targetMage = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === targetMageId);
      if (!targetMage || targetMage.location.kind !== 'action-space') {
        throw new Error(`${selfEffectId}: target no longer on a slot`);
      }
      const targetSpaceId = targetMage.location.spaceId;
      const targetSpace = ctx.state.rooms
        .flatMap((r) => r.actionSpaces)
        .find((s) => s.id === targetSpaceId);
      if (targetSpace?.shadowOccupant) {
        return { kind: 'done', patch: {} };
      }
      const caster = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      const officeMages =
        caster?.mages
          .filter((m) => m.location.kind === 'office' && !m.isWounded)
          .map((m) => m.id) ?? [];
      if (officeMages.length === 0) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
          resume: {
            effectId: selfEffectId,
            context: { step: 'apply', targetMageId, targetSpaceId },
          },
          source: ctx.source,
        },
      };
    }

    // Step 3: place the caster's mage in the shadow slot.
    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} apply expected mage-chosen`);
      }
      const targetMageId = ctx.resumeContext?.['targetMageId'];
      const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
      if (
        typeof targetMageId !== 'string' ||
        typeof targetSpaceId !== 'string'
      ) {
        throw new Error(`${selfEffectId} apply: missing context fields`);
      }
      const placerMageId = ctx.resumeAnswer.mageId;
      const patch = placeOfficeMageAsShadow(
        ctx.state,
        ctx.triggeringPlayerId,
        placerMageId,
        targetSpaceId,
      );
      const event = buildMageShadowedEvent(
        { ...ctx.state, ...patch },
        targetMageId,
        ctx.triggeringPlayerId,
      );
      return {
        kind: 'open-reaction',
        patch,
        window: {
          triggerEvents: [event],
          pendingResponderIds: buildReactionQueue(
            ctx.state,
            ctx.triggeringPlayerId,
          ),
          reactedPlayerIds: [],
          afterResume: {
            effectId: selfEffectId,
            context: { step: 'after-shadow-window', targetSpaceId },
          },
          source: ctx.source,
        },
      };
    }

    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  };
}

registerEffect(
  'base.spell.paralocation.l1',
  shadowOpponentMageEffect('base.spell.paralocation.l1'),
);

// ============================================================================
// Vault cards — simple resource-gain and prompt-based effects.
//
// Mage manipulation, swap loops, refresh-spell, infirmary moves, multi-tap
// mana spends, and Legendary research remain unregistered; PLAY_VAULT_CARD
// on those throws "effect not registered" but the cards still exhaust /
// discard and count for endgame scoring.
// ============================================================================

/** Mana Crystal (treasure, action) — Gain 2 Mana. */
registerEffect(
  'base.vault.mana-crystal',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 2),
  }),
);

/** Gilded Chalice (treasure, action) — Gain 2 IP. */
registerEffect(
  'base.vault.gilded-chalice',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
  }),
);

/** The Arcane Eye (treasure, action) — Gain a Mark. */
registerEffect(
  'base.vault.the-arcane-eye',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (prompt === null) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    throw new Error(
      'the-arcane-eye should not be re-invoked (gain-mark handles its own resume)',
    );
  },
);

/** Spirits (consumable, fast-action) — Gain a Mark. */
registerEffect(
  'base.vault.spirits',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (prompt === null) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    throw new Error(
      'spirits should not be re-invoked (gain-mark handles its own resume)',
    );
  },
);

/** Runestone (consumable, fast-action) — Gain 1 INT OR gain 1 WIS. */
registerEffect(
  'base.vault.runestone',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'int', label: 'Gain 1 INT', payload: {} },
              { id: 'wis', label: 'Gain 1 WIS', payload: {} },
            ],
          },
          resume: { effectId: 'base.vault.runestone', context: {} },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`runestone expected option-chosen, got ${ctx.resumeAnswer.kind}`);
    }
    const resource = ctx.resumeAnswer.optionId === 'int' ? 'intelligence' : 'wisdom';
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, resource, 1),
    };
  },
);

/** Mana Elixir (consumable, fast-action) — The next Spell you play this
 *  turn costs no Mana. Sets the player's `nextSpellFreeMana` flag, which
 *  CAST_SPELL consumes and processErrandsAdvance clears at turn end. */
registerEffect('base.vault.mana-elixir', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    players: ctx.state.players.map((p) =>
      p.id !== ctx.triggeringPlayerId
        ? p
        : { ...p, nextSpellFreeMana: true },
    ),
  },
}));

/**
 * Endless Coin Purse (treasure, action) — Gain 1 Gold. Gain a Buy.
 * Step 1: grant 1 gold. Step 2: prompt Buy/Skip, then route the Buy through
 * a `choose-vault-card` filtered to affordable cards.
 */
registerEffect('base.vault.endless-coin-purse', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  // step='after-buy' re-enters from a reaction-window afterResume; no
  // resumeAnswer. Handle BEFORE the first-call short-circuit below.
  if (step === 'after-buy') {
    const vaultCardId = ctx.resumeContext?.['vaultCardId'];
    if (typeof vaultCardId !== 'string') {
      throw new Error('endless-coin-purse after-buy: missing vaultCardId');
    }
    return {
      kind: 'done',
      patch: applyVaultPurchaseMaybeWaived(
        ctx.state,
        ctx.triggeringPlayerId,
        vaultCardId,
      ),
    };
  }
  if (!ctx.resumeAnswer) {
    // First entry: grant 1 Gold, then ask Buy/Skip.
    const goldGained = {
      ...ctx.state,
      ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 1),
    };
    const affordable = affordableVaultCards(goldGained, ctx.triggeringPlayerId);
    if (affordable.length === 0) {
      return { kind: 'done', patch: { players: goldGained.players } };
    }
    return {
      kind: 'pause',
      patch: { players: goldGained.players },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'buy', label: 'Gain a Buy', payload: {} },
            { id: 'skip', label: 'Skip the Buy', payload: {} },
          ],
        },
        resume: {
          effectId: 'base.vault.endless-coin-purse',
          context: { step: 'buy-or-skip' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'buy-or-skip') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('endless-coin-purse buy-or-skip expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'skip') {
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId !== 'buy') {
      throw new Error(
        `endless-coin-purse unknown option ${ctx.resumeAnswer.optionId}`,
      );
    }
    const affordable = affordableVaultCards(ctx.state, ctx.triggeringPlayerId);
    if (affordable.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-vault-card', eligibleCardIds: affordable },
        resume: {
          effectId: 'base.vault.endless-coin-purse',
          context: { step: 'pick-card' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-card') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error('endless-coin-purse pick-card expected card-chosen');
    }
    // Route through the gold-payment reaction window so Auric Catalyst
    // can waive the cost. afterResume re-enters at step='after-buy'
    // (handled above the resumeAnswer guard).
    return spawnVaultBuyReactionWindow(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.cardId,
      ctx.source,
      {
        effectId: 'base.vault.endless-coin-purse',
        context: {
          step: 'after-buy',
          vaultCardId: ctx.resumeAnswer.cardId,
        },
      },
    );
  }
  throw new Error(`endless-coin-purse unexpected step ${String(step)}`);
});

/**
 * Sealed Jar (consumable, fast-action) — Gain 7 Gold OR draw a Vault Card.
 * "Draw" = take the top of the vault deck (random unseen card).
 */
registerEffect('base.vault.sealed-jar', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'gold', label: 'Gain 7 Gold', payload: {} },
            { id: 'draw', label: 'Draw a Vault Card', payload: {} },
          ],
        },
        resume: { effectId: 'base.vault.sealed-jar', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('sealed-jar expected option-chosen');
  }
  if (ctx.resumeAnswer.optionId === 'gold') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 7),
    };
  }
  if (ctx.resumeAnswer.optionId === 'draw') {
    return {
      kind: 'done',
      patch: drawTopOfVaultDeck(ctx.state, ctx.triggeringPlayerId, 1),
    };
  }
  throw new Error(`sealed-jar unknown option ${ctx.resumeAnswer.optionId}`);
});

/**
 * Bottled Memories (consumable, fast-action) — Refresh an exhausted Spell.
 * Prompts for one of the caster's exhausted spells; clears `exhausted`.
 */
registerEffect('base.vault.bottled-memories', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const prompt = buildRefreshOwnedSpellPrompt(
      ctx.state,
      ctx.triggeringPlayerId,
      { effectId: 'base.vault.bottled-memories', context: {} },
      ctx.source,
    );
    if (!prompt) return { kind: 'done', patch: {} };
    return { kind: 'pause', pending: prompt };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('bottled-memories expected option-chosen');
  }
  return {
    kind: 'done',
    patch: refreshOwnedSpellPatch(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.optionId,
    ),
  };
});

/**
 * Healing Drops (consumable, action) — Move a Mage from the Infirmary to
 * an open slot of your choice. Identical pattern to Bless (the leader
 * spell); reuses the same prompt chain.
 */
registerEffect('base.vault.healing-drops', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const infirmaryMages: string[] = [];
    for (const p of ctx.state.players) {
      for (const m of p.mages) {
        if (m.location.kind === 'infirmary') infirmaryMages.push(m.id);
      }
    }
    if (infirmaryMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: infirmaryMages },
        resume: {
          effectId: 'base.vault.healing-drops',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('healing-drops pick-slot expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const openSlots: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant) openSlots.push(s.id);
      }
    }
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.vault.healing-drops',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('healing-drops apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('healing-drops apply: missing targetMageId');
    }
    return {
      kind: 'done',
      patch: healMageToSpace(ctx.state, targetMageId, ctx.resumeAnswer.spaceId),
    };
  }
  throw new Error(`healing-drops unexpected step ${String(step)}`);
});

/**
 * Liquid Lightning (consumable, fast-action) — Place a Mage. Player picks
 * one of their office mages and an open action space; the mage is placed.
 *
 * Note: this bypasses normal Action-budget gating (Liquid Lightning IS the
 * placement) and any per-room placement-limit checks; matches the card text.
 */
registerEffect('base.vault.liquid-lightning', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const officeMages =
      player?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
        resume: {
          effectId: 'base.vault.liquid-lightning',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('liquid-lightning pick-slot expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const openSlots: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant) openSlots.push(s.id);
      }
    }
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.vault.liquid-lightning',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('liquid-lightning apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('liquid-lightning apply: missing targetMageId');
    }
    return {
      kind: 'done',
      patch: placeOfficeMageOnSpace(
        ctx.state,
        ctx.triggeringPlayerId,
        targetMageId,
        ctx.resumeAnswer.spaceId,
      ),
    };
  }
  throw new Error(`liquid-lightning unexpected step ${String(step)}`);
});

/**
 * Wound + place — shared registration for Bottled Rage and Spellblade.
 *
 * "Wound a Mage, then place one of yours into its slot." Step 1: pick wound
 * target (non-spell harmful filter). Step 2: pick one of your office mages
 * to place into the now-empty slot.
 */
/**
 * Wound + place pattern used by Bottled Rage and Spellblade.
 *
 * Sequence:
 *   1. Player picks the wound target.
 *   2. Wound applied; reaction window opens.
 *   3. After window closes (`step: 'after-wound'`):
 *      - If the wound stuck and was inflicted on an opponent, pause for
 *        the infirmary bonus prompt and route the bonus answer into
 *        `step: 'after-bonus'`.
 *      - Otherwise fall through to `tryPlace`.
 *   4. `after-bonus`: apply bonus, then `tryPlace`.
 *   5. `tryPlace`: if the wounded slot is now empty and the player has
 *      an office mage, prompt for the placer (`step: 'apply-place'`).
 *      If the slot got reclaimed (Phase Steppers shadow) or the player
 *      has no office mage, end without placing.
 *   6. `apply-place`: place the chosen mage onto the wounded slot.
 */
function woundAndPlaceEffect(opts: {
  selfEffectId: string;
  /**
   * 'non-spell' = vault cards / supporters / mage abilities (blue immunity
   * does NOT apply). 'spell' = direct spell cast (blue immunity applies).
   */
  source?: 'spell' | 'non-spell';
  /**
   * Suppress the standard post-wound Infirmary bonus (e.g. Poison: "owner
   * gains no Infirmary Bonus"). When true, skip directly to the place step.
   */
  suppressInfirmaryBonus?: boolean;
}) {
  const { selfEffectId } = opts;
  const source = opts.source ?? 'non-spell';
  const suppressBonus = opts.suppressInfirmaryBonus ?? false;
  return (ctx: EffectContext): EffectResult => {
    const step = ctx.resumeContext?.['step'];

    // after-wound is re-entered from the reaction-window's afterResume
    // (invokeContinuation passes no resumeAnswer). Handle it BEFORE the
    // first-call short-circuit so we don't re-present the wound prompt.
    if (step === 'after-wound') {
      const event = readTriggerEvent(ctx);
      const slotId = ctx.resumeContext?.['slotId'];
      if (typeof slotId !== 'string') {
        throw new Error(`${selfEffectId} after-wound: missing slotId`);
      }
      if (
        !suppressBonus &&
        event &&
        checkInfirmaryBonusApplies(ctx.state, event)
      ) {
        return {
          kind: 'pause',
          pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
            effectId: selfEffectId,
            context: {
              step: 'after-bonus',
              recipientPlayerId: event.ownerId,
              slotId,
            },
          }),
        };
      }
      return tryPlaceForWoundPlace(ctx, selfEffectId, slotId, ctx.state);
    }

    // Step 1: present wound target list.
    if (!ctx.resumeAnswer) {
      const targets =
        source === 'spell'
          ? buildBurnTargets(ctx.state, ctx.triggeringPlayerId)
          : buildNonSpellHarmfulTargets(
              ctx.state,
              ctx.triggeringPlayerId,
            );
      if (targets.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: { effectId: selfEffectId, context: { step: 'wound' } },
          source: ctx.source,
        },
      };
    }

    // Step 2: wound the target and open the reaction window.
    if (step === 'wound') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} wound expected mage-chosen`);
      }
      const woundTarget = ctx.resumeAnswer.mageId;
      const targetMage = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === woundTarget);
      if (!targetMage || targetMage.location.kind !== 'action-space') {
        throw new Error(`${selfEffectId}: wound target no longer on a slot`);
      }
      const slotId = targetMage.location.spaceId;
      const wound = woundMage(
        ctx.state,
        woundTarget,
        ctx.triggeringPlayerId,
      );
      return {
        kind: 'open-reaction',
        patch: wound.patch,
        window: {
          triggerEvents: [wound.triggerEvent],
          pendingResponderIds: buildReactionQueue(
            ctx.state,
            ctx.triggeringPlayerId,
          ),
          reactedPlayerIds: [],
          afterResume: {
            effectId: selfEffectId,
            context: {
              step: 'after-wound',
              triggerEvent: triggerEventToContext(wound.triggerEvent),
              slotId,
            },
          },
          source: ctx.source,
        },
      };
    }

    // Step 3 (after-wound) is handled at the top of the function before the
    // resumeAnswer short-circuit, since the reaction-window's afterResume
    // re-enters without a resumeAnswer.

    // Step 4: apply the bonus the wounded player picked, then attempt the place.
    if (step === 'after-bonus') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${selfEffectId} after-bonus expected option-chosen`);
      }
      const recipientId = ctx.resumeContext?.['recipientPlayerId'];
      const slotId = ctx.resumeContext?.['slotId'];
      if (typeof recipientId !== 'string' || typeof slotId !== 'string') {
        throw new Error(`${selfEffectId} after-bonus: missing context fields`);
      }
      const bonusPatch = applyInfirmaryBonusPatch(
        ctx.state,
        recipientId,
        ctx.resumeAnswer.optionId,
      );
      const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
      return tryPlaceForWoundPlace(ctx, selfEffectId, slotId, afterBonus);
    }

    // Step 6: place the chosen mage onto the vacated slot.
    if (step === 'apply-place') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} apply-place expected mage-chosen`);
      }
      const slotId = ctx.resumeContext?.['slotId'];
      if (typeof slotId !== 'string') {
        throw new Error(`${selfEffectId}: missing slotId`);
      }
      const lookup = findActionSpace(ctx.state, slotId);
      if (!lookup || lookup.space.occupant !== null) {
        // Slot was reclaimed (e.g. Phase Steppers / Invisibility Cloak).
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'done',
        patch: placeOfficeMageOnSpace(
          ctx.state,
          ctx.triggeringPlayerId,
          ctx.resumeAnswer.mageId,
          slotId,
        ),
      };
    }

    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  };
}

/**
 * Helper for Bottled Rage / Spellblade's step-5 "try the place". Builds the
 * placer-pick pause if it's viable; otherwise returns done.
 */
function tryPlaceForWoundPlace(
  ctx: EffectContext,
  selfEffectId: string,
  slotId: string,
  state: GameState,
): EffectResult {
  // If the slot got reclaimed during the reaction window (Phase Steppers /
  // Invisibility Cloak put the mage back), we can't place.
  const lookup = findActionSpace(state, slotId);
  if (!lookup || lookup.space.occupant !== null) {
    return { kind: 'done', patch: {} };
  }
  const placer = state.players.find((p) => p.id === ctx.triggeringPlayerId);
  const officeMages =
    placer?.mages
      .filter((m) => m.location.kind === 'office' && !m.isWounded)
      .map((m) => m.id) ?? [];
  if (officeMages.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
      resume: {
        effectId: selfEffectId,
        context: { step: 'apply-place', slotId },
      },
      source: ctx.source,
    },
  };
}

registerEffect(
  'base.vault.bottled-rage',
  woundAndPlaceEffect({ selfEffectId: 'base.vault.bottled-rage', source: 'non-spell' }),
);
registerEffect(
  'base.vault.spellblade',
  woundAndPlaceEffect({ selfEffectId: 'base.vault.spellblade', source: 'non-spell' }),
);

/**
 * Shadow Potion (consumable, action) — Shadow a slot with one of your Mages.
 *
 * Pick one of your office mages, pick a slot whose base position holds an
 * existing mage (you can only shadow a slot that has someone in it), and
 * place your mage in that slot's shadow position. Your shadow mage will
 * resolve AFTER the base mage during the resolution phase. While shadowing,
 * your mage loses its color-based ability and isn't targetable by default.
 */
registerEffect('base.vault.shadow-potion', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    // Step 1: pick the placer (one of your office mages).
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const officeMages =
      player?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
        resume: {
          effectId: 'base.vault.shadow-potion',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    // Step 2: pick a slot whose base is occupied and shadow is empty.
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('shadow-potion pick-slot expected mage-chosen');
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const eligibleSpaces: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      if (isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, r.id)) continue;
      for (const s of r.actionSpaces) {
        if (s.occupant && !s.shadowOccupant) eligibleSpaces.push(s.id);
      }
    }
    if (eligibleSpaces.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: eligibleSpaces,
        },
        resume: {
          effectId: 'base.vault.shadow-potion',
          context: { step: 'apply', placerMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('shadow-potion apply expected space-chosen');
    }
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof placerMageId !== 'string') {
      throw new Error('shadow-potion apply: missing placerMageId');
    }
    // Shadow placement counts as "placing a Mage" per the user rules —
    // instant-room slots fire their reward for the shadow occupant.
    const placePatch = placeOfficeMageAsShadow(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      ctx.resumeAnswer.spaceId,
    );
    return patchWithMaybeInstantReward(
      ctx.state,
      placePatch,
      ctx.resumeAnswer.spaceId,
      ctx.triggeringPlayerId,
      'shadow',
    );
  }
  throw new Error(`shadow-potion unexpected step ${String(step)}`);
});

/**
 * Force Gloves (consumable, action) — Spend 2 Mana to banish a Mage. Do
 * this any number of times. Loop terminates when player stops or runs out
 * of mana / targets.
 */
registerEffect('base.vault.force-gloves', (ctx): EffectResult =>
  manaRepeatLoop(ctx, 'base.vault.force-gloves', {
    manaCost: 2,
    label: 'Spend 2 Mana: Banish a Mage',
    apply: (state, playerId, targetMageId) =>
      banishMage(state, targetMageId, playerId),
  }),
);

/**
 * Malefic Torch (consumable, action) — Spend 2 Mana to wound a Mage.
 * Repeat any number of times. Same shape as Force Gloves.
 */
registerEffect('base.vault.malefic-torch', (ctx): EffectResult =>
  manaRepeatLoop(ctx, 'base.vault.malefic-torch', {
    manaCost: 2,
    label: 'Spend 2 Mana: Wound a Mage',
    apply: (state, playerId, targetMageId) =>
      woundMage(state, targetMageId, playerId),
  }),
);

/**
 * Unbreakable Box (consumable, action) — Spend 6 Mana to gain the top 3
 * cards of the Vault Deck. One-shot. Fizzles if player lacks 6 mana.
 */
registerEffect('base.vault.unbreakable-box', (ctx): EffectResult => {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.mana < 6) {
    return { kind: 'done', patch: {} };
  }
  const drawn = drawTopOfVaultDeck(ctx.state, ctx.triggeringPlayerId, 3);
  return {
    kind: 'done',
    patch: {
      ...drawn,
      players: (drawn.players ?? ctx.state.players).map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, resources: { ...p.resources, mana: p.resources.mana - 6 } },
      ),
    },
  };
});

/**
 * Mystic Lantern (consumable, fast-action) — Look at the top 3 cards of
 * the Supporter Deck. Gain one as a Secret Supporter. The other two are
 * placed at the bottom of the Supporter Deck (no separate discard pile;
 * per user guidance the deck simply cycles).
 *
 * Flow: first call presents a `choose-peeked-supporter` prompt with the
 * top-3 ids; on resume, the chosen card is added to the player's
 * personalDiscard as `secret-supporter`, and the remaining peeked ids
 * are appended to the END of supporterDeck (bottom).
 */
registerEffect('base.vault.mystic-lantern', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const top3 = ctx.state.supporterDeck.slice(0, 3);
    if (top3.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-peeked-supporter',
          eligibleCardIds: [...top3],
        },
        resume: { effectId: 'base.vault.mystic-lantern', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `mystic-lantern expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const chosen = ctx.resumeAnswer.cardId;
  // Re-peek the top 3 — should match the original peek since prompts
  // block other deck-mutating actions.
  const top3 = ctx.state.supporterDeck.slice(0, 3);
  if (!top3.includes(chosen)) {
    throw new Error('mystic-lantern: chosen card is not among the top 3');
  }
  const unchosen = top3.filter((id) => id !== chosen);
  const remainingDeck = ctx.state.supporterDeck.slice(top3.length);
  // Unchosen cards go to the bottom of the deck.
  const newDeck = [...remainingDeck, ...unchosen];
  return {
    kind: 'done',
    patch: {
      supporterDeck: newDeck,
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              personalDiscard: [
                ...p.personalDiscard,
                { kind: 'secret-supporter' as const, cardId: chosen },
              ],
            },
      ),
    },
  };
});

/**
 * The Contract (consumable, fast-action) — Gain 3 Research. The first
 * non-discard pick (draft or WIS-upgrade) locks the department of the
 * spell chosen; the remaining 2 Researches must target that same
 * department.
 *
 * Drained one entry at a time by `drainContractResearchIfIdle` in the
 * engine. `research-draft` / `research-add-wis` set the lock when
 * `contractChain` is threaded through their resume context.
 */
registerEffect('base.vault.the-contract', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    pendingContractResearch: {
      playerId: ctx.triggeringPlayerId,
      source: ctx.source,
      remaining: 3,
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers for vault effects.
// ---------------------------------------------------------------------------

function placeOfficeMageOnSpace(
  state: GameState,
  playerId: PlayerId,
  mageId: string,
  spaceId: string,
): GameStatePatch {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error('placeOfficeMageOnSpace: player not found');
  const mage = player.mages.find((m) => m.id === mageId);
  if (!mage) throw new Error('placeOfficeMageOnSpace: mage not in office');
  if (mage.location.kind !== 'office') {
    throw new Error('placeOfficeMageOnSpace: mage not in office');
  }
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : { ...m, location: { kind: 'action-space' as const, spaceId } },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId
          ? s
          : {
              ...s,
              occupant: {
                mageId,
                ownerId: playerId,
                isShadowing: false,
              },
            },
      ),
    })),
  };
}

function drawTopOfVaultDeck(
  state: GameState,
  playerId: PlayerId,
  n: number,
): GameStatePatch {
  const taken = state.vaultDeck.slice(0, n);
  if (taken.length === 0) return {};
  return {
    vaultDeck: state.vaultDeck.slice(taken.length),
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            vaultCards: [
              ...p.vaultCards,
              ...taken.map((cardId) => ({ cardId, exhausted: false })),
            ],
          },
    ),
  };
}

/**
 * "Spend N mana to {do something} any number of times" loop. Each iteration:
 *  - Stop / Spend choice. Stop → done.
 *  - On Spend: deduct mana, prompt for target, apply, open reaction window.
 *  - After reaction window resolves, loop back to Stop/Spend.
 */
function manaRepeatLoop(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: {
    manaCost: number;
    label: string;
    apply: (
      state: GameState,
      playerId: PlayerId,
      targetMageId: string,
    ) => { patch: GameStatePatch; triggerEvent: ReactionTriggerEvent };
  },
): EffectResult {
  const step = ctx.resumeContext?.['step'];

  if (step === 'pick-target') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${selfEffectId} pick-target expected mage-chosen`);
    }
    // Deduct mana, apply, open reaction window. After the window closes
    // we route through step='after-wound' so the infirmary-bonus check
    // can fire BEFORE looping back to the next ask.
    const deducted: GameState = {
      ...ctx.state,
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                mana: p.resources.mana - cfg.manaCost,
              },
            },
      ),
    };
    const applied = cfg.apply(
      deducted,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.mageId,
    );
    const mergedPatch: GameStatePatch = {
      ...applied.patch,
      players: applied.patch.players ?? deducted.players,
    };
    return {
      kind: 'open-reaction',
      patch: mergedPatch,
      window: {
        triggerEvents: [applied.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: selfEffectId,
          context: {
            step: 'after-wound',
            triggerEvent: triggerEventToContext(applied.triggerEvent),
          },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-wound') {
    // Reaction window has closed. If the trigger was a wound that stuck
    // (mage still in infirmary, wounded by opponent), pause for the
    // infirmary bonus prompt and route the bonus answer into 'after-bonus'.
    // For non-wound triggers (banish from Force Gloves), the bonus check
    // returns false and we fall through to the loop's ask.
    const event = readTriggerEvent(ctx);
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
          effectId: selfEffectId,
          context: {
            step: 'after-bonus',
            recipientPlayerId: event.ownerId,
          },
        }),
      };
    }
    return askManaRepeat(ctx, selfEffectId, cfg);
  }

  if (step === 'after-bonus') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} after-bonus expected option-chosen`);
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error(`${selfEffectId} after-bonus: missing recipientPlayerId`);
    }
    const bonusPatch = applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    return askManaRepeat(
      { ...ctx, state: afterBonus },
      selfEffectId,
      cfg,
    );
  }

  if (step === 'ask') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      // Reaction-resume path: no ctx.resumeAnswer; just present the ask.
      return askManaRepeat(ctx, selfEffectId, cfg);
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId !== 'spend') {
      throw new Error(`${selfEffectId} unknown option ${ctx.resumeAnswer.optionId}`);
    }
    return promptTargetForManaRepeat(ctx, selfEffectId, cfg);
  }

  // First entry — open the loop.
  return askManaRepeat(ctx, selfEffectId, cfg);
}

function askManaRepeat(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: { manaCost: number; label: string },
): EffectResult {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.mana < cfg.manaCost) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'spend', label: cfg.label, payload: {} },
          { id: 'stop', label: 'Stop', payload: {} },
        ],
      },
      resume: { effectId: selfEffectId, context: { step: 'ask' } },
      source: ctx.source,
    },
  };
}

function promptTargetForManaRepeat(
  ctx: EffectContext,
  selfEffectId: string,
  _cfg: { manaCost: number; label: string },
): EffectResult {
  const targets = buildNonSpellHarmfulTargets(
    ctx.state,
    ctx.triggeringPlayerId,
  );
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
      resume: {
        effectId: selfEffectId,
        context: { step: 'pick-target' },
      },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Spell wiring — Wave 1: resource gains + spell-refresh primitives
// ============================================================================
//
// All of these spells are pure effects that either grant a resource, gain a
// Mark, or refresh an exhausted spell. Composite spells (e.g. Power = gain
// 1 Mana + refresh) chain re-entrant steps using `resumeContext.step`.
//
// The refresh primitive uses `buildRefreshOwnedSpellPrompt` /
// `refreshOwnedSpellPatch` (in helpers.ts) — shared with Bottled Memories
// and any future card that refreshes a spell.

/** The Pursuit of Power L1 "Warmth" — Gain 2 Mana. */
registerEffect(
  'base.spell.the-pursuit-of-power.l1',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 2),
  }),
);

/** Sorcerous Inspiration L1 "Luminosity" — Gain a Mark. */
registerEffect(
  'base.spell.sorcerous-inspiration.l1',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (prompt === null) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    throw new Error(
      'sorcerous-inspiration.l1 should not be re-invoked (gain-mark handles its own resume)',
    );
  },
);

/** The Light that Leads L1 "Illuminate" — Gain a Mark (fast-action). */
registerEffect(
  'base.spell.the-light-that-leads.l1',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (prompt === null) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    throw new Error(
      'the-light-that-leads.l1 should not be re-invoked (gain-mark handles its own resume)',
    );
  },
);

/** A Brighter Flame L2 "Kindle" — Refresh an exhausted Spell. */
registerEffect(
  'base.spell.a-brighter-flame.l2',
  (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = buildRefreshOwnedSpellPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        {
          effectId: 'base.spell.a-brighter-flame.l2',
          context: { step: 'apply-refresh' },
        },
        ctx.source,
      );
      if (!prompt) return { kind: 'done', patch: {} };
      return { kind: 'pause', pending: prompt };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `a-brighter-flame.l2 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    return {
      kind: 'done',
      patch: refreshOwnedSpellPatch(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.optionId,
      ),
    };
  },
);

/**
 * The Pursuit of Power L2 "Power" — Gain 1 Mana, then refresh a Spell.
 *
 * Step 1 (no resumeAnswer): apply the mana gain immediately and surface the
 * refresh prompt (if any exhausted spells exist). If nothing to refresh, the
 * effect ends after the mana gain.
 *
 * Step 2 ('apply-refresh'): apply the refresh patch for the chosen spell.
 */
registerEffect(
  'base.spell.the-pursuit-of-power.l2',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    if (!ctx.resumeAnswer) {
      const manaPatch = gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'mana',
        1,
      );
      const stateAfter: GameState = { ...ctx.state, ...manaPatch };
      const prompt = buildRefreshOwnedSpellPrompt(
        stateAfter,
        ctx.triggeringPlayerId,
        {
          effectId: 'base.spell.the-pursuit-of-power.l2',
          context: { step: 'apply-refresh' },
        },
        ctx.source,
      );
      if (!prompt) return { kind: 'done', patch: manaPatch };
      return { kind: 'pause', patch: manaPatch, pending: prompt };
    }
    if (step === 'apply-refresh') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(
          `the-pursuit-of-power.l2 apply-refresh expected option-chosen, got ${ctx.resumeAnswer.kind}`,
        );
      }
      return {
        kind: 'done',
        patch: refreshOwnedSpellPatch(
          ctx.state,
          ctx.triggeringPlayerId,
          ctx.resumeAnswer.optionId,
        ),
      };
    }
    throw new Error(`the-pursuit-of-power.l2 unexpected step ${String(step)}`);
  },
);

/**
 * The Pursuit of Power L3 "Intensity" — Refresh a Spell, then gain a Research.
 *
 * The Research prompt fires AFTER the refresh resolves. If the player has no
 * exhausted spells, we skip straight to the Research prompt (still get to
 * spend 1 Research).
 */
registerEffect(
  'base.spell.the-pursuit-of-power.l3',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    if (!ctx.resumeAnswer) {
      const refreshPrompt = buildRefreshOwnedSpellPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        {
          effectId: 'base.spell.the-pursuit-of-power.l3',
          context: { step: 'after-refresh' },
        },
        ctx.source,
      );
      if (refreshPrompt) return { kind: 'pause', pending: refreshPrompt };
      // No exhausted spells — go straight to Research.
      const researchPrompt = spawnResearchPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      return { kind: 'pause', pending: researchPrompt };
    }
    if (step === 'after-refresh') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(
          `the-pursuit-of-power.l3 after-refresh expected option-chosen, got ${ctx.resumeAnswer.kind}`,
        );
      }
      const refreshPatch = refreshOwnedSpellPatch(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.optionId,
      );
      const stateAfter: GameState = { ...ctx.state, ...refreshPatch };
      const researchPrompt = spawnResearchPrompt(
        stateAfter,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      return { kind: 'pause', patch: refreshPatch, pending: researchPrompt };
    }
    throw new Error(`the-pursuit-of-power.l3 unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Spell wiring — Wave 2: single-target wound spells
// ============================================================================
//
// Factory: prompt for a wound target → wound + open reaction window → after
// the window, route either through the standard Infirmary-bonus prompt
// (`base.system.post-wound-bonus`) or skip it (`base.system.noop`) when
// the spell text says "owner gains no Infirmary bonus" (Venom).
//
// `targetFilter` controls who's targetable. Two presets cover the data so
// far: `'opponent-only'` (Bolt) excludes the caster's own mages, `'any-mage'`
// (Firebolt, Venom) lets the caster wound their own. Both still inherit
// the spell-source protections (green-immune, opposing-blue-immune,
// shadow-excluded) via `buildBurnTargets`.

type WoundTargetFilter = 'any-mage' | 'opponent-only';

function buildWoundTargetsFor(
  state: GameState,
  casterId: string,
  filter: WoundTargetFilter,
): string[] {
  const all = buildBurnTargets(state, casterId);
  if (filter === 'any-mage') return all;
  return all.filter((mageId) => {
    const lookup = state.players.find((p) =>
      p.mages.some((m) => m.id === mageId),
    );
    return lookup?.id !== casterId;
  });
}

function simpleWoundSpell(opts: {
  selfEffectId: string;
  targetFilter: WoundTargetFilter;
  suppressInfirmaryBonus?: boolean;
}) {
  const afterResumeId = opts.suppressInfirmaryBonus
    ? 'base.system.noop'
    : 'base.system.post-wound-bonus';
  return (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      const targets = buildWoundTargetsFor(
        ctx.state,
        ctx.triggeringPlayerId,
        opts.targetFilter,
      );
      if (targets.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: {
            effectId: opts.selfEffectId,
            context: { step: 'apply-wound' },
          },
          source: ctx.source,
        },
      };
    }
    const step = ctx.resumeContext?.['step'];
    if (step !== 'apply-wound') {
      throw new Error(
        `${opts.selfEffectId}: unexpected resume step ${String(step)}`,
      );
    }
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(
        `${opts.selfEffectId} apply-wound expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const wounded = woundMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: afterResumeId,
          context: {
            triggerEvent: triggerEventToContext(wounded.triggerEvent),
          },
        },
        source: ctx.source,
      },
    };
  };
}

/** Lightning and You L1 "Bolt" — Wound an opponent's Mage. */
registerEffect(
  'base.spell.lightning-and-you.l1',
  simpleWoundSpell({
    selfEffectId: 'base.spell.lightning-and-you.l1',
    targetFilter: 'opponent-only',
  }),
);

/** The Gift of Fire L1 "Firebolt" — Wound a Mage (any owner). */
registerEffect(
  'base.spell.the-gift-of-fire.l1',
  simpleWoundSpell({
    selfEffectId: 'base.spell.the-gift-of-fire.l1',
    targetFilter: 'any-mage',
  }),
);

/**
 * The Lamentations of Sareth L1 "Venom" — Wound a Mage; its owner gains no
 * Infirmary bonus. We route afterResume through `base.system.noop` so the
 * standard post-wound-bonus prompt never surfaces.
 */
registerEffect(
  'base.spell.the-lamentations-of-sareth.l1',
  simpleWoundSpell({
    selfEffectId: 'base.spell.the-lamentations-of-sareth.l1',
    targetFilter: 'any-mage',
    suppressInfirmaryBonus: true,
  }),
);

// ============================================================================
// Spell wiring — Wave 3: single-target banish + wound-or-banish choice
// ============================================================================
//
// Factory mirrors `simpleWoundSpell`. Banish doesn't open an Infirmary bonus
// (the mage doesn't enter the Infirmary), so the afterResume is always
// `base.system.noop`. Reactions like Mystic Amulet still fire from the
// mage-banished reaction window.

function buildBanishTargetsFor(
  state: GameState,
  casterId: string,
  filter: WoundTargetFilter,
): string[] {
  const all = buildBanishTargets(state, casterId);
  if (filter === 'any-mage') return all;
  return all.filter((mageId) => {
    const lookup = state.players.find((p) =>
      p.mages.some((m) => m.id === mageId),
    );
    return lookup?.id !== casterId;
  });
}

function simpleBanishSpell(opts: {
  selfEffectId: string;
  targetFilter: WoundTargetFilter;
}) {
  return (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      const targets = buildBanishTargetsFor(
        ctx.state,
        ctx.triggeringPlayerId,
        opts.targetFilter,
      );
      if (targets.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: {
            effectId: opts.selfEffectId,
            context: { step: 'apply-banish' },
          },
          source: ctx.source,
        },
      };
    }
    const step = ctx.resumeContext?.['step'];
    if (step !== 'apply-banish') {
      throw new Error(
        `${opts.selfEffectId}: unexpected resume step ${String(step)}`,
      );
    }
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(
        `${opts.selfEffectId} apply-banish expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const banished = banishMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: banished.patch,
      window: {
        triggerEvents: [banished.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  };
}

/** Book of One Hundred Seas L1 "Wave" — Banish an opponent's Mage. */
registerEffect(
  'base.spell.book-of-one-hundred-seas.l1',
  simpleBanishSpell({
    selfEffectId: 'base.spell.book-of-one-hundred-seas.l1',
    targetFilter: 'opponent-only',
  }),
);

/**
 * On the Weakness of Flesh L1 "Disease" — Wound a Mage OR banish a Mage.
 *
 * Step 1: present "Wound" / "Banish" choice.
 * Step 2 (wound-branch): pick wound target → apply wound + reaction window.
 * Step 2 (banish-branch): pick banish target → apply banish + reaction window.
 *
 * If neither subroutine has any legal target the corresponding option is
 * suppressed; if both are empty the spell fizzles silently after step 1.
 */
registerEffect('base.spell.on-the-weakness-of-flesh.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const woundTargets = buildWoundTargetsFor(
      ctx.state,
      ctx.triggeringPlayerId,
      'any-mage',
    );
    const banishTargets = buildBanishTargetsFor(
      ctx.state,
      ctx.triggeringPlayerId,
      'any-mage',
    );
    if (woundTargets.length === 0 && banishTargets.length === 0) {
      return { kind: 'done', patch: {} };
    }
    const options: ChoiceOption[] = [];
    if (woundTargets.length > 0) {
      options.push({ id: 'wound', label: 'Wound a Mage', payload: {} });
    }
    if (banishTargets.length > 0) {
      options.push({ id: 'banish', label: 'Banish a Mage', payload: {} });
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: {
          effectId: 'base.spell.on-the-weakness-of-flesh.l1',
          context: { step: 'pick-mode' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-mode') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('disease pick-mode expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'wound') {
      const woundTargets = buildWoundTargetsFor(
        ctx.state,
        ctx.triggeringPlayerId,
        'any-mage',
      );
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: woundTargets,
          },
          resume: {
            effectId: 'base.spell.on-the-weakness-of-flesh.l1',
            context: { step: 'apply-wound' },
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.optionId === 'banish') {
      const banishTargets = buildBanishTargetsFor(
        ctx.state,
        ctx.triggeringPlayerId,
        'any-mage',
      );
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: banishTargets,
          },
          resume: {
            effectId: 'base.spell.on-the-weakness-of-flesh.l1',
            context: { step: 'apply-banish' },
          },
          source: ctx.source,
        },
      };
    }
    throw new Error(
      `disease pick-mode unknown option ${ctx.resumeAnswer.optionId}`,
    );
  }
  if (step === 'apply-wound') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('disease apply-wound expected mage-chosen');
    }
    const wounded = woundMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.system.post-wound-bonus',
          context: {
            triggerEvent: triggerEventToContext(wounded.triggerEvent),
          },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply-banish') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('disease apply-banish expected mage-chosen');
    }
    const banished = banishMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: banished.patch,
      window: {
        triggerEvents: [banished.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`disease unexpected step ${String(step)}`);
});

// ============================================================================
// Spell wiring — Wave 4: wound/banish-and-place-in-vacated-slot
// ============================================================================
//
// Poison reuses `woundAndPlaceEffect` with the spell-source filter +
// bonus suppression. Tidal Wave needs a parallel banish-and-place factory:
// banish target → reaction window → if the slot is still empty, prompt
// for the placer.

function banishAndPlaceInSlotEffect(opts: {
  selfEffectId: string;
  /** Spell filter applies blue immunity; non-spell does not. */
  source: 'spell' | 'non-spell';
}) {
  const { selfEffectId, source } = opts;
  return (ctx: EffectContext): EffectResult => {
    const step = ctx.resumeContext?.['step'];

    // after-banish is re-entered from the reaction-window's afterResume
    // (no resumeAnswer). Handle BEFORE the first-call short-circuit.
    if (step === 'after-banish') {
      const slotId = ctx.resumeContext?.['slotId'];
      if (typeof slotId !== 'string') {
        throw new Error(`${selfEffectId} after-banish: missing slotId`);
      }
      return tryPlaceForWoundPlace(ctx, selfEffectId, slotId, ctx.state);
    }

    // Step 1: pick banish target (opponents only per the spell text).
    if (!ctx.resumeAnswer) {
      const all =
        source === 'spell'
          ? buildBanishTargets(ctx.state, ctx.triggeringPlayerId)
          : buildNonSpellHarmfulTargets(ctx.state, ctx.triggeringPlayerId);
      const opponentTargets = all.filter((mageId) => {
        const lookup = ctx.state.players.find((p) =>
          p.mages.some((m) => m.id === mageId),
        );
        return lookup?.id !== ctx.triggeringPlayerId;
      });
      if (opponentTargets.length === 0) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: opponentTargets,
          },
          resume: { effectId: selfEffectId, context: { step: 'banish' } },
          source: ctx.source,
        },
      };
    }

    // Step 2: banish + open reaction window.
    if (step === 'banish') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} banish expected mage-chosen`);
      }
      const target = ctx.resumeAnswer.mageId;
      const targetMage = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === target);
      if (!targetMage || targetMage.location.kind !== 'action-space') {
        throw new Error(`${selfEffectId}: banish target no longer on a slot`);
      }
      const slotId = targetMage.location.spaceId;
      const banished = banishMage(
        ctx.state,
        target,
        ctx.triggeringPlayerId,
      );
      return {
        kind: 'open-reaction',
        patch: banished.patch,
        window: {
          triggerEvents: [banished.triggerEvent],
          pendingResponderIds: buildReactionQueue(
            ctx.state,
            ctx.triggeringPlayerId,
          ),
          reactedPlayerIds: [],
          afterResume: {
            effectId: selfEffectId,
            context: { step: 'after-banish', slotId },
          },
          source: ctx.source,
        },
      };
    }

    // Step 3 (after-banish) is handled at the top of the function before the
    // resumeAnswer short-circuit, since the reaction-window's afterResume
    // re-enters without a resumeAnswer.

    // Step 4 (re-uses the same `apply-place` step as wound-and-place).
    if (step === 'apply-place') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} apply-place expected mage-chosen`);
      }
      const slotId = ctx.resumeContext?.['slotId'];
      if (typeof slotId !== 'string') {
        throw new Error(`${selfEffectId}: missing slotId`);
      }
      const lookup = findActionSpace(ctx.state, slotId);
      if (!lookup || lookup.space.occupant !== null) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'done',
        patch: placeOfficeMageOnSpace(
          ctx.state,
          ctx.triggeringPlayerId,
          ctx.resumeAnswer.mageId,
          slotId,
        ),
      };
    }
    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  };
}

/**
 * The Lamentations of Sareth L2 "Poison" — Wound a Mage and place one of
 * yours in its slot. Owner gains no Infirmary bonus.
 */
registerEffect(
  'base.spell.the-lamentations-of-sareth.l2',
  woundAndPlaceEffect({
    selfEffectId: 'base.spell.the-lamentations-of-sareth.l2',
    source: 'spell',
    suppressInfirmaryBonus: true,
  }),
);

/**
 * Book of One Hundred Seas L2 "Tidal Wave" — Banish an opponent's Mage and
 * place a Mage from your Office in its place.
 */
registerEffect(
  'base.spell.book-of-one-hundred-seas.l2',
  banishAndPlaceInSlotEffect({
    selfEffectId: 'base.spell.book-of-one-hundred-seas.l2',
    source: 'spell',
  }),
);

// ============================================================================
// Spell wiring — Wave 5a: place / move primitives
// ============================================================================
//
// Celerity: pick one of your office mages → pick an open slot → place
// (respecting per-room caps + cannotBePlacedInDirectly via
// `listEligiblePlacementSlots`). Credits `roundPlacements` so the cap is
// enforced on subsequent placements that round.
//
// Zephyr: pick an opponent's placed mage (spell-source filter, opponents
// only) → pick another open slot in the SAME room → move + open a
// `mage-moved` reaction window. No new placement; per-room cap doesn't
// apply.

/** Everyday Paralocation L1 "Celerity" — Place any Mage (your office mage). */
registerEffect('base.spell.everyday-paralocation.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const officeMages =
      player?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
        resume: {
          effectId: 'base.spell.everyday-paralocation.l1',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('celerity pick-slot expected mage-chosen');
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const openSlots = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.spell.everyday-paralocation.l1',
          context: { step: 'apply', placerMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('celerity apply expected space-chosen');
    }
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof placerMageId !== 'string') {
      throw new Error('celerity apply: missing placerMageId');
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const placePatch = placeOfficeMageOnSpace(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      spaceId,
    );
    return {
      kind: 'done',
      patch: placePatch,
    };
  }
  throw new Error(`celerity unexpected step ${String(step)}`);
});

/**
 * Everyday Paralocation L3 "Teleport" — Move up to 2 of your Mages to any
 * open slots; Infirmary mages are eligible. Loops up to twice; after the
 * first move, a "stop" option is offered.
 *
 * No reaction windows are opened — these are self-moves of the caster's
 * own mages and don't surface defensive reactions in practice. Per-room
 * caps are respected via `listEligiblePlacementSlots`; healed mages are
 * credited with a `roundPlacements` entry (the heal-place is a placement
 * for cap purposes, unlike pure slot-to-slot moves).
 */
registerEffect('base.spell.everyday-paralocation.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'] ?? 'pick-mage';
  const done = Number(ctx.resumeContext?.['done'] ?? 0);
  const self = 'base.spell.everyday-paralocation.l3';

  if (step === 'pick-mage') {
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const candidates =
      player?.mages
        .filter(
          (m) =>
            (m.location.kind === 'action-space' && !m.isWounded) ||
            m.location.kind === 'infirmary',
        )
        .map((m) => m.id) ?? [];
    if (candidates.length === 0) return { kind: 'done', patch: {} };
    const options: ChoiceOption[] = candidates.map((mid) => ({
      id: mid,
      label: `Move ${mid}`,
      payload: {},
    }));
    options.push({ id: 'stop', label: 'Stop', payload: {} });
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: self, context: { step: 'after-mage', done } },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-mage') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} after-mage expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return { kind: 'done', patch: {} };
    }
    const sourceMageId = ctx.resumeAnswer.optionId;
    const openSlots = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: self,
          context: { step: 'after-slot', done, sourceMageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-slot') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} after-slot expected space-chosen`);
    }
    const sourceMageId = ctx.resumeContext?.['sourceMageId'];
    if (typeof sourceMageId !== 'string') {
      throw new Error(`${self} after-slot: missing sourceMageId`);
    }
    const destSpaceId = ctx.resumeAnswer.spaceId;
    const sourceMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === sourceMageId);
    if (!sourceMage) return { kind: 'done', patch: {} };
    const targetRoom = ctx.state.rooms.find((r) =>
      r.actionSpaces.some((s) => s.id === destSpaceId),
    );
    if (!targetRoom) return { kind: 'done', patch: {} };

    let movePatch: GameStatePatch;
    if (sourceMage.location.kind === 'infirmary') {
      movePatch = healMageToSpace(ctx.state, sourceMageId, destSpaceId);
    } else {
      const moved = moveMageToSpace(
        ctx.state,
        sourceMageId,
        destSpaceId,
        ctx.triggeringPlayerId,
      );
      movePatch = moved.patch;
    }

    const stateAfter: GameState = { ...ctx.state, ...movePatch };
    const newDone = done + 1;
    if (newDone >= 2) {
      return { kind: 'done', patch: movePatch };
    }
    // Surface the next pick-mage prompt with a 'stop' option.
    const player = stateAfter.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const candidates =
      player?.mages
        .filter(
          (m) =>
            (m.location.kind === 'action-space' && !m.isWounded) ||
            m.location.kind === 'infirmary',
        )
        .map((m) => m.id) ?? [];
    if (candidates.length === 0) return { kind: 'done', patch: movePatch };
    const options: ChoiceOption[] = candidates.map((mid) => ({
      id: mid,
      label: `Move ${mid}`,
      payload: {},
    }));
    options.push({ id: 'stop', label: 'Stop', payload: {} });
    return {
      kind: 'pause',
      patch: movePatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: {
          effectId: self,
          context: { step: 'after-mage', done: newDone },
        },
        source: ctx.source,
      },
    };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/**
 * Taming of the Storm L1 "Zephyr" — Move an opponent's Mage to another open
 * slot in the same room. Two prompts: pick target, then pick destination
 * slot (must be empty + in the target's current room + not the source slot).
 */
registerEffect('base.spell.taming-of-the-storm.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    // Move targets: green is wound-immune only, so it can be moved.
    // Opposing blue is still spell-immune. Opponent-only per spell text.
    const targets = buildSpellMoveTargets(
      ctx.state,
      ctx.triggeringPlayerId,
    ).filter((mageId) => {
      const owner = ctx.state.players.find((p) =>
        p.mages.some((m) => m.id === mageId),
      );
      return owner !== undefined && owner.id !== ctx.triggeringPlayerId;
    });
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.taming-of-the-storm.l1',
          context: { step: 'pick-destination' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-destination') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('zephyr pick-destination expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!targetMage || targetMage.location.kind !== 'action-space') {
      throw new Error('zephyr: target no longer on a slot');
    }
    const sourceSpaceId = targetMage.location.spaceId;
    const sourceRoom = ctx.state.rooms.find((r) =>
      r.actionSpaces.some((s) => s.id === sourceSpaceId),
    );
    if (!sourceRoom) {
      throw new Error('zephyr: room not found for target');
    }
    const openSlots = sourceRoom.actionSpaces
      .filter((s) => s.id !== sourceSpaceId && !s.occupant)
      .map((s) => s.id);
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.spell.taming-of-the-storm.l1',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('zephyr apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('zephyr apply: missing targetMageId');
    }
    const moved = moveMageToSpace(
      ctx.state,
      targetMageId,
      ctx.resumeAnswer.spaceId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: moved.patch,
      window: {
        triggerEvents: [moved.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`zephyr unexpected step ${String(step)}`);
});

// ============================================================================
// Spell wiring — Wave 5b: anywhere-place (Lightning L2, Immolation)
// ============================================================================
//
// Shared helper: surface a "pick one of your office mages" pause whose
// resume routes to the caller's `pick-slot` step. If the caster has no
// office mages, returns null and the caller should end the effect.
//
// This is the same shape Celerity uses; extracting it lets Lightning L2's
// post-wound tail and Immolation's place tail share the code.

function placeAnyOfficeMagePrompt(
  state: GameState,
  playerId: string,
  selfEffectId: string,
  source: ResolutionSource,
  pickSlotContext: SerializableContext,
): PendingResolutionInput | null {
  const player = state.players.find((p) => p.id === playerId);
  const officeMages =
    player?.mages
      .filter((m) => m.location.kind === 'office' && !m.isWounded)
      .map((m) => m.id) ?? [];
  if (officeMages.length === 0) return null;
  return {
    responderId: playerId,
    prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
    resume: { effectId: selfEffectId, context: pickSlotContext },
    source,
  };
}

/**
 * Apply a "place office mage on slot". Cap enforcement is occupancy-based
 * (see `isRoomAtPlayerCap`), so no extra bookkeeping is needed beyond the
 * underlying placement patch.
 */
function placeOfficeMageOnSpaceCrediting(
  state: GameState,
  playerId: string,
  mageId: string,
  spaceId: string,
): GameStatePatch {
  return placeOfficeMageOnSpace(state, playerId, mageId, spaceId);
}

/**
 * Lightning and You L2 "Lightning" — Wound an opponent's Mage, then place
 * a Mage of your own (anywhere). The "anywhere" placement differs from
 * Bottled Rage / Spellblade / Poison which place in the vacated slot.
 */
registerEffect('base.spell.lightning-and-you.l2', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.lightning-and-you.l2';

  // After the wound reaction window resolves — Infirmary bonus, then place.
  if (step === 'after-wound') {
    const event = readTriggerEvent(ctx);
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
          effectId: self,
          context: { step: 'after-bonus', recipientPlayerId: event.ownerId },
        }),
      };
    }
    const placerPrompt = placeAnyOfficeMagePrompt(
      ctx.state,
      ctx.triggeringPlayerId,
      self,
      ctx.source,
      { step: 'pick-slot' },
    );
    if (!placerPrompt) return { kind: 'done', patch: {} };
    return { kind: 'pause', pending: placerPrompt };
  }

  if (!ctx.resumeAnswer) {
    const targets = buildWoundTargetsFor(
      ctx.state,
      ctx.triggeringPlayerId,
      'opponent-only',
    );
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: self, context: { step: 'wound' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'wound') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('lightning.l2 wound expected mage-chosen');
    }
    const wound = woundMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: wound.patch,
      window: {
        triggerEvents: [wound.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: self,
          context: {
            step: 'after-wound',
            triggerEvent: triggerEventToContext(wound.triggerEvent),
          },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-bonus') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('lightning.l2 after-bonus expected option-chosen');
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error('lightning.l2 after-bonus: missing recipientPlayerId');
    }
    const bonusPatch = applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    const placerPrompt = placeAnyOfficeMagePrompt(
      afterBonus,
      ctx.triggeringPlayerId,
      self,
      ctx.source,
      { step: 'pick-slot' },
    );
    if (!placerPrompt) return { kind: 'done', patch: bonusPatch };
    return { kind: 'pause', patch: bonusPatch, pending: placerPrompt };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('lightning.l2 pick-slot expected mage-chosen');
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const openSlots = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: self,
          context: { step: 'apply-place', placerMageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply-place') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('lightning.l2 apply-place expected space-chosen');
    }
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof placerMageId !== 'string') {
      throw new Error('lightning.l2 apply-place: missing placerMageId');
    }
    return {
      kind: 'done',
      patch: placeOfficeMageOnSpaceCrediting(
        ctx.state,
        ctx.triggeringPlayerId,
        placerMageId,
        ctx.resumeAnswer.spaceId,
      ),
    };
  }
  throw new Error(`lightning.l2 unexpected step ${String(step)}`);
});

/**
 * A Brighter Flame L3 "Immolation" — Place a Mage into any slot. If the slot
 * is occupied, wound the Mage there and take its place.
 *
 * Slot picker offers:
 *  - empty slots in rooms where the caster isn't at the per-round cap and
 *    that aren't cannotBePlacedInDirectly, AND
 *  - occupied slots whose occupant is spell-woundable (green / opposing-blue
 *    are immune; shadows are excluded), with the same per-room cap +
 *    cannotBePlacedInDirectly filters.
 */
registerEffect('base.spell.a-brighter-flame.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.a-brighter-flame.l3';

  // After the wound reaction window resolves — bonus, then place into the
  // (now hopefully empty) slot.
  if (step === 'after-wound') {
    const event = readTriggerEvent(ctx);
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
    if (typeof placerMageId !== 'string' || typeof targetSpaceId !== 'string') {
      throw new Error('immolation after-wound: missing context fields');
    }
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
          effectId: self,
          context: {
            step: 'after-bonus',
            recipientPlayerId: event.ownerId,
            placerMageId,
            targetSpaceId,
          },
        }),
      };
    }
    return immolationFinalPlace(ctx, placerMageId, targetSpaceId, ctx.state);
  }

  if (!ctx.resumeAnswer) {
    // Step 1: pick caster's office mage as the placer.
    const placerPrompt = placeAnyOfficeMagePrompt(
      ctx.state,
      ctx.triggeringPlayerId,
      self,
      ctx.source,
      { step: 'pick-slot' },
    );
    if (!placerPrompt) return { kind: 'done', patch: {} };
    return { kind: 'pause', pending: placerPrompt };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('immolation pick-slot expected mage-chosen');
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    // Empty slots, plus occupied slots whose base occupant is spell-woundable.
    const emptyEligible = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    const woundableTargets = new Set(
      buildBurnTargets(ctx.state, ctx.triggeringPlayerId),
    );
    const occupiedEligible: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      if (isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, r.id)) continue;
      for (const s of r.actionSpaces) {
        if (s.occupant && woundableTargets.has(s.occupant.mageId)) {
          occupiedEligible.push(s.id);
        }
      }
    }
    const allSlots = Array.from(new Set([...emptyEligible, ...occupiedEligible]));
    if (allSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: allSlots,
        },
        resume: { effectId: self, context: { step: 'apply', placerMageId } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('immolation apply expected space-chosen');
    }
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof placerMageId !== 'string') {
      throw new Error('immolation apply: missing placerMageId');
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const space = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === spaceId);
    if (!space) throw new Error(`immolation: space ${spaceId} not found`);
    if (!space.occupant) {
      // Empty slot — straight place.
      return {
        kind: 'done',
        patch: placeOfficeMageOnSpaceCrediting(
          ctx.state,
          ctx.triggeringPlayerId,
          placerMageId,
          spaceId,
        ),
      };
    }
    // Occupied slot — wound first, then place after the reaction.
    const wound = woundMage(
      ctx.state,
      space.occupant.mageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: wound.patch,
      window: {
        triggerEvents: [wound.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: self,
          context: {
            step: 'after-wound',
            triggerEvent: triggerEventToContext(wound.triggerEvent),
            placerMageId,
            targetSpaceId: spaceId,
          },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-bonus') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('immolation after-bonus expected option-chosen');
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
    if (
      typeof recipientId !== 'string' ||
      typeof placerMageId !== 'string' ||
      typeof targetSpaceId !== 'string'
    ) {
      throw new Error('immolation after-bonus: missing context fields');
    }
    const bonusPatch = applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    return immolationFinalPlace(ctx, placerMageId, targetSpaceId, afterBonus);
  }

  throw new Error(`immolation unexpected step ${String(step)}`);
});

/**
 * Apply Immolation's final place after the wound + bonus chain. If the slot
 * got reclaimed by a defensive reaction (Phase Steppers, Invisibility Cloak),
 * the place fizzles silently.
 */
function immolationFinalPlace(
  ctx: EffectContext,
  placerMageId: string,
  targetSpaceId: string,
  state: GameState,
): EffectResult {
  const space = state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.id === targetSpaceId);
  if (!space || space.occupant !== null) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'done',
    patch: placeOfficeMageOnSpaceCrediting(
      state,
      ctx.triggeringPlayerId,
      placerMageId,
      targetSpaceId,
    ),
  };
}

// ============================================================================
// Spell wiring — Wave 6: infirmary heal
// ============================================================================
//
// "Heal" returns a wounded mage from the Infirmary to its owner's Office.
// "Move from infirmary" places it on a chosen open slot (Amelioration).
// Mass-heals return ALL caster's (or all) wounded mages in one go.
//
// Heal events don't open a reaction window per `healMageToSpace` /
// `returnMageToOfficePatch`. Innervation (L3) IS deferred — it allows
// wounding an opponent in order to clear a placement slot, which is the
// same compound shape as Immolation and warrants a separate pass.

function buildWoundedTargets(
  state: GameState,
  filter: 'any' | 'own',
  playerId: string,
): string[] {
  const targets: string[] = [];
  for (const p of state.players) {
    if (filter === 'own' && p.id !== playerId) continue;
    for (const m of p.mages) {
      if (m.location.kind === 'infirmary' && m.isWounded) {
        targets.push(m.id);
      }
    }
  }
  return targets;
}

/** Of Mortal Form L1 "Heal" — Return a Mage from the Infirmary to its owner's Office. */
registerEffect('base.spell.of-mortal-form.l1', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildWoundedTargets(ctx.state, 'any', ctx.triggeringPlayerId);
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.of-mortal-form.l1',
          context: { step: 'apply' },
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error('of-mortal-form.l1 apply expected mage-chosen');
  }
  return {
    kind: 'done',
    patch: returnMageToOfficePatch(ctx.state, ctx.resumeAnswer.mageId),
  };
});

/** Of Mortal Form L2 "Amelioration" — Move a Mage from the Infirmary to an open slot. */
registerEffect('base.spell.of-mortal-form.l2', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const targets = buildWoundedTargets(ctx.state, 'any', ctx.triggeringPlayerId);
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.of-mortal-form.l2',
          context: { step: 'pick-slot' },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('amelioration pick-slot expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    // Healing-to-slot doesn't grant the recipient a roundPlacements credit
    // (the mage is being healed-and-placed by the caster on the recipient's
    // behalf — the per-round cap belongs to the recipient, not the caster).
    // We still respect cannotBePlacedInDirectly so a healed mage can't be
    // placed back into the Infirmary.
    const openSlots: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant) openSlots.push(s.id);
      }
    }
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.spell.of-mortal-form.l2',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('amelioration apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('amelioration apply: missing targetMageId');
    }
    return {
      kind: 'done',
      patch: healMageToSpace(
        ctx.state,
        targetMageId,
        ctx.resumeAnswer.spaceId,
      ),
    };
  }
  throw new Error(`amelioration unexpected step ${String(step)}`);
});

/**
 * Of Mortal Form L3 "Innervation" — Move a Mage from the Infirmary to any
 * slot. You may wound an opponent's Mage to clear a slot for your placement.
 *
 * Steps:
 *  1) pick a wounded mage (any owner — text says "Mage from the Infirmary"
 *     unqualified; we restrict to the caster's own per common convention so
 *     the caster doesn't accidentally heal an opponent. Mirrors L1/L2 — they
 *     both use `buildWoundedTargets(_, 'any', _)`, so we follow that.)
 *  2) pick a slot — empty OR occupied with a wound-eligible occupant
 *  3) if occupied: wound the occupant (the wound is part of the spell, so a
 *     reaction window fires; afterResume re-enters at step 'place' which
 *     performs the heal-place into the now-empty slot). Infirmary bonus
 *     applies on opposing wound.
 *  4) if empty: heal-place directly via `healMageToSpace`.
 */
registerEffect('base.spell.of-mortal-form.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.of-mortal-form.l3';

  if (step === 'place') {
    // afterResume from the wound's reaction window — perform the heal-place
    // into the (now empty) slot regardless of resumeAnswer.
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    const destSpaceId = ctx.resumeContext?.['destSpaceId'];
    if (typeof targetMageId !== 'string' || typeof destSpaceId !== 'string') {
      throw new Error(`${self} place: missing context fields`);
    }
    // Re-check the destination is still empty (a defensive reaction may have
    // relocated the wounded mage into it or somewhere else).
    const space = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === destSpaceId);
    if (!space || space.occupant) return { kind: 'done', patch: {} };
    // Also re-check the source mage is still in the Infirmary.
    const sourceMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!sourceMage || sourceMage.location.kind !== 'infirmary') {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'done',
      patch: healMageToSpace(ctx.state, targetMageId, destSpaceId),
    };
  }

  if (!ctx.resumeAnswer) {
    const targets = buildWoundedTargets(ctx.state, 'any', ctx.triggeringPlayerId);
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: self, context: { step: 'pick-slot' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-slot expected mage-chosen`);
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    // Empty slots: any slot whose room accepts direct placement and is
    // unoccupied (we don't credit roundPlacements here — see L2 comment).
    const emptySlots: string[] = [];
    // Occupied slots: those with a wound-eligible occupant (non-green and
    // not already wounded — `buildBurnTargets` style filter for opponents
    // only, since wounding our own mage to clear a slot would be self-harm).
    const woundCandidates = new Set(
      buildBurnTargets(ctx.state, ctx.triggeringPlayerId).filter((mid) => {
        const owner = ctx.state.players.find((p) =>
          p.mages.some((m) => m.id === mid),
        );
        return owner?.id !== ctx.triggeringPlayerId;
      }),
    );
    const occupiedSlots: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant) {
          emptySlots.push(s.id);
        } else if (woundCandidates.has(s.occupant.mageId)) {
          occupiedSlots.push(s.id);
        }
      }
    }
    const allSlots = [...emptySlots, ...occupiedSlots];
    if (allSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: allSlots,
        },
        resume: { effectId: self, context: { step: 'apply', targetMageId } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error(`${self} apply: missing targetMageId`);
    }
    const destSpaceId = ctx.resumeAnswer.spaceId;
    const destSpace = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === destSpaceId);
    if (!destSpace) return { kind: 'done', patch: {} };

    if (!destSpace.occupant) {
      // Empty — heal directly.
      return {
        kind: 'done',
        patch: healMageToSpace(ctx.state, targetMageId, destSpaceId),
      };
    }

    // Occupied — wound the occupant + chain through reaction + Infirmary
    // bonus, then heal-place into the now-empty slot.
    const occupantMageId = destSpace.occupant.mageId;
    const wounded = woundMage(
      ctx.state,
      occupantMageId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: self,
          context: {
            step: 'place',
            targetMageId,
            destSpaceId,
          },
        },
        source: ctx.source,
      },
    };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/**
 * Rites of Renewal L1 "Chain of Healing" — Return up to two of your Mages
 * from the Infirmary to your Office. Re-entrant loop; player can stop early.
 *
 * Step 1: present caster's wounded list + "Stop" option. Pick triggers a
 * heal-to-office, increments `healed`, and re-enters at step 'pick'. After
 * 2 heals OR Stop OR no remaining wounded, the effect ends.
 */
registerEffect('base.spell.rites-of-renewal.l1', (ctx): EffectResult => {
  const healed = (ctx.resumeContext?.['healed'] as number | undefined) ?? 0;
  const step = ctx.resumeContext?.['step'];
  if (step !== undefined && step !== 'pick') {
    throw new Error(`chain-of-healing unexpected step ${String(step)}`);
  }

  // Apply prior selection (if this is a re-entry from a prompt response).
  let working = ctx.state;
  let newlyHealed = healed;
  if (ctx.resumeAnswer && ctx.resumeAnswer.kind === 'option-chosen') {
    if (ctx.resumeAnswer.optionId === 'stop') {
      return { kind: 'done', patch: {} };
    }
    const healPatch = returnMageToOfficePatch(
      ctx.state,
      ctx.resumeAnswer.optionId,
    );
    working = { ...ctx.state, ...healPatch };
    newlyHealed = healed + 1;
    if (newlyHealed >= 2) {
      return { kind: 'done', patch: healPatch };
    }
    // Continue to re-prompt below; we'll surface as a fresh prompt with the
    // already-applied patch.
  }

  const remaining = buildWoundedTargets(
    working,
    'own',
    ctx.triggeringPlayerId,
  );
  if (remaining.length === 0) {
    if (working === ctx.state) return { kind: 'done', patch: {} };
    // We've applied a prior heal patch; return done with the accumulated patch.
    return {
      kind: 'done',
      patch: {
        players: working.players,
      },
    };
  }
  const options: ChoiceOption[] = remaining.map((mid) => ({
    id: mid,
    label: `Return ${mid} to your Office`,
    payload: {},
  }));
  options.push({ id: 'stop', label: 'Stop', payload: {} });
  const pending: PendingResolutionInput = {
    responderId: ctx.triggeringPlayerId,
    prompt: { kind: 'choose-from-options', options },
    resume: {
      effectId: 'base.spell.rites-of-renewal.l1',
      context: { step: 'pick', healed: newlyHealed },
    },
    source: ctx.source,
  };
  if (working === ctx.state) {
    return { kind: 'pause', pending };
  }
  return {
    kind: 'pause',
    patch: { players: working.players },
    pending,
  };
});

/** Rites of Renewal L2 "Circle of Healing" — Return all your wounded mages to your Office. */
registerEffect('base.spell.rites-of-renewal.l2', (ctx): EffectResult => {
  const woundedOwnIds = buildWoundedTargets(
    ctx.state,
    'own',
    ctx.triggeringPlayerId,
  );
  if (woundedOwnIds.length === 0) return { kind: 'done', patch: {} };
  let working = ctx.state;
  for (const mid of woundedOwnIds) {
    working = { ...working, ...returnMageToOfficePatch(working, mid) };
  }
  return { kind: 'done', patch: { players: working.players } };
});

/**
 * Rites of Renewal L3 "Well of Healing" — Return all mages in the Infirmary
 * to their Offices. Gain 2 IP if at least one opponent's Mage was returned.
 */
registerEffect('base.spell.rites-of-renewal.l3', (ctx): EffectResult => {
  const allWounded = buildWoundedTargets(
    ctx.state,
    'any',
    ctx.triggeringPlayerId,
  );
  if (allWounded.length === 0) return { kind: 'done', patch: {} };
  let working = ctx.state;
  let healedOpponent = false;
  for (const mid of allWounded) {
    const owner = ctx.state.players.find((p) =>
      p.mages.some((m) => m.id === mid),
    );
    if (owner && owner.id !== ctx.triggeringPlayerId) healedOpponent = true;
    working = { ...working, ...returnMageToOfficePatch(working, mid) };
  }
  const players = working.players;
  if (!healedOpponent) {
    return { kind: 'done', patch: { players } };
  }
  // +2 IP for returning at least one opponent's mage.
  const stateWithHeals: GameState = { ...ctx.state, players };
  const ipPatch = bumpInfluencePatch(
    stateWithHeals,
    ctx.triggeringPlayerId,
    2,
  );
  return { kind: 'done', patch: { ...ipPatch } };
});

// ============================================================================
// Spell wiring — Wave 7: shadow primitives
// ============================================================================
//
// Flicker is mechanically identical to Paralocation: pick an opponent's
// placed mage → pick one of your office mages → drop yours into the slot's
// shadow position → open mage-shadowed reaction window → after the window,
// check for instant-room reward. Shared via `shadowOpponentMageEffect`.
//
// Invisibility: pick one of your office mages → pick an empty action space
// (must have an empty shadow position; cannotBePlacedInDirectly skipped;
// caster's per-room cap respected) → place as shadow. No mage was shadowed
// so no reaction window; the shadow placement helper still credits the cap
// and an instant-room reward fires for the shadow occupant.
//
// Doppelganger: pick one of your placed mages → pick one of your office
// mages → drop the office mage into the picked slot's shadow position. No
// reaction window opens (self-shadow is not an opponent action and no
// existing reaction triggers on it).
//
// Cut Plane (L1 of Indefinite Definitives) is deferred — it requires
// converting an opponent's base mage into a shadow at the same slot and
// placing the caster's mage into the now-empty base, which is a
// shadow-swap pattern not yet abstracted.

/** Parallel Synchronicity L1 "Flicker" — Shadow an opponent's Mage with one of your Mages. */
registerEffect(
  'base.spell.parallel-synchronicity.l1',
  shadowOpponentMageEffect('base.spell.parallel-synchronicity.l1'),
);

/** Indefinite Definitives L2 "Invisibility" — Shadow an empty slot. */
registerEffect('base.spell.indefinite-definitives.l2', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.indefinite-definitives.l2';

  if (step === 'after-place') {
    const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
    if (typeof targetSpaceId !== 'string') {
      throw new Error(`${self} after-place: missing targetSpaceId`);
    }
    return patchWithMaybeInstantReward(
      ctx.state,
      {},
      targetSpaceId,
      ctx.triggeringPlayerId,
      'shadow',
    );
  }

  if (!ctx.resumeAnswer) {
    const caster = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const officeMages =
      caster?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
        resume: { effectId: self, context: { step: 'pick-slot' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-slot expected mage-chosen`);
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    // Empty slots (base unoccupied + shadow unoccupied) in rooms that
    // accept placement and where the caster isn't at-cap.
    const emptySlots: string[] = [];
    for (const r of ctx.state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      if (isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, r.id)) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant && !s.shadowOccupant) emptySlots.push(s.id);
      }
    }
    if (emptySlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: emptySlots,
        },
        resume: {
          effectId: self,
          context: { step: 'apply', placerMageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof placerMageId !== 'string') {
      throw new Error(`${self} apply: missing placerMageId`);
    }
    const targetSpaceId = ctx.resumeAnswer.spaceId;
    const patch = placeOfficeMageAsShadow(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      targetSpaceId,
    );
    // No mage was shadowed, so no reaction window. Still check instant-room
    // reward via the patchWithMaybeInstantReward helper.
    return patchWithMaybeInstantReward(
      ctx.state,
      patch,
      targetSpaceId,
      ctx.triggeringPlayerId,
      'shadow',
    );
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** Indefinite Definitives L3 "Doppelganger" — Shadow one of your own Mages. */
registerEffect('base.spell.indefinite-definitives.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.indefinite-definitives.l3';

  if (!ctx.resumeAnswer) {
    // Step 1: pick one of YOUR placed (non-shadow, non-wounded) mages.
    const caster = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const placedOwn =
      caster?.mages
        .filter(
          (m) =>
            m.location.kind === 'action-space' &&
            !m.isWounded &&
            !m.isShadowing,
        )
        .filter((m) => {
          // Only target slots whose shadow position is empty.
          const space = ctx.state.rooms
            .flatMap((r) => r.actionSpaces)
            .find(
              (s) =>
                s.id ===
                (m.location as { kind: 'action-space'; spaceId: string }).spaceId,
            );
          return space && !space.shadowOccupant;
        })
        .map((m) => m.id) ?? [];
    if (placedOwn.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: placedOwn },
        resume: { effectId: self, context: { step: 'pick-placer' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-placer') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-placer expected mage-chosen`);
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!targetMage || targetMage.location.kind !== 'action-space') {
      throw new Error(`${self}: target no longer on a slot`);
    }
    const targetSpaceId = targetMage.location.spaceId;
    const caster = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const officeMages =
      caster?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (officeMages.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
        resume: {
          effectId: self,
          context: { step: 'apply', targetSpaceId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const targetSpaceId = ctx.resumeContext?.['targetSpaceId'];
    if (typeof targetSpaceId !== 'string') {
      throw new Error(`${self} apply: missing targetSpaceId`);
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const patch = placeOfficeMageAsShadow(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      targetSpaceId,
    );
    // Self-shadow doesn't open a useful reaction window (Mystic Amulet only
    // triggers when the shadower is an OPPONENT; Phase Steppers doesn't
    // react to mage-shadowed at all). Skip the window; still check for
    // instant-room reward.
    return patchWithMaybeInstantReward(
      ctx.state,
      patch,
      targetSpaceId,
      ctx.triggeringPlayerId,
      'shadow',
    );
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ============================================================================
// Spell wiring — Wave 8: area-effect batch spells
// ============================================================================
//
// Multi-mage spells (Tsunami, Nox, Plague, Pestilence, Fireball, Inferno)
// wound or banish multiple mages per cast. Per the rulebook each affected
// PLAYER (not each affected mage) gets a single reaction across the whole
// cast, in turn order starting with the next-numbered player after the
// caster. The reactor picks which of their affected mages to react with.
//
// To honor that, we open ONE reaction window carrying ALL events. The
// engine surfaces the responder queue in turn order; for each responder
// the multi-event prompt offers (reaction-card × affected-mage) options
// labeled per mage (see helpers.ts → buildReactionOptionsFor). The
// engine routes the chosen reaction to the chosen target via the
// option's `forMageId`.
//
// Infirmary bonus is deferred until AFTER the reaction window resolves
// (so reactions that save a mage from being wounded — Phase Steppers /
// Invisibility Cloak — suppress the bonus correctly). A separate
// continuation walks the events in turn order, surfacing a bonus prompt
// for each mage that's still in the infirmary — added in a follow-up
// commit when the first "wound-many-with-bonus" spell lands.

function banishManyMages(
  state: GameState,
  mageIds: string[],
  byPlayerId: string,
): { patch: GameStatePatch; events: ReactionTriggerEvent[] } {
  let working = state;
  const events: ReactionTriggerEvent[] = [];
  for (const mageId of mageIds) {
    const result = banishMage(working, mageId, byPlayerId);
    working = { ...working, ...result.patch };
    events.push(result.triggerEvent);
  }
  return {
    patch: { players: working.players, rooms: working.rooms },
    events,
  };
}

function woundManyMages(
  state: GameState,
  mageIds: string[],
  byPlayerId: string,
): { patch: GameStatePatch; events: ReactionTriggerEvent[] } {
  let working = state;
  const events: ReactionTriggerEvent[] = [];
  for (const mageId of mageIds) {
    const result = woundMage(working, mageId, byPlayerId);
    working = { ...working, ...result.patch };
    events.push(result.triggerEvent);
  }
  return {
    patch: { players: working.players, rooms: working.rooms },
    events,
  };
}

/**
 * Reactor queue for a batch effect: opponents in turn order starting
 * after the caster, filtered to those who own at least one affected mage.
 * Players with no affected mages would only see an empty prompt — skip them.
 */
function buildBatchReactorQueue(
  state: GameState,
  casterId: string,
  events: ReactionTriggerEvent[],
): string[] {
  const affectedOwnerIds = new Set<string>();
  for (const event of events) {
    if (
      event.kind === 'mage-wounded' ||
      event.kind === 'mage-banished' ||
      event.kind === 'mage-moved' ||
      event.kind === 'mage-shadowed'
    ) {
      affectedOwnerIds.add(event.ownerId);
    }
  }
  affectedOwnerIds.delete(casterId);
  return buildReactionQueue(state, casterId).filter((pid) =>
    affectedOwnerIds.has(pid),
  );
}

/** Spell-source banishable mages in a given room. */
function buildBanishableMagesInRoom(
  state: GameState,
  casterId: string,
  roomId: string,
): string[] {
  const eligible = new Set(buildBanishTargets(state, casterId));
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const mages: string[] = [];
  for (const s of room.actionSpaces) {
    if (s.occupant && eligible.has(s.occupant.mageId)) {
      mages.push(s.occupant.mageId);
    }
    if (s.shadowOccupant && eligible.has(s.shadowOccupant.mageId)) {
      mages.push(s.shadowOccupant.mageId);
    }
  }
  return mages;
}

/** Spell-source woundable mages in a given room. */
function buildWoundableMagesInRoom(
  state: GameState,
  casterId: string,
  roomId: string,
): string[] {
  const eligible = new Set(buildBurnTargets(state, casterId));
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const mages: string[] = [];
  for (const s of room.actionSpaces) {
    if (s.occupant && eligible.has(s.occupant.mageId)) {
      mages.push(s.occupant.mageId);
    }
    if (s.shadowOccupant && eligible.has(s.shadowOccupant.mageId)) {
      mages.push(s.shadowOccupant.mageId);
    }
  }
  return mages;
}

/**
 * Book of One Hundred Seas L3 "Tsunami" — Banish all Mages in a room.
 *
 * Caster picks a room with at least one banishable mage. All banishable
 * mages in that room are banished simultaneously; a single reaction window
 * opens with every banish event so each affected player gets one reaction
 * choosing which of their banished mages to use it on. No Infirmary bonus
 * (banished mages don't enter the infirmary).
 */
registerEffect('base.spell.book-of-one-hundred-seas.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.book-of-one-hundred-seas.l3';

  if (!ctx.resumeAnswer) {
    const eligibleRoomIds: string[] = [];
    for (const r of ctx.state.rooms) {
      if (
        buildBanishableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
          .length > 0
      ) {
        eligibleRoomIds.push(r.id);
      }
    }
    if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligibleRoomIds.map((rid) => {
            const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
            return { id: rid, label: r.name, payload: {} };
          }),
        },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const roomId = ctx.resumeAnswer.optionId;
    const mageIds = buildBanishableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      roomId,
    );
    if (mageIds.length === 0) return { kind: 'done', patch: {} };
    const banished = banishManyMages(
      ctx.state,
      mageIds,
      ctx.triggeringPlayerId,
    );
    const reactorQueue = buildBatchReactorQueue(
      ctx.state,
      ctx.triggeringPlayerId,
      banished.events,
    );
    return {
      kind: 'open-reaction',
      patch: banished.patch,
      window: {
        triggerEvents: banished.events,
        pendingResponderIds: reactorQueue,
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

/**
 * The Lamentations of Sareth L3 "Nox" — Wound all Mages in a room. Owners
 * receive NO Infirmary bonus per spell text. Mirrors Tsunami's shape but
 * uses `woundManyMages`.
 */
registerEffect('base.spell.the-lamentations-of-sareth.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.the-lamentations-of-sareth.l3';

  if (!ctx.resumeAnswer) {
    const eligibleRoomIds: string[] = [];
    for (const r of ctx.state.rooms) {
      if (
        buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
          .length > 0
      ) {
        eligibleRoomIds.push(r.id);
      }
    }
    if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligibleRoomIds.map((rid) => {
            const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
            return { id: rid, label: r.name, payload: {} };
          }),
        },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const roomId = ctx.resumeAnswer.optionId;
    const mageIds = buildWoundableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      roomId,
    );
    if (mageIds.length === 0) return { kind: 'done', patch: {} };
    const wounded = woundManyMages(ctx.state, mageIds, ctx.triggeringPlayerId);
    const reactorQueue = buildBatchReactorQueue(
      ctx.state,
      ctx.triggeringPlayerId,
      wounded.events,
    );
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: wounded.events,
        pendingResponderIds: reactorQueue,
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ----------------------------------------------------------------------------
// batch-post-wound-bonus — fired as the afterResume continuation for batch
// wound spells (Plague, Pestilence, Fireball, Inferno) once the reaction
// window resolves. Walks the wound events in pre-sorted order (turn order
// from next-after-caster, then within-player by wound order) and, for each
// event whose mage is STILL wounded in the infirmary, surfaces the
// standard 3-option Infirmary bonus prompt for that mage's owner.
//
// Order matters per the rulebook: a player who reacted with Phase Steppers
// or Invisibility Cloak isn't in the infirmary, so `checkInfirmaryBonusApplies`
// returns false and they're skipped. Players whose mages were saved get
// no bonus; players whose mages stuck get their bonus, one per still-
// wounded mage.
// ----------------------------------------------------------------------------

function readEventsArray(ctx: EffectContext): ReactionTriggerEvent[] | null {
  const raw = ctx.resumeContext?.['events'];
  if (!Array.isArray(raw)) return null;
  return raw as unknown as ReactionTriggerEvent[];
}

function eventsArrayToContext(
  events: ReactionTriggerEvent[],
): SerializableContext['events'] {
  return events.map((e) => triggerEventToContext(e)) as unknown as SerializableContext['events'];
}

/**
 * Pre-sort wound events by turn order (next-after-caster, then cycling) +
 * within-player by their wound index. Used by batch spells to order the
 * Infirmary-bonus queue before handing it to `base.system.batch-post-wound-bonus`.
 */
function orderEventsByTurn(
  state: GameState,
  casterId: string,
  events: ReactionTriggerEvent[],
): ReactionTriggerEvent[] {
  const turn = buildReactionQueue(state, casterId);
  const turnRank = new Map(turn.map((pid, i) => [pid, i] as const));
  const indexed = events.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => {
    const ar =
      'ownerId' in a.e ? (turnRank.get(a.e.ownerId) ?? 9999) : 9999;
    const br =
      'ownerId' in b.e ? (turnRank.get(b.e.ownerId) ?? 9999) : 9999;
    if (ar !== br) return ar - br;
    return a.i - b.i;
  });
  return indexed.map((x) => x.e);
}

registerEffect('base.system.batch-post-wound-bonus', (ctx): EffectResult => {
  const events = readEventsArray(ctx);
  if (!events) {
    throw new Error('batch-post-wound-bonus: missing `events` in resumeContext');
  }
  const startIndex =
    (ctx.resumeContext?.['queueIndex'] as number | undefined) ?? 0;

  // If we just resolved a bonus prompt, apply the chosen bonus first.
  let workingState = ctx.state;
  let nextIndex = startIndex;
  if (ctx.resumeAnswer && ctx.resumeAnswer.kind === 'option-chosen') {
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error('batch-post-wound-bonus: missing recipientPlayerId on resume');
    }
    const patch = applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    );
    workingState = { ...ctx.state, ...patch };
    nextIndex = startIndex + 1;
  }

  const accumulatedPatch =
    workingState === ctx.state
      ? undefined
      : ({
          players: workingState.players,
          rooms: workingState.rooms,
        } as GameStatePatch);

  // Find the next event whose mage is still wounded + in infirmary by an opponent.
  while (nextIndex < events.length) {
    const event = events[nextIndex];
    if (event && checkInfirmaryBonusApplies(workingState, event)) {
      return {
        kind: 'pause',
        ...(accumulatedPatch ? { patch: accumulatedPatch } : {}),
        pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
          effectId: 'base.system.batch-post-wound-bonus',
          context: {
            events: eventsArrayToContext(events),
            queueIndex: nextIndex,
            recipientPlayerId: event.ownerId,
          },
        }),
      };
    }
    nextIndex++;
  }

  // All events processed.
  return { kind: 'done', patch: accumulatedPatch ?? {} };
});

// ----------------------------------------------------------------------------
// Two-adjacent-rooms × one-mage-each spells (Plague, Fireball)
// ----------------------------------------------------------------------------
//
// Shape:
//   1. Pick room A (must contain a woundable mage).
//   2. Pick target mage in room A.
//   3. Pick room B (orthogonally adjacent to room A AND contains a
//      woundable mage).
//   4. Pick target mage in room B.
//   5. Apply both wounds atomically. Open one batch reaction window with
//      both events; opponents react in turn order, one reaction per
//      player. After the window, route through
//      `base.system.batch-post-wound-bonus` to surface Infirmary-bonus
//      prompts in turn order for any mage still in the infirmary.

function twoAdjacentRoomsWoundEffect(selfEffectId: string) {
  return (ctx: EffectContext): EffectResult => {
    const step = ctx.resumeContext?.['step'];

    // Step 1: pick room A.
    if (!ctx.resumeAnswer) {
      const eligibleRoomIds: string[] = [];
      for (const r of ctx.state.rooms) {
        if (
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
            .length === 0
        ) {
          continue;
        }
        // Room A must have at least one orthogonal neighbor with a
        // woundable mage — otherwise step 3 has nothing eligible.
        const neighbors = getOrthogonallyAdjacentRoomIds(
          ctx.state.roomLayout,
          r.id,
        );
        const hasUsableNeighbor = neighbors.some(
          (nid) =>
            buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, nid)
              .length > 0,
        );
        if (hasUsableNeighbor) eligibleRoomIds.push(r.id);
      }
      if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRoomIds.map((rid) => {
              const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
              return { id: rid, label: r.name, payload: {} };
            }),
          },
          resume: { effectId: selfEffectId, context: { step: 'pick-target-a' } },
          source: ctx.source,
        },
      };
    }

    // Step 2: pick target in room A.
    if (step === 'pick-target-a') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${selfEffectId} pick-target-a expected option-chosen`);
      }
      const roomA = ctx.resumeAnswer.optionId;
      const targets = buildWoundableMagesInRoom(
        ctx.state,
        ctx.triggeringPlayerId,
        roomA,
      );
      if (targets.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: {
            effectId: selfEffectId,
            context: { step: 'pick-room-b', roomA },
          },
          source: ctx.source,
        },
      };
    }

    // Step 3: pick room B (adjacent to room A, with a target).
    if (step === 'pick-room-b') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} pick-room-b expected mage-chosen`);
      }
      const targetA = ctx.resumeAnswer.mageId;
      const roomA = ctx.resumeContext?.['roomA'];
      if (typeof roomA !== 'string') {
        throw new Error(`${selfEffectId} pick-room-b: missing roomA`);
      }
      const neighbors = getOrthogonallyAdjacentRoomIds(
        ctx.state.roomLayout,
        roomA,
      );
      const eligibleRoomIds = neighbors.filter(
        (nid) =>
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, nid)
            .length > 0,
      );
      if (eligibleRoomIds.length === 0) {
        // No usable neighbor — wound just the room-A target and skip B.
        return applyBatchWound(ctx, selfEffectId, [targetA]);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRoomIds.map((rid) => {
              const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
              return { id: rid, label: r.name, payload: {} };
            }),
          },
          resume: {
            effectId: selfEffectId,
            context: { step: 'pick-target-b', targetA },
          },
          source: ctx.source,
        },
      };
    }

    // Step 4: pick target in room B.
    if (step === 'pick-target-b') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${selfEffectId} pick-target-b expected option-chosen`);
      }
      const roomB = ctx.resumeAnswer.optionId;
      const targetA = ctx.resumeContext?.['targetA'];
      if (typeof targetA !== 'string') {
        throw new Error(`${selfEffectId} pick-target-b: missing targetA`);
      }
      const targets = buildWoundableMagesInRoom(
        ctx.state,
        ctx.triggeringPlayerId,
        roomB,
      );
      if (targets.length === 0) {
        return applyBatchWound(ctx, selfEffectId, [targetA]);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: {
            effectId: selfEffectId,
            context: { step: 'apply', targetA },
          },
          source: ctx.source,
        },
      };
    }

    // Step 5: apply both wounds.
    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} apply expected mage-chosen`);
      }
      const targetA = ctx.resumeContext?.['targetA'];
      if (typeof targetA !== 'string') {
        throw new Error(`${selfEffectId} apply: missing targetA`);
      }
      const targetB = ctx.resumeAnswer.mageId;
      return applyBatchWound(ctx, selfEffectId, [targetA, targetB]);
    }

    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  };
}

/**
 * Helper: wound the given mage list, open the multi-event reaction window,
 * route the afterResume through `base.system.batch-post-wound-bonus` so
 * Infirmary bonuses fire in turn order for any mage still wounded.
 */
function applyBatchWound(
  ctx: EffectContext,
  selfEffectId: string,
  mageIds: string[],
): EffectResult {
  if (mageIds.length === 0) return { kind: 'done', patch: {} };
  const wounded = woundManyMages(ctx.state, mageIds, ctx.triggeringPlayerId);
  const reactorQueue = buildBatchReactorQueue(
    ctx.state,
    ctx.triggeringPlayerId,
    wounded.events,
  );
  const orderedEvents = orderEventsByTurn(
    ctx.state,
    ctx.triggeringPlayerId,
    wounded.events,
  );
  void selfEffectId; // selfEffectId reserved for future per-spell variants.
  return {
    kind: 'open-reaction',
    patch: wounded.patch,
    window: {
      triggerEvents: wounded.events,
      pendingResponderIds: reactorQueue,
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.batch-post-wound-bonus',
        context: { events: eventsArrayToContext(orderedEvents) },
      },
      source: ctx.source,
    },
  };
}

/** On the Weakness of Flesh L2 "Plague" — Choose two adjacent rooms. Wound one Mage in each. */
registerEffect(
  'base.spell.on-the-weakness-of-flesh.l2',
  twoAdjacentRoomsWoundEffect('base.spell.on-the-weakness-of-flesh.l2'),
);

/** The Gift of Fire L2 "Fireball" — Choose two adjacent rooms, wound one Mage in each. */
registerEffect(
  'base.spell.the-gift-of-fire.l2',
  twoAdjacentRoomsWoundEffect('base.spell.the-gift-of-fire.l2'),
);

// ----------------------------------------------------------------------------
// Two-adjacent-rooms × all-mages spells (Inferno)
// ----------------------------------------------------------------------------

/**
 * The Gift of Fire L3 "Inferno" — Wound all Mages in two adjacent rooms.
 *
 * Shape:
 *   1. Pick room A with at least one woundable mage AND a usable neighbor.
 *   2. Pick room B (orthogonally adjacent to A, ideally with woundable mages).
 *   3. Wound EVERY woundable mage in both rooms. Open batch reaction +
 *      bonus continuation.
 */
registerEffect('base.spell.the-gift-of-fire.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.the-gift-of-fire.l3';

  if (!ctx.resumeAnswer) {
    const eligibleRoomIds: string[] = [];
    for (const r of ctx.state.rooms) {
      if (
        buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
          .length === 0
      ) {
        continue;
      }
      const neighbors = getOrthogonallyAdjacentRoomIds(
        ctx.state.roomLayout,
        r.id,
      );
      if (neighbors.length === 0) continue;
      // Inferno is happy to pair with a neighbor even if THAT neighbor has
      // 0 mages — the spell still wounds everyone in room A. Just need a
      // neighbor that exists.
      eligibleRoomIds.push(r.id);
    }
    if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligibleRoomIds.map((rid) => {
            const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
            return { id: rid, label: r.name, payload: {} };
          }),
        },
        resume: { effectId: self, context: { step: 'pick-room-b' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-room-b') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} pick-room-b expected option-chosen`);
    }
    const roomA = ctx.resumeAnswer.optionId;
    const neighbors = getOrthogonallyAdjacentRoomIds(
      ctx.state.roomLayout,
      roomA,
    );
    if (neighbors.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: neighbors.map((rid) => {
            const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
            return { id: rid, label: r.name, payload: {} };
          }),
        },
        resume: { effectId: self, context: { step: 'apply', roomA } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const roomA = ctx.resumeContext?.['roomA'];
    if (typeof roomA !== 'string') {
      throw new Error(`${self} apply: missing roomA`);
    }
    const roomB = ctx.resumeAnswer.optionId;
    const mageIds = [
      ...buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, roomA),
      ...buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, roomB),
    ];
    return applyBatchWound(ctx, self, mageIds);
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ----------------------------------------------------------------------------
// On the Weakness of Flesh L3 "Pestilence" — Choose up to four adjacent
// rooms. Wound one Mage in each.
// ----------------------------------------------------------------------------
//
// Adjacency rule: each room after the first must be orthogonally adjacent
// to AT LEAST ONE already-chosen room (rooms form a connected component;
// L-shapes, T-shapes, lines all valid).
//
// Crucial timing: every wound is held until the player either stops or
// reaches 4 rooms — only THEN are the wounds applied atomically and the
// single batch reaction window opens. Doing it this way matches the
// rulebook intent (all wounds simultaneous) and gives each affected
// player exactly ONE reaction choosing which of their bitten mages to
// react with. Without the atomic batch, a reaction window would open
// after the first wound and the caster's second target-pick could be
// invalidated by a defensive reaction (Phase Steppers, Invisibility Cloak)
// before they finish choosing.
//
// State machine (carried entirely in resumeContext arrays):
//   • initial           — pick room 1 (rooms with a woundable target)
//   • pick-target       — pick mage in the room just chosen
//   • continue-or-stop  — after a target is locked in, either stop or
//                         pick another room. Auto-applies when at the
//                         4-room cap or no more adjacent rooms have a
//                         woundable target.
//   • after-continue-or-stop — route to next room pick or apply.
registerEffect('base.spell.on-the-weakness-of-flesh.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.on-the-weakness-of-flesh.l3';
  const MAX_ROOMS = 4;

  const chosenRoomIds =
    (ctx.resumeContext?.['chosenRoomIds'] as string[] | undefined) ?? [];
  const chosenTargets =
    (ctx.resumeContext?.['chosenTargets'] as string[] | undefined) ?? [];

  /** Rooms eligible for the NEXT pick: adjacent to ≥1 chosen + has target. */
  function eligibleNextRoomIds(): string[] {
    const chosen = new Set(chosenRoomIds);
    const candidates = new Set<string>();
    for (const rid of chosenRoomIds) {
      for (const nid of getOrthogonallyAdjacentRoomIds(
        ctx.state.roomLayout,
        rid,
      )) {
        if (chosen.has(nid)) continue;
        if (
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, nid)
            .length === 0
        )
          continue;
        candidates.add(nid);
      }
    }
    return Array.from(candidates);
  }

  function roomOption(rid: string): ChoiceOption {
    const r = ctx.state.rooms.find((rr) => rr.id === rid);
    return { id: rid, label: r?.name ?? rid, payload: {} };
  }

  // initial: pick room 1.
  if (!ctx.resumeAnswer) {
    const eligible = ctx.state.rooms
      .filter(
        (r) =>
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
            .length > 0,
      )
      .map((r) => r.id);
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligible.map(roomOption),
        },
        resume: {
          effectId: self,
          context: { step: 'pick-target', chosenRoomIds: [], chosenTargets: [] },
        },
        source: ctx.source,
      },
    };
  }

  // pick-target: a room was just chosen; prompt for the mage.
  if (step === 'pick-target') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} pick-target expected option-chosen`);
    }
    const newRoomId = ctx.resumeAnswer.optionId;
    const targets = buildWoundableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      newRoomId,
    );
    if (targets.length === 0) {
      return chosenTargets.length === 0
        ? { kind: 'done', patch: {} }
        : applyBatchWound(ctx, self, chosenTargets);
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: self,
          context: {
            step: 'continue-or-stop',
            chosenRoomIds: [...chosenRoomIds, newRoomId],
            chosenTargets,
          },
        },
        source: ctx.source,
      },
    };
  }

  // continue-or-stop: target locked in; ask whether to chain another room.
  if (step === 'continue-or-stop') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} continue-or-stop expected mage-chosen`);
    }
    const newTarget = ctx.resumeAnswer.mageId;
    const accumulatedTargets = [...chosenTargets, newTarget];

    if (chosenRoomIds.length >= MAX_ROOMS) {
      return applyBatchWound(ctx, self, accumulatedTargets);
    }
    const nextRooms = eligibleNextRoomIds();
    if (nextRooms.length === 0) {
      return applyBatchWound(ctx, self, accumulatedTargets);
    }

    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'continue', label: 'Pick another adjacent room', payload: {} },
            {
              id: 'stop',
              label: `Stop (${accumulatedTargets.length} wound${accumulatedTargets.length === 1 ? '' : 's'} so far)`,
              payload: {},
            },
          ],
        },
        resume: {
          effectId: self,
          context: {
            step: 'after-continue-or-stop',
            chosenRoomIds,
            chosenTargets: accumulatedTargets,
          },
        },
        source: ctx.source,
      },
    };
  }

  // after-continue-or-stop: route based on the player's choice.
  if (step === 'after-continue-or-stop') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} after-continue-or-stop expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return applyBatchWound(ctx, self, chosenTargets);
    }
    if (ctx.resumeAnswer.optionId === 'continue') {
      const nextRooms = eligibleNextRoomIds();
      if (nextRooms.length === 0) {
        return applyBatchWound(ctx, self, chosenTargets);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: nextRooms.map(roomOption),
          },
          resume: {
            effectId: self,
            context: { step: 'pick-target', chosenRoomIds, chosenTargets },
          },
          source: ctx.source,
        },
      };
    }
    throw new Error(
      `${self} after-continue-or-stop unknown option ${ctx.resumeAnswer.optionId}`,
    );
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** Sorcerous Inspiration L2 "Brilliance" — Gain two Research. */
registerEffect(
  'base.spell.sorcerous-inspiration.l2',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: appendResearchQueue(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.source,
      2,
    ),
  }),
);

/**
 * Sorcerous Inspiration L3 "Radiance" — Gain a Research, refresh an
 * exhausted Spell, then gain a Mark.
 *
 * Step order: refresh prompt fires first, then a Mark prompt is queued
 * on top of the research entry. After the player resolves the Mark, the
 * resolution stack idles and the engine's research drain pump surfaces
 * the queued Research opportunity.
 *
 * (Player-visible outcome: refresh → mark → research-spend. The spell
 * text lists research first, but `appendResearchQueue` queues it
 * lazily so it surfaces after the in-line prompts settle.)
 *
 * Fizzles gracefully: no exhausted spells → skip the refresh prompt
 * and only the mark + research fire; no eligible voters → skip the
 * mark prompt and only the research is queued.
 */
registerEffect(
  'base.spell.sorcerous-inspiration.l3',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      // Initial entry: try to surface the refresh prompt first.
      const refreshPrompt = buildRefreshOwnedSpellPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        {
          effectId: 'base.spell.sorcerous-inspiration.l3',
          context: { step: 'after-refresh' },
        },
        ctx.source,
      );
      if (refreshPrompt) return { kind: 'pause', pending: refreshPrompt };
      // No exhausted spells — queue research + surface the mark prompt.
      const researchPatch = appendResearchQueue(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
        1,
      );
      const markPrompt = spawnGainMarkPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      if (!markPrompt) return { kind: 'done', patch: researchPatch };
      return { kind: 'pause', patch: researchPatch, pending: markPrompt };
    }
    if (step === 'after-refresh') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(
          `sorcerous-inspiration.l3 after-refresh expected option-chosen, got ${ctx.resumeAnswer.kind}`,
        );
      }
      const refreshPatch = refreshOwnedSpellPatch(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.optionId,
      );
      const stateAfter: GameState = { ...ctx.state, ...refreshPatch };
      const researchPatch = appendResearchQueue(
        stateAfter,
        ctx.triggeringPlayerId,
        ctx.source,
        1,
      );
      const markPrompt = spawnGainMarkPrompt(
        stateAfter,
        ctx.triggeringPlayerId,
        ctx.source,
      );
      const combined: GameStatePatch = { ...refreshPatch, ...researchPatch };
      if (!markPrompt) return { kind: 'done', patch: combined };
      return { kind: 'pause', patch: combined, pending: markPrompt };
    }
    throw new Error(`sorcerous-inspiration.l3 unexpected step ${String(step)}`);
  },
);

/**
 * Parallel Synchronicity L3 "Planar Disjunction" — Choose a room. All
 * Mages in that room are banished.
 *
 * Mirrors Book of One Hundred Seas L3 / Tsunami L3: prompt for a room
 * (only rooms with at least one banishable mage are offered), then
 * banish every eligible mage in that room and open a batch reaction
 * window so each affected player gets one reaction across the cast.
 *
 * The spell text's "Any that were shadowing move into normal spaces"
 * is rendered moot here — banished shadow occupants leave the slot
 * entirely, so there is no shadow→base slide to apply.
 */
registerEffect(
  'base.spell.parallel-synchronicity.l3',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.parallel-synchronicity.l3';

    if (!ctx.resumeAnswer) {
      const eligibleRoomIds: string[] = [];
      for (const r of ctx.state.rooms) {
        if (
          buildBanishableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
            .length > 0
        ) {
          eligibleRoomIds.push(r.id);
        }
      }
      if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRoomIds.map((rid) => {
              const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
              return { id: rid, label: r.name, payload: {} };
            }),
          },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }
    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const roomId = ctx.resumeAnswer.optionId;
      const mageIds = buildBanishableMagesInRoom(
        ctx.state,
        ctx.triggeringPlayerId,
        roomId,
      );
      if (mageIds.length === 0) return { kind: 'done', patch: {} };
      const banished = banishManyMages(
        ctx.state,
        mageIds,
        ctx.triggeringPlayerId,
      );
      const reactorQueue = buildBatchReactorQueue(
        ctx.state,
        ctx.triggeringPlayerId,
        banished.events,
      );
      return {
        kind: 'open-reaction',
        patch: banished.patch,
        window: {
          triggerEvents: banished.events,
          pendingResponderIds: reactorQueue,
          reactedPlayerIds: [],
          afterResume: { effectId: 'base.system.noop', context: {} },
          source: ctx.source,
        },
      };
    }
    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

/**
 * Thirteen Greater Mysteries L1 "Mana Drain" — Steal 1 mana from a single
 * opponent. Prompts for an opponent with ≥1 unspent Mana; the caster
 * gains 1 Mana and the target loses 1 Mana. Fizzles if no opponent has
 * any mana.
 *
 * No reaction window opens — stealing resources is not a recognized
 * reaction trigger in the base set.
 */
registerEffect(
  'base.spell.thirteen-greater-mysteries.l1',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.thirteen-greater-mysteries.l1';

    if (!ctx.resumeAnswer) {
      const candidates = ctx.state.players.filter(
        (p) => p.id !== ctx.triggeringPlayerId && p.resources.mana >= 1,
      );
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: candidates.map((p) => ({
              id: p.id,
              label: `Steal 1 Mana from ${p.name} (${p.resources.mana} Mana)`,
              payload: {},
            })),
          },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }
    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const victimId = ctx.resumeAnswer.optionId;
      const victim = ctx.state.players.find((p) => p.id === victimId);
      if (!victim || victim.resources.mana < 1) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'done',
        patch: {
          players: ctx.state.players.map((p) => {
            if (p.id === victimId) {
              return {
                ...p,
                resources: { ...p.resources, mana: p.resources.mana - 1 },
              };
            }
            if (p.id === ctx.triggeringPlayerId) {
              return {
                ...p,
                resources: { ...p.resources, mana: p.resources.mana + 1 },
              };
            }
            return p;
          }),
        },
      };
    }
    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Alt-leader spells (Rihki Kanhamme, Mannheim Wildern, Jesca Renetton,
// Lavanina, Monad Riverime, Jion Erjon).
// ============================================================================

/**
 * Monad Riverime — Holy Smite (Divinity alt). Wound a Mage and gain 1 IP.
 * The +1 IP is granted alongside the wound patch (immediate, before the
 * reaction window resolves). Standard post-wound-bonus flow follows.
 */
registerEffect('base.spell.holy-smite.l1', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildBurnTargets(ctx.state, ctx.triggeringPlayerId);
    if (targets.length === 0) {
      // No target — still grant the IP per spell text (cost already paid).
      return {
        kind: 'done',
        patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 1),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.holy-smite.l1',
          context: { step: 'apply' },
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `holy-smite expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const wounded = woundMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  const ipPatch = bumpInfluencePatch(
    { ...ctx.state, ...wounded.patch },
    ctx.triggeringPlayerId,
    1,
  );
  return {
    kind: 'open-reaction',
    patch: { ...wounded.patch, ...ipPatch },
    window: {
      triggerEvents: [wounded.triggerEvent],
      pendingResponderIds: buildReactionQueue(
        ctx.state,
        ctx.triggeringPlayerId,
      ),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.post-wound-bonus',
        context: {
          triggerEvent: triggerEventToContext(wounded.triggerEvent),
        },
      },
      source: ctx.source,
    },
  };
});

/**
 * Rihki Kanhamme — Burnout (Sorcery alt). Send one of your own office
 * Mages to the Infirmary (no Infirmary bonus), then gain 3 Mana. The
 * mage starts in office (not on a slot), so this is a flag flip + a
 * location change — no reaction window opens (no opponent triggered it).
 */
registerEffect('base.spell.burnout.l1', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const eligible =
      player?.mages
        .filter((m) => m.location.kind === 'office' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (eligible.length === 0) {
      // No mage to sacrifice — spell still grants the 3 Mana per text.
      return {
        kind: 'done',
        patch: gainResourcePatch(
          ctx.state,
          ctx.triggeringPlayerId,
          'mana',
          3,
        ),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: eligible },
        resume: {
          effectId: 'base.spell.burnout.l1',
          context: { step: 'apply' },
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `burnout expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const mageId = ctx.resumeAnswer.mageId;
  const casterId = ctx.triggeringPlayerId;
  // Move the chosen office mage straight into the infirmary with
  // isWounded=true. No reaction window — opponent didn't cause this and
  // the spell text suppresses the Infirmary bonus.
  const infirmaryPatch: GameStatePatch = {
    players: ctx.state.players.map((p) =>
      p.id !== casterId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : {
                    ...m,
                    isWounded: true,
                    isShadowing: false,
                    location: { kind: 'infirmary' as const },
                  },
            ),
          },
    ),
  };
  const afterInfirmary: GameState = { ...ctx.state, ...infirmaryPatch };
  const manaPatch = gainResourcePatch(afterInfirmary, casterId, 'mana', 3);
  return {
    kind: 'done',
    patch: { ...infirmaryPatch, ...manaPatch },
  };
});

/**
 * Jesca Renetton — Dark Pact (Mysticism alt). Banish one of your own
 * Mages, then Wound a Mage. Multi-step prompt chain.
 *
 *   step 1 (no resumeAnswer): pick your own mage to banish.
 *   step 2 ('pick-wound'): apply the banish, then prompt for wound target.
 *   step 3 ('apply-wound'): wound + open reaction window with the standard
 *     post-wound-bonus afterResume.
 *
 * The banish is self-inflicted so no reaction window opens for it (Mystic
 * Amulet requires opponent trigger).
 */
registerEffect('base.spell.dark-pact.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const casterId = ctx.triggeringPlayerId;

  // Step 1: pick own mage to banish.
  if (!ctx.resumeAnswer) {
    const player = ctx.state.players.find((p) => p.id === casterId);
    // Own mages, anywhere — banished mages return to office immediately so
    // every owned mage is reachable here.
    const eligible = player?.mages.map((m) => m.id) ?? [];
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: casterId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: eligible },
        resume: {
          effectId: 'base.spell.dark-pact.l1',
          context: { step: 'pick-wound' },
        },
        source: ctx.source,
      },
    };
  }

  // Step 2: banish, then prompt for wound target.
  if (step === 'pick-wound') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('dark-pact pick-wound expected mage-chosen');
    }
    const banished = banishMage(ctx.state, ctx.resumeAnswer.mageId, casterId);
    const afterBanish: GameState = { ...ctx.state, ...banished.patch };
    const wTargets = buildBurnTargets(afterBanish, casterId);
    if (wTargets.length === 0) {
      return { kind: 'done', patch: banished.patch };
    }
    return {
      kind: 'pause',
      patch: banished.patch,
      pending: {
        responderId: casterId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: wTargets },
        resume: {
          effectId: 'base.spell.dark-pact.l1',
          context: { step: 'apply-wound' },
        },
        source: ctx.source,
      },
    };
  }

  // Step 3: wound + reaction window.
  if (step === 'apply-wound') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('dark-pact apply-wound expected mage-chosen');
    }
    const wounded = woundMage(ctx.state, ctx.resumeAnswer.mageId, casterId);
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(ctx.state, casterId),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.system.post-wound-bonus',
          context: {
            triggerEvent: triggerEventToContext(wounded.triggerEvent),
          },
        },
        source: ctx.source,
      },
    };
  }

  throw new Error(`dark-pact unexpected step ${String(step)}`);
});

/**
 * Lavanina — Shadow Bolt (Planar Studies alt). "An opponent's Mage is now
 * shadowing its slot." Mechanically: the mage moves from the base
 * position of its slot to the shadow position of the SAME slot.
 *
 * Per the user spec this counts as a MOVE for reaction triggering — so a
 * `mage-moved` event fires (Phase Steppers / Invisibility Cloak / Shield
 * Potion / Ancient Armor are all eligible to react). The `fromSpaceId`
 * and `toSpaceId` are the same — defensive reactions that target "any
 * open slot" can still relocate the mage elsewhere via their slot-pick.
 */
registerEffect('base.spell.shadow-bolt.l1', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    // Shadow is not wound — green mages CAN be shadowed. Opposing blue
    // remains spell-immune. Opponent-only per spell text.
    const targets = buildSpellShadowTargets(
      ctx.state,
      ctx.triggeringPlayerId,
    ).filter((mageId) => {
      const owner = ctx.state.players.find((p) =>
        p.mages.some((m) => m.id === mageId),
      );
      return owner?.id !== ctx.triggeringPlayerId;
    });
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: 'base.spell.shadow-bolt.l1',
          context: { step: 'apply' },
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error('shadow-bolt expected mage-chosen');
  }
  const targetMageId = ctx.resumeAnswer.mageId;
  const targetMage = ctx.state.players
    .flatMap((p) => p.mages)
    .find((m) => m.id === targetMageId);
  if (
    !targetMage ||
    targetMage.location.kind !== 'action-space'
  ) {
    return { kind: 'done', patch: {} };
  }
  const targetOwner = ctx.state.players.find((p) =>
    p.mages.some((m) => m.id === targetMageId),
  );
  if (!targetOwner) return { kind: 'done', patch: {} };
  const spaceId = targetMage.location.spaceId;
  const targetSpace = ctx.state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.id === spaceId);
  if (!targetSpace || targetSpace.shadowOccupant) {
    // Shadow slot already filled — spell fizzles (the mage can't move into
    // an occupied shadow slot).
    return { kind: 'done', patch: {} };
  }
  // Build the patch: clear the base occupant, set the shadow occupant,
  // flip the mage's isShadowing flag.
  const patch: GameStatePatch = {
    players: ctx.state.players.map((p) =>
      p.id !== targetOwner.id
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== targetMageId
                ? m
                : { ...m, isShadowing: true },
            ),
          },
    ),
    rooms: ctx.state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId
          ? s
          : {
              ...s,
              occupant: null,
              shadowOccupant: {
                mageId: targetMageId,
                ownerId: targetOwner.id,
                isShadowing: true,
              },
            },
      ),
    })),
  };
  // Per spec: emit a mage-moved event for reaction triggering, fromSpaceId
  // === toSpaceId. Defensive reactions key off the event kind, not the
  // origin/destination, so this is enough to trigger them.
  const event: ReactionTriggerEvent = {
    kind: 'mage-moved',
    mageId: targetMageId,
    ownerId: targetOwner.id,
    fromSpaceId: spaceId,
    toSpaceId: spaceId,
    byPlayerId: ctx.triggeringPlayerId,
  };
  return {
    kind: 'open-reaction',
    patch,
    window: {
      triggerEvents: [event],
      pendingResponderIds: buildReactionQueue(
        ctx.state,
        ctx.triggeringPlayerId,
      ),
      reactedPlayerIds: [],
      // mage-moved doesn't grant an Infirmary bonus; close out silently.
      afterResume: { effectId: 'base.system.noop', context: {} },
      source: ctx.source,
    },
  };
});

/**
 * Mannheim Wildern — Gust of Wind (Natural Magick alt). Move any Mage to an
 * open slot in an adjacent room. The destination room must:
 *   - be orthogonally adjacent to the target's current room,
 *   - be placeable (not `cannotBePlacedInDirectly` — that excludes the
 *     Infirmary).
 * TODO: the spell text also excludes "Great Hall"; current room data has
 * no such room, so for now the cannotBePlacedInDirectly filter alone covers
 * the exclusion set.
 */
registerEffect('base.spell.gust-of-wind.l1', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];

  // Step 1: pick the target Mage. Move is NOT wound — green mages CAN be
  // moved (green is wound-immune only). Opposing blue remains spell-immune.
  if (!ctx.resumeAnswer) {
    const allTargets = buildSpellMoveTargets(ctx.state, ctx.triggeringPlayerId);
    // Filter to targets whose room has at least one placeable orthogonal
    // neighbor with an open slot — otherwise the move can't happen.
    const eligible = allTargets.filter((mageId) => {
      const mage = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === mageId);
      if (!mage || mage.location.kind !== 'action-space') return false;
      const sourceSpaceId = mage.location.spaceId;
      const sourceRoom = ctx.state.rooms.find((r) =>
        r.actionSpaces.some((s) => s.id === sourceSpaceId),
      );
      if (!sourceRoom) return false;
      const neighbors = getOrthogonallyAdjacentRoomIds(
        ctx.state.roomLayout,
        sourceRoom.id,
      );
      for (const nid of neighbors) {
        const neighbor = ctx.state.rooms.find((r) => r.id === nid);
        if (!neighbor || neighbor.cannotBePlacedInDirectly) continue;
        if (neighbor.actionSpaces.some((s) => !s.occupant)) return true;
      }
      return false;
    });
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: eligible },
        resume: {
          effectId: 'base.spell.gust-of-wind.l1',
          context: { step: 'pick-destination' },
        },
        source: ctx.source,
      },
    };
  }

  // Step 2: pick destination slot (open slot in an adjacent placeable room).
  if (step === 'pick-destination') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('gust-of-wind pick-destination expected mage-chosen');
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    if (!targetMage || targetMage.location.kind !== 'action-space') {
      return { kind: 'done', patch: {} };
    }
    const sourceSpaceId = targetMage.location.spaceId;
    const sourceRoom = ctx.state.rooms.find((r) =>
      r.actionSpaces.some((s) => s.id === sourceSpaceId),
    );
    if (!sourceRoom) return { kind: 'done', patch: {} };
    const neighbors = getOrthogonallyAdjacentRoomIds(
      ctx.state.roomLayout,
      sourceRoom.id,
    );
    const openSlots: string[] = [];
    for (const nid of neighbors) {
      const neighbor = ctx.state.rooms.find((r) => r.id === nid);
      if (!neighbor || neighbor.cannotBePlacedInDirectly) continue;
      for (const s of neighbor.actionSpaces) {
        if (!s.occupant) openSlots.push(s.id);
      }
    }
    if (openSlots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: 'base.spell.gust-of-wind.l1',
          context: { step: 'apply', targetMageId },
        },
        source: ctx.source,
      },
    };
  }

  // Step 3: apply the move + open the mage-moved reaction window.
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('gust-of-wind apply expected space-chosen');
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') {
      throw new Error('gust-of-wind apply: missing targetMageId');
    }
    const moved = moveMageToSpace(
      ctx.state,
      targetMageId,
      ctx.resumeAnswer.spaceId,
      ctx.triggeringPlayerId,
    );
    return {
      kind: 'open-reaction',
      patch: moved.patch,
      window: {
        triggerEvents: [moved.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }

  throw new Error(`gust-of-wind unexpected step ${String(step)}`);
});

// ============================================================================
// Tardy (Lavanina leader L1) + Stop Time (Temporal Calculus L2)
//
// Both trigger off the `bell-tower-last-claimed` reaction event opened by
// the engine pump after an opponent claims the final Bell Tower offering.
// Each pays its own mana cost + exhausts the spell, then "places a Mage
// without using Mage powers" — Tardy once, Stop Time twice.
//
// "Without Mage powers" means we exclude shadow / wound slot types (those
// require Sorcery powers to occupy) and we don't fire any color-based
// placement abilities (no fast-action for purple, no Ars Magna for red).
// The placement is otherwise a normal one: per-room cap is honored, and
// every placement (Tardy's, both of Stop Time's) fires its instant-room
// reward when applicable.
//
// Stop Time's second placement is queued via `state.pendingPlaceChain` —
// the engine's `drainPendingPlaceChainIfIdle` pump surfaces the next
// mage prompt once the first placement (including any instant-room
// reward chain) has fully resolved.
// ============================================================================

/** Eligible empty regular/merit base slots for a "place without Mage powers"
 *  step — excludes Infirmary, locked rooms, room-cap-exhausted rooms, and
 *  shadow/wound slot types. */
export function listPlaceWithoutPowersSlots(
  state: GameState,
  playerId: string,
): string[] {
  const slots: string[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    if (state.roomLocks.some((l) => l.roomId === r.id)) continue;
    if (isRoomAtPlayerCap(state, playerId, r.id)) continue;
    for (const s of r.actionSpaces) {
      if (s.occupant) continue;
      if (s.slotType !== 'regular' && s.slotType !== 'merit') continue;
      slots.push(s.id);
    }
  }
  return slots;
}

/** Eligible office mages for a "place without Mage powers" step. */
export function listPlaceWithoutPowersMages(
  state: GameState,
  playerId: string,
): string[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  return player.mages
    .filter((m) => m.location.kind === 'office' && !m.isWounded)
    .map((m) => m.id);
}

/** Shared system effect for a single "place a Mage without using Mage powers"
 *  step. Steps in `resumeContext`: undefined / 'pick-mage' (initial mage
 *  prompt) → 'pick-slot' (after mage chosen, slot prompt) → 'apply' (after
 *  slot chosen, place + instant reward). Used by Tardy.react, Stop Time.react,
 *  and the engine's pendingPlaceChain drain pump. */
registerEffect(
  'base.system.place-mage-without-powers',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'] ?? 'pick-mage';

    if (step === 'pick-mage') {
      const mages = listPlaceWithoutPowersMages(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (mages.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: mages },
          resume: {
            effectId: 'base.system.place-mage-without-powers',
            context: { step: 'pick-slot' },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-slot') {
      if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
        throw new Error('place-mage-without-powers pick-slot expected mage-chosen');
      }
      const slots = listPlaceWithoutPowersSlots(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (slots.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-action-space',
            eligibleSpaceIds: slots,
          },
          resume: {
            effectId: 'base.system.place-mage-without-powers',
            context: { step: 'apply', placerMageId: ctx.resumeAnswer.mageId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer?.kind !== 'space-chosen') {
        throw new Error('place-mage-without-powers apply expected space-chosen');
      }
      const placerMageId = ctx.resumeContext?.['placerMageId'];
      if (typeof placerMageId !== 'string') {
        throw new Error('place-mage-without-powers apply: missing placerMageId');
      }
      const spaceId = ctx.resumeAnswer.spaceId;
      const placePatch = placeOfficeMageOnSpace(
        ctx.state,
        ctx.triggeringPlayerId,
        placerMageId,
        spaceId,
      );
      return patchWithMaybeInstantReward(
        ctx.state,
        placePatch,
        spaceId,
        ctx.triggeringPlayerId,
        'base',
      );
    }

    throw new Error(
      `place-mage-without-powers: unexpected step ${String(step)}`,
    );
  },
);

/** Pays the spell's cost + exhausts it. Returns null if the player can't
 *  afford or doesn't own the spell unexhausted. */
function payAndExhaustSpell(
  state: GameState,
  playerId: string,
  spellCardId: string,
  manaCost: number,
): GameState | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;
  if (player.resources.mana < manaCost) return null;
  const owned = player.ownedSpells.find((s) => s.cardId === spellCardId);
  if (!owned || owned.exhausted) return null;
  return {
    ...state,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, mana: p.resources.mana - manaCost },
            ownedSpells: p.ownedSpells.map((s) =>
              s.cardId !== spellCardId ? s : { ...s, exhausted: true },
            ),
          },
    ),
  };
}

/** Composes the paid-state patch with whatever the place-mage-without-powers
 *  delegate returned (which may itself be a pause for the mage prompt). */
function composeWithDelegate(
  delegateResult: EffectResult,
  baseUpdate: GameStatePatch,
): EffectResult {
  switch (delegateResult.kind) {
    case 'done':
      return { kind: 'done', patch: { ...baseUpdate, ...delegateResult.patch } };
    case 'pause':
      return {
        kind: 'pause',
        patch: { ...baseUpdate, ...(delegateResult.patch ?? {}) },
        pending: delegateResult.pending,
      };
    case 'open-reaction':
      // Shouldn't happen — delegate runs with allowReactions=false.
      return {
        kind: 'open-reaction',
        patch: { ...baseUpdate, ...(delegateResult.patch ?? {}) },
        window: delegateResult.window,
      };
  }
}

registerEffect('base.spell.tardy.l1.react', (ctx): EffectResult => {
  const paid = payAndExhaustSpell(
    ctx.state,
    ctx.triggeringPlayerId,
    'base.spell.tardy',
    1,
  );
  if (!paid) return { kind: 'done', patch: {} };
  const delegate = getEffect('base.system.place-mage-without-powers')({
    state: paid,
    source: ctx.source,
    triggeringPlayerId: ctx.triggeringPlayerId,
    allowReactions: false,
  });
  return composeWithDelegate(delegate, { players: paid.players });
});

registerEffect(
  'base.spell.temporal-calculus-6th-ed.l2.react',
  (ctx): EffectResult => {
    const paid = payAndExhaustSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.temporal-calculus-6th-ed',
      3,
    );
    if (!paid) return { kind: 'done', patch: {} };
    // Queue the second placement — the engine's drain pump fires it once the
    // first placement (and its instant-room reward chain) settles.
    const withChain: GameState = {
      ...paid,
      pendingPlaceChain: {
        playerId: ctx.triggeringPlayerId,
        source: ctx.source,
        remaining: 1,
      },
    };
    const delegate = getEffect('base.system.place-mage-without-powers')({
      state: withChain,
      source: ctx.source,
      triggeringPlayerId: ctx.triggeringPlayerId,
      allowReactions: false,
    });
    return composeWithDelegate(delegate, {
      players: withChain.players,
      pendingPlaceChain: withChain.pendingPlaceChain,
    });
  },
);

// ============================================================================
// Wrath of Heaven (Divinity, reaction)
//
// Per rulebook, reactions cannot be reacted to. Each Wrath effect applies
// its wound / banish patch directly (no `open-reaction`) so no defensive
// reaction window opens against the retaliation. The Infirmary bonus
// (post-wound-bonus prompt) still fires for L1 because it is a separate
// bonus mechanic, not a reaction trigger.
// ============================================================================

/** Wrath of Heaven L1 "Justice" — Reaction. When one of your Mages is shadowed
 *  or moved by an opponent, wound any placed Mage belonging to that
 *  opponent. Cost: 1 Mana. */
registerEffect('base.spell.wrath-of-heaven.l1.react', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.wrath-of-heaven.l1.react';

  if (!step) {
    const paid = payAndExhaustSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.wrath-of-heaven',
      1,
    );
    if (!paid) return { kind: 'done', patch: {} };
    const rawEvent = ctx.resumeContext?.['triggerEvent'];
    if (!rawEvent || typeof rawEvent !== 'object') {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const event = rawEvent as unknown as ReactionTriggerEvent;
    if (!('byPlayerId' in event)) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const attackerId = event.byPlayerId;
    const attacker = paid.players.find((p) => p.id === attackerId);
    const targets =
      attacker?.mages
        .filter((m) => m.location.kind === 'action-space' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (targets.length === 0) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    return {
      kind: 'pause',
      patch: { players: paid.players },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const wounded = woundMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    if (checkInfirmaryBonusApplies(ctx.state, wounded.triggerEvent)) {
      return {
        kind: 'pause',
        patch: wounded.patch,
        pending: bonusPromptFor(wounded.triggerEvent, ctx.triggeringPlayerId),
      };
    }
    return { kind: 'done', patch: wounded.patch };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** Wrath of Heaven L2 "Recompense" — Reaction. When one of your Mages is
 *  banished by an opponent, banish a Mage belonging to that opponent.
 *  Cost: 1 Mana. No Infirmary bonus (banishing skips it). */
registerEffect('base.spell.wrath-of-heaven.l2.react', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.wrath-of-heaven.l2.react';

  if (!step) {
    const paid = payAndExhaustSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.wrath-of-heaven',
      1,
    );
    if (!paid) return { kind: 'done', patch: {} };
    const rawEvent = ctx.resumeContext?.['triggerEvent'];
    if (!rawEvent || typeof rawEvent !== 'object') {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const event = rawEvent as unknown as ReactionTriggerEvent;
    if (!('byPlayerId' in event)) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const attackerId = event.byPlayerId;
    const attacker = paid.players.find((p) => p.id === attackerId);
    const targets =
      attacker?.mages
        .filter((m) => m.location.kind === 'action-space' && !m.isWounded)
        .map((m) => m.id) ?? [];
    if (targets.length === 0) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    return {
      kind: 'pause',
      patch: { players: paid.players },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const banished = banishMage(
      ctx.state,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    return { kind: 'done', patch: banished.patch };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ============================================================================
// Songs of Springtime (Natural Magick, reaction)
// ============================================================================

/** Songs of Springtime L1 "Regeneration" — Reaction. When one of your Mages
 *  is wounded or moved, refresh an exhausted Spell or Treasure. Cost: 0
 *  Mana (still exhausts the spell). */
registerEffect(
  'base.spell.songs-of-springtime.l1.react',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.songs-of-springtime.l1.react';

    if (!step) {
      const paid = payAndExhaustSpell(
        ctx.state,
        ctx.triggeringPlayerId,
        'base.spell.songs-of-springtime',
        0,
      );
      if (!paid) return { kind: 'done', patch: {} };
      const reactor = paid.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      const exhaustedSpells =
        reactor?.ownedSpells.filter((s) => s.exhausted) ?? [];
      const exhaustedTreasures =
        reactor?.vaultCards.filter((v) => v.exhausted) ?? [];
      if (
        exhaustedSpells.length + exhaustedTreasures.length === 0
      ) {
        return { kind: 'done', patch: { players: paid.players } };
      }
      const options: ChoiceOption[] = [
        ...exhaustedSpells.map((s) => ({
          id: `spell:${s.cardId}`,
          label: `Refresh Spell — ${spellLabel(paid, s.cardId)}`,
          payload: {},
        })),
        ...exhaustedTreasures.map((v) => ({
          id: `treasure:${v.cardId}`,
          label: `Refresh Treasure — ${v.cardId}`,
          payload: {},
        })),
      ];
      return {
        kind: 'pause',
        patch: { players: paid.players },
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-from-options', options },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer?.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const choice = ctx.resumeAnswer.optionId;
      if (choice.startsWith('spell:')) {
        const cardId = choice.slice('spell:'.length);
        return {
          kind: 'done',
          patch: refreshOwnedSpellPatch(
            ctx.state,
            ctx.triggeringPlayerId,
            cardId,
          ),
        };
      }
      if (choice.startsWith('treasure:')) {
        const cardId = choice.slice('treasure:'.length);
        return {
          kind: 'done',
          patch: {
            players: ctx.state.players.map((p) =>
              p.id !== ctx.triggeringPlayerId
                ? p
                : {
                    ...p,
                    vaultCards: p.vaultCards.map((v) =>
                      v.cardId !== cardId ? v : { ...v, exhausted: false },
                    ),
                  },
            ),
          },
        };
      }
      throw new Error(`${self} apply: unknown option ${choice}`);
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Room-locking spells — Calval's L2, Master Book of Starcalling L2/L3,
// Moste Holie Litanies L3.
//
// Per rulebook: locks prevent any mage from entering / exiting / being
// affected in the room. Mages already inside still complete their Errands
// at the start of Resolution; locks auto-clear when Resolution begins
// (handled in `processErrandsAdvance`).
// ============================================================================

/** Calval's Deadliest Magicks L2 "Flamespout" — Wound a Mage, then lock the
 *  room it previously occupied. Standard wound-reaction-window flow; the
 *  lock is applied alongside the wound BEFORE the reaction window opens so
 *  defensive reactions (Phase Steppers / Invisibility Cloak) see the lock
 *  and can't relocate the mage back into the now-locked room. */
registerEffect('base.spell.calvals-deadliest-magicks.l2', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.calvals-deadliest-magicks.l2';
  if (!ctx.resumeAnswer) {
    const targets = buildBurnTargets(ctx.state, ctx.triggeringPlayerId);
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
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    // Find the room the target is currently in (before the wound moves
    // them to the Infirmary).
    const slotLookup = ctx.state.rooms.flatMap((r) =>
      r.actionSpaces
        .filter((s) => s.occupant?.mageId === targetMageId)
        .map(() => r.id),
    );
    const originalRoomId = slotLookup[0];
    const wounded = woundMage(ctx.state, targetMageId, ctx.triggeringPlayerId);
    const lockPatch = originalRoomId
      ? applyRoomLockPatch(
          { ...ctx.state, ...wounded.patch },
          originalRoomId,
        )
      : {};
    return {
      kind: 'open-reaction',
      patch: { ...wounded.patch, ...lockPatch },
      window: {
        triggerEvents: [wounded.triggerEvent],
        pendingResponderIds: buildReactionQueue(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.system.post-wound-bonus',
          context: {
            triggerEvent: triggerEventToContext(wounded.triggerEvent),
          },
        },
        source: ctx.source,
      },
    };
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** Master Book of Starcalling L2 "Meteor" — Place a Mage into a room, then
 *  lock that room. Three prompts: pick room → pick mage from office → pick
 *  open slot in that room. */
registerEffect(
  'base.spell.master-book-of-starcalling.l2',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.master-book-of-starcalling.l2';

    if (!ctx.resumeAnswer) {
      // Pick a room that is placeable, not locked, not at-cap for caster,
      // and has at least one empty base slot.
      const eligibleRooms = ctx.state.rooms.filter((r) => {
        if (r.cannotBePlacedInDirectly) return false;
        if (ctx.state.roomLocks.some((l) => l.roomId === r.id)) return false;
        if (isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, r.id))
          return false;
        return r.actionSpaces.some((s) => !s.occupant);
      });
      if (eligibleRooms.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRooms.map((r) => ({
              id: r.id,
              label: r.name,
              payload: {},
            })),
          },
          resume: { effectId: self, context: { step: 'pick-mage' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-mage') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} pick-mage expected option-chosen`);
      }
      const roomId = ctx.resumeAnswer.optionId;
      const player = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      const officeMages =
        player?.mages
          .filter((m) => m.location.kind === 'office' && !m.isWounded)
          .map((m) => m.id) ?? [];
      if (officeMages.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
          resume: { effectId: self, context: { step: 'pick-slot', roomId } },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-slot') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} pick-slot expected mage-chosen`);
      }
      const placerMageId = ctx.resumeAnswer.mageId;
      const roomId = ctx.resumeContext?.['roomId'];
      if (typeof roomId !== 'string') {
        throw new Error(`${self} pick-slot: missing roomId`);
      }
      const room = ctx.state.rooms.find((r) => r.id === roomId);
      const openSlots =
        room?.actionSpaces.filter((s) => !s.occupant).map((s) => s.id) ?? [];
      if (openSlots.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-action-space',
            eligibleSpaceIds: openSlots,
          },
          resume: {
            effectId: self,
            context: { step: 'apply', roomId, placerMageId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'space-chosen') {
        throw new Error(`${self} apply expected space-chosen`);
      }
      const roomId = ctx.resumeContext?.['roomId'];
      const placerMageId = ctx.resumeContext?.['placerMageId'];
      if (typeof roomId !== 'string' || typeof placerMageId !== 'string') {
        throw new Error(`${self} apply: missing context fields`);
      }
      const spaceId = ctx.resumeAnswer.spaceId;
      const placePatch = placeOfficeMageOnSpace(
        ctx.state,
        ctx.triggeringPlayerId,
        placerMageId,
        spaceId,
      );
      const afterPlace: GameState = { ...ctx.state, ...placePatch };
      const lockPatch = applyRoomLockPatch(afterPlace, roomId);
      return {
        kind: 'done',
        patch: { ...placePatch, ...lockPatch },
      };
    }
    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

/** Master Book of Starcalling L3 "Cataclysm" — Banish all Mages in a room,
 *  then lock that room. Mirrors Tsunami (book-of-100-seas.l3) with the
 *  extra lock-after-banish step. */
registerEffect(
  'base.spell.master-book-of-starcalling.l3',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.master-book-of-starcalling.l3';

    if (!ctx.resumeAnswer) {
      const eligibleRoomIds: string[] = [];
      for (const r of ctx.state.rooms) {
        if (ctx.state.roomLocks.some((l) => l.roomId === r.id)) continue;
        if (
          buildBanishableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
            .length > 0
        ) {
          eligibleRoomIds.push(r.id);
        }
      }
      // Even if no mages to banish, Cataclysm still locks the chosen room —
      // but the spell text says "Banish all Mages in a room, then lock that
      // room", implying the banish IS the primary effect. We require at
      // least one banishable mage per the spec's phrasing.
      if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRoomIds.map((rid) => {
              const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
              return { id: rid, label: r.name, payload: {} };
            }),
          },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }
    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const roomId = ctx.resumeAnswer.optionId;
      const mageIds = buildBanishableMagesInRoom(
        ctx.state,
        ctx.triggeringPlayerId,
        roomId,
      );
      if (mageIds.length === 0) return { kind: 'done', patch: {} };
      const banished = banishManyMages(
        ctx.state,
        mageIds,
        ctx.triggeringPlayerId,
      );
      const reactorQueue = buildBatchReactorQueue(
        ctx.state,
        ctx.triggeringPlayerId,
        banished.events,
      );
      const afterBanish: GameState = { ...ctx.state, ...banished.patch };
      const lockPatch = applyRoomLockPatch(afterBanish, roomId);
      return {
        kind: 'open-reaction',
        patch: { ...banished.patch, ...lockPatch },
        window: {
          triggerEvents: banished.events,
          pendingResponderIds: reactorQueue,
          reactedPlayerIds: [],
          afterResume: { effectId: 'base.system.noop', context: {} },
          source: ctx.source,
        },
      };
    }
    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

/** Moste Holie Litanies L3 "Consecration" — Place as many Mages as you wish
 *  into a single room, then Lock that room. Loop: pick room (once), then
 *  pick mage from office → pick slot in that room → place; repeat or stop.
 *  When the player stops (or runs out), lock the room. */
registerEffect('base.spell.moste-holie-litanies.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.moste-holie-litanies.l3';

  if (!ctx.resumeAnswer) {
    // Pick a room that is placeable, not locked, not at-cap, with an open slot
    // AND the caster has at least one office mage.
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const hasOfficeMage = !!player?.mages.some(
      (m) => m.location.kind === 'office' && !m.isWounded,
    );
    if (!hasOfficeMage) return { kind: 'done', patch: {} };
    const eligibleRooms = ctx.state.rooms.filter((r) => {
      if (r.cannotBePlacedInDirectly) return false;
      if (ctx.state.roomLocks.some((l) => l.roomId === r.id)) return false;
      if (isRoomAtPlayerCap(ctx.state, ctx.triggeringPlayerId, r.id))
        return false;
      return r.actionSpaces.some((s) => !s.occupant);
    });
    if (eligibleRooms.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligibleRooms.map((r) => ({
            id: r.id,
            label: r.name,
            payload: {},
          })),
        },
        resume: { effectId: self, context: { step: 'pick-mage' } },
        source: ctx.source,
      },
    };
  }

  // Step 'pick-mage' (or re-entry after a placement): prompt for mage in
  // office. Add 'stop' option to let the player end early and trigger the
  // lock. Carry `roomId` through resumeContext.
  if (step === 'pick-mage') {
    let roomId: string;
    if (ctx.resumeAnswer.kind === 'option-chosen') {
      roomId = ctx.resumeAnswer.optionId;
    } else {
      throw new Error(`${self} pick-mage expected option-chosen`);
    }
    return openMosteHolieMagePrompt(ctx, self, roomId);
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} pick-slot expected option-chosen`);
    }
    const roomId = ctx.resumeContext?.['roomId'];
    if (typeof roomId !== 'string') {
      throw new Error(`${self} pick-slot: missing roomId`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      // Apply the lock and finish.
      return {
        kind: 'done',
        patch: applyRoomLockPatch(ctx.state, roomId),
      };
    }
    const placerMageId = ctx.resumeAnswer.optionId;
    const room = ctx.state.rooms.find((r) => r.id === roomId);
    const openSlots =
      room?.actionSpaces.filter((s) => !s.occupant).map((s) => s.id) ?? [];
    if (openSlots.length === 0) {
      // No empty slots — apply lock and finish.
      return {
        kind: 'done',
        patch: applyRoomLockPatch(ctx.state, roomId),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: openSlots,
        },
        resume: {
          effectId: self,
          context: { step: 'apply', roomId, placerMageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const roomId = ctx.resumeContext?.['roomId'];
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof roomId !== 'string' || typeof placerMageId !== 'string') {
      throw new Error(`${self} apply: missing context fields`);
    }
    const spaceId = ctx.resumeAnswer.spaceId;
    const placePatch = placeOfficeMageOnSpace(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      spaceId,
    );
    const afterPlace: GameState = { ...ctx.state, ...placePatch };
    // After each placement, re-enter the mage prompt; if no more mages or
    // room is full, apply lock and finish.
    const stillOfficeMage = afterPlace.players
      .find((p) => p.id === ctx.triggeringPlayerId)
      ?.mages.some((m) => m.location.kind === 'office' && !m.isWounded);
    const stillHasSlot = afterPlace.rooms
      .find((r) => r.id === roomId)
      ?.actionSpaces.some((s) => !s.occupant);
    if (!stillOfficeMage || !stillHasSlot) {
      return {
        kind: 'done',
        patch: {
          ...placePatch,
          ...applyRoomLockPatch(afterPlace, roomId),
        },
      };
    }
    // Surface the next mage prompt (with stop) and pass roomId forward.
    const next = openMosteHolieMagePrompt(
      { ...ctx, state: afterPlace },
      self,
      roomId,
    );
    if (next.kind === 'done') {
      return {
        kind: 'done',
        patch: {
          ...placePatch,
          ...applyRoomLockPatch(afterPlace, roomId),
        },
      };
    }
    return {
      kind: 'pause',
      patch: placePatch,
      pending: next.pending,
    };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

function openMosteHolieMagePrompt(
  ctx: EffectContext,
  selfEffectId: string,
  roomId: string,
): Extract<EffectResult, { kind: 'done' | 'pause' }> {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  const officeMages =
    player?.mages
      .filter((m) => m.location.kind === 'office' && !m.isWounded)
      .map((m) => m.id) ?? [];
  if (officeMages.length === 0) {
    return {
      kind: 'done',
      patch: applyRoomLockPatch(ctx.state, roomId),
    };
  }
  const options: ChoiceOption[] = officeMages.map((mid) => ({
    id: mid,
    label: `Place ${mid}`,
    payload: {},
  }));
  options.push({ id: 'stop', label: 'Stop (lock the room)', payload: {} });
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: {
        effectId: selfEffectId,
        context: { step: 'pick-slot', roomId },
      },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Burn L2 / L3 — wider Sorcery wound spells
// ============================================================================
//
// L1 (Burn) is the vertical-slice single-target wound spell above. L2 and L3
// extend the same theme to multi-mage hits in a single room.

/** Factory for "Wound up to two Mages in the same room" spells (Burn L2
 *  Conflagration, Calval's L1 Pyre). Steps: pick a room with at least
 *  one woundable mage → first target → optional second target in the
 *  same room (with 'stop after one'). Routes through `applyBatchWound`
 *  for the batched reaction + Infirmary bonus chain. */
function woundUpToTwoInRoomEffect(selfEffectId: string) {
  return (ctx: EffectContext): EffectResult => {
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const eligibleRoomIds: string[] = [];
      for (const r of ctx.state.rooms) {
        if (
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
            .length > 0
        ) {
          eligibleRoomIds.push(r.id);
        }
      }
      if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRoomIds.map((rid) => {
              const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
              return { id: rid, label: r.name, payload: {} };
            }),
          },
          resume: { effectId: selfEffectId, context: { step: 'pick-first' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-first') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${selfEffectId} pick-first expected option-chosen`);
      }
      const roomId = ctx.resumeAnswer.optionId;
      const targets = buildWoundableMagesInRoom(
        ctx.state,
        ctx.triggeringPlayerId,
        roomId,
      );
      if (targets.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: {
            effectId: selfEffectId,
            context: { step: 'pick-second', roomId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-second') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${selfEffectId} pick-second expected mage-chosen`);
      }
      const firstId = ctx.resumeAnswer.mageId;
      const roomId = ctx.resumeContext?.['roomId'];
      if (typeof roomId !== 'string') {
        throw new Error(`${selfEffectId} pick-second: missing roomId`);
      }
      const remaining = buildWoundableMagesInRoom(
        ctx.state,
        ctx.triggeringPlayerId,
        roomId,
      ).filter((m) => m !== firstId);
      if (remaining.length === 0) {
        return applyBatchWound(ctx, selfEffectId, [firstId]);
      }
      const options: ChoiceOption[] = remaining.map((mid) => ({
        id: mid,
        label: `Also wound ${mid}`,
        payload: {},
      }));
      options.push({ id: 'stop', label: 'Stop after one', payload: {} });
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-from-options', options },
          resume: {
            effectId: selfEffectId,
            context: { step: 'apply', firstId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${selfEffectId} apply expected option-chosen`);
      }
      const firstId = ctx.resumeContext?.['firstId'];
      if (typeof firstId !== 'string') {
        throw new Error(`${selfEffectId} apply: missing firstId`);
      }
      if (ctx.resumeAnswer.optionId === 'stop') {
        return applyBatchWound(ctx, selfEffectId, [firstId]);
      }
      return applyBatchWound(ctx, selfEffectId, [
        firstId,
        ctx.resumeAnswer.optionId,
      ]);
    }

    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  };
}

/** Burn L2 "Conflagration" — Wound up to two Mages in the same room. */
registerEffect(
  'base.spell.burn.l2',
  woundUpToTwoInRoomEffect('base.spell.burn.l2'),
);

/** Calval's L1 "Pyre" — Wound up to two Mages in the same room. */
registerEffect(
  'base.spell.calvals-deadliest-magicks.l1',
  woundUpToTwoInRoomEffect('base.spell.calvals-deadliest-magicks.l1'),
);

/**
 * Calval's L3 "Volcano" — Banish one Mage belonging to each opponent.
 * Walks opponents in turn order starting after the caster; for each
 * opponent with at least one banishable mage, the caster picks which
 * one. After all picks, applies all banishes in a single batch + opens
 * one reaction window so each affected owner gets exactly one reaction
 * across the cast.
 *
 * Opponents with no banishable mages are skipped silently. If no
 * opponent has an eligible target the spell fizzles entirely.
 */
registerEffect(
  'base.spell.calvals-deadliest-magicks.l3',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'] ?? 'pick';
    const self = 'base.spell.calvals-deadliest-magicks.l3';
    const casterId = ctx.triggeringPlayerId;
    let targets = (ctx.resumeContext?.['targets'] ?? []) as string[];
    let nextIdx = Number(ctx.resumeContext?.['idx'] ?? 0);

    if (step === 'pick' && ctx.resumeAnswer) {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} pick expected mage-chosen`);
      }
      targets = [...targets, ctx.resumeAnswer.mageId];
      nextIdx += 1;
    }

    return promptNextVolcanoVictim(ctx, self, casterId, nextIdx, targets);
  },
);

function promptNextVolcanoVictim(
  ctx: EffectContext,
  selfEffectId: string,
  casterId: string,
  fromIdx: number,
  targetsSoFar: string[],
): EffectResult {
  // Opponents in turn order, starting after the caster.
  const orderedOpponents = volcanoOpponentsInTurnOrder(ctx.state, casterId);
  for (let i = fromIdx; i < orderedOpponents.length; i++) {
    const oppId = orderedOpponents[i]!;
    const eligible = buildBanishTargets(ctx.state, casterId).filter(
      (mageId) => {
        if (targetsSoFar.includes(mageId)) return false;
        const owner = ctx.state.players.find((p) =>
          p.mages.some((m) => m.id === mageId),
        );
        return owner?.id === oppId;
      },
    );
    if (eligible.length === 0) continue;
    return {
      kind: 'pause',
      pending: {
        responderId: casterId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: eligible },
        resume: {
          effectId: selfEffectId,
          context: { step: 'pick', idx: i, targets: targetsSoFar },
        },
        source: ctx.source,
      },
    };
  }
  // No more opponents to prompt — apply all banishes (if any).
  if (targetsSoFar.length === 0) return { kind: 'done', patch: {} };
  const banished = banishManyMages(ctx.state, targetsSoFar, casterId);
  return {
    kind: 'open-reaction',
    patch: banished.patch,
    window: {
      triggerEvents: banished.events,
      pendingResponderIds: buildBatchReactorQueue(
        ctx.state,
        casterId,
        banished.events,
      ),
      reactedPlayerIds: [],
      afterResume: { effectId: 'base.system.noop', context: {} },
      source: ctx.source,
    },
  };
}

function volcanoOpponentsInTurnOrder(
  state: GameState,
  casterId: string,
): string[] {
  const order = state.players.map((p) => p.id);
  const startIdx = order.indexOf(casterId);
  if (startIdx === -1) return order.filter((id) => id !== casterId);
  const out: string[] = [];
  for (let i = 1; i < order.length; i++) {
    out.push(order[(startIdx + i) % order.length]!);
  }
  return out;
}

/** Burn L3 "Inferno" — Wound all Mages in a room. Mirrors Lamentations'
 *  Nox shape but DOES grant the standard Infirmary bonus per the spell
 *  text (no "owner gains no bonus" clause). */
registerEffect('base.spell.burn.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.burn.l3';

  if (!ctx.resumeAnswer) {
    const eligibleRoomIds: string[] = [];
    for (const r of ctx.state.rooms) {
      if (
        buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
          .length > 0
      ) {
        eligibleRoomIds.push(r.id);
      }
    }
    if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: eligibleRoomIds.map((rid) => {
            const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
            return { id: rid, label: r.name, payload: {} };
          }),
        },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const roomId = ctx.resumeAnswer.optionId;
    const mageIds = buildWoundableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      roomId,
    );
    return applyBatchWound(ctx, self, mageIds);
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ============================================================================
// The Grasping Darkness L1 "Repeating Hex"
//
// Swap this Spell for a non-starter, non-legendary level-1 Spell from
// another player. Both Spells are exhausted after the swap.
//
// Errata (per the rulebook FAQ): if the caster has upgraded their
// Grasping Darkness (WIS placed at L2/L3) before casting Repeating Hex,
// the caster KEEPS those WIS tokens — they return to the caster's unspent
// WIS pool and may be spent later — but the research itself is lost (the
// spell goes to the opponent at L1-only). The opponent's spell coming
// over is L1-only by definition (the swap filter requires it).
// ============================================================================

interface RepeatingHexCandidate {
  ownerId: PlayerId;
  spellCardId: SpellCardId;
}

function buildRepeatingHexCandidates(
  state: GameState,
  casterId: PlayerId,
): RepeatingHexCandidate[] {
  const candidates: RepeatingHexCandidate[] = [];
  for (const p of state.players) {
    if (p.id === casterId) continue;
    for (const owned of p.ownedSpells) {
      if (!owned.intPlaced) continue; // must be researched
      if (owned.wisPlacedLevel2) continue; // L1 only
      if (owned.wisPlacedLevel3) continue;
      if (owned.cardId === p.candidateStartingSpellId) continue; // non-starter
      if (isLegendarySpell(state, owned.cardId)) continue;
      candidates.push({ ownerId: p.id, spellCardId: owned.cardId });
    }
  }
  return candidates;
}

registerEffect(
  'base.spell.the-grasping-darkness.l1',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.the-grasping-darkness.l1';
    const casterId = ctx.triggeringPlayerId;

    if (!ctx.resumeAnswer) {
      const candidates = buildRepeatingHexCandidates(ctx.state, casterId);
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const opponentNameOf = (id: PlayerId) =>
        ctx.state.players.find((p) => p.id === id)?.name ?? id;
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.ownerId}:${c.spellCardId}`,
        label: `${spellLabel(ctx.state, c.spellCardId)} — ${opponentNameOf(c.ownerId)}`,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: casterId,
          prompt: { kind: 'choose-from-options', options },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const sepIdx = ctx.resumeAnswer.optionId.indexOf(':');
      if (sepIdx < 0) {
        throw new Error(`${self} apply: malformed optionId`);
      }
      const targetPlayerId = ctx.resumeAnswer.optionId.slice(0, sepIdx);
      const targetSpellCardId = ctx.resumeAnswer.optionId.slice(sepIdx + 1);

      // Re-validate (state could have changed between prompt + resolve).
      const caster = ctx.state.players.find((p) => p.id === casterId);
      const target = ctx.state.players.find((p) => p.id === targetPlayerId);
      if (!caster || !target) return { kind: 'done', patch: {} };
      const myGrasping = caster.ownedSpells.find(
        (s) => s.cardId === 'base.spell.the-grasping-darkness',
      );
      const theirSpell = target.ownedSpells.find(
        (s) => s.cardId === targetSpellCardId,
      );
      if (
        !myGrasping ||
        !theirSpell ||
        !theirSpell.intPlaced ||
        theirSpell.wisPlacedLevel2 ||
        theirSpell.wisPlacedLevel3 ||
        theirSpell.cardId === target.candidateStartingSpellId ||
        isLegendarySpell(ctx.state, theirSpell.cardId)
      ) {
        return { kind: 'done', patch: {} };
      }

      // Per errata: caster keeps WIS tokens that were on Grasping Darkness.
      const refundedWis =
        (myGrasping.wisPlacedLevel2 ? 1 : 0) +
        (myGrasping.wisPlacedLevel3 ? 1 : 0);

      const players: Player[] = ctx.state.players.map((p) => {
        if (p.id === casterId) {
          return {
            ...p,
            ownedSpells: [
              ...p.ownedSpells.filter(
                (s) => s.cardId !== 'base.spell.the-grasping-darkness',
              ),
              {
                cardId: targetSpellCardId,
                intPlaced: true,
                wisPlacedLevel2: false,
                wisPlacedLevel3: false,
                exhausted: true,
              },
            ],
            resources: {
              ...p.resources,
              wisdom: p.resources.wisdom + refundedWis,
            },
          };
        }
        if (p.id === targetPlayerId) {
          return {
            ...p,
            ownedSpells: [
              ...p.ownedSpells.filter((s) => s.cardId !== targetSpellCardId),
              {
                cardId: 'base.spell.the-grasping-darkness',
                intPlaced: true,
                wisPlacedLevel2: false,
                wisPlacedLevel3: false,
                exhausted: true,
              },
            ],
          };
        }
        return p;
      });
      return { kind: 'done', patch: { players } };
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

/**
 * The Grasping Darkness L2 "Telepathy" — Discard an opponent's
 * non-starter, non-legendary level-1 Spell to the bottom of the Spell
 * Deck. The opponent keeps the INT they spent on it (it returns to
 * their unspent pool).
 *
 * Reuses the L1 candidate filter (`buildRepeatingHexCandidates`) since
 * the eligibility rules are identical. `applyDiscardOwnedSpell` already
 * sends the card to the bottom of the deck AND refunds INT (and any
 * WIS, but the L1-only filter means none is present).
 */
registerEffect(
  'base.spell.the-grasping-darkness.l2',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.the-grasping-darkness.l2';
    const casterId = ctx.triggeringPlayerId;

    if (!ctx.resumeAnswer) {
      const candidates = buildRepeatingHexCandidates(ctx.state, casterId);
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const opponentNameOf = (id: PlayerId) =>
        ctx.state.players.find((p) => p.id === id)?.name ?? id;
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.ownerId}:${c.spellCardId}`,
        label: `${spellLabel(ctx.state, c.spellCardId)} — ${opponentNameOf(c.ownerId)}`,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: casterId,
          prompt: { kind: 'choose-from-options', options },
          resume: { effectId: self, context: { step: 'apply' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const sepIdx = ctx.resumeAnswer.optionId.indexOf(':');
      if (sepIdx < 0) throw new Error(`${self} apply: malformed optionId`);
      const targetPlayerId = ctx.resumeAnswer.optionId.slice(0, sepIdx);
      const targetSpellCardId = ctx.resumeAnswer.optionId.slice(sepIdx + 1);

      // Re-validate.
      const target = ctx.state.players.find((p) => p.id === targetPlayerId);
      if (!target) return { kind: 'done', patch: {} };
      const theirSpell = target.ownedSpells.find(
        (s) => s.cardId === targetSpellCardId,
      );
      if (
        !theirSpell ||
        !theirSpell.intPlaced ||
        theirSpell.wisPlacedLevel2 ||
        theirSpell.wisPlacedLevel3 ||
        theirSpell.cardId === target.candidateStartingSpellId ||
        isLegendarySpell(ctx.state, theirSpell.cardId)
      ) {
        return { kind: 'done', patch: {} };
      }

      return {
        kind: 'done',
        patch: applyDiscardOwnedSpell(
          ctx.state,
          targetPlayerId,
          targetSpellCardId,
        ),
      };
    }
    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

/**
 * The Grasping Darkness L3 "Deathly Paling" — Steal 1 unspent INT from
 * a player with more INT than you, OR steal 1 unspent WIS from a player
 * with more WIS than you.
 *
 * Steps:
 *   1. Pick resource (INT / WIS). Only offered if at least one opponent
 *      has strictly more of that resource than the caster.
 *   2. Pick victim from the list of eligible opponents.
 *   3. Transfer 1 token from victim → caster.
 *
 * Fizzles silently if neither resource has an eligible victim.
 */
registerEffect(
  'base.spell.the-grasping-darkness.l3',
  (ctx): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const self = 'base.spell.the-grasping-darkness.l3';
    const casterId = ctx.triggeringPlayerId;

    if (!ctx.resumeAnswer) {
      const caster = ctx.state.players.find((p) => p.id === casterId);
      if (!caster) return { kind: 'done', patch: {} };
      const eligibleForInt = ctx.state.players.some(
        (p) =>
          p.id !== casterId &&
          p.resources.intelligence > caster.resources.intelligence,
      );
      const eligibleForWis = ctx.state.players.some(
        (p) =>
          p.id !== casterId && p.resources.wisdom > caster.resources.wisdom,
      );
      if (!eligibleForInt && !eligibleForWis) {
        return { kind: 'done', patch: {} };
      }
      const options: ChoiceOption[] = [];
      if (eligibleForInt) {
        options.push({
          id: 'int',
          label: 'Steal 1 INT from a player with more INT than you',
          payload: {},
        });
      }
      if (eligibleForWis) {
        options.push({
          id: 'wis',
          label: 'Steal 1 WIS from a player with more WIS than you',
          payload: {},
        });
      }
      return {
        kind: 'pause',
        pending: {
          responderId: casterId,
          prompt: { kind: 'choose-from-options', options },
          resume: { effectId: self, context: { step: 'pick-victim' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-victim') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} pick-victim expected option-chosen`);
      }
      const resource = ctx.resumeAnswer.optionId;
      if (resource !== 'int' && resource !== 'wis') {
        throw new Error(`${self} pick-victim: unknown resource ${resource}`);
      }
      const caster = ctx.state.players.find((p) => p.id === casterId);
      if (!caster) return { kind: 'done', patch: {} };
      const casterValue =
        resource === 'int'
          ? caster.resources.intelligence
          : caster.resources.wisdom;
      const victims = ctx.state.players.filter(
        (p) =>
          p.id !== casterId &&
          (resource === 'int'
            ? p.resources.intelligence > casterValue
            : p.resources.wisdom > casterValue),
      );
      if (victims.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: casterId,
          prompt: {
            kind: 'choose-from-options',
            options: victims.map((v) => ({
              id: v.id,
              label: `${v.name} (${
                resource === 'int' ? v.resources.intelligence : v.resources.wisdom
              } ${resource.toUpperCase()})`,
              payload: {},
            })),
          },
          resume: { effectId: self, context: { step: 'apply', resource } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const resource = ctx.resumeContext?.['resource'];
      if (resource !== 'int' && resource !== 'wis') {
        throw new Error(`${self} apply: missing/invalid resource`);
      }
      const victimId = ctx.resumeAnswer.optionId;
      const caster = ctx.state.players.find((p) => p.id === casterId);
      const victim = ctx.state.players.find((p) => p.id === victimId);
      if (!caster || !victim) return { kind: 'done', patch: {} };
      // Re-validate the inequality (state could change between prompts).
      const casterValue =
        resource === 'int'
          ? caster.resources.intelligence
          : caster.resources.wisdom;
      const victimValue =
        resource === 'int'
          ? victim.resources.intelligence
          : victim.resources.wisdom;
      if (victimValue <= casterValue) return { kind: 'done', patch: {} };
      const field = resource === 'int' ? 'intelligence' : 'wisdom';
      return {
        kind: 'done',
        patch: {
          players: ctx.state.players.map((p) => {
            if (p.id === victimId) {
              return {
                ...p,
                resources: { ...p.resources, [field]: p.resources[field] - 1 },
              };
            }
            if (p.id === casterId) {
              return {
                ...p,
                resources: { ...p.resources, [field]: p.resources[field] + 1 },
              };
            }
            return p;
          }),
        },
      };
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Sustained immunity buffs — Moste Holie Litanies, Heart of the Mountain,
// Tome of Protection
// ============================================================================
//
// Each effect appends one entry to `state.activeBuffs`. The buff protects
// the caster's mages from a list of effect kinds (wound / banish / move /
// shadow) for a bounded duration:
//   - `turn-start`: expires when the buff's owner begins their next turn
//   - `round-end`: expires when the round transitions to Resolution
//
// The target-build filters (`buildHarmfulMageTargets`, `buildArsMagnaTargets`)
// skip mages whose owner has a matching active buff, so protected mages
// don't appear as eligible targets anywhere in the engine or UI.

function immunityBuffSpell(opts: {
  spellCardId: string;
  label: string;
  immuneTo: HarmfulEffectKind[];
  source: 'spell' | 'any';
  duration: 'turn-start' | 'round-end';
}) {
  return (ctx: EffectContext): EffectResult => {
    const newBuff: MageImmunityBuff = {
      kind: 'mage-immunity',
      ownerId: ctx.triggeringPlayerId,
      spellCardId: opts.spellCardId,
      label: opts.label,
      immuneTo: opts.immuneTo,
      source: opts.source,
      expiresAt:
        opts.duration === 'turn-start'
          ? { kind: 'turn-start', playerId: ctx.triggeringPlayerId }
          : { kind: 'round-end' },
    };
    return {
      kind: 'done',
      patch: {
        activeBuffs: [...ctx.state.activeBuffs, newBuff],
      },
    };
  };
}

// Moste Holie Litanies (Divinity, legendary)
registerEffect(
  'base.spell.moste-holie-litanies.l1',
  immunityBuffSpell({
    spellCardId: 'base.spell.moste-holie-litanies',
    label: 'Sanctification',
    immuneTo: ['wound'],
    source: 'any',
    duration: 'turn-start',
  }),
);
registerEffect(
  'base.spell.moste-holie-litanies.l2',
  immunityBuffSpell({
    spellCardId: 'base.spell.moste-holie-litanies',
    label: 'Protective Aura',
    immuneTo: ['wound'],
    source: 'any',
    duration: 'round-end',
  }),
);

// Heart of the Mountain (Natural Magick)
registerEffect(
  'base.spell.heart-of-the-mountain.l1',
  immunityBuffSpell({
    spellCardId: 'base.spell.heart-of-the-mountain',
    label: 'Oakskin',
    immuneTo: ['wound', 'move'],
    source: 'any',
    duration: 'turn-start',
  }),
);
registerEffect(
  'base.spell.heart-of-the-mountain.l2',
  immunityBuffSpell({
    spellCardId: 'base.spell.heart-of-the-mountain',
    label: 'Stoneskin',
    immuneTo: ['wound', 'move'],
    source: 'any',
    duration: 'round-end',
  }),
);

// Heart of the Mountain L3 "Diamondskin": "your Mages lose their innate
// powers, but become immune to all negative effects." The "lose innate
// powers" side requires suppressing colour-based mage abilities (purple
// fast-action, red Ars Magna, etc.) — that's a separate mechanic and is
// NOT yet implemented. The immunity portion is wired here; expanding to
// power-suppression is a follow-up.
registerEffect(
  'base.spell.heart-of-the-mountain.l3',
  immunityBuffSpell({
    spellCardId: 'base.spell.heart-of-the-mountain',
    label: 'Diamondskin',
    immuneTo: ['wound', 'banish', 'move', 'shadow'],
    source: 'any',
    duration: 'round-end',
  }),
);

// Tome of Protection
registerEffect(
  'base.spell.tome-of-protection.l1',
  immunityBuffSpell({
    spellCardId: 'base.spell.tome-of-protection',
    label: 'Spell Shield',
    immuneTo: ['wound', 'banish', 'move', 'shadow'],
    source: 'spell',
    duration: 'turn-start',
  }),
);
registerEffect(
  'base.spell.tome-of-protection.l2',
  immunityBuffSpell({
    spellCardId: 'base.spell.tome-of-protection',
    label: 'Wall',
    immuneTo: ['wound', 'banish', 'move', 'shadow'],
    source: 'any',
    duration: 'turn-start',
  }),
);

// ============================================================================
// Tenets of Dominance L1 "Mesmerize"
// ============================================================================
//
// "Until your next turn, all Mages (except those immune to Spells) lose
// their powers." Blue (Divinity) is the only colour with spell-immunity,
// so blue mages keep their power; every other colour acts as neutral
// while the buff is active:
//   - Green: no longer wound-immune
//   - Purple: no fast-action placement
//   - Red: cannot trigger Ars Magna
//   - Grey: no Mysticism place-after-cast
//
// Duration: caster's next turn OR round-end, whichever comes first. The
// round-end branch is the global "clear all buffs at Resolution start"
// hook in engine.ts — no extra logic needed here.

registerEffect(
  'base.spell.tenets-of-dominance.l1',
  (ctx): EffectResult => {
    const buff: MagesLosePowersBuff = {
      kind: 'mages-lose-powers',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.tenets-of-dominance',
      label: 'Mesmerize',
      expiresAt: { kind: 'turn-start', playerId: ctx.triggeringPlayerId },
    };
    return {
      kind: 'done',
      patch: {
        activeBuffs: [...ctx.state.activeBuffs, buff],
      },
    };
  },
);

// ============================================================================
// Sealed Scroll — research a Legendary Spell of your choice from the set-aside
// pool. The 5 legendary spell books (`baseLegendarySpellBooks`) never enter the
// regular spell deck; they live in `pack.legendarySpells` and are claimed only
// here. Pays 1 INT (the "Research" cost). Fizzles if the pool is empty or the
// player has no spare INT — the scroll itself is still consumed by
// PLAY_VAULT_CARD upstream.
// ============================================================================

function legendaryBookOptionLabel(
  state: GameState,
  spellCardId: SpellCardId,
): string {
  const def = lookupSpellCardDef(state, spellCardId);
  if (!def) return spellCardId;
  const lines = def.levels.map((lv) => {
    const cost = `${lv.manaCost} Mana`;
    const timing =
      lv.timing === 'fast-action'
        ? 'Fast Action'
        : lv.timing === 'reaction'
          ? 'Reaction'
          : 'Action';
    return `  L${lv.level} ${lv.title} (${cost}, ${timing}): ${lv.description ?? ''}`;
  });
  return `${def.name}\n${lines.join('\n')}`;
}

registerEffect('base.vault.sealed-scroll', (ctx): EffectResult => {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.intelligence < 1) {
    return { kind: 'done', patch: {} };
  }
  const pool = unclaimedLegendaryBooks(ctx.state);
  if (pool.length === 0) return { kind: 'done', patch: {} };
  const options: ChoiceOption[] = pool.map((cid) => ({
    id: cid,
    label: legendaryBookOptionLabel(ctx.state, cid),
    payload: {},
  }));
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: 'base.vault.sealed-scroll.draft', context: {} },
      source: ctx.source,
    },
  };
});

registerEffect('base.vault.sealed-scroll.draft', (ctx): EffectResult => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error('sealed-scroll.draft expected option-chosen');
  }
  const spellCardId = ctx.resumeAnswer.optionId;
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources.intelligence < 1) {
    return { kind: 'done', patch: {} };
  }
  if (!unclaimedLegendaryBooks(ctx.state).includes(spellCardId)) {
    return { kind: 'done', patch: {} };
  }
  const patch = applyDraftLegendarySpell(
    ctx.state,
    ctx.triggeringPlayerId,
    spellCardId,
  );
  return { kind: 'done', patch };
});

// ============================================================================
// Master Book of Starcalling L1 "Ice Comet" — In a single room, wound a Mage,
// banish a Mage, and move a Mage to an open slot in the same room.
//
// Picks are collected in order (wound → banish → move-source → move-dest);
// later picks exclude mages chosen for earlier picks (a single target can't
// be wound AND banish'd by one cast). Each step auto-skips if no eligible
// targets exist. After all picks, the three effects apply in a single batch
// and ONE combined reaction window opens with all triggered events — affected
// opponents react after the spell has fully resolved, not after each step.
// ============================================================================

const ICE_COMET_SKIP = '__SKIP__';

function buildMovableMagesInRoom(
  state: GameState,
  casterId: string,
  roomId: string,
): string[] {
  const eligible = new Set(buildSpellMoveTargets(state, casterId));
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const mages: string[] = [];
  for (const s of room.actionSpaces) {
    if (s.occupant && eligible.has(s.occupant.mageId)) {
      mages.push(s.occupant.mageId);
    }
    if (s.shadowOccupant && eligible.has(s.shadowOccupant.mageId)) {
      mages.push(s.shadowOccupant.mageId);
    }
  }
  return mages;
}

function openBaseSlotsInRoom(state: GameState, roomId: string): string[] {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  return room.actionSpaces
    .filter(
      (s) =>
        !s.occupant && (s.slotType === 'regular' || s.slotType === 'merit'),
    )
    .map((s) => s.id);
}

type IceCometPicks = {
  roomId: string;
  woundMageId?: string;
  banishMageId?: string;
  moveMageId?: string;
  moveDestSpaceId?: string;
};

function iceCometWalk(
  ctx: EffectContext,
  self: string,
  picks: IceCometPicks,
): EffectResult {
  // Wound pick.
  if (picks.woundMageId === undefined) {
    const targets = buildWoundableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      picks.roomId,
    );
    if (targets.length === 0) {
      return iceCometWalk(ctx, self, { ...picks, woundMageId: ICE_COMET_SKIP });
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: self,
          context: { step: 'wound-chosen', picks: picksToContext(picks) },
        },
        source: ctx.source,
      },
    };
  }
  // Banish pick (exclude wound target).
  if (picks.banishMageId === undefined) {
    const targets = buildBanishableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      picks.roomId,
    ).filter((id) => id !== picks.woundMageId);
    if (targets.length === 0) {
      return iceCometWalk(ctx, self, {
        ...picks,
        banishMageId: ICE_COMET_SKIP,
      });
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: self,
          context: { step: 'banish-chosen', picks: picksToContext(picks) },
        },
        source: ctx.source,
      },
    };
  }
  // Move source (exclude wound + banish targets); need ≥1 open dest in room.
  if (picks.moveMageId === undefined) {
    const candidates = buildMovableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      picks.roomId,
    ).filter(
      (id) => id !== picks.woundMageId && id !== picks.banishMageId,
    );
    const opens = openBaseSlotsInRoom(ctx.state, picks.roomId);
    // Each source needs an open dest that ISN'T its own current slot.
    const sources = candidates.filter((mid) => {
      const pos = findMageSlotPosition(ctx.state, mid);
      const otherOpens = opens.filter((sid) => pos?.spaceId !== sid);
      return otherOpens.length > 0;
    });
    if (sources.length === 0) {
      return iceCometWalk(ctx, self, {
        ...picks,
        moveMageId: ICE_COMET_SKIP,
        moveDestSpaceId: ICE_COMET_SKIP,
      });
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: sources },
        resume: {
          effectId: self,
          context: {
            step: 'move-source-chosen',
            picks: picksToContext(picks),
          },
        },
        source: ctx.source,
      },
    };
  }
  // Move dest.
  if (picks.moveDestSpaceId === undefined) {
    if (picks.moveMageId === ICE_COMET_SKIP) {
      return iceCometWalk(ctx, self, {
        ...picks,
        moveDestSpaceId: ICE_COMET_SKIP,
      });
    }
    const pos = findMageSlotPosition(
      ctx.state,
      picks.moveMageId as OwnedMageId,
    );
    const dests = openBaseSlotsInRoom(ctx.state, picks.roomId).filter(
      (sid) => pos?.spaceId !== sid,
    );
    if (dests.length === 0) {
      return iceCometWalk(ctx, self, {
        ...picks,
        moveMageId: ICE_COMET_SKIP,
        moveDestSpaceId: ICE_COMET_SKIP,
      });
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
          effectId: self,
          context: { step: 'move-dest-chosen', picks: picksToContext(picks) },
        },
        source: ctx.source,
      },
    };
  }
  return iceCometFinalize(ctx, picks);
}

function picksToContext(picks: IceCometPicks): SerializableContext {
  const out: SerializableContext = { roomId: picks.roomId };
  if (picks.woundMageId !== undefined) out['woundMageId'] = picks.woundMageId;
  if (picks.banishMageId !== undefined) out['banishMageId'] = picks.banishMageId;
  if (picks.moveMageId !== undefined) out['moveMageId'] = picks.moveMageId;
  if (picks.moveDestSpaceId !== undefined)
    out['moveDestSpaceId'] = picks.moveDestSpaceId;
  return out;
}

function picksFromContext(ctx: EffectContext): IceCometPicks {
  const raw = (ctx.resumeContext?.['picks'] ?? {}) as SerializableContext;
  const out: IceCometPicks = { roomId: String(raw['roomId'] ?? '') };
  if (typeof raw['woundMageId'] === 'string') out.woundMageId = raw['woundMageId'];
  if (typeof raw['banishMageId'] === 'string') out.banishMageId = raw['banishMageId'];
  if (typeof raw['moveMageId'] === 'string') out.moveMageId = raw['moveMageId'];
  if (typeof raw['moveDestSpaceId'] === 'string') out.moveDestSpaceId = raw['moveDestSpaceId'];
  return out;
}

function iceCometFinalize(
  ctx: EffectContext,
  picks: IceCometPicks,
): EffectResult {
  let working = ctx.state;
  const events: ReactionTriggerEvent[] = [];
  const byPlayerId = ctx.triggeringPlayerId;

  if (picks.woundMageId && picks.woundMageId !== ICE_COMET_SKIP) {
    const w = woundMage(working, picks.woundMageId, byPlayerId);
    working = { ...working, ...w.patch };
    events.push(w.triggerEvent);
  }
  if (picks.banishMageId && picks.banishMageId !== ICE_COMET_SKIP) {
    const b = banishMage(working, picks.banishMageId, byPlayerId);
    working = { ...working, ...b.patch };
    events.push(b.triggerEvent);
  }
  if (
    picks.moveMageId &&
    picks.moveMageId !== ICE_COMET_SKIP &&
    picks.moveDestSpaceId &&
    picks.moveDestSpaceId !== ICE_COMET_SKIP
  ) {
    const m = moveMageToSpace(
      working,
      picks.moveMageId,
      picks.moveDestSpaceId,
      byPlayerId,
    );
    working = { ...working, ...m.patch };
    events.push(m.triggerEvent);
  }

  if (events.length === 0) return { kind: 'done', patch: {} };

  const patch: GameStatePatch = {
    players: working.players,
    rooms: working.rooms,
  };
  const reactorQueue = buildBatchReactorQueue(ctx.state, byPlayerId, events);
  const orderedEvents = orderEventsByTurn(ctx.state, byPlayerId, events);

  return {
    kind: 'open-reaction',
    patch,
    window: {
      triggerEvents: events,
      pendingResponderIds: reactorQueue,
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.batch-post-wound-bonus',
        context: { events: eventsArrayToContext(orderedEvents) },
      },
      source: ctx.source,
    },
  };
}

registerEffect(
  'base.spell.master-book-of-starcalling.l1',
  (ctx): EffectResult => {
    const self = 'base.spell.master-book-of-starcalling.l1';

    // Initial entry: pick room.
    if (!ctx.resumeAnswer) {
      const eligibleRoomIds = ctx.state.rooms
        .filter((r) => {
          const hasWound =
            buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
              .length > 0;
          const hasBanish =
            buildBanishableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
              .length > 0;
          const opens = openBaseSlotsInRoom(ctx.state, r.id);
          const hasMove =
            buildMovableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id)
              .some((mid) => {
                const pos = findMageSlotPosition(
                  ctx.state,
                  mid as OwnedMageId,
                );
                return opens.some((sid) => pos?.spaceId !== sid);
              });
          return hasWound || hasBanish || hasMove;
        })
        .map((r) => r.id);
      if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: eligibleRoomIds.map((rid) => ({
              id: rid,
              label: ctx.state.rooms.find((r) => r.id === rid)!.name,
              payload: {},
            })),
          },
          resume: { effectId: self, context: { step: 'room-chosen' } },
          source: ctx.source,
        },
      };
    }

    const step = ctx.resumeContext?.['step'];

    if (step === 'room-chosen') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} room-chosen expected option-chosen`);
      }
      return iceCometWalk(ctx, self, { roomId: ctx.resumeAnswer.optionId });
    }

    const picks = picksFromContext(ctx);

    if (step === 'wound-chosen') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} wound-chosen expected mage-chosen`);
      }
      return iceCometWalk(ctx, self, {
        ...picks,
        woundMageId: ctx.resumeAnswer.mageId,
      });
    }
    if (step === 'banish-chosen') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} banish-chosen expected mage-chosen`);
      }
      return iceCometWalk(ctx, self, {
        ...picks,
        banishMageId: ctx.resumeAnswer.mageId,
      });
    }
    if (step === 'move-source-chosen') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} move-source-chosen expected mage-chosen`);
      }
      return iceCometWalk(ctx, self, {
        ...picks,
        moveMageId: ctx.resumeAnswer.mageId,
      });
    }
    if (step === 'move-dest-chosen') {
      if (ctx.resumeAnswer.kind !== 'space-chosen') {
        throw new Error(`${self} move-dest-chosen expected space-chosen`);
      }
      return iceCometWalk(ctx, self, {
        ...picks,
        moveDestSpaceId: ctx.resumeAnswer.spaceId,
      });
    }
    throw new Error(`${self}: unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Infinite Universes Realized L1 "Event Horizon" — Shadow two Mages with two
// of your Mages.
//
// The caster picks two pairs (target, shadower):
//   - target = any spell-shadow-eligible mage on a slot whose shadow position
//     is empty AND whose room isn't at the caster's per-room cap;
//   - shadower = one of the caster's unwounded office mages.
// Targets and shadowers can't repeat across the two picks. If only one of
// each is available, the spell does just one shadow. After all picks, both
// placements apply in order; the second is silently skipped if it would
// violate the per-room cap or the shadow slot has become occupied. A single
// reaction window opens at the end with both `mage-shadowed` events.
// ============================================================================

function eventHorizonTargets(
  state: GameState,
  casterId: string,
  excludeMageId?: string,
): string[] {
  const shadowable = new Set(buildSpellShadowTargets(state, casterId));
  const out: string[] = [];
  for (const r of state.rooms) {
    if (isRoomLocked(state, r.id)) continue;
    if (isRoomAtPlayerCap(state, casterId, r.id)) continue;
    for (const s of r.actionSpaces) {
      if (s.shadowOccupant) continue;
      const occ = s.occupant;
      if (!occ) continue;
      if (!shadowable.has(occ.mageId)) continue;
      if (occ.mageId === excludeMageId) continue;
      out.push(occ.mageId);
    }
  }
  return out;
}

function eventHorizonShadowers(
  state: GameState,
  casterId: string,
  excludeMageId?: string,
): string[] {
  const caster = state.players.find((p) => p.id === casterId);
  if (!caster) return [];
  return caster.mages
    .filter(
      (m) =>
        m.location.kind === 'office' &&
        !m.isWounded &&
        m.id !== excludeMageId,
    )
    .map((m) => m.id);
}

registerEffect(
  'base.spell.infinite-universes-realized.l1',
  (ctx): EffectResult => {
    const self = 'base.spell.infinite-universes-realized.l1';
    const step = ctx.resumeContext?.['step'];

    // Initial entry: prompt for target 1.
    if (!ctx.resumeAnswer) {
      const targets = eventHorizonTargets(ctx.state, ctx.triggeringPlayerId);
      const shadowers = eventHorizonShadowers(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (targets.length === 0 || shadowers.length === 0) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: { effectId: self, context: { step: 'pick-shadower-1' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-shadower-1') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} pick-shadower-1 expected mage-chosen`);
      }
      const target1 = ctx.resumeAnswer.mageId;
      const shadowers = eventHorizonShadowers(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (shadowers.length === 0) {
        return eventHorizonFinalize(ctx, [{ target: target1, shadower: '' }]);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: shadowers },
          resume: {
            effectId: self,
            context: { step: 'pick-target-2', target1 },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-target-2') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} pick-target-2 expected mage-chosen`);
      }
      const target1 = String(ctx.resumeContext?.['target1'] ?? '');
      const shadower1 = ctx.resumeAnswer.mageId;
      const target2Options = eventHorizonTargets(
        ctx.state,
        ctx.triggeringPlayerId,
        target1,
      );
      if (target2Options.length === 0) {
        return eventHorizonFinalize(ctx, [
          { target: target1, shadower: shadower1 },
        ]);
      }
      const shadower2Options = eventHorizonShadowers(
        ctx.state,
        ctx.triggeringPlayerId,
        shadower1,
      );
      if (shadower2Options.length === 0) {
        return eventHorizonFinalize(ctx, [
          { target: target1, shadower: shadower1 },
        ]);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: target2Options,
          },
          resume: {
            effectId: self,
            context: { step: 'pick-shadower-2', target1, shadower1 },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-shadower-2') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} pick-shadower-2 expected mage-chosen`);
      }
      const target1 = String(ctx.resumeContext?.['target1'] ?? '');
      const shadower1 = String(ctx.resumeContext?.['shadower1'] ?? '');
      const target2 = ctx.resumeAnswer.mageId;
      const shadower2Options = eventHorizonShadowers(
        ctx.state,
        ctx.triggeringPlayerId,
        shadower1,
      );
      if (shadower2Options.length === 0) {
        return eventHorizonFinalize(ctx, [
          { target: target1, shadower: shadower1 },
        ]);
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: shadower2Options,
          },
          resume: {
            effectId: self,
            context: {
              step: 'finalize',
              target1,
              shadower1,
              target2,
            },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'finalize') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} finalize expected mage-chosen`);
      }
      const target1 = String(ctx.resumeContext?.['target1'] ?? '');
      const shadower1 = String(ctx.resumeContext?.['shadower1'] ?? '');
      const target2 = String(ctx.resumeContext?.['target2'] ?? '');
      const shadower2 = ctx.resumeAnswer.mageId;
      return eventHorizonFinalize(ctx, [
        { target: target1, shadower: shadower1 },
        { target: target2, shadower: shadower2 },
      ]);
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

function eventHorizonFinalize(
  ctx: EffectContext,
  pairs: { target: string; shadower: string }[],
): EffectResult {
  let working = ctx.state;
  const events: ReactionTriggerEvent[] = [];
  for (const { target, shadower } of pairs) {
    if (!target || !shadower) continue;
    const targetMage = working.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === target);
    if (!targetMage || targetMage.location.kind !== 'action-space') continue;
    const spaceId = targetMage.location.spaceId;
    const space = working.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === spaceId);
    if (!space || space.shadowOccupant) continue;
    const targetRoom = working.rooms.find((r) =>
      r.actionSpaces.some((s) => s.id === spaceId),
    );
    if (!targetRoom) continue;
    if (isRoomAtPlayerCap(working, ctx.triggeringPlayerId, targetRoom.id)) {
      continue;
    }
    const shadowerMage = working.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === shadower);
    if (!shadowerMage || shadowerMage.location.kind !== 'office') continue;
    const patch = placeOfficeMageAsShadow(
      working,
      ctx.triggeringPlayerId,
      shadower,
      spaceId,
    );
    working = { ...working, ...patch };
    events.push(
      buildMageShadowedEvent(working, target, ctx.triggeringPlayerId),
    );
  }
  if (events.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'open-reaction',
    patch: { players: working.players, rooms: working.rooms },
    window: {
      triggerEvents: events,
      pendingResponderIds: buildBatchReactorQueue(
        ctx.state,
        ctx.triggeringPlayerId,
        events,
      ),
      reactedPlayerIds: [],
      afterResume: { effectId: 'base.system.noop', context: {} },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Infinite Universes Realized L2 "Zero Hour" — For the rest of the round,
// your Mages can shadow opponent's Mages when placed. (Optional shadow on
// place; normal base placement remains available.)
// ============================================================================

registerEffect(
  'base.spell.infinite-universes-realized.l2',
  (ctx): EffectResult => {
    const buff: ShadowOnPlaceBuff = {
      kind: 'shadow-on-place',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.infinite-universes-realized',
      label: 'Zero Hour',
      mode: 'optional',
      expiresAt: { kind: 'round-end' },
    };
    return {
      kind: 'done',
      patch: {
        activeBuffs: [...ctx.state.activeBuffs, buff],
      },
    };
  },
);

// ============================================================================
// Infinite Universes Realized L3 "Inversion" — All of your placed Mages move
// to the Shadow position if able. For the rest of the round, you must
// Shadow opponents or empty slots.
//
// Mass-move: each of the caster's mages currently at a slot's BASE position
// shifts to the SHADOW position of the same slot, provided the shadow
// position is empty. Mages already shadowing, or whose target shadow slot
// is occupied, are skipped. No reaction events fire for the self-move.
// Then the mandatory shadow-on-place buff is added; PLACE_WORKER's shadow-
// placement branch (see engine.ts) enforces the "must shadow" rule for the
// rest of the round.
// ============================================================================

function applyInversionMassMove(state: GameState, casterId: string): GameState {
  const caster = state.players.find((p) => p.id === casterId);
  if (!caster) return state;
  let working = state;
  for (const m of caster.mages) {
    if (m.location.kind !== 'action-space') continue;
    if (m.isShadowing) continue;
    const spaceId = m.location.spaceId;
    const space = working.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === spaceId);
    if (!space || space.shadowOccupant) continue;
    if (space.occupant?.mageId !== m.id) continue;
    working = {
      ...working,
      players: working.players.map((p) =>
        p.id !== casterId
          ? p
          : {
              ...p,
              mages: p.mages.map((mm) =>
                mm.id !== m.id ? mm : { ...mm, isShadowing: true },
              ),
            },
      ),
      rooms: working.rooms.map((r) => {
        if (!r.actionSpaces.some((s) => s.id === spaceId)) return r;
        return {
          ...r,
          actionSpaces: r.actionSpaces.map((s) =>
            s.id !== spaceId
              ? s
              : {
                  ...s,
                  occupant: null,
                  shadowOccupant: {
                    mageId: m.id,
                    ownerId: casterId,
                    isShadowing: true,
                  },
                },
          ),
        };
      }),
    };
  }
  return working;
}

registerEffect(
  'base.spell.infinite-universes-realized.l3',
  (ctx): EffectResult => {
    const afterMove = applyInversionMassMove(ctx.state, ctx.triggeringPlayerId);
    const buff: ShadowOnPlaceBuff = {
      kind: 'shadow-on-place',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.infinite-universes-realized',
      label: 'Inversion',
      mode: 'mandatory',
      expiresAt: { kind: 'round-end' },
    };
    return {
      kind: 'done',
      patch: {
        players: afterMove.players,
        rooms: afterMove.rooms,
        activeBuffs: [...afterMove.activeBuffs, buff],
      },
    };
  },
);

// ============================================================================
// The Darkness Within L1 "Malaise" — Until your next turn, Mages cannot be
// placed. Affects every player (caster included). PLACE_WORKER and the grey
// Mysticism post-cast prompt are gated on the global `placements-blocked`
// buff (see helpers.ts + engine.ts).
// ============================================================================

registerEffect(
  'base.spell.the-darkness-within.l1',
  (ctx): EffectResult => {
    const buff: PlacementsBlockedBuff = {
      kind: 'placements-blocked',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.the-darkness-within',
      label: 'Malaise',
      expiresAt: { kind: 'turn-start', playerId: ctx.triggeringPlayerId },
    };
    return {
      kind: 'done',
      patch: {
        activeBuffs: [...ctx.state.activeBuffs, buff],
      },
    };
  },
);
