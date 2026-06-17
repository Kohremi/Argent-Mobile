// Base game effect implementations. Currently scoped to the Vertical Slice
// targets: Library A slot 1, Burn L1, Phase Steppers reaction.

import { getEffect, hasEffect, registerEffect } from './registry';
import { computeFinalScoring, playerOwnsWildSupporter } from '../scoring';
import { getPack } from '../../content/registry';
import { getOrthogonallyAdjacentRoomIds } from '../setup';
import {
  actsAsColor,
  colorAbilityActive,
  buildResolutionChoiceOptions,
  affordableVaultCards,
  ADVENTURING_B_CAP,
  adventuringBPlacementHookPatch,
  adventuringPoolOrEmpty,
  applyAddWisToSpell,
  applyDiscardOwnedSpell,
  applyDraftLegendarySpell,
  applyDraftSpell,
  applyGainMark,
  applyGoldForMageSwap,
  applyInfirmaryBonusFromCtx,
  buildInfirmaryBonusOptions,
  applyMoveWisBetweenSpells,
  applySecretSupporterDraw,
  applySwapOwnedSpellWithTableau,
  applySupporterDraft,
  applyVaultDraft,
  applyVaultPurchase,
  applyVaultPurchaseMaybeWaived,
  banishMage,
  buildArsMagnaTargets,
  buildBanishTargets,
  buildBurnTargets,
  buildHarmfulMageTargets,
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
  canArsMagnaTakeSpace,
  findMageSlotPosition,
  isLegendarySpell,
  isRoomAtPlayerCap,
  isRoomLocked,
  lookupSpellCardDef,
  nextResearchLevel,
  lookupVaultCardDef,
  MAGE_CARD_BY_COLOR,
  magesLosePowers,
  moveMageToSpace,
  placeOfficeMageAsShadow,
  refreshOwnedSpellPatch,
  returnMageToOfficePatch,
  playerHasAuricCatalyst,
  spellLabel,
  technomancyOnPlacePatch,
  unclaimedLegendaryBooks,
  woundMage,
  allocateInfirmaryBed,
} from './helpers';
import type {
  ActionSpaceId,
  ChoiceOption,
  Department,
  EffectContext,
  EffectResult,
  EnergyDrainBuff,
  GameState,
  GameStatePatch,
  HarmfulEffectKind,
  MageColor,
  MageImmunityBuff,
  MagesLosePowersBuff,
  PlacementsBlockedBuff,
  RevivalBuff,
  ShadowOnPlaceBuff,
  SpellsBlockedBuff,
  SpellsCheaperBuff,
  OwnedMage,
  OwnedMageId,
  PendingResolutionInput,
  Player,
  PlayerId,
  ReactionTriggerEvent,
  ResolutionSource,
  ResumeContinuation,
  Room,
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
  // Only spells with an actual next level to unlock — single-level leader /
  // unique spells (no L2/L3) and maxed spells are never advanceable.
  const upgradable = learned.filter(
    (s) => nextResearchLevel(state, s) !== undefined,
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

/**
 * True when the player can legally move a WIS token between two of their own
 * learned Spells — some Spell holds a movable WIS (L2 or L3) and a DIFFERENT
 * learned Spell still has room (not yet at L3). Gates the Research Archive's
 * "move Research" opportunities so an impossible move never surfaces a dead
 * prompt.
 */
function hasLegalWisMove(state: GameState, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  return player.ownedSpells.some(
    (src) =>
      (src.wisPlacedLevel2 || src.wisPlacedLevel3) &&
      player.ownedSpells.some(
        (dst) =>
          dst.cardId !== src.cardId &&
          dst.intPlaced &&
          !(dst.wisPlacedLevel2 && dst.wisPlacedLevel3),
      ),
  );
}

/**
 * Builds a "move Research" prompt — a restricted research menu offering only
 * the move-WIS action plus a "Done" stop. Routes through
 * `base.system.spend-research` so the existing board UI (click a placed W
 * box, then click an empty box on another Spell) drives it. `moveBudget` is
 * the number of moves remaining in this opportunity. Used by the Mancers
 * Research Archive room.
 */
function spawnMoveResearchPrompt(
  state: GameState,
  playerId: string,
  source: ResolutionSource,
  moveBudget: number,
): PendingResolutionInput {
  void state;
  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        {
          id: 'move-wis',
          label: 'Move a WIS token to another Spell',
          payload: {},
        },
        { id: 'discard', label: 'Done moving Research', payload: {} },
      ],
    },
    resume: {
      effectId: 'base.system.spend-research',
      context: { moveOnly: true, moveBudget },
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
    case 'technomancy':
      return 'Technomancy';
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
  // Research Archive "move Research" opportunity: surface a move-only menu,
  // or silently consume the entry when no legal move remains / budget is spent.
  if (ctx.resumeContext?.['moveOnly'] === true) {
    const budget = Number(ctx.resumeContext?.['moveBudget'] ?? 1);
    if (budget <= 0 || !hasLegalWisMove(ctx.state, ctx.triggeringPlayerId)) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: spawnMoveResearchPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
        budget,
      ),
    };
  }
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
      (s) => nextResearchLevel(ctx.state, s) !== undefined && matches(s.cardId),
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
    // Carry the Research Archive move budget into the move chain so the apply
    // step can re-surface the prompt for the next move.
    const moveOnly = ctx.resumeContext?.['moveOnly'] === true;
    const moveBudget = Number(ctx.resumeContext?.['moveBudget'] ?? 1);
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
          context: {
            step: 'pick-dest',
            ...(moveOnly ? { moveOnly: true, moveBudget } : {}),
          },
        },
        source: ctx.source,
      },
    };
  }
  if (optionId === 'swap-spell') {
    // Research Archive B slot 3: swap an owned (non-unique) Spell with one
    // from the Tableau, transferring all its Research. This surfaces the
    // source pick (the player's own Spells); the destination Tableau pick and
    // apply happen in `research-swap-spell`.
    const swapSources = player.ownedSpells.filter(
      (s) => !lookupSpellCardDef(ctx.state, s.cardId)?.unique,
    );
    if (swapSources.length === 0 || ctx.state.spellTableau.length === 0) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: swapSources.map((s) => ({
            id: s.cardId,
            label: `Swap out ${spellLabel(ctx.state, s.cardId)}`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-swap-spell',
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

/**
 * Research Archive B slot 3: swap an owned Spell with one from the Tableau,
 * transferring all of the owned Spell's Research to the new Spell. Two steps:
 * the source (own Spell) arrives as the resume answer with step='pick-dest';
 * the next prompt is the destination Tableau Spell; the final step applies
 * the swap. The owned Spell returns to the Tableau in the drafted slot.
 */
registerEffect('base.system.research-swap-spell', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (step === 'pick-dest') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-swap-spell pick-dest expected option-chosen');
    }
    const sourceCardId = ctx.resumeAnswer.optionId;
    if (ctx.state.spellTableau.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: ctx.state.spellTableau.map((cid) => ({
            id: cid,
            label: `Swap to ${spellLabel(ctx.state, cid)}`,
            payload: {},
          })),
        },
        resume: {
          effectId: 'base.system.research-swap-spell',
          context: { step: 'apply', sourceCardId },
        },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('research-swap-spell apply expected option-chosen');
    }
    const destCardId = ctx.resumeAnswer.optionId;
    const sourceCardId = ctx.resumeContext?.['sourceCardId'];
    if (typeof sourceCardId !== 'string') {
      throw new Error('research-swap-spell apply: missing sourceCardId');
    }
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    // Re-validate against the live state (source still owned & non-unique,
    // dest still in the tableau) before applying.
    if (
      !player ||
      !player.ownedSpells.some((s) => s.cardId === sourceCardId) ||
      lookupSpellCardDef(ctx.state, sourceCardId)?.unique ||
      !ctx.state.spellTableau.includes(destCardId)
    ) {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'done',
      patch: applySwapOwnedSpellWithTableau(
        ctx.state,
        ctx.triggeringPlayerId,
        sourceCardId,
        destCardId,
      ),
    };
  }
  throw new Error(`research-swap-spell unexpected step ${String(step)}`);
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
    const moveOnly = ctx.resumeContext?.['moveOnly'] === true;
    const moveBudget = Number(ctx.resumeContext?.['moveBudget'] ?? 1);
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
          context: {
            step: 'apply',
            sourceCardId,
            ...(moveOnly ? { moveOnly: true, moveBudget } : {}),
          },
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
    const movePatch = applyMoveWisBetweenSpells(
      ctx.state,
      ctx.triggeringPlayerId,
      sourceCardId,
      destCardId,
    );
    // Research Archive: a move-only opportunity loops — after applying, spend
    // one from the budget and re-surface the move menu if any budget and a
    // legal move remain. Otherwise the opportunity ends.
    if (ctx.resumeContext?.['moveOnly'] === true) {
      const next = Number(ctx.resumeContext?.['moveBudget'] ?? 1) - 1;
      const working: GameState = { ...ctx.state, ...movePatch };
      if (next > 0 && hasLegalWisMove(working, ctx.triggeringPlayerId)) {
        return {
          kind: 'pause',
          patch: movePatch,
          pending: spawnMoveResearchPrompt(
            working,
            ctx.triggeringPlayerId,
            ctx.source,
            next,
          ),
        };
      }
    }
    return { kind: 'done', patch: movePatch };
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
      pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId),
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
      pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId),
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
    /** `'consumable'` → discard; `'exhaust'` → mark the Treasure exhausted;
     *  `'none'` → leave the card untouched (Sacred Shield never exhausts). */
    disposal: 'consumable' | 'exhaust' | 'none';
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
    if (p.id === reactorId && disposal !== 'none') {
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
  // The mage may already sit on a slot — repositions that react to a MOVE or
  // SHADOW (e.g. Ancient Armor after Gust of Wind, Phase Steppers, Invisibility
  // Cloak) act on a Mage that's still on the board. Clear that origin slot, or
  // it keeps a stale reference and the Mage ends up "on" two slots with a
  // `location` that disagrees. (Wound / banish reactions repose from the
  // infirmary, so there's no origin slot to clear.)
  const origin = findMageSlotPosition(state, mageId);
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) => {
      let sp = s;
      if (origin && s.id === origin.spaceId) {
        sp =
          origin.position === 'shadow'
            ? { ...sp, shadowOccupant: null }
            : { ...sp, occupant: null };
      }
      if (s.id === destinationSpaceId) {
        sp = asShadow
          ? { ...sp, shadowOccupant: occupancy }
          : { ...sp, occupant: occupancy };
      }
      return sp;
    }),
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
 * Sacred Shield (Mancers synthesis Treasure, reaction — does NOT exhaust) —
 * after one of your Mages is wounded (any source), spend 1 Mana to move it to
 * any open slot. The reactor may play it again for each Mage wounded by the
 * same effect (the option is flagged `repeatable`). Registered here to reuse
 * the shared reposition + slot-pick plumbing.
 */
registerEffect('mancers.vault.sacred-shield.react', (ctx): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Sacred Shield: missing triggerEvent');
  }
  const event = raw as unknown as ReactionTriggerEvent;
  if (event.kind !== 'mage-wounded') {
    throw new Error(`Sacred Shield cannot react to ${event.kind}`);
  }
  if (event.ownerId !== ctx.triggeringPlayerId) {
    throw new Error('Sacred Shield: only protects your own Mage');
  }
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player || player.resources.mana < 1) return { kind: 'done', patch: {} };
  const destinationSpaceId = resolveReactionDestination(
    ctx.state,
    event,
    ctx.resumeContext,
  );
  if (!destinationSpaceId) return { kind: 'done', patch: {} };
  // Pay 1 Mana, then reposition (the card is NOT exhausted: disposal 'none').
  const afterMana: GameState = {
    ...ctx.state,
    ...gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -1),
  };
  return {
    kind: 'done',
    patch: applyReactionReposition(afterMana, {
      mageId: event.mageId,
      ownerId: event.ownerId,
      reactorId: ctx.triggeringPlayerId,
      destinationSpaceId,
      asShadow: false,
      cardId: 'mancers.vault.sacred-shield',
      disposal: 'none',
    }),
  };
});

/**
 * Diviner's Mitre (Mancers Treasure, reaction) — when one of your Mages would
 * be wounded, banished, or moved BY A SPELL, place it in any empty slot (the
 * spell-source gate lives in `buildReactionOptionsFor`). Mirrors Ancient
 * Armor's reposition; the card exhausts on use.
 */
registerEffect('mancers.vault.diviners-mitre.react', (ctx): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error("Diviner's Mitre: missing triggerEvent");
  }
  const event = raw as unknown as ReactionTriggerEvent;
  if (
    event.kind !== 'mage-wounded' &&
    event.kind !== 'mage-banished' &&
    event.kind !== 'mage-moved'
  ) {
    throw new Error(`Diviner's Mitre cannot react to ${event.kind}`);
  }
  if (event.ownerId !== ctx.triggeringPlayerId) {
    throw new Error("Diviner's Mitre: only protects your own Mage");
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
      cardId: 'mancers.vault.diviners-mitre',
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
// Vault B — three slots per the room file (this is the "draft / gain gold"
// face of the room; rulebook Side A is the unwired reveal-3-pick-1 face):
//   Slot 1 (merit, costs 1 MB to place): Draft a Vault Card AND Gain 4 Gold
//   Slot 2 (regular):                    Draft a Vault Card OR Gain 5 Gold
//   Slot 3 (regular):                    Gain 3 Gold
// ============================================================================

/** Vault B slot 1 — merit. Draft + 4 gold. Merit cost paid at placement. */
registerEffect('base.room.vault-b.slot-1', (ctx: EffectContext): EffectResult => {
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
        resume: { effectId: 'base.room.vault-b.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `vault-b.slot-1 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
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
registerEffect('base.room.vault-b.slot-2', (ctx: EffectContext): EffectResult => {
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
        resume: { effectId: 'base.room.vault-b.slot-2', context: { step: 'or' } },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step === 'or') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`vault-b.slot-2 OR expected option-chosen`);
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
            effectId: 'base.room.vault-b.slot-2',
            context: { step: 'pick' },
          },
          source: ctx.source,
        },
      };
    }
    throw new Error(`vault-b.slot-2 unknown option: ${ctx.resumeAnswer.optionId}`);
  }
  if (step === 'pick') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error(`vault-b.slot-2 pick expected card-chosen`);
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
  throw new Error(`vault-b.slot-2 unexpected step: ${String(step)}`);
});

/** Vault B slot 3 — regular. Gain 3 Gold. */
registerEffect('base.room.vault-b.slot-3', (ctx: EffectContext): EffectResult => {
  return {
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 3),
  };
});

// ============================================================================
// Vault A — shared slot effect. First invocation in a resolution pops
// the top 3 of the Vault Deck into `state.vaultARevealed`; subsequent
// invocations draft from the same pool. The resolution pump clears the
// pool and returns leftovers to the top of the deck once it advances
// past Vault A (see `advanceResolutionPointer`).
// ============================================================================

registerEffect('base.room.vault-a.slot', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    // First entry for this slot: ensure the revealed pool is seeded,
    // then prompt the player to pick one of the revealed cards.
    let working = ctx.state;
    if (working.vaultARevealed === null) {
      const popped = working.vaultDeck.slice(0, 3);
      working = {
        ...working,
        vaultARevealed: popped,
        vaultDeck: working.vaultDeck.slice(popped.length),
      };
    }
    const pool = working.vaultARevealed ?? [];
    const seedPatch: GameStatePatch =
      working === ctx.state
        ? {}
        : { vaultARevealed: working.vaultARevealed, vaultDeck: working.vaultDeck };
    if (pool.length === 0) {
      // Deck was empty (or fewer than the previous occupants drafted) —
      // nothing to draft.
      return { kind: 'done', patch: seedPatch };
    }
    return {
      kind: 'pause',
      patch: seedPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...pool],
        },
        resume: { effectId: 'base.room.vault-a.slot', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `vault-a.slot expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const cardId = ctx.resumeAnswer.cardId;
  const pool = ctx.state.vaultARevealed ?? [];
  if (!pool.includes(cardId)) {
    throw new Error(`vault-a.slot: ${cardId} not in revealed pool`);
  }
  const newPool = pool.filter((id) => id !== cardId);
  const players = ctx.state.players.map((p) =>
    p.id !== ctx.triggeringPlayerId
      ? p
      : {
          ...p,
          vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
        },
  );
  return {
    kind: 'done',
    patch: {
      vaultARevealed: newPool,
      players,
    },
  };
});

// ============================================================================
// Adventuring B — on-place "pick a card type, add to room pool" + resolution
// "draft from the room pool". The on-place trigger and prompt builder live in
// `effects/helpers.ts` so the shared placement helpers can bake the prompt
// push directly into their output patch — every placement source picks up
// the trigger automatically. PLACE_WORKER's inlined placement uses an
// equivalent engine-side hook (`adventuringBPlacedHook` in engine.ts).
// ============================================================================

/**
 * Resume handler for the on-place pick prompt. Moves the top of the
 * chosen deck into the room's pool. Silently no-ops on Skip or if the
 * chosen type happens to be capped/empty at apply time.
 */
registerEffect(
  'base.system.adventuring-b.pick-card-type',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `adventuring-b.pick-card-type expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const choice = ctx.resumeAnswer.optionId;
    if (choice === 'skip') return { kind: 'done', patch: {} };
    const pool = adventuringPoolOrEmpty(ctx.state);
    if (choice === 'spell') {
      if (
        ctx.state.spellDeck.length === 0 ||
        pool.spells.length >= ADVENTURING_B_CAP
      ) {
        return { kind: 'done', patch: {} };
      }
      const [drawn, ...rest] = ctx.state.spellDeck;
      if (drawn === undefined) return { kind: 'done', patch: {} };
      return {
        kind: 'done',
        patch: {
          spellDeck: rest,
          adventuringBPool: { ...pool, spells: [...pool.spells, drawn] },
        },
      };
    }
    if (choice === 'vault') {
      if (
        ctx.state.vaultDeck.length === 0 ||
        pool.vaultCards.length >= ADVENTURING_B_CAP
      ) {
        return { kind: 'done', patch: {} };
      }
      const [drawn, ...rest] = ctx.state.vaultDeck;
      if (drawn === undefined) return { kind: 'done', patch: {} };
      return {
        kind: 'done',
        patch: {
          vaultDeck: rest,
          adventuringBPool: {
            ...pool,
            vaultCards: [...pool.vaultCards, drawn],
          },
        },
      };
    }
    if (choice === 'supporter') {
      if (
        ctx.state.supporterDeck.length === 0 ||
        pool.supporters.length >= ADVENTURING_B_CAP
      ) {
        return { kind: 'done', patch: {} };
      }
      const [drawn, ...rest] = ctx.state.supporterDeck;
      if (drawn === undefined) return { kind: 'done', patch: {} };
      return {
        kind: 'done',
        patch: {
          supporterDeck: rest,
          adventuringBPool: {
            ...pool,
            supporters: [...pool.supporters, drawn],
          },
        },
      };
    }
    throw new Error(
      `adventuring-b.pick-card-type unknown option ${choice}`,
    );
  },
);

/**
 * Resolution-time slot effect for Adventuring B: surface a "pick a card
 * from the pool" prompt. The option id encodes `<type>::<cardId>` so
 * the apply step knows which slice to mutate. If the pool is empty,
 * the slot's effect silently completes.
 */
registerEffect(
  'base.room.adventuring-b.draft',
  (ctx: EffectContext): EffectResult => {
    const pool = adventuringPoolOrEmpty(ctx.state);
    if (!ctx.resumeAnswer) {
      // Look up display names from the active packs. Falls back to the
      // raw id if the pack isn't seated or the card isn't found.
      const findVaultName = (cardId: string): string | undefined => {
        for (const pid of ctx.state.activePackIds) {
          const pack = getPack(pid);
          if (!pack) continue;
          const found = pack.vaultCards.find((v) => v.id === cardId);
          if (found) return found.name;
        }
        return undefined;
      };
      const findSupporterName = (cardId: string): string | undefined => {
        for (const pid of ctx.state.activePackIds) {
          const pack = getPack(pid);
          if (!pack) continue;
          const found = pack.supporters.find((s) => s.id === cardId);
          if (found) return found.name;
        }
        return undefined;
      };
      // Drafting a spell from the pool works like a Library draft: the
      // player spends 1 INT to learn the card. Without spare INT the
      // spell entries stay visible but unavailable so the player can see
      // what they're locked out of.
      const drafter = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      const canLearnSpell = (drafter?.resources.intelligence ?? 0) >= 1;
      const options: ChoiceOption[] = [];
      for (const cardId of pool.spells) {
        const def = lookupSpellCardDef(ctx.state, cardId);
        options.push({
          id: `spell::${cardId}`,
          label: `Spell: ${def?.name ?? cardId}`,
          payload: {},
          available: canLearnSpell,
          ...(canLearnSpell
            ? {}
            : {
                unavailableReason: `requires 1 INT to learn (you have ${
                  drafter?.resources.intelligence ?? 0
                })`,
              }),
        });
      }
      for (const cardId of pool.vaultCards) {
        options.push({
          id: `vault::${cardId}`,
          label: `Vault: ${findVaultName(cardId) ?? cardId}`,
          payload: {},
        });
      }
      for (const cardId of pool.supporters) {
        options.push({
          id: `supporter::${cardId}`,
          label: `Supporter: ${findSupporterName(cardId) ?? cardId}`,
          payload: {},
        });
      }
      if (options.length === 0) {
        return { kind: 'done', patch: {} };
      }
      // Always offer a "Pass" so a player whose only available picks
      // are unaffordable (e.g. spells-only pool + no spare INT) can't
      // get bricked into resolving an impossible draft.
      options.push({ id: 'pass', label: 'Pass — forgo this draft', payload: {} });
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-from-options', options },
          resume: {
            effectId: 'base.room.adventuring-b.draft',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `adventuring-b.draft expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    if (ctx.resumeAnswer.optionId === 'pass') {
      return { kind: 'done', patch: {} };
    }
    const sepIdx = ctx.resumeAnswer.optionId.indexOf('::');
    if (sepIdx < 0) {
      throw new Error(
        `adventuring-b.draft malformed optionId ${ctx.resumeAnswer.optionId}`,
      );
    }
    const kind = ctx.resumeAnswer.optionId.slice(0, sepIdx);
    const cardId = ctx.resumeAnswer.optionId.slice(sepIdx + 2);
    if (kind === 'spell') {
      if (!pool.spells.includes(cardId)) {
        throw new Error(`adventuring-b.draft: ${cardId} not in spell pool`);
      }
      // Drafting a spell from the Adventuring pool learns it the same
      // way a Library draft does: spend 1 INT, add to ownedSpells with
      // intPlaced=true. Belt-and-suspenders enforcement matching the
      // prompt-time `available: false` guard above.
      const drafter = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      if (!drafter || drafter.resources.intelligence < 1) {
        throw new Error(
          'adventuring-b.draft: requires 1 INT to learn the spell',
        );
      }
      const players = ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                intelligence: p.resources.intelligence - 1,
              },
              ownedSpells: [
                ...p.ownedSpells,
                {
                  cardId,
                  intPlaced: true,
                  wisPlacedLevel2: false,
                  wisPlacedLevel3: false,
                  exhausted: false,
                },
              ],
            },
      );
      return {
        kind: 'done',
        patch: {
          players,
          adventuringBPool: {
            ...pool,
            spells: pool.spells.filter((id) => id !== cardId),
          },
        },
      };
    }
    if (kind === 'vault') {
      if (!pool.vaultCards.includes(cardId)) {
        throw new Error(`adventuring-b.draft: ${cardId} not in vault pool`);
      }
      const players = ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              vaultCards: [
                ...p.vaultCards,
                { cardId, exhausted: false },
              ],
            },
      );
      return {
        kind: 'done',
        patch: {
          players,
          adventuringBPool: {
            ...pool,
            vaultCards: pool.vaultCards.filter((id) => id !== cardId),
          },
        },
      };
    }
    if (kind === 'supporter') {
      if (!pool.supporters.includes(cardId)) {
        throw new Error(
          `adventuring-b.draft: ${cardId} not in supporter pool`,
        );
      }
      const players = ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, supporters: [...p.supporters, cardId] },
      );
      return {
        kind: 'done',
        patch: {
          players,
          adventuringBPool: {
            ...pool,
            supporters: pool.supporters.filter((id) => id !== cardId),
          },
        },
      };
    }
    throw new Error(`adventuring-b.draft unknown kind ${kind}`);
  },
);

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
// Guilds — Pick gold OR mana per slot. Same OR-prompt shape on both
// sides; the only differences are payout sizes and instant vs non-
// instant resolution timing (encoded on the room itself).
//   Side A (non-instant, bigger): 8/4, 6/3, 4/2
//   Side B (instant, smaller):    6/3, 4/2, 2/1
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
  guildsOrPrompt(ctx, 8, 4, 'base.room.guilds-a.slot-1'),
);
registerEffect('base.room.guilds-a.slot-2', (ctx) =>
  guildsOrPrompt(ctx, 6, 3, 'base.room.guilds-a.slot-2'),
);
registerEffect('base.room.guilds-a.slot-3', (ctx) =>
  guildsOrPrompt(ctx, 4, 2, 'base.room.guilds-a.slot-3'),
);

registerEffect('base.room.guilds-b.slot-1', (ctx) =>
  guildsOrPrompt(ctx, 6, 3, 'base.room.guilds-b.slot-1'),
);
registerEffect('base.room.guilds-b.slot-2', (ctx) =>
  guildsOrPrompt(ctx, 4, 2, 'base.room.guilds-b.slot-2'),
);
registerEffect('base.room.guilds-b.slot-3', (ctx) =>
  guildsOrPrompt(ctx, 2, 1, 'base.room.guilds-b.slot-3'),
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
// Library B — same UC slot count as A but with Research-heavy variants.
// Slot 3's "2 Buys OR 1 Buy + 1 Research" is partially wired: the
// 2-Buys branch isn't sequenced yet, so the slot collapses to the
// simpler "1 Buy + 1 Research" path (same as Side A slot 3).
// ============================================================================

/** Library B slot 1 (merit, 1 MB): Gain 1 Research AND draft a Vault Card. */
registerEffect('base.room.library-b.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    if (ctx.state.vaultTableau.length === 0) {
      // No vault card to draft — just queue the research.
      return {
        kind: 'done',
        patch: appendResearchQueue(
          ctx.state,
          ctx.triggeringPlayerId,
          ctx.source,
          1,
        ),
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
        resume: { effectId: 'base.room.library-b.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `library-b.slot-1 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  let working = ctx.state;
  working = {
    ...working,
    ...applyVaultDraft(working, ctx.triggeringPlayerId, ctx.resumeAnswer.cardId),
  };
  const researchPatch = appendResearchQueue(
    working,
    ctx.triggeringPlayerId,
    ctx.source,
    1,
  );
  return {
    kind: 'done',
    patch: {
      players: working.players,
      vaultTableau: working.vaultTableau,
      ...researchPatch,
    },
  };
});

/** Library B slot 2 (merit, 1 MB): Gain 1 INT + 1 WIS OR gain 3 Research. */
registerEffect('base.room.library-b.slot-2', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'int-wis', label: 'Gain 1 INT and 1 WIS', payload: {} },
            { id: 'research', label: 'Gain 3 Research', payload: {} },
          ],
        },
        resume: { effectId: 'base.room.library-b.slot-2', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `library-b.slot-2 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  if (ctx.resumeAnswer.optionId === 'int-wis') {
    return {
      kind: 'done',
      patch: gainResourcesPatch(ctx.state, ctx.triggeringPlayerId, {
        intelligence: 1,
        wisdom: 1,
      }),
    };
  }
  if (ctx.resumeAnswer.optionId === 'research') {
    return {
      kind: 'done',
      patch: appendResearchQueue(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
        3,
      ),
    };
  }
  throw new Error(
    `library-b.slot-2 unknown option: ${ctx.resumeAnswer.optionId}`,
  );
});

/**
 * Library B slot 3 (regular): "Gain 2 Buys OR gain 1 Buy and 1 Research."
 *
 * Currently wired as "1 Buy + 1 Research" only (delegated to Side A slot
 * 3). The "2 Buys" alternative would need a sequenced double-buy chain;
 * left as TODO so the slot is at least playable.
 */
registerEffect('base.room.library-b.slot-3', (ctx: EffectContext): EffectResult =>
  getEffect('base.room.library-a.slot-3')(ctx),
);

/** Library B slot 4 (regular): Gain 1 INT OR 1 WIS OR 1 Research. */
registerEffect('base.room.library-b.slot-4', (ctx: EffectContext): EffectResult =>
  getEffect('base.room.library-a.slot-4')(ctx),
);

// ============================================================================
// Training Fields B — three slots per the room file.
// ============================================================================

/** Slot 1 (merit, 1 MB): Gain 1 INT OR 1 WIS; gain 2 Research. */
registerEffect(
  'base.room.training-fields-b.slot-1',
  (ctx: EffectContext): EffectResult => {
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
          resume: {
            effectId: 'base.room.training-fields-b.slot-1',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `training-fields-b.slot-1 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const resource =
      ctx.resumeAnswer.optionId === 'int'
        ? 'intelligence'
        : ctx.resumeAnswer.optionId === 'wis'
          ? 'wisdom'
          : null;
    if (resource === null) {
      throw new Error(
        `training-fields-b.slot-1 unknown option: ${ctx.resumeAnswer.optionId}`,
      );
    }
    let working = ctx.state;
    const resourcePatch = gainResourcePatch(
      working,
      ctx.triggeringPlayerId,
      resource,
      1,
    );
    working = { ...working, ...resourcePatch };
    const researchPatch = appendResearchQueue(
      working,
      ctx.triggeringPlayerId,
      ctx.source,
      2,
    );
    return {
      kind: 'done',
      patch: { players: working.players, ...researchPatch },
    };
  },
);

/** Slot 2 (regular): Gain 1 INT OR gain 1 WIS. */
registerEffect(
  'base.room.training-fields-b.slot-2',
  (ctx: EffectContext): EffectResult => {
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
          resume: {
            effectId: 'base.room.training-fields-b.slot-2',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `training-fields-b.slot-2 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const resource =
      ctx.resumeAnswer.optionId === 'int' ? 'intelligence' : 'wisdom';
    return {
      kind: 'done',
      patch: gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        resource,
        1,
      ),
    };
  },
);

/** Slot 3 (regular): Gain 2 Mana OR gain 2 Research. */
registerEffect(
  'base.room.training-fields-b.slot-3',
  (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'mana', label: 'Gain 2 Mana', payload: {} },
              { id: 'research', label: 'Gain 2 Research', payload: {} },
            ],
          },
          resume: {
            effectId: 'base.room.training-fields-b.slot-3',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `training-fields-b.slot-3 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    if (ctx.resumeAnswer.optionId === 'mana') {
      return {
        kind: 'done',
        patch: gainResourcePatch(
          ctx.state,
          ctx.triggeringPlayerId,
          'mana',
          2,
        ),
      };
    }
    return {
      kind: 'done',
      patch: appendResearchQueue(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.source,
        2,
      ),
    };
  },
);

// ============================================================================
// Catacombs B — Gold/IP trade-offs.
// ============================================================================

/** Slot 1 (merit, 1 MB): one-shot Yes/No — Swap 1 IP for 10 Gold. */
registerEffect(
  'base.room.catacombs-b.slot-1',
  (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      const player = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      // Can't afford the swap → no prompt, silent done.
      if (!player || player.resources.influence < 1) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'swap', label: 'Swap 1 IP for 10 Gold', payload: {} },
              { id: 'skip', label: 'Skip', payload: {} },
            ],
          },
          resume: { effectId: 'base.room.catacombs-b.slot-1', context: {} },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `catacombs-b.slot-1 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    if (ctx.resumeAnswer.optionId === 'skip') {
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId !== 'swap') {
      throw new Error(
        `catacombs-b.slot-1 unknown option: ${ctx.resumeAnswer.optionId}`,
      );
    }
    // Apply IP change via the influence-specific helper (handles
    // arrival-sequence + MB bonuses), then layer +10 Gold on top.
    const ipPatch = bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, -1);
    const working: GameState = { ...ctx.state, ...ipPatch };
    const goldPatch = gainResourcePatch(
      working,
      ctx.triggeringPlayerId,
      'gold',
      10,
    );
    return {
      kind: 'done',
      patch: {
        ...ipPatch,
        ...goldPatch,
      },
    };
  },
);

/** Slot 2 (regular): Swap 2 Gold for 1 IP, up to 4 times. */
registerEffect('base.room.catacombs-b.slot-2', (ctx): EffectResult =>
  swapLoop(ctx, 'base.room.catacombs-b.slot-2', {
    label: 'Swap 2 Gold for 1 IP',
    goldCost: 2,
    total: 4,
    immediateGain: (state) =>
      bumpInfluencePatch(state, ctx.triggeringPlayerId, 1),
  }),
);

/** Slot 3 (regular): Swap 1 Gold for 1 IP, up to 3 times. */
registerEffect('base.room.catacombs-b.slot-3', (ctx): EffectResult =>
  swapLoop(ctx, 'base.room.catacombs-b.slot-3', {
    label: 'Swap 1 Gold for 1 IP',
    goldCost: 1,
    total: 3,
    immediateGain: (state) =>
      bumpInfluencePatch(state, ctx.triggeringPlayerId, 1),
  }),
);

// ============================================================================
// Courtyard B — Mana scaling with WIS, with research / half-WIS variants.
// ============================================================================

/** Slot 1 (merit, 1 MB): Gain Mana equal to your WIS, then gain 1 Research. */
registerEffect(
  'base.room.courtyard-b.slot-1',
  (ctx: EffectContext): EffectResult => {
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    if (!player) throw new Error('courtyard-b.slot-1: player not found');
    let working = ctx.state;
    if (player.resources.wisdom > 0) {
      working = {
        ...working,
        ...gainResourcePatch(
          working,
          ctx.triggeringPlayerId,
          'mana',
          player.resources.wisdom,
        ),
      };
    }
    const researchPatch = appendResearchQueue(
      working,
      ctx.triggeringPlayerId,
      ctx.source,
      1,
    );
    return {
      kind: 'done',
      patch: { players: working.players, ...researchPatch },
    };
  },
);

/** Slot 2 (regular): Gain Mana equal to your WIS. */
registerEffect('base.room.courtyard-b.slot-2', (ctx) => {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player) throw new Error('courtyard-b.slot-2: player not found');
  if (player.resources.wisdom <= 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'mana',
      player.resources.wisdom,
    ),
  };
});

/** Slot 3 (regular): Gain Mana equal to half your WIS, rounded up. */
registerEffect('base.room.courtyard-b.slot-3', (ctx) => {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player) throw new Error('courtyard-b.slot-3: player not found');
  const amount = Math.ceil(player.resources.wisdom / 2);
  if (amount <= 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: gainResourcePatch(
      ctx.state,
      ctx.triggeringPlayerId,
      'mana',
      amount,
    ),
  };
});

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

function readTriggerEvent(ctx: EffectContext): ReactionTriggerEvent | null {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as unknown as ReactionTriggerEvent;
}

/** Casts a trigger event to a SerializableContext for storage in resume context. */
function triggerEventToContext(event: ReactionTriggerEvent): SerializableContext {
  return event as unknown as SerializableContext;
}

/**
 * Builds the Infirmary wound-arrival bonus prompt. The option set is
 * computed from `state` via `buildInfirmaryBonusOptions` so Infirmary
 * Side B's buffed slots (4 Gold / 2 Mana) get offered when their slot
 * is empty. The wounded mage's id is threaded into the resume context
 * so the apply step can record slot occupancy when a buffed option
 * fires.
 */
function bonusPromptFor(
  state: GameState,
  event: ReactionTriggerEvent,
  casterId: PlayerId,
  customResume?: ResumeContinuation,
): PendingResolutionInput {
  if (event.kind !== 'mage-wounded') {
    throw new Error('bonusPromptFor: only mage-wounded events trigger the bonus');
  }
  const baseContext: SerializableContext = {
    recipientPlayerId: event.ownerId,
    woundedMageId: event.mageId,
  };
  // Auto-inject the wounded mage's id into the resume context (custom
  // or default) so the apply step can mark the buffed Infirmary B slot
  // occupant when the buffed branch fires. Caller-supplied context keys
  // win on collision.
  const resume: ResumeContinuation = customResume
    ? {
        ...customResume,
        context: { ...baseContext, ...(customResume.context ?? {}) },
      }
    : {
        effectId: 'base.system.infirmary-bonus',
        context: baseContext,
      };
  return {
    responderId: event.ownerId,
    prompt: {
      kind: 'choose-from-options',
      options: buildInfirmaryBonusOptions(state),
    },
    resume,
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
  const goldCostRaw = ctx.resumeContext?.['goldCost'];
  if (
    typeof innerEffectIdRaw !== 'string' ||
    typeof meritCostRaw !== 'number'
  ) {
    throw new Error('resolution-choice: missing context fields');
  }
  const goldCost = typeof goldCostRaw === 'number' ? goldCostRaw : 0;
  const playerId = ctx.triggeringPlayerId;

  if (optionId === 'forfeit') {
    return {
      kind: 'done',
      patch: bumpInfluencePatch(ctx.state, playerId, 1),
    };
  }
  // `reward` pays the slot's Merit cost (if any) with Merit Badges; `reward-gold`
  // is Divinity Side B — pay 4 Gold to activate the Merit Slot instead. Both run
  // the slot's real effect afterward; only the resource paid differs.
  const payWithGold = optionId === 'reward-gold';
  if (optionId !== 'reward' && !payWithGold) {
    throw new Error(`resolution-choice: unknown optionId ${optionId}`);
  }

  // Deduct the slot's cost up front, then run the slot's effect against the
  // post-deduction state so the inner effect's player-patch already reflects
  // the spend.
  let working: GameState = ctx.state;
  const meritToSpend = payWithGold ? 0 : meritCostRaw;
  const goldToSpend = payWithGold ? goldCost : 0;
  if (meritToSpend > 0 || goldToSpend > 0) {
    const player = working.players.find((p) => p.id === playerId);
    if (!player) throw new Error('resolution-choice: player not found');
    if (player.resources.meritBadges < meritToSpend) {
      // Should never happen — the prompt's "reward" option is unavailable in
      // this case. Belt-and-suspenders.
      throw new Error(
        'resolution-choice: cannot take reward without sufficient Merit Badges',
      );
    }
    if (player.resources.gold < goldToSpend) {
      throw new Error(
        'resolution-choice: cannot take reward without sufficient Gold',
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
                meritBadges: p.resources.meritBadges - meritToSpend,
                meritBadgesSpent: p.resources.meritBadgesSpent + meritToSpend,
                gold: p.resources.gold - goldToSpend,
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
  const costPatch: GameStatePatch =
    meritToSpend > 0 || goldToSpend > 0 ? { players: working.players } : {};
  const innerPatch = innerResult.patch ?? {};
  const combined: GameStatePatch = { ...costPatch, ...innerPatch };

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
  const recipientId = ctx.resumeContext?.['recipientPlayerId'];
  if (typeof recipientId !== 'string') {
    throw new Error('infirmary-bonus: missing recipientPlayerId');
  }
  return {
    kind: 'done',
    patch: applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
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
// Council Chamber B — pick N of {Draft a Supporter, Gain 1 IP, Gain a Mark}.
//
// One shared chain handler powers all five slots; the slot's effectId
// encodes its N (1 / 2 / 3). Each pick is applied as it's chosen, then
// the chain loops back to ask for the next pick out of the remaining
// options. Sub-actions that would fizzle (empty supporter tableau / no
// eligible voters) silently count as completed so the chain doesn't
// stall.
// ============================================================================

const COUNCIL_B_OPTION_IDS = ['draft', 'ip', 'mark'] as const;
type CouncilBOptionId = (typeof COUNCIL_B_OPTION_IDS)[number];

function councilChamberBLabel(o: CouncilBOptionId): string {
  switch (o) {
    case 'draft':
      return 'Draft a Supporter';
    case 'ip':
      return 'Gain 1 IP';
    case 'mark':
      return 'Gain a Mark';
  }
}

function councilChamberBLoop(
  ctx: EffectContext,
  selfEffectId: string,
  totalPicks: number,
  picked: CouncilBOptionId[],
  working: GameState,
): EffectResult {
  if (picked.length >= totalPicks) {
    return { kind: 'done', patch: councilBDiff(working) };
  }
  const remaining = COUNCIL_B_OPTION_IDS.filter((o) => !picked.includes(o));
  if (remaining.length === 0) {
    return { kind: 'done', patch: councilBDiff(working) };
  }
  if (remaining.length === 1) {
    // Auto-execute the forced final pick — no point asking the player.
    return councilChamberBExecute(
      ctx,
      selfEffectId,
      totalPicks,
      picked,
      working,
      remaining[0]!,
    );
  }
  return {
    kind: 'pause',
    patch: councilBDiff(working),
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: remaining.map((o) => ({
          id: o,
          label: councilChamberBLabel(o),
          payload: {},
        })),
      },
      resume: {
        effectId: selfEffectId,
        context: { step: 'after-or-pick', picked, totalPicks },
      },
      source: ctx.source,
    },
  };
}

/**
 * Field-by-field patch of every GameState slice the chain might have
 * touched (supporter draft + IP bump + Mark all go through different
 * fields). Cheaper than spreading the full state.
 */
function councilBDiff(working: GameState): GameStatePatch {
  return {
    players: working.players,
    supporterTableau: working.supporterTableau,
    voterMarks: working.voterMarks,
    nextSequenceId: working.nextSequenceId,
  };
}

function councilChamberBExecute(
  ctx: EffectContext,
  selfEffectId: string,
  totalPicks: number,
  picked: CouncilBOptionId[],
  working: GameState,
  choice: CouncilBOptionId,
): EffectResult {
  if (choice === 'ip') {
    const patch = bumpInfluencePatch(working, ctx.triggeringPlayerId, 1);
    const next: GameState = { ...working, ...patch };
    return councilChamberBLoop(
      ctx,
      selfEffectId,
      totalPicks,
      [...picked, 'ip'],
      next,
    );
  }
  if (choice === 'draft') {
    // Empty tableau → silent fizzle; chain continues with this pick counted.
    if (working.supporterTableau.length === 0) {
      return councilChamberBLoop(
        ctx,
        selfEffectId,
        totalPicks,
        [...picked, 'draft'],
        working,
      );
    }
    return {
      kind: 'pause',
      patch: councilBDiff(working),
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-supporter-card',
          eligibleCardIds: [...working.supporterTableau],
        },
        resume: {
          effectId: selfEffectId,
          context: { step: 'after-supporter-pick', picked, totalPicks },
        },
        source: ctx.source,
      },
    };
  }
  // choice === 'mark'
  const markPromptInput = spawnGainMarkPrompt(
    working,
    ctx.triggeringPlayerId,
    ctx.source,
  );
  if (markPromptInput === null) {
    // No eligible voters → fizzle; chain continues with this pick counted.
    return councilChamberBLoop(
      ctx,
      selfEffectId,
      totalPicks,
      [...picked, 'mark'],
      working,
    );
  }
  return {
    kind: 'pause',
    patch: councilBDiff(working),
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: markPromptInput.prompt,
      resume: {
        effectId: selfEffectId,
        context: { step: 'after-mark-pick', picked, totalPicks },
      },
      source: ctx.source,
    },
  };
}

function councilChamberBChain(
  ctx: EffectContext,
  selfEffectId: string,
  totalPicks: number,
): EffectResult {
  const step = ctx.resumeContext?.['step'];
  const pickedRaw = ctx.resumeContext?.['picked'];
  const picked: CouncilBOptionId[] = Array.isArray(pickedRaw)
    ? pickedRaw.filter((x): x is CouncilBOptionId =>
        typeof x === 'string' &&
        (COUNCIL_B_OPTION_IDS as readonly string[]).includes(x),
      )
    : [];

  // Resume from a sub-prompt: apply the answered sub-action, then loop.
  if (step === 'after-supporter-pick') {
    if (ctx.resumeAnswer?.kind !== 'card-chosen') {
      throw new Error(
        `${selfEffectId} after-supporter-pick expected card-chosen`,
      );
    }
    const patch = applySupporterDraft(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.cardId,
    );
    const working: GameState = { ...ctx.state, ...patch };
    return councilChamberBLoop(
      ctx,
      selfEffectId,
      totalPicks,
      [...picked, 'draft'],
      working,
    );
  }
  if (step === 'after-mark-pick') {
    if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
      throw new Error(`${selfEffectId} after-mark-pick expected voter-chosen`);
    }
    const patch = applyGainMark(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.voterId,
    );
    const working: GameState = { ...ctx.state, ...patch };
    return councilChamberBLoop(
      ctx,
      selfEffectId,
      totalPicks,
      [...picked, 'mark'],
      working,
    );
  }
  if (step === 'after-or-pick') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${selfEffectId} after-or-pick expected option-chosen`);
    }
    const choice = ctx.resumeAnswer.optionId;
    if (!(COUNCIL_B_OPTION_IDS as readonly string[]).includes(choice)) {
      throw new Error(`${selfEffectId}: unknown choice ${choice}`);
    }
    return councilChamberBExecute(
      ctx,
      selfEffectId,
      totalPicks,
      picked,
      ctx.state,
      choice as CouncilBOptionId,
    );
  }

  // First entry — start the chain.
  return councilChamberBLoop(ctx, selfEffectId, totalPicks, picked, ctx.state);
}

registerEffect('base.room.council-chamber-b.do-1', (ctx) =>
  councilChamberBChain(ctx, 'base.room.council-chamber-b.do-1', 1),
);
registerEffect('base.room.council-chamber-b.do-2', (ctx) =>
  councilChamberBChain(ctx, 'base.room.council-chamber-b.do-2', 2),
);
registerEffect('base.room.council-chamber-b.do-3', (ctx) =>
  councilChamberBChain(ctx, 'base.room.council-chamber-b.do-3', 3),
);

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
// Adventuring A — Side A of the Adventuring room.
//   Slot 1 (merit, 1 MB):  Gain a Secret Supporter AND Gain 3 Gold
//   Slot 2 (regular):      Draw a Vault Card OR Gain 2 IP OR Gain 1 INT
//   Slot 3 (regular):      Draw a Spell Card OR Gain 2 IP OR Gain 1 WIS
//
// Both regular slots are simple `choose-from-options` prompts. A drawn
// Spell goes into the spellbook UNLEARNED (intPlaced=false) — the player
// pays INT later if they want to actually use it.
// ============================================================================

registerEffect(
  'base.room.adventuring-a.slot-1',
  (ctx: EffectContext): EffectResult => {
    const drawPatch = applySecretSupporterDraw(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    // Compose: draft updates `players` (personalDiscard) and may update
    // `supporterDeck`. Gold then re-derives `players` from the post-draft
    // state so both updates land.
    const afterDraw: GameState = { ...ctx.state, ...drawPatch };
    const goldPatch = gainResourcePatch(
      afterDraw,
      ctx.triggeringPlayerId,
      'gold',
      3,
    );
    return {
      kind: 'done',
      patch: { ...drawPatch, ...goldPatch },
    };
  },
);

registerEffect(
  'base.room.adventuring-a.slot-2',
  (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'vault', label: 'Draw a Vault Card', payload: {} },
              { id: 'ip', label: 'Gain 2 IP', payload: {} },
              { id: 'int', label: 'Gain 1 INT', payload: {} },
            ],
          },
          resume: {
            effectId: 'base.room.adventuring-a.slot-2',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `adventuring-a.slot-2 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const optionId = ctx.resumeAnswer.optionId;
    if (optionId === 'vault') {
      return {
        kind: 'done',
        patch: drawTopOfVaultDeck(ctx.state, ctx.triggeringPlayerId, 1),
      };
    }
    if (optionId === 'ip') {
      return {
        kind: 'done',
        patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
      };
    }
    if (optionId === 'int') {
      return {
        kind: 'done',
        patch: gainResourcePatch(
          ctx.state,
          ctx.triggeringPlayerId,
          'intelligence',
          1,
        ),
      };
    }
    throw new Error(`adventuring-a.slot-2: unknown option ${optionId}`);
  },
);

registerEffect(
  'base.room.adventuring-a.slot-3',
  (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      // Drawing a spell costs 1 INT (same as a Library / Adventuring B
      // draft) — the spell is learned on the spot. Without spare INT the
      // option stays visible but unavailable so the player can see what
      // they're locked out of.
      const drafter = ctx.state.players.find(
        (p) => p.id === ctx.triggeringPlayerId,
      );
      const canLearnSpell = (drafter?.resources.intelligence ?? 0) >= 1;
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              {
                id: 'spell',
                label: 'Draw a Spell Card',
                payload: {},
                available: canLearnSpell,
                ...(canLearnSpell
                  ? {}
                  : {
                      unavailableReason: `requires 1 INT to learn (you have ${
                        drafter?.resources.intelligence ?? 0
                      })`,
                    }),
              },
              { id: 'ip', label: 'Gain 2 IP', payload: {} },
              { id: 'wis', label: 'Gain 1 WIS', payload: {} },
            ],
          },
          resume: {
            effectId: 'base.room.adventuring-a.slot-3',
            context: {},
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `adventuring-a.slot-3 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const optionId = ctx.resumeAnswer.optionId;
    if (optionId === 'spell') {
      // `drawAndLearnTopOfSpellDeck` throws if INT < 1 — belt-and-
      // suspenders match for the prompt-time `available: false` guard.
      return {
        kind: 'done',
        patch: drawAndLearnTopOfSpellDeck(
          ctx.state,
          ctx.triggeringPlayerId,
        ),
      };
    }
    if (optionId === 'ip') {
      return {
        kind: 'done',
        patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
      };
    }
    if (optionId === 'wis') {
      return {
        kind: 'done',
        patch: gainResourcePatch(
          ctx.state,
          ctx.triggeringPlayerId,
          'wisdom',
          1,
        ),
      };
    }
    throw new Error(`adventuring-a.slot-3: unknown option ${optionId}`);
  },
);

// ============================================================================
// Chapel — both sides. Every slot grants a Mark on top of its primary
// reward (Side A is non-instant, Side B fires at placement). The shared
// `applyPatchThenMarkPrompt` helper applies the primary patch and hands
// off to `base.system.gain-mark` via `spawnGainMarkPrompt`. The slot
// effect never resumes itself for single-mark slots — the mark chain
// owns its own continuation. Side B slot 1's 2-mark chain is the one
// exception; it self-resumes via `chapelBMarkChain` further down.
//
// Side A:
//   Slot 1 (merit, 1 MB): Gain 1 INT + 1 WIS, then gain a Mark
//   Slot 2 (regular):     Gain 2 IP, then gain a Mark
//   Slot 3 (regular):     Gain 2 Gold OR Gain 2 Mana, then gain a Mark
// ============================================================================

function applyPatchThenMarkPrompt(
  ctx: EffectContext,
  primaryPatch: GameStatePatch,
): EffectResult {
  const afterPrimary: GameState = { ...ctx.state, ...primaryPatch };
  const markPrompt = spawnGainMarkPrompt(
    afterPrimary,
    ctx.triggeringPlayerId,
    ctx.source,
  );
  if (markPrompt === null) {
    // No eligible voter — apply the primary reward and stop.
    return { kind: 'done', patch: primaryPatch };
  }
  return { kind: 'pause', patch: primaryPatch, pending: markPrompt };
}

/** Slot 1 (merit, 1 MB): Gain 1 INT AND Gain 1 WIS, then gain a Mark. */
registerEffect(
  'base.room.chapel-a.slot-1',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer) {
      throw new Error(
        'chapel-a.slot-1 should not be re-invoked (mark handles its own resume)',
      );
    }
    return applyPatchThenMarkPrompt(
      ctx,
      gainResourcesPatch(ctx.state, ctx.triggeringPlayerId, {
        intelligence: 1,
        wisdom: 1,
      }),
    );
  },
);

/** Slot 2 (regular): Gain 2 IP, then gain a Mark. */
registerEffect(
  'base.room.chapel-a.slot-2',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer) {
      throw new Error(
        'chapel-a.slot-2 should not be re-invoked (mark handles its own resume)',
      );
    }
    return applyPatchThenMarkPrompt(
      ctx,
      bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
    );
  },
);

/**
 * Slot 3 (regular): Gain 2 Gold OR Gain 2 Mana, then gain a Mark.
 *
 * Two-step: open the gold/mana OR prompt; on the chosen-option resume,
 * apply the picked resource and hand off to the mark chain.
 */
registerEffect(
  'base.room.chapel-a.slot-3',
  (ctx: EffectContext): EffectResult => {
    if (!ctx.resumeAnswer) {
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'gold', label: 'Gain 2 Gold', payload: {} },
              { id: 'mana', label: 'Gain 2 Mana', payload: {} },
            ],
          },
          resume: {
            effectId: 'base.room.chapel-a.slot-3',
            context: { step: 'after-pick' },
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `chapel-a.slot-3 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const optionId = ctx.resumeAnswer.optionId;
    if (optionId !== 'gold' && optionId !== 'mana') {
      throw new Error(`chapel-a.slot-3: unknown option ${optionId}`);
    }
    const kind = optionId === 'gold' ? 'gold' : 'mana';
    return applyPatchThenMarkPrompt(
      ctx,
      gainResourcePatch(ctx.state, ctx.triggeringPlayerId, kind, 2),
    );
  },
);

// ============================================================================
// Chapel B — INSTANT room. Slot effects resolve at placement.
//   Slot 1 (merit, 1 MB): Immediately gain 2 Marks
//   Slot 2 (regular):     Immediately gain 1 IP AND gain a Mark
//   Slot 3 (regular):     Immediately gain a Mark
//
// Slot 1 chains two voter prompts: it pauses with `remaining` in
// resumeContext, applies the picked mark, and either re-pauses for the
// second mark or returns done. Slots 2 and 3 reuse the Catacombs A
// pattern (one prompt; the standard `base.system.gain-mark` resume
// handles the apply step).
// ============================================================================

/**
 * Chains `total` mark prompts. First entry seeds the chain; the
 * self-resume context carries `remaining = total - already-applied`.
 * `carryPatch` is the cumulative mark-application diff so far.
 * Fizzles silently if no voter is eligible (mirrors single-mark fizzle).
 */
function chapelBMarkChain(
  ctx: EffectContext,
  selfEffectId: string,
  total: number,
  carryPatch: GameStatePatch = {},
): EffectResult {
  const eligible = eligibleVotersForMark(ctx.state, ctx.triggeringPlayerId);
  if (eligible.length === 0) {
    return { kind: 'done', patch: carryPatch };
  }
  const remaining = total - 1;
  return {
    kind: 'pause',
    patch: carryPatch,
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-voter',
        eligibleVoterIds: eligible.map((v) => v.id),
      },
      resume: {
        effectId: selfEffectId,
        context: { step: 'after-mark', remaining },
      },
      source: ctx.source,
    },
  };
}

/** Slot 1 (merit, 1 MB): Immediately gain 2 Marks. */
registerEffect(
  'base.room.chapel-b.slot-1',
  (ctx: EffectContext): EffectResult => {
    const step = ctx.resumeContext?.['step'];
    const selfEffectId = 'base.room.chapel-b.slot-1';

    // First entry — start the 2-mark chain.
    if (step === undefined) {
      return chapelBMarkChain(ctx, selfEffectId, 2);
    }

    if (step === 'after-mark') {
      if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
        throw new Error(
          `${selfEffectId} after-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
        );
      }
      const patch = applyGainMark(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.voterId,
      );
      const working: GameState = { ...ctx.state, ...patch };
      const remaining = Number(ctx.resumeContext?.['remaining'] ?? 0);
      if (remaining <= 0) {
        return { kind: 'done', patch };
      }
      // Recurse via the helper to spawn the next prompt against the
      // post-apply state, carrying the cumulative players/voterMarks
      // patch forward so it isn't dropped at the next pause.
      return chapelBMarkChain(
        { ...ctx, state: working },
        selfEffectId,
        1,
        {
          players: working.players,
          voterMarks: working.voterMarks,
        },
      );
    }

    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  },
);

/** Slot 2 (regular): Immediately gain 1 IP AND gain a Mark. */
registerEffect(
  'base.room.chapel-b.slot-2',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer) {
      throw new Error(
        'chapel-b.slot-2 should not be re-invoked (mark handles its own resume)',
      );
    }
    return applyPatchThenMarkPrompt(
      ctx,
      bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 1),
    );
  },
);

/** Slot 3 (regular): Immediately gain a Mark. */
registerEffect(
  'base.room.chapel-b.slot-3',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer) {
      throw new Error(
        'chapel-b.slot-3 should not be re-invoked (mark handles its own resume)',
      );
    }
    return applyPatchThenMarkPrompt(ctx, {});
  },
);

// ============================================================================
// Dormitory — both sides. Pick a Mage colour from the supply and gain a
// mage of that colour. 2-per-colour cap on owned mages (neutral is
// uncapped per user spec). Each slot has its own primary cost:
//   A.slot-1 (merit, 1 MB): 2 Gold
//   A.slot-2 (regular):     6 Gold
//   B.slot-1 (merit, 1 MB): free
//   B.slot-2 (regular):     2 IP
//
// All four share `dormitoryGainMage`. The slot fizzles silently if
// the player can't afford the primary cost OR no colour is selectable
// (every colour is either at the 2-cap or out of supply).
// ============================================================================

type DormitoryCost =
  | { kind: 'gold'; amount: number }
  | { kind: 'ip'; amount: number }
  | null;

const DORMITORY_COLOR_OPTIONS: {
  color: MageColor;
  label: string;
  /** Only offered when this pack is in `state.activePackIds`. */
  requiresPackId?: string;
}[] = [
  { color: 'red', label: 'Sorcery (red)' },
  { color: 'blue', label: 'Divinity (blue)' },
  { color: 'grey', label: 'Mysticism (grey)' },
  { color: 'green', label: 'Natural Magick (green)' },
  { color: 'purple', label: 'Planar Studies (purple)' },
  {
    color: 'orange',
    label: 'Technomancy (orange)',
    requiresPackId: 'mancers',
  },
  { color: 'off-white', label: 'Neutral (off-white) — uncapped' },
];

/**
 * Per-colour availability for the Dormitory prompt. Available iff the
 * supply pool isn't empty AND (the colour is neutral OR the player has
 * fewer than 2 of that colour). Neutral mages are explicitly uncapped.
 */
function dormitoryColorAvailable(
  state: GameState,
  player: Player,
  color: MageColor,
): { available: boolean; reasons: string[] } {
  const poolCount = state.mageDraftPool[color] ?? 0;
  const ownedCount = player.mages.filter((m) => m.color === color).length;
  const poolEmpty = poolCount === 0;
  const capReached = color !== 'off-white' && ownedCount >= 2;
  const reasons: string[] = [];
  if (poolEmpty) reasons.push('supply empty');
  if (capReached) reasons.push('already have 2');
  return { available: !poolEmpty && !capReached, reasons };
}

function dormitoryGainMage(
  ctx: EffectContext,
  selfEffectId: string,
  cost: DormitoryCost,
): EffectResult {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player) return { kind: 'done', patch: {} };

  // First entry — open the colour picker.
  if (!ctx.resumeAnswer) {
    // Affordability check up front; if the player can't pay the slot's
    // primary cost, fizzle silently.
    if (cost?.kind === 'gold' && player.resources.gold < cost.amount) {
      return { kind: 'done', patch: {} };
    }
    if (cost?.kind === 'ip' && player.resources.influence < cost.amount) {
      return { kind: 'done', patch: {} };
    }
    // Skip colour rows whose backing pack isn't seated (e.g. Technomancy
    // when Mancers isn't active) — the option doesn't belong in this game
    // at all, distinct from "supply empty within this game".
    const offered = DORMITORY_COLOR_OPTIONS.filter(
      ({ requiresPackId }) =>
        requiresPackId === undefined ||
        ctx.state.activePackIds.includes(requiresPackId),
    );
    const options: ChoiceOption[] = offered.map(({ color, label }) => {
      const { available, reasons } = dormitoryColorAvailable(
        ctx.state,
        player,
        color,
      );
      return {
        id: color,
        label,
        payload: {},
        available,
        ...(available ? {} : { unavailableReason: reasons.join(' + ') }),
      };
    });
    // If every colour is locked, fizzle rather than show a useless prompt.
    if (!options.some((o) => o.available)) {
      return { kind: 'done', patch: {} };
    }
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

  // Resume — apply the chosen colour.
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `${selfEffectId} expected option-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const color = ctx.resumeAnswer.optionId as MageColor;
  if (!(color in MAGE_CARD_BY_COLOR)) {
    throw new Error(`${selfEffectId}: unknown colour ${color}`);
  }
  // Belt-and-suspenders: re-check availability and affordability. State
  // may have shifted between prompt and resume (other reactions, etc.).
  const { available } = dormitoryColorAvailable(ctx.state, player, color);
  if (!available) return { kind: 'done', patch: {} };
  if (cost?.kind === 'gold' && player.resources.gold < cost.amount) {
    return { kind: 'done', patch: {} };
  }
  if (cost?.kind === 'ip' && player.resources.influence < cost.amount) {
    return { kind: 'done', patch: {} };
  }

  // Apply the primary cost first against the original state, then layer
  // the mage-add patch on top of the post-cost state so both updates
  // land in `players` cleanly.
  let working: GameState = ctx.state;
  if (cost?.kind === 'gold') {
    const goldPatch = gainResourcePatch(
      working,
      ctx.triggeringPlayerId,
      'gold',
      -cost.amount,
    );
    working = { ...working, ...goldPatch };
  } else if (cost?.kind === 'ip') {
    const ipPatch = bumpInfluencePatch(
      working,
      ctx.triggeringPlayerId,
      -cost.amount,
    );
    working = { ...working, ...ipPatch };
  }

  const seq = working.nextSequenceId;
  const poolCount = working.mageDraftPool[color] ?? 0;
  return {
    kind: 'done',
    patch: {
      nextSequenceId: seq + 1,
      mageDraftPool: { ...working.mageDraftPool, [color]: poolCount - 1 },
      players: working.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              mages: [
                ...p.mages,
                {
                  id: `m-${seq}`,
                  cardId: MAGE_CARD_BY_COLOR[color],
                  color,
                  location: {
                    kind: 'office' as const,
                    playerId: ctx.triggeringPlayerId,
                  },
                  isShadowing: false,
                  isWounded: false,
                },
              ],
            },
      ),
    },
  };
}

registerEffect(
  'base.room.dormitory-a.slot-1',
  (ctx: EffectContext): EffectResult =>
    dormitoryGainMage(ctx, 'base.room.dormitory-a.slot-1', {
      kind: 'gold',
      amount: 2,
    }),
);

registerEffect(
  'base.room.dormitory-a.slot-2',
  (ctx: EffectContext): EffectResult =>
    dormitoryGainMage(ctx, 'base.room.dormitory-a.slot-2', {
      kind: 'gold',
      amount: 6,
    }),
);

registerEffect(
  'base.room.dormitory-b.slot-1',
  (ctx: EffectContext): EffectResult =>
    dormitoryGainMage(ctx, 'base.room.dormitory-b.slot-1', null),
);

registerEffect(
  'base.room.dormitory-b.slot-2',
  (ctx: EffectContext): EffectResult =>
    dormitoryGainMage(ctx, 'base.room.dormitory-b.slot-2', {
      kind: 'ip',
      amount: 2,
    }),
);

// ============================================================================
// Student Stores — both sides grant N Buys via a chain prompt. Each Buy is
// one of:
//   Side A: Vault Card | 1 INT (4g) | 1 WIS (4g) | 1 Research (4g) | Skip
//   Side B: Vault Card | (once) Pay 1g to re-deal Vault Tableau | Skip
// Side B slot 1 grants 2 Gold off every Vault Buy (discount). The re-deal
// option is "once per slot resolution" — tracked via `redealUsed` in the
// resume context.
//
// Research buys append to `researchQueue`; the engine drains the queue
// after the chain finishes, so the research prompt opens after all
// remaining buys.
// ============================================================================

type StudentStoresOpts = {
  side: 'A' | 'B';
  discount: number;
  initialBuys: number;
};

/**
 * Affordable vault cards given a `discount` off the printed cost. Cards
 * are affordable when `goldCost - discount <= player.gold`. Catalyst
 * waives the cost entirely (every card affordable).
 */
function affordableVaultCardsDiscounted(
  state: GameState,
  playerId: PlayerId,
  discount: number,
): string[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  // Affordability must match what the Student Stores buy path can ACTUALLY
  // pay (`applyVaultPurchaseDiscounted`): the gold cost net of the discount,
  // waived only when `nextGoldCostWaived` is already set. Merely OWNING Auric
  // Catalyst doesn't help here — that reaction is never offered on this path
  // (it opens no gold-payment window), so counting it as "affordable" would
  // surface a buy the player can't complete and the purchase would throw.
  const waived = player.nextGoldCostWaived === true;
  const out: string[] = [];
  for (const cardId of state.vaultTableau) {
    const def = lookupVaultCardDef(state, cardId);
    if (!def) continue;
    if (waived) {
      out.push(cardId);
      continue;
    }
    const netCost = Math.max(0, def.goldCost - discount);
    if (netCost <= player.resources.gold) out.push(cardId);
  }
  return out;
}

/**
 * Apply a vault purchase with a per-buy `discount`. If the buyer has a
 * waived gold cost (Auric Catalyst), discount is irrelevant — defer to
 * the standard maybe-waived helper. Otherwise pre-credit the discount
 * before the standard purchase, so the net deduction is goldCost -
 * discount.
 */
function applyVaultPurchaseDiscounted(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  discount: number,
): GameStatePatch {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error('applyVaultPurchaseDiscounted: player not found');
  if (player.nextGoldCostWaived || discount <= 0) {
    return applyVaultPurchaseMaybeWaived(state, playerId, cardId);
  }
  // Pre-credit the discount so applyVaultPurchase's full goldCost deduction
  // nets to (goldCost - discount).
  const creditPatch = gainResourcePatch(state, playerId, 'gold', discount);
  const working: GameState = { ...state, ...creditPatch };
  return applyVaultPurchase(working, playerId, cardId);
}

/**
 * Moves the entire current Vault Tableau to the bottom of the Vault Deck
 * and draws the top 3 (or fewer if the deck has been exhausted) back into
 * the tableau. Used by Student Stores Side B's "pay 1 Gold to re-deal"
 * option.
 */
function redealVaultTableau(state: GameState): GameStatePatch {
  const tableauSize = state.vaultTableau.length;
  if (tableauSize === 0) return {};
  const combined = [...state.vaultDeck, ...state.vaultTableau];
  return {
    vaultTableau: combined.slice(0, tableauSize),
    vaultDeck: combined.slice(tableauSize),
  };
}

/**
 * Builds the per-Buy option prompt. Vault is always offered (greyed when
 * unaffordable). Side A adds the 4-Gold INT/WIS/Research options. Side B
 * adds the once-per-resolution re-deal option (omitted entirely once
 * used). Skip is always available so the player can decline a Buy.
 */
function studentStoresOpenBuy(
  state: GameState,
  ctx: EffectContext,
  selfEffectId: string,
  opts: StudentStoresOpts,
  remaining: number,
  redealUsed: boolean,
  carryPatch: GameStatePatch,
): EffectResult {
  if (remaining <= 0) {
    return { kind: 'done', patch: carryPatch };
  }
  const player = state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: carryPatch };

  const options: ChoiceOption[] = [];

  const affordable = affordableVaultCardsDiscounted(
    state,
    ctx.triggeringPlayerId,
    opts.discount,
  );
  const vaultLabel =
    opts.discount > 0
      ? `Buy a Vault Item (${opts.discount} Gold off)`
      : 'Buy a Vault Item';
  options.push({
    id: 'vault',
    label: vaultLabel,
    payload: {},
    available: affordable.length > 0,
    ...(affordable.length === 0
      ? { unavailableReason: 'no affordable Vault Card' }
      : {}),
  });

  if (opts.side === 'A') {
    const canPay4 = player.resources.gold >= 4;
    const reason4 = `requires 4 Gold (you have ${player.resources.gold})`;
    options.push({
      id: 'int',
      label: 'Buy 1 INT for 4 Gold',
      payload: {},
      available: canPay4,
      ...(canPay4 ? {} : { unavailableReason: reason4 }),
    });
    options.push({
      id: 'wis',
      label: 'Buy 1 WIS for 4 Gold',
      payload: {},
      available: canPay4,
      ...(canPay4 ? {} : { unavailableReason: reason4 }),
    });
    options.push({
      id: 'research',
      label: 'Buy 1 Research for 4 Gold',
      payload: {},
      available: canPay4,
      ...(canPay4 ? {} : { unavailableReason: reason4 }),
    });
  }

  if (opts.side === 'B' && !redealUsed) {
    const canPay1 = player.resources.gold >= 1;
    options.push({
      id: 'redeal',
      label: 'Pay 1 Gold to discard and re-deal the Vault Tableau',
      payload: {},
      available: canPay1,
      ...(canPay1 ? {} : { unavailableReason: 'requires 1 Gold' }),
    });
  }

  options.push({
    id: 'skip',
    label: `Skip this Buy (${remaining} remaining)`,
    payload: {},
  });

  return {
    kind: 'pause',
    patch: carryPatch,
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: {
        effectId: selfEffectId,
        context: {
          step: 'after-buy-choice',
          remaining,
          redealUsed,
        },
      },
      source: ctx.source,
    },
  };
}

function studentStoresChain(
  ctx: EffectContext,
  selfEffectId: string,
  opts: StudentStoresOpts,
): EffectResult {
  const step = ctx.resumeContext?.['step'];
  const remaining =
    step === undefined
      ? opts.initialBuys
      : Number(ctx.resumeContext?.['remaining'] ?? 0);
  const redealUsed = ctx.resumeContext?.['redealUsed'] === true;

  // Resume from a vault-card-chosen prompt → apply purchase, decrement, loop.
  if (step === 'after-vault-pick') {
    if (ctx.resumeAnswer?.kind !== 'card-chosen') {
      throw new Error(
        `${selfEffectId} after-vault-pick expected card-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const buyPatch = applyVaultPurchaseDiscounted(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.cardId,
      opts.discount,
    );
    const working: GameState = { ...ctx.state, ...buyPatch };
    return studentStoresOpenBuy(
      working,
      ctx,
      selfEffectId,
      opts,
      remaining - 1,
      redealUsed,
      {
        players: working.players,
        vaultTableau: working.vaultTableau,
        vaultDeck: working.vaultDeck,
      },
    );
  }

  // Resume from the buy-option pick.
  if (step === 'after-buy-choice') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `${selfEffectId} after-buy-choice expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const optionId = ctx.resumeAnswer.optionId;

    if (optionId === 'skip') {
      return studentStoresOpenBuy(
        ctx.state,
        ctx,
        selfEffectId,
        opts,
        remaining - 1,
        redealUsed,
        {},
      );
    }

    if (optionId === 'vault') {
      const affordable = affordableVaultCardsDiscounted(
        ctx.state,
        ctx.triggeringPlayerId,
        opts.discount,
      );
      if (affordable.length === 0) {
        // Affordability may have shifted between prompts (reactions
        // etc.) — silently consume this Buy and continue.
        return studentStoresOpenBuy(
          ctx.state,
          ctx,
          selfEffectId,
          opts,
          remaining - 1,
          redealUsed,
          {},
        );
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-vault-card', eligibleCardIds: affordable },
          resume: {
            effectId: selfEffectId,
            context: {
              step: 'after-vault-pick',
              remaining,
              redealUsed,
            },
          },
          source: ctx.source,
        },
      };
    }

    if (optionId === 'int' || optionId === 'wis') {
      const goldPatch = gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'gold',
        -4,
      );
      const afterGold: GameState = { ...ctx.state, ...goldPatch };
      const resKind: 'intelligence' | 'wisdom' =
        optionId === 'int' ? 'intelligence' : 'wisdom';
      const resPatch = gainResourcePatch(
        afterGold,
        ctx.triggeringPlayerId,
        resKind,
        1,
      );
      const afterRes: GameState = { ...afterGold, ...resPatch };
      return studentStoresOpenBuy(
        afterRes,
        ctx,
        selfEffectId,
        opts,
        remaining - 1,
        redealUsed,
        { players: afterRes.players },
      );
    }

    if (optionId === 'research') {
      const goldPatch = gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'gold',
        -4,
      );
      const afterGold: GameState = { ...ctx.state, ...goldPatch };
      const researchPatch = appendResearchQueue(
        afterGold,
        ctx.triggeringPlayerId,
        ctx.source,
        1,
      );
      const afterRes: GameState = { ...afterGold, ...researchPatch };
      return studentStoresOpenBuy(
        afterRes,
        ctx,
        selfEffectId,
        opts,
        remaining - 1,
        redealUsed,
        {
          players: afterRes.players,
          researchQueue: afterRes.researchQueue,
        },
      );
    }

    if (optionId === 'redeal') {
      if (opts.side !== 'B' || redealUsed) {
        throw new Error(`${selfEffectId}: redeal not allowed here`);
      }
      const goldPatch = gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'gold',
        -1,
      );
      const afterGold: GameState = { ...ctx.state, ...goldPatch };
      const redealPatch = redealVaultTableau(afterGold);
      const afterRedeal: GameState = { ...afterGold, ...redealPatch };
      // Same Buy stays up for grabs — do NOT decrement remaining.
      return studentStoresOpenBuy(
        afterRedeal,
        ctx,
        selfEffectId,
        opts,
        remaining,
        true,
        {
          players: afterRedeal.players,
          vaultTableau: afterRedeal.vaultTableau,
          vaultDeck: afterRedeal.vaultDeck,
        },
      );
    }

    throw new Error(`${selfEffectId}: unknown option ${optionId}`);
  }

  // First entry — open the first Buy prompt.
  return studentStoresOpenBuy(
    ctx.state,
    ctx,
    selfEffectId,
    opts,
    remaining,
    redealUsed,
    {},
  );
}

registerEffect(
  'base.room.student-stores-a.slot-1',
  (ctx: EffectContext): EffectResult =>
    studentStoresChain(ctx, 'base.room.student-stores-a.slot-1', {
      side: 'A',
      discount: 0,
      initialBuys: 3,
    }),
);

registerEffect(
  'base.room.student-stores-a.slot-2',
  (ctx: EffectContext): EffectResult =>
    studentStoresChain(ctx, 'base.room.student-stores-a.slot-2', {
      side: 'A',
      discount: 0,
      initialBuys: 2,
    }),
);

registerEffect(
  'base.room.student-stores-a.slot-3',
  (ctx: EffectContext): EffectResult =>
    studentStoresChain(ctx, 'base.room.student-stores-a.slot-3', {
      side: 'A',
      discount: 0,
      initialBuys: 1,
    }),
);

registerEffect(
  'base.room.student-stores-b.slot-1',
  (ctx: EffectContext): EffectResult =>
    studentStoresChain(ctx, 'base.room.student-stores-b.slot-1', {
      side: 'B',
      discount: 2,
      initialBuys: 2,
    }),
);

registerEffect(
  'base.room.student-stores-b.slot-2',
  (ctx: EffectContext): EffectResult =>
    studentStoresChain(ctx, 'base.room.student-stores-b.slot-2', {
      side: 'B',
      discount: 0,
      initialBuys: 2,
    }),
);

registerEffect(
  'base.room.student-stores-b.slot-3',
  (ctx: EffectContext): EffectResult =>
    studentStoresChain(ctx, 'base.room.student-stores-b.slot-3', {
      side: 'B',
      discount: 0,
      initialBuys: 1,
    }),
);

// ============================================================================
// Great Hall — both sides are INSTANT rooms with a "place up to 3 mages
// together" chain. Side A grants 1 IP per placement; Side B grants 2
// Gold OR 1 Mana per placement. After applying the reward, the slot
// effect sets up `pendingPlaceChain` (remaining=2, restricted to this
// Great Hall, allowStop=true) so the engine surfaces up to 2 more
// placement prompts. The chain set-up is gated on "no chain already
// exists for this room" so the chained placements don't re-set it.
// ============================================================================

/**
 * Sets up the Great Hall chain on the FIRST placement of a sequence. If
 * a chain restricted to this same room is already in flight, leaves it
 * alone — we're mid-chain and the engine's drain pump will surface the
 * next placement prompt.
 */
function maybeSetGreatHallChain(
  state: GameState,
  roomId: string,
  playerId: PlayerId,
  source: ResolutionSource,
  carryPatch: GameStatePatch,
): EffectResult {
  const chain = state.pendingPlaceChain;
  const alreadyChaining =
    chain !== null &&
    chain.playerId === playerId &&
    chain.restrictRoomId === roomId;
  if (alreadyChaining) {
    return { kind: 'done', patch: carryPatch };
  }
  return {
    kind: 'done',
    patch: {
      ...carryPatch,
      pendingPlaceChain: {
        playerId,
        source,
        // remaining=2: drain pump decrements then surfaces a placement
        // prompt, so 2 means up to 2 more placements (3 total with the
        // initial one).
        remaining: 2,
        restrictRoomId: roomId,
        allowStop: true,
      },
    },
  };
}

/** Side A slot: gain 1 IP, then maybe set up the chain. */
registerEffect(
  'base.room.great-hall-a.slot',
  (ctx: EffectContext): EffectResult => {
    const ipPatch = bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 1);
    const afterIp: GameState = { ...ctx.state, ...ipPatch };
    return maybeSetGreatHallChain(
      afterIp,
      'base.room.great-hall.a',
      ctx.triggeringPlayerId,
      ctx.source,
      ipPatch,
    );
  },
);

/**
 * Side B slot: prompt Gold/Mana, apply the chosen resource, then maybe
 * set up the chain. The chain set-up happens on the resume after the
 * resource pick.
 */
registerEffect(
  'base.room.great-hall-b.slot',
  (ctx: EffectContext): EffectResult => {
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
          resume: {
            effectId: 'base.room.great-hall-b.slot',
            context: { step: 'after-pick' },
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(
        `great-hall-b.slot expected option-chosen, got ${ctx.resumeAnswer.kind}`,
      );
    }
    const optionId = ctx.resumeAnswer.optionId;
    let resourcePatch: GameStatePatch;
    if (optionId === 'gold') {
      resourcePatch = gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'gold',
        2,
      );
    } else if (optionId === 'mana') {
      resourcePatch = gainResourcePatch(
        ctx.state,
        ctx.triggeringPlayerId,
        'mana',
        1,
      );
    } else {
      throw new Error(`great-hall-b.slot: unknown option ${optionId}`);
    }
    const afterResource: GameState = { ...ctx.state, ...resourcePatch };
    return maybeSetGreatHallChain(
      afterResource,
      'base.room.great-hall.b',
      ctx.triggeringPlayerId,
      ctx.source,
      resourcePatch,
    );
  },
);

// ============================================================================
// Archmage's Study Side A — INSTANT room.
//   Slot 1 (merit, 1 MB): pay 1 Mana → gain the Archmage's Apprentice
//                         for the round.
//   Slot 2 (regular):     gain 1 IP and swap the placed Mage for
//                         another from the supply.
//   Slot 3 (regular):     swap the placed Mage for another from the
//                         supply.
//
// The Apprentice is the "joker" mage with all Mage Powers. It cannot
// be traded, swapped, or otherwise transferred. Tracked via
// `state.archmagesApprenticeOwner`; the round-end cleanup removes it
// from the owner's office and clears the pointer.
// ============================================================================

const ARCHMAGES_APPRENTICE_CARD_ID = 'base.mage.archmages-apprentice';

/** True iff `m` is the special Archmage's Apprentice piece. */
function isArchmagesApprentice(m: OwnedMage): boolean {
  return m.cardId === ARCHMAGES_APPRENTICE_CARD_ID;
}

/**
 * Looks up the mage currently sitting on `spaceId` for `playerId` (base
 * occupant first, then shadow). Returns null if the slot has no
 * matching occupant — handles e.g. Phase Steppers reverting a placement
 * between PLACE_WORKER and the resolution-choice resume.
 */
function findPlacedMageOnSpace(
  state: GameState,
  spaceId: string,
  playerId: PlayerId,
): OwnedMage | null {
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.id !== spaceId) continue;
      const candidates: { mageId: string; ownerId: string }[] = [];
      if (s.occupant && s.occupant.ownerId === playerId) candidates.push(s.occupant);
      if (s.shadowOccupant && s.shadowOccupant.ownerId === playerId) candidates.push(s.shadowOccupant);
      for (const occ of candidates) {
        const owner = state.players.find((p) => p.id === occ.ownerId);
        const m = owner?.mages.find((mm) => mm.id === occ.mageId);
        if (m) return m;
      }
    }
  }
  return null;
}

/** Eligible swap-target colours for slots 2 / 3: pool > 0, player not at
 *  the 2-per-colour cap, never apprentice / rainbow / orange unless
 *  the relevant pack is seated. */
function archmagesStudySwapColours(
  state: GameState,
  playerId: PlayerId,
  excludeColor: MageColor,
): MageColor[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  const out: MageColor[] = [];
  const candidates: MageColor[] = [
    'red',
    'blue',
    'grey',
    'green',
    'purple',
    'orange',
    'off-white',
  ];
  for (const c of candidates) {
    if (c === excludeColor) continue;
    if (c === 'orange' && !state.activePackIds.includes('mancers')) continue;
    if ((state.mageDraftPool[c] ?? 0) <= 0) continue;
    const owned = player.mages.filter((m) => m.color === c).length;
    if (c !== 'off-white' && owned >= 2) continue;
    out.push(c);
  }
  return out;
}

/** Builds a `Mage` color-label for the swap prompt option text. */
function colorPromptLabel(color: MageColor): string {
  switch (color) {
    case 'red':
      return 'Sorcery (red)';
    case 'blue':
      return 'Divinity (blue)';
    case 'grey':
      return 'Mysticism (grey)';
    case 'green':
      return 'Natural Magick (green)';
    case 'purple':
      return 'Planar Studies (purple)';
    case 'orange':
      return 'Technomancy (orange)';
    case 'off-white':
      return 'Neutral (off-white)';
    case 'rainbow':
      return "Archmage's Apprentice";
  }
}

/**
 * Returns the apprentice card id mapped per colour. Wraps the helper
 * MAGE_CARD_BY_COLOR lookup so the apprentice never appears as a swap
 * target (`'rainbow'` is filtered out upstream).
 */
function cardIdForColor(color: MageColor): string {
  return MAGE_CARD_BY_COLOR[color];
}

/**
 * Swaps a mage's color in place. Decrements the source pool back up
 * by one, decrements the target pool, and rewrites the mage's color +
 * cardId on the owning player. Slot occupancy references the mage id,
 * not its color, so the placement stays put.
 */
function applyArchmagesSwap(
  state: GameState,
  playerId: PlayerId,
  mage: OwnedMage,
  newColor: MageColor,
): GameStatePatch {
  const oldColor = mage.color;
  const pool: Record<MageColor, number> = {
    ...state.mageDraftPool,
    [oldColor]: (state.mageDraftPool[oldColor] ?? 0) + 1,
    [newColor]: (state.mageDraftPool[newColor] ?? 0) - 1,
  };
  return {
    mageDraftPool: pool,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mage.id
                ? m
                : { ...m, color: newColor, cardId: cardIdForColor(newColor) },
            ),
          },
    ),
  };
}

/**
 * Shared "claim the Archmage's Apprentice" slot resolver. Both Study
 * sides have a merit slot 1 that grants the joker mage for a single
 * round, differing only in the cost: Side A pays 1 Mana, Side B pays 2
 * Gold. Fizzles silently if the apprentice is already claimed (it's a
 * one-of-one) or the player can't pay.
 */
function archmagesStudyClaimApprentice(
  ctx: EffectContext,
  cost: { resource: 'mana' | 'gold'; amount: number },
): EffectResult {
  if (ctx.state.archmagesApprenticeOwner !== null) {
    return { kind: 'done', patch: {} };
  }
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player || player.resources[cost.resource] < cost.amount) {
    return { kind: 'done', patch: {} };
  }
  const seq = ctx.state.nextSequenceId;
  return {
    kind: 'done',
    patch: {
      nextSequenceId: seq + 1,
      archmagesApprenticeOwner: ctx.triggeringPlayerId,
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                [cost.resource]: p.resources[cost.resource] - cost.amount,
              },
              mages: [
                ...p.mages,
                {
                  id: `m-${seq}`,
                  cardId: ARCHMAGES_APPRENTICE_CARD_ID,
                  color: 'rainbow' as const,
                  location: {
                    kind: 'office' as const,
                    playerId: ctx.triggeringPlayerId,
                  },
                  isShadowing: false,
                  isWounded: false,
                },
              ],
            },
      ),
    },
  };
}

/** Side A slot 1 (merit, 1 MB): pay 1 Mana → gain the Archmage's Apprentice. */
registerEffect(
  'base.room.archmages-study-a.slot-1',
  (ctx: EffectContext): EffectResult =>
    archmagesStudyClaimApprentice(ctx, { resource: 'mana', amount: 1 }),
);

/** Side B slot 1 (merit, 1 MB): pay 2 Gold → gain the Archmage's Apprentice. */
registerEffect(
  'base.room.archmages-study-b.slot-1',
  (ctx: EffectContext): EffectResult =>
    archmagesStudyClaimApprentice(ctx, { resource: 'gold', amount: 2 }),
);

/**
 * Shared resolver for slots 2 and 3: applies the up-front bonus
 * (`bonusPatch`), then opens the colour-swap prompt. The apprentice can
 * never be swapped; if it's the placed mage the slot just applies the
 * bonus and finishes.
 */
function archmagesStudySwapSlot(
  ctx: EffectContext,
  selfEffectId: string,
  bonusPatch: GameStatePatch,
): EffectResult {
  if (!ctx.resumeAnswer) {
    if (ctx.source.kind !== 'room-action') {
      return { kind: 'done', patch: bonusPatch };
    }
    const mage = findPlacedMageOnSpace(
      ctx.state,
      ctx.source.id,
      ctx.triggeringPlayerId,
    );
    // Apprentice is untradeable. Apply the bonus (slot 2) and stop.
    if (!mage || isArchmagesApprentice(mage)) {
      return { kind: 'done', patch: bonusPatch };
    }
    // After applying the bonus, evaluate swap targets against the
    // post-bonus state so the prompt sees fresh resources.
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    const colours = archmagesStudySwapColours(
      afterBonus,
      ctx.triggeringPlayerId,
      mage.color,
    );
    if (colours.length === 0) {
      return { kind: 'done', patch: bonusPatch };
    }
    return {
      kind: 'pause',
      patch: bonusPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: colours.map((c) => ({
            id: c,
            label: colorPromptLabel(c),
            payload: {},
          })),
        },
        resume: {
          effectId: selfEffectId,
          context: { step: 'after-pick', mageId: mage.id },
        },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `${selfEffectId} expected option-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const mageIdRaw = ctx.resumeContext?.['mageId'];
  if (typeof mageIdRaw !== 'string') {
    throw new Error(`${selfEffectId}: missing mageId`);
  }
  const owner = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  const mage = owner?.mages.find((m) => m.id === mageIdRaw);
  if (!owner || !mage) return { kind: 'done', patch: {} };
  if (isArchmagesApprentice(mage)) return { kind: 'done', patch: {} };
  const newColor = ctx.resumeAnswer.optionId as MageColor;
  // Re-validate availability — state may have shifted between prompt
  // and resume (other reactions, etc.).
  const eligible = archmagesStudySwapColours(
    ctx.state,
    ctx.triggeringPlayerId,
    mage.color,
  );
  if (!eligible.includes(newColor)) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: applyArchmagesSwap(ctx.state, ctx.triggeringPlayerId, mage, newColor),
  };
}

/** Slot 2 (regular): gain 1 IP, then swap the placed Mage. */
registerEffect(
  'base.room.archmages-study-a.slot-2',
  (ctx: EffectContext): EffectResult =>
    archmagesStudySwapSlot(
      ctx,
      'base.room.archmages-study-a.slot-2',
      bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 1),
    ),
);

/** Slot 3 (regular): swap the placed Mage. No upfront bonus. */
registerEffect(
  'base.room.archmages-study-a.slot-3',
  (ctx: EffectContext): EffectResult =>
    archmagesStudySwapSlot(
      ctx,
      'base.room.archmages-study-a.slot-3',
      {},
    ),
);

/** Side B slot 2 (regular): gain 1 Mana, then swap the placed Mage. */
registerEffect(
  'base.room.archmages-study-b.slot-2',
  (ctx: EffectContext): EffectResult =>
    archmagesStudySwapSlot(
      ctx,
      'base.room.archmages-study-b.slot-2',
      gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 1),
    ),
);

/**
 * Side B slot 3 (regular): swap this non-Neutral Mage for a Neutral
 * Mage AND gain 3 Marks. The swap is the gate for the whole reward —
 * if it can't happen (a Neutral mage or the untradeable Apprentice was
 * placed, or the Neutral supply is empty), the slot fizzles entirely
 * and NO Marks are gained. When the swap is valid it's automatic (no
 * colour picker — the target is always Neutral), then a self-resuming
 * voter-pick chain grants the 3 Marks.
 */
registerEffect(
  'base.room.archmages-study-b.slot-3',
  (ctx: EffectContext): EffectResult => {
    const selfEffectId = 'base.room.archmages-study-b.slot-3';
    const step = ctx.resumeContext?.['step'];

    // First entry — the swap must be possible for the slot to do
    // anything. Fizzle (no swap, no Marks) otherwise.
    if (step === undefined) {
      if (ctx.source.kind !== 'room-action') {
        return { kind: 'done', patch: {} };
      }
      const mage = findPlacedMageOnSpace(
        ctx.state,
        ctx.source.id,
        ctx.triggeringPlayerId,
      );
      // Swap requires a non-neutral, non-apprentice mage and available
      // Neutral supply. Any failure fizzles the entire slot.
      if (
        !mage ||
        isArchmagesApprentice(mage) ||
        mage.color === 'off-white' ||
        (ctx.state.mageDraftPool['off-white'] ?? 0) <= 0
      ) {
        return { kind: 'done', patch: {} };
      }
      const swapPatch = applyArchmagesSwap(
        ctx.state,
        ctx.triggeringPlayerId,
        mage,
        'off-white',
      );
      const working: GameState = { ...ctx.state, ...swapPatch };
      // Begin the 3-mark chain carrying the swap patch forward.
      return chapelBMarkChain(
        { ...ctx, state: working },
        selfEffectId,
        3,
        swapPatch,
      );
    }

    if (step === 'after-mark') {
      if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
        throw new Error(
          `${selfEffectId} after-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
        );
      }
      const markPatch = applyGainMark(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.voterId,
      );
      const working: GameState = { ...ctx.state, ...markPatch };
      const remaining = Number(ctx.resumeContext?.['remaining'] ?? 0);
      if (remaining <= 0) {
        return { kind: 'done', patch: markPatch };
      }
      // `chapelBMarkChain(total)` stores `remaining = total - 1`, so pass
      // the current `remaining` as the next `total` to decrement once
      // more for the following mark.
      return chapelBMarkChain(
        { ...ctx, state: working },
        selfEffectId,
        remaining,
        { players: working.players, voterMarks: working.voterMarks },
      );
    }

    throw new Error(`${selfEffectId} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Astronomy Tower Side A — pay-to-move-the-marker reward track.
//
// A shared marker (`state.astronomyTowerMarker`) sits on a 6-space track.
// Placing a Mage on a slot lets the player pay (per the slot's per-space
// cost) to move the marker forward; after moving at least one space they
// claim the reward the marker lands on. The marker wraps from the last
// space back to the first and PERSISTS between rounds.
//
// Gold isn't deducted until the player stops moving — `pos` (the working
// marker index) and `spent` (gold pledged so far) ride in resumeContext,
// and only on "stop" is the gold deducted, the marker committed, and the
// reward applied. The "2 Marks" space uses the shared mark chain.
// ============================================================================

type AstronomyReward = {
  label: string;
  gold?: number;
  mana?: number;
  intelligence?: number;
  wisdom?: number;
  research?: number;
  marks?: number;
};

const ASTRONOMY_A_TRACK: AstronomyReward[] = [
  { label: '1 WIS + 2 Mana', wisdom: 1, mana: 2 },
  { label: '2 Research', research: 2 },
  { label: '8 Gold', gold: 8 },
  { label: '1 INT + 1 Research', intelligence: 1, research: 1 },
  { label: '4 Mana', mana: 4 },
  { label: '2 Marks', marks: 2 },
];

/** Builds the "Stop & claim / Move 1 more" prompt for the move loop. */
function astronomyMovePrompt(
  ctx: EffectContext,
  selfEffectId: string,
  perSpace: number,
  pos: number,
  spent: number,
  moves: number,
): EffectResult {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  const goldLeft = (player?.resources.gold ?? 0) - spent;
  const canMove = goldLeft >= perSpace;
  const options: ChoiceOption[] = [];
  if (moves >= 1) {
    // The marker has moved at least once → the reward is claimable.
    options.push({
      id: 'stop',
      label: `Stop & claim: ${ASTRONOMY_A_TRACK[pos]!.label}`,
      payload: {},
    });
  } else {
    // Haven't moved yet (slots 2/3) — declining claims NOTHING. You must
    // move the marker at least one space to claim a reward.
    options.push({
      id: 'decline',
      label: 'Do not move — claim no reward',
      payload: {},
    });
  }
  if (canMove) {
    const nextPos = (pos + 1) % ASTRONOMY_A_TRACK.length;
    options.push({
      id: 'move',
      label: `Move 1 ${moves >= 1 ? 'more ' : ''}→ ${ASTRONOMY_A_TRACK[nextPos]!.label} (pay ${perSpace} Gold)`,
      payload: {},
    });
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: {
        effectId: selfEffectId,
        context: { step: 'choose', pos, spent, moves },
      },
      source: ctx.source,
    },
  };
}

/**
 * Applies the reward at `pos`, deducting the pledged `spent` gold and
 * committing the marker move. Resource / research rewards resolve in one
 * patch; the "2 Marks" space hands off to the shared mark chain.
 */
function astronomyApplyReward(
  ctx: EffectContext,
  selfEffectId: string,
  pos: number,
  spent: number,
): EffectResult {
  const reward = ASTRONOMY_A_TRACK[pos]!;
  // 1. Deduct pledged gold + commit the marker position.
  let working: GameState = {
    ...ctx.state,
    astronomyTowerMarker: pos,
    players: ctx.state.players.map((p) =>
      p.id !== ctx.triggeringPlayerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, gold: p.resources.gold - spent },
          },
    ),
  };
  // 2. Resource gains.
  if (
    reward.gold !== undefined ||
    reward.mana !== undefined ||
    reward.intelligence !== undefined ||
    reward.wisdom !== undefined
  ) {
    working = {
      ...working,
      ...gainResourcesPatch(working, ctx.triggeringPlayerId, {
        ...(reward.gold !== undefined ? { gold: reward.gold } : {}),
        ...(reward.mana !== undefined ? { mana: reward.mana } : {}),
        ...(reward.intelligence !== undefined
          ? { intelligence: reward.intelligence }
          : {}),
        ...(reward.wisdom !== undefined ? { wisdom: reward.wisdom } : {}),
      }),
    };
  }
  // 3. Research opportunities (drained by the engine pump).
  if (reward.research !== undefined && reward.research > 0) {
    working = {
      ...working,
      ...appendResearchQueue(
        working,
        ctx.triggeringPlayerId,
        ctx.source,
        reward.research,
      ),
    };
  }
  const basePatch: GameStatePatch = {
    players: working.players,
    astronomyTowerMarker: working.astronomyTowerMarker,
    ...(working.researchQueue !== ctx.state.researchQueue
      ? { researchQueue: working.researchQueue }
      : {}),
  };
  // 4. Marks (voter-pick chain).
  if (reward.marks !== undefined && reward.marks > 0) {
    return chapelBMarkChain(
      { ...ctx, state: working },
      selfEffectId,
      reward.marks,
      basePatch,
    );
  }
  return { kind: 'done', patch: basePatch };
}

/**
 * Shared resolver for all three Astronomy Tower A slots. `cfg` carries
 * the per-slot cost: slot 1 moves the first space free then 1 Gold each;
 * slots 2 / 3 charge 2 / 4 Gold per space.
 */
function astronomyTowerSlot(
  ctx: EffectContext,
  selfEffectId: string,
  cfg: { firstFree: boolean; perSpace: number },
): EffectResult {
  const step = ctx.resumeContext?.['step'];

  // Mark-chain continuation (the "2 Marks" reward).
  if (step === 'after-mark') {
    if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
      throw new Error(
        `${selfEffectId} after-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const markPatch = applyGainMark(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.voterId,
    );
    const working: GameState = { ...ctx.state, ...markPatch };
    const remaining = Number(ctx.resumeContext?.['remaining'] ?? 0);
    if (remaining <= 0) {
      return { kind: 'done', patch: markPatch };
    }
    return chapelBMarkChain(
      { ...ctx, state: working },
      selfEffectId,
      remaining,
      { players: working.players, voterMarks: working.voterMarks },
    );
  }

  // Move-loop continuation.
  if (step === 'choose') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `${selfEffectId} choose expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const pos = Number(ctx.resumeContext?.['pos'] ?? 0);
    const spent = Number(ctx.resumeContext?.['spent'] ?? 0);
    const moves = Number(ctx.resumeContext?.['moves'] ?? 0);
    if (ctx.resumeAnswer.optionId === 'decline') {
      // Chose not to move from the start (slots 2/3) — no reward, no
      // gold spent, marker unchanged.
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return astronomyApplyReward(ctx, selfEffectId, pos, spent);
    }
    if (ctx.resumeAnswer.optionId !== 'move') {
      throw new Error(
        `${selfEffectId}: unknown option ${ctx.resumeAnswer.optionId}`,
      );
    }
    // Move one more space (re-validate affordability defensively).
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const newSpent = spent + cfg.perSpace;
    if (!player || player.resources.gold < newSpent) {
      // Can't afford the move now — claim at the current position if the
      // marker has already moved, else fizzle (nothing to claim yet).
      if (moves >= 1) {
        return astronomyApplyReward(ctx, selfEffectId, pos, spent);
      }
      return { kind: 'done', patch: {} };
    }
    const newPos = (pos + 1) % ASTRONOMY_A_TRACK.length;
    return astronomyMovePrompt(
      ctx,
      selfEffectId,
      cfg.perSpace,
      newPos,
      newSpent,
      moves + 1,
    );
  }

  // First entry.
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player) return { kind: 'done', patch: {} };
  if (cfg.firstFree) {
    // Slot 1 (merit): the first space is free and automatic — advance
    // the marker, then offer to keep moving or stop & claim.
    const startPos =
      (ctx.state.astronomyTowerMarker + 1) % ASTRONOMY_A_TRACK.length;
    return astronomyMovePrompt(ctx, selfEffectId, cfg.perSpace, startPos, 0, 1);
  }
  // Slots 2 / 3: the first move is a paid CHOICE — moving is required to
  // claim anything. If the player can't afford it, fizzle outright.
  if (player.resources.gold < cfg.perSpace) {
    return { kind: 'done', patch: {} };
  }
  // Offer move/decline from the CURRENT marker position (not yet moved).
  return astronomyMovePrompt(
    ctx,
    selfEffectId,
    cfg.perSpace,
    ctx.state.astronomyTowerMarker,
    0,
    0,
  );
}

registerEffect(
  'base.room.astronomy-tower-a.slot-1',
  (ctx: EffectContext): EffectResult =>
    astronomyTowerSlot(ctx, 'base.room.astronomy-tower-a.slot-1', {
      firstFree: true,
      perSpace: 1,
    }),
);

registerEffect(
  'base.room.astronomy-tower-a.slot-2',
  (ctx: EffectContext): EffectResult =>
    astronomyTowerSlot(ctx, 'base.room.astronomy-tower-a.slot-2', {
      firstFree: false,
      perSpace: 2,
    }),
);

registerEffect(
  'base.room.astronomy-tower-a.slot-3',
  (ctx: EffectContext): EffectResult =>
    astronomyTowerSlot(ctx, 'base.room.astronomy-tower-a.slot-3', {
      firstFree: false,
      perSpace: 3,
    }),
);

// ============================================================================
// Astronomy Tower Side B — like Side A, but:
//   * Costs are paid in MANA (not Gold).
//   * The marker only moves RIGHT and CLAMPS at the final space (no wrap).
//   * The final space ("Choose any previous reward") can be activated by
//     paying once even though the marker can't advance further.
//   * Richer reward track: includes a free 2-card Vault draft, a "gain a
//     Mage from the supply" colour pick (2-per-department cap, Neutral
//     uncapped), and the "choose any previous reward" meta-space.
//   * The marker RESETS to 0 at round-setup (see engine.ts).
// ============================================================================

type AstronomyBReward = {
  label: string;
  gold?: number;
  mana?: number;
  intelligence?: number;
  wisdom?: number;
  research?: number;
  marks?: number;
  draftVault?: number; // draft N Vault Cards (free)
  gainMage?: boolean; // colour-picker Mage gain
  choosePrevious?: boolean; // pick one of the earlier spaces' rewards
};

const ASTRONOMY_B_TRACK: AstronomyBReward[] = [
  { label: 'Start' }, // 0 — no reward (the reset position)
  { label: '5 Mana', mana: 5 }, // 1
  { label: '8 Gold', gold: 8 }, // 2
  { label: '2 Marks', marks: 2 }, // 3
  {
    label: '1 INT + 1 WIS + 1 Research',
    intelligence: 1,
    wisdom: 1,
    research: 1,
  }, // 4
  { label: 'Draft 2 Vault Cards', draftVault: 2 }, // 5
  { label: 'Gain a Mage from the supply', gainMage: true }, // 6
  { label: 'Choose any previous reward', choosePrevious: true }, // 7
];

const ASTRONOMY_B_LAST = ASTRONOMY_B_TRACK.length - 1;

/** Builds the move/stop/decline prompt for the Side B move loop. */
function astronomyBMovePrompt(
  ctx: EffectContext,
  selfEffectId: string,
  perSpace: number,
  pos: number,
  spent: number,
  moves: number,
): EffectResult {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  const manaLeft = (player?.resources.mana ?? 0) - spent;
  const canPay = manaLeft >= perSpace;
  // Can advance while not at the end; at the end you may pay ONCE to
  // activate the final space (but only if you haven't moved yet).
  const canAdvance = pos < ASTRONOMY_B_LAST;
  const canActivateAtEnd = pos === ASTRONOMY_B_LAST && moves === 0;
  const options: ChoiceOption[] = [];
  if (moves >= 1) {
    options.push({
      id: 'stop',
      label: `Stop & claim: ${ASTRONOMY_B_TRACK[pos]!.label}`,
      payload: {},
    });
  } else {
    options.push({
      id: 'decline',
      label: 'Do not move — claim no reward',
      payload: {},
    });
  }
  if (canPay && (canAdvance || canActivateAtEnd)) {
    const nextPos = Math.min(pos + 1, ASTRONOMY_B_LAST);
    const label = canActivateAtEnd
      ? `Activate ${ASTRONOMY_B_TRACK[pos]!.label} (pay ${perSpace} Mana)`
      : `Move 1 ${moves >= 1 ? 'more ' : ''}→ ${ASTRONOMY_B_TRACK[nextPos]!.label} (pay ${perSpace} Mana)`;
    options.push({ id: 'move', label, payload: {} });
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: {
        effectId: selfEffectId,
        context: { step: 'choose', pos, spent, moves },
      },
      source: ctx.source,
    },
  };
}

/**
 * Dispatches a Side B reward at `index` against the already-committed
 * `working` state. `basePatch` carries the cumulative diff so far (mana
 * deduction + marker commit, and any earlier resource gains). Resource
 * rewards resolve in one patch; Marks / Vault draft / Mage gain / choose-
 * previous pause for their own prompts.
 */
function astronomyBDispatchReward(
  ctx: EffectContext,
  selfEffectId: string,
  working: GameState,
  index: number,
  basePatch: GameStatePatch,
): EffectResult {
  const reward = ASTRONOMY_B_TRACK[index]!;
  const dctx: EffectContext = { ...ctx, state: working };

  // Draft 2 Vault Cards (free).
  if (reward.draftVault !== undefined && reward.draftVault > 0) {
    if (working.vaultTableau.length === 0) {
      return { kind: 'done', patch: basePatch };
    }
    return {
      kind: 'pause',
      patch: basePatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...working.vaultTableau],
        },
        resume: {
          effectId: selfEffectId,
          context: { step: 'draft-vault', remaining: reward.draftVault },
        },
        source: ctx.source,
      },
    };
  }

  // Gain a Mage from the supply (colour picker; 2-per-department cap).
  if (reward.gainMage) {
    const player = working.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    if (!player) return { kind: 'done', patch: basePatch };
    const offered = DORMITORY_COLOR_OPTIONS.filter(
      ({ requiresPackId }) =>
        requiresPackId === undefined ||
        working.activePackIds.includes(requiresPackId),
    );
    const options: ChoiceOption[] = offered.map(({ color, label }) => {
      const { available, reasons } = dormitoryColorAvailable(
        working,
        player,
        color,
      );
      return {
        id: color,
        label,
        payload: {},
        available,
        ...(available ? {} : { unavailableReason: reasons.join(' + ') }),
      };
    });
    if (!options.some((o) => o.available)) {
      return { kind: 'done', patch: basePatch };
    }
    return {
      kind: 'pause',
      patch: basePatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: selfEffectId, context: { step: 'gain-mage' } },
        source: ctx.source,
      },
    };
  }

  // Choose any previous reward — pick one of the earlier reward spaces.
  if (reward.choosePrevious) {
    const options: ChoiceOption[] = [];
    for (let i = 1; i < index; i++) {
      // Skip the empty Start space (it has no reward); every other
      // earlier space is a real reward.
      options.push({
        id: String(i),
        label: ASTRONOMY_B_TRACK[i]!.label,
        payload: {},
      });
    }
    if (options.length === 0) {
      return { kind: 'done', patch: basePatch };
    }
    return {
      kind: 'pause',
      patch: basePatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: selfEffectId, context: { step: 'choose-prev' } },
        source: ctx.source,
      },
    };
  }

  // Simple resource / research / marks reward.
  let w = working;
  if (
    reward.gold !== undefined ||
    reward.mana !== undefined ||
    reward.intelligence !== undefined ||
    reward.wisdom !== undefined
  ) {
    w = {
      ...w,
      ...gainResourcesPatch(w, ctx.triggeringPlayerId, {
        ...(reward.gold !== undefined ? { gold: reward.gold } : {}),
        ...(reward.mana !== undefined ? { mana: reward.mana } : {}),
        ...(reward.intelligence !== undefined
          ? { intelligence: reward.intelligence }
          : {}),
        ...(reward.wisdom !== undefined ? { wisdom: reward.wisdom } : {}),
      }),
    };
  }
  if (reward.research !== undefined && reward.research > 0) {
    w = {
      ...w,
      ...appendResearchQueue(
        w,
        ctx.triggeringPlayerId,
        ctx.source,
        reward.research,
      ),
    };
  }
  const patch: GameStatePatch = {
    ...basePatch,
    players: w.players,
    ...(w.researchQueue !== ctx.state.researchQueue
      ? { researchQueue: w.researchQueue }
      : {}),
  };
  if (reward.marks !== undefined && reward.marks > 0) {
    return chapelBMarkChain({ ...dctx, state: w }, selfEffectId, reward.marks, patch);
  }
  return { kind: 'done', patch };
}

/** On "stop", deduct the pledged mana, commit the marker, apply reward. */
function astronomyBApplyReward(
  ctx: EffectContext,
  selfEffectId: string,
  pos: number,
  spent: number,
): EffectResult {
  const working: GameState = {
    ...ctx.state,
    astronomyTowerMarker: pos,
    players: ctx.state.players.map((p) =>
      p.id !== ctx.triggeringPlayerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, mana: p.resources.mana - spent },
          },
    ),
  };
  const basePatch: GameStatePatch = {
    players: working.players,
    astronomyTowerMarker: working.astronomyTowerMarker,
  };
  return astronomyBDispatchReward(ctx, selfEffectId, working, pos, basePatch);
}

/** Shared resolver for all three Astronomy Tower B slots. */
function astronomyTowerBSlot(
  ctx: EffectContext,
  selfEffectId: string,
  perSpace: number,
): EffectResult {
  const step = ctx.resumeContext?.['step'];

  // Mark-chain continuation (2-Marks space, or choose-previous → marks).
  if (step === 'after-mark') {
    if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
      throw new Error(
        `${selfEffectId} after-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const markPatch = applyGainMark(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.voterId,
    );
    const working: GameState = { ...ctx.state, ...markPatch };
    const remaining = Number(ctx.resumeContext?.['remaining'] ?? 0);
    if (remaining <= 0) {
      return { kind: 'done', patch: markPatch };
    }
    return chapelBMarkChain(
      { ...ctx, state: working },
      selfEffectId,
      remaining,
      { players: working.players, voterMarks: working.voterMarks },
    );
  }

  // Vault-draft continuation (Draft 2 Vault Cards).
  if (step === 'draft-vault') {
    if (ctx.resumeAnswer?.kind !== 'card-chosen') {
      throw new Error(
        `${selfEffectId} draft-vault expected card-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const draftPatch = applyVaultDraft(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.cardId,
    );
    const working: GameState = { ...ctx.state, ...draftPatch };
    const remaining = Number(ctx.resumeContext?.['remaining'] ?? 1) - 1;
    if (remaining <= 0 || working.vaultTableau.length === 0) {
      return { kind: 'done', patch: draftPatch };
    }
    return {
      kind: 'pause',
      patch: draftPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...working.vaultTableau],
        },
        resume: { effectId: selfEffectId, context: { step: 'draft-vault', remaining } },
        source: ctx.source,
      },
    };
  }

  // Gain-mage continuation (colour chosen).
  if (step === 'gain-mage') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `${selfEffectId} gain-mage expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const color = ctx.resumeAnswer.optionId as MageColor;
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    if (!player || !(color in MAGE_CARD_BY_COLOR)) {
      return { kind: 'done', patch: {} };
    }
    const { available } = dormitoryColorAvailable(ctx.state, player, color);
    if (!available) return { kind: 'done', patch: {} };
    const seq = ctx.state.nextSequenceId;
    const poolCount = ctx.state.mageDraftPool[color] ?? 0;
    return {
      kind: 'done',
      patch: {
        nextSequenceId: seq + 1,
        mageDraftPool: { ...ctx.state.mageDraftPool, [color]: poolCount - 1 },
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                mages: [
                  ...p.mages,
                  {
                    id: `m-${seq}`,
                    cardId: MAGE_CARD_BY_COLOR[color],
                    color,
                    location: {
                      kind: 'office' as const,
                      playerId: ctx.triggeringPlayerId,
                    },
                    isShadowing: false,
                    isWounded: false,
                  },
                ],
              },
        ),
      },
    };
  }

  // Choose-previous continuation (which earlier space's reward).
  if (step === 'choose-prev') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `${selfEffectId} choose-prev expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const chosen = Number(ctx.resumeAnswer.optionId);
    if (!Number.isInteger(chosen) || chosen < 1 || chosen >= ASTRONOMY_B_LAST) {
      return { kind: 'done', patch: {} };
    }
    // Mana + marker already committed before this pause; apply the chosen
    // reward against the current state with an empty base patch.
    return astronomyBDispatchReward(ctx, selfEffectId, ctx.state, chosen, {});
  }

  // Move-loop continuation.
  if (step === 'choose') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `${selfEffectId} choose expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const pos = Number(ctx.resumeContext?.['pos'] ?? 0);
    const spent = Number(ctx.resumeContext?.['spent'] ?? 0);
    const moves = Number(ctx.resumeContext?.['moves'] ?? 0);
    if (ctx.resumeAnswer.optionId === 'decline') {
      return { kind: 'done', patch: {} };
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return astronomyBApplyReward(ctx, selfEffectId, pos, spent);
    }
    if (ctx.resumeAnswer.optionId !== 'move') {
      throw new Error(
        `${selfEffectId}: unknown option ${ctx.resumeAnswer.optionId}`,
      );
    }
    const player = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const newSpent = spent + perSpace;
    if (!player || player.resources.mana < newSpent) {
      if (moves >= 1) return astronomyBApplyReward(ctx, selfEffectId, pos, spent);
      return { kind: 'done', patch: {} };
    }
    const newPos = Math.min(pos + 1, ASTRONOMY_B_LAST);
    return astronomyBMovePrompt(
      ctx,
      selfEffectId,
      perSpace,
      newPos,
      newSpent,
      moves + 1,
    );
  }

  // First entry — the first move is a paid choice (no free move).
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  if (!player) return { kind: 'done', patch: {} };
  if (player.resources.mana < perSpace) {
    return { kind: 'done', patch: {} };
  }
  return astronomyBMovePrompt(
    ctx,
    selfEffectId,
    perSpace,
    ctx.state.astronomyTowerMarker,
    0,
    0,
  );
}

registerEffect(
  'base.room.astronomy-tower-b.slot-1',
  (ctx: EffectContext): EffectResult =>
    astronomyTowerBSlot(ctx, 'base.room.astronomy-tower-b.slot-1', 2),
);

registerEffect(
  'base.room.astronomy-tower-b.slot-2',
  (ctx: EffectContext): EffectResult =>
    astronomyTowerBSlot(ctx, 'base.room.astronomy-tower-b.slot-2', 2),
);

registerEffect(
  'base.room.astronomy-tower-b.slot-3',
  (ctx: EffectContext): EffectResult =>
    astronomyTowerBSlot(ctx, 'base.room.astronomy-tower-b.slot-3', 1),
);

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
    // The apprentice acts as red and may use Ars Magna — but only while
    // Sorcery is on Side A (Side B is the mana-on-place power instead).
    if (!colorAbilityActive(ctx.state, redMage, 'red')) {
      throw new Error('Ars Magna: source mage must be red (Sorcery), Side A');
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
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
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
      pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
// Natural Magick (green) Side B — "When placing, if possible you may move an
// opponent's Mage to another slot in the same room and take its place."
//
// The engine detects the opt-in at PLACE_WORKER (a green-B Mage placed onto an
// opposing-occupied base slot) and surfaces a choose-slot prompt; this effect
// resumes once the destination is chosen. Two distinct operations follow, each
// obeying the standard rules:
//   1. The opponent's Mage MOVES to the chosen open slot — via `moveMageToSpace`,
//      which by construction never claims an instant-room reward (the "moving
//      never claims rewards" rule). Modeled as a forced reposition: we take the
//      move patch but open no reaction window (mirrors Cut Plane).
//   2. The green Mage is PLACED into the vacated slot from the office — a normal
//      placement, so it DOES claim the instant-room reward like any other
//      (routed through `placeOfficeMageOnSpace` + `patchWithMaybeInstantReward`).
// ============================================================================
registerEffect(
  'base.mage.natural-magick.displace',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(
        `natural-magick.displace expected space-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const destSpaceId = ctx.resumeAnswer.spaceId;
    const greenMageId = ctx.resumeContext?.['greenMageId'];
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    const takenSpaceId = ctx.resumeContext?.['takenSpaceId'];
    if (
      typeof greenMageId !== 'string' ||
      typeof targetMageId !== 'string' ||
      typeof takenSpaceId !== 'string'
    ) {
      throw new Error('natural-magick.displace: missing context fields');
    }
    const greenOwnerId = ctx.triggeringPlayerId;

    // Move the opponent to the chosen slot (a MOVE — no instant reward) and
    // open the standard mage-moved reaction window so the displaced owner may
    // respond (Phase Steppers / Invisibility Cloak / Ancient Armor, …). The
    // green Mage is seated afterward, once the window drains, via the
    // `afterResume` continuation — so a reaction that sends the opponent back
    // to the vacated slot can foil the takeover.
    const moved = moveMageToSpace(
      ctx.state,
      targetMageId,
      destSpaceId,
      greenOwnerId,
    );
    return {
      kind: 'open-reaction',
      patch: moved.patch,
      window: {
        triggerEvents: [moved.triggerEvent],
        pendingResponderIds: buildReactionQueue(ctx.state, greenOwnerId),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.mage.natural-magick.displace.seat',
          context: { greenMageId, takenSpaceId },
        },
        source: ctx.source,
      },
    };
  },
);

// After the displaced opponent's reaction window drains, seat the green Mage in
// the vacated slot (a placement → claims the instant-room reward). If a reaction
// returned a Mage to that slot (Phase Steppers sends the moved Mage back to its
// original slot, which is the vacated one), the takeover fizzles — the green
// Mage stays in the office and the Action is still spent.
registerEffect(
  'base.mage.natural-magick.displace.seat',
  (ctx: EffectContext): EffectResult => {
    const greenMageId = ctx.resumeContext?.['greenMageId'];
    const takenSpaceId = ctx.resumeContext?.['takenSpaceId'];
    if (typeof greenMageId !== 'string' || typeof takenSpaceId !== 'string') {
      throw new Error('natural-magick.displace.seat: missing context fields');
    }
    const greenOwnerId = ctx.triggeringPlayerId;
    const space = ctx.state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((s) => s.id === takenSpaceId);
    if (!space || space.occupant) return { kind: 'done', patch: {} };
    const greenMage = ctx.state.players
      .find((p) => p.id === greenOwnerId)
      ?.mages.find((m) => m.id === greenMageId);
    if (!greenMage || greenMage.location.kind !== 'office') {
      return { kind: 'done', patch: {} };
    }
    const seatPatch = placeOfficeMageOnSpace(
      ctx.state,
      greenOwnerId,
      greenMageId,
      takenSpaceId,
    );
    return patchWithMaybeInstantReward(
      ctx.state,
      seatPatch,
      takenSpaceId,
      greenOwnerId,
    );
  },
);

// ============================================================================
// Archmage's Apprentice — placement-power choice
// ============================================================================
//
// The Apprentice acts as every colour, so placing it onto an occupied opposing
// base slot can satisfy BOTH Sorcery Side A (Ars Magna) and Natural Magick Side
// B (displace). The engine surfaces a choose-one prompt at PLACE_WORKER time and
// resumes here with the picked power. Both branches reuse the existing single-
// colour machinery: the displace flow (`natural-magick.displace`) and the Ars
// Magna continuation (`sorcery.ars-magna.complete`). The Action budget was
// already consumed by PLACE_WORKER, so neither branch touches it again.
registerEffect(
  'base.mage.apprentice.place-on-occupied',
  (ctx: EffectContext): EffectResult => {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(
        `apprentice place-on-occupied expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
      );
    }
    const optionId = ctx.resumeAnswer.optionId;
    const sourceMageId = ctx.resumeContext?.['sourceMageId'];
    const takenSpaceId = ctx.resumeContext?.['takenSpaceId'];
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (
      typeof sourceMageId !== 'string' ||
      typeof takenSpaceId !== 'string' ||
      typeof targetMageId !== 'string'
    ) {
      throw new Error('apprentice place-on-occupied: missing context fields');
    }
    const playerId = ctx.triggeringPlayerId;

    if (optionId === 'displace') {
      // Natural Magick Side B: pick which open slot in the room to shove the
      // occupant into, then hand off to the shared displacement effect.
      const room = findRoomBySpaceId(ctx.state, takenSpaceId);
      if (!room) throw new Error('apprentice displace: room not found');
      const openSlots = room.actionSpaces.filter(
        (sp) =>
          sp.id !== takenSpaceId &&
          !sp.occupant &&
          sp.slotType !== 'shadow' &&
          sp.slotType !== 'shadow-merit' &&
          sp.slotType !== 'wound',
      );
      if (openSlots.length === 0) {
        throw new Error('apprentice displace: no open slot to displace into');
      }
      return {
        kind: 'pause',
        pending: {
          responderId: playerId,
          prompt: {
            kind: 'choose-target-action-space',
            eligibleSpaceIds: openSlots.map((sp) => sp.id),
            label: "Move the opponent's Mage to which slot?",
          },
          resume: {
            effectId: 'base.mage.natural-magick.displace',
            context: { greenMageId: sourceMageId, targetMageId, takenSpaceId },
          },
          source: ctx.source,
        },
      };
    }

    if (optionId === 'wound') {
      // Ars Magna: pay 1 Mana, wound the occupant, then (after the reaction
      // window) the Apprentice takes the vacated slot via the shared
      // ars-magna.complete continuation.
      const player = ctx.state.players.find((p) => p.id === playerId);
      if (!player || player.resources.mana < 1) {
        throw new Error('apprentice Ars Magna: requires 1 Mana');
      }
      const afterMana: GameState = {
        ...ctx.state,
        players: ctx.state.players.map((p) =>
          p.id !== playerId
            ? p
            : { ...p, resources: { ...p.resources, mana: p.resources.mana - 1 } },
        ),
      };
      const wounded = woundMage(afterMana, targetMageId, playerId);
      if (wounded.triggerEvent.kind !== 'mage-wounded') {
        throw new Error('apprentice Ars Magna: unexpected wound event');
      }
      return {
        kind: 'open-reaction',
        patch: wounded.patch,
        window: {
          triggerEvents: [wounded.triggerEvent],
          pendingResponderIds: buildReactionQueue(afterMana, playerId),
          reactedPlayerIds: [],
          afterResume: {
            effectId: 'base.mage.sorcery.ars-magna.complete',
            context: {
              sourceMageId,
              targetSpaceId: takenSpaceId,
              triggerEvent: triggerEventToContext(wounded.triggerEvent),
            },
          },
          source: ctx.source,
        },
      };
    }

    throw new Error(`apprentice place-on-occupied: unknown option ${optionId}`);
  },
);

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

/**
 * Strength (4+) — heal a Mage in the Infirmary. Two-step: pick a wounded
 * mage of the claimer, then pick an open base slot to place them on.
 * Fizzles if the claimer has no wounded mages or no open slots exist.
 */
registerEffect('base.bell.heal-from-infirmary', (ctx: EffectContext): EffectResult => {
  const self = 'base.bell.heal-from-infirmary';
  const step = ctx.resumeContext?.['step'];

  if (!ctx.resumeAnswer) {
    const claimer = ctx.state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    const wounded =
      claimer?.mages
        .filter((m) => m.location.kind === 'infirmary' && m.isWounded)
        .map((m) => m.id) ?? [];
    if (wounded.length === 0) return { kind: 'done', patch: {} };
    const opens = listEligiblePlacementSlots(ctx.state, ctx.triggeringPlayerId);
    if (opens.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: wounded },
        resume: { effectId: self, context: { step: 'pick-slot' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-slot expected mage-chosen`);
    }
    const mageId = ctx.resumeAnswer.mageId;
    const opens = listEligiblePlacementSlots(ctx.state, ctx.triggeringPlayerId);
    if (opens.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: opens,
        },
        resume: { effectId: self, context: { step: 'apply', mageId } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const mageId = String(ctx.resumeContext?.['mageId'] ?? '');
    if (!mageId) return { kind: 'done', patch: {} };
    const spaceId = ctx.resumeAnswer.spaceId;
    return {
      kind: 'done',
      patch: healMageToSpace(ctx.state, mageId, spaceId),
    };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/**
 * Power (5+) — Your Spells cost 1 less Mana for the rest of the round. Adds
 * a `spells-cheaper` buff scoped to the claimer; the cast-spell handler
 * subtracts the buff's `discount` (floored at 0) when computing the mana
 * cost. Clears at round-end like every other active buff.
 */
registerEffect('base.bell.cheap-spells', (ctx: EffectContext): EffectResult => {
  const buff: SpellsCheaperBuff = {
    kind: 'spells-cheaper',
    casterPlayerId: ctx.triggeringPlayerId,
    sourceId: 'base.bell.cheap-spells',
    label: 'Power',
    discount: 1,
    expiresAt: { kind: 'round-end' },
  };
  return {
    kind: 'done',
    patch: {
      activeBuffs: [...ctx.state.activeBuffs, buff],
    },
  };
});

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
  // Persist BOTH the Mark placements (`voterMarks`) and the `marks` resource
  // bump — `applyGainMark` updates both, so the patch must carry both or the
  // Mark never lands on the Voter (only the counter would move).
  const diff: GameStatePatch = {
    players: working.players,
    voterMarks: working.voterMarks,
  };
  if (appliedRemaining <= 0) {
    return { kind: 'done', patch: diff };
  }
  const prompt = spawnGainMarkPrompt(working, ctx.triggeringPlayerId, ctx.source);
  if (prompt === null) {
    // No more eligible voters — emit what we already applied and stop.
    return { kind: 'done', patch: diff };
  }
  return {
    kind: 'pause',
    patch: diff,
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
// can't pay 3 Gold or both the requested-color and the off-white fallback
// supplies can't satisfy the trade. When the requested color is empty but
// off-white isn't (and the player isn't capped at 2 neutrals), the player
// receives an off-white mage instead of the requested color.
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
        // Board truth: only Mages actually occupying a slot can be moved. A
        // Mage whose `location` claims a slot it doesn't hold (a transient
        // inconsistency) would otherwise crash `moveMageToSpace`, so gate on
        // `findMageSlotPosition` rather than the `location` field alone.
        if (!m.isWounded && findMageSlotPosition(ctx.state, m.id) !== null) {
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
    // Locate the target on the board (truth) rather than trusting `location`;
    // if it's no longer on a slot, the move simply fizzles.
    const fromPos = findMageSlotPosition(ctx.state, targetMageId);
    if (!fromPos) return { kind: 'done', patch: {} };
    const fromSpaceId = fromPos.spaceId;
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
    // If the target left its slot between prompts, the move fizzles.
    if (!findMageSlotPosition(ctx.state, targetMageId)) {
      return { kind: 'done', patch: {} };
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
 * `afterResume` continuation that fires the instant-room reward prompt
 * (position='shadow') for a slot once a `mage-shadowed` reaction window
 * closes. No-op when the slot's room isn't an instant room with a
 * registered effect — used by the Mysticism post-cast trigger when
 * shadow-placing under Inversion.
 */
registerEffect(
  'base.system.shadow-instant-reward',
  (ctx): EffectResult => {
    const spaceId = ctx.resumeContext?.['spaceId'];
    if (typeof spaceId !== 'string') return { kind: 'done', patch: {} };
    return patchWithMaybeInstantReward(
      ctx.state,
      {},
      spaceId,
      ctx.triggeringPlayerId,
      'shadow',
    );
  },
);

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
              // Apprentice acts as grey (and every department colour),
              // so the post-cast placement offers it as a candidate too.
              actsAsColor(m, 'grey') &&
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
      // Under a mandatory shadow-on-place buff (Inversion), the grey
      // mage must shadow-place: write `shadowOccupant` instead of
      // `occupant`, mark the mage as shadowing, and fire a mage-shadowed
      // reaction if an opposing mage is at the base. Shadow occupants
      // never collect the slot's reward, so we skip the instant-reward
      // prompt for this branch.
      const mandatoryShadow = findMandatoryShadowBuff(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (mandatoryShadow) {
        return shadowPlaceMysticismMage(
          ctx,
          placerMageId,
          spaceId,
          mandatoryShadow,
        );
      }
      // Ars Magna branch: when the placer acts as red AND the chosen
      // slot is occupied by a valid Ars Magna target, run the standard
      // wound + reaction-window + Ars-Magna-complete chain. This makes
      // the Apprentice's red power available even when placing via the
      // Mysticism post-cast trigger (it acts as both grey and red).
      const targetSpace = ctx.state.rooms
        .flatMap((r) => r.actionSpaces)
        .find((sp) => sp.id === spaceId);
      const placer = ctx.state.players
        .find((p) => p.id === ctx.triggeringPlayerId)
        ?.mages.find((m) => m.id === placerMageId);
      if (
        targetSpace &&
        targetSpace.occupant &&
        placer &&
        actsAsColor(placer, 'red') &&
        canArsMagnaTakeSpace(ctx.state, ctx.triggeringPlayerId, targetSpace)
      ) {
        const targetMageId = targetSpace.occupant.mageId;
        const afterMana: GameState = {
          ...ctx.state,
          players: ctx.state.players.map((p) =>
            p.id !== ctx.triggeringPlayerId
              ? p
              : {
                  ...p,
                  resources: { ...p.resources, mana: p.resources.mana - 1 },
                },
          ),
        };
        const wounded = woundMage(
          afterMana,
          targetMageId,
          ctx.triggeringPlayerId,
        );
        const source: ResolutionSource = {
          kind: 'mage-power',
          id: placerMageId,
          triggeringPlayerId: ctx.triggeringPlayerId,
          description: 'Ars Magna (Mysticism placement)',
        };
        return {
          kind: 'open-reaction',
          patch: { players: afterMana.players, ...wounded.patch },
          window: {
            triggerEvents: [wounded.triggerEvent],
            pendingResponderIds: buildReactionQueue(
              afterMana,
              ctx.triggeringPlayerId,
            ),
            reactedPlayerIds: [],
            afterResume: {
              effectId: 'base.mage.sorcery.ars-magna.complete',
              context: {
                sourceMageId: placerMageId,
                targetSpaceId: spaceId,
                triggerEvent:
                  wounded.triggerEvent as unknown as SerializableContext,
              },
            },
            source,
          },
        };
      }
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
 * Same gating as `listEligiblePlacementSlots`, but returns slots whose
 * SHADOW position is open. Used by the Mysticism post-cast trigger when
 * the caster is under Inversion (mandatory shadow-on-place). Under
 * Inversion's mandatory mode, shadow placement is legal even when the
 * base is empty or owned by the caster — only `shadowOccupant` must be
 * empty.
 */
function listEligibleShadowSlots(
  state: GameState,
  playerId: string,
): string[] {
  const out: string[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    if (r.noShadowSlots) continue;
    if (isRoomLocked(state, r.id)) continue;
    if (isRoomAtPlayerCap(state, playerId, r.id)) continue;
    for (const s of r.actionSpaces) {
      if (!s.shadowOccupant) out.push(s.id);
    }
  }
  return out;
}

/**
 * Lookup helper: returns the active mandatory shadow-on-place buff for
 * `playerId` (Inversion), or null. The optional-mode buff (Zero Hour)
 * doesn't change the post-cast placement path.
 */
function findMandatoryShadowBuff(
  state: GameState,
  playerId: PlayerId,
): ShadowOnPlaceBuff | null {
  return (
    state.activeBuffs.find(
      (b): b is ShadowOnPlaceBuff =>
        b.kind === 'shadow-on-place' &&
        b.casterPlayerId === playerId &&
        b.mode === 'mandatory',
    ) ?? null
  );
}

/**
 * Shadow-places a grey office mage during the Mysticism post-cast trigger
 * under Inversion. Mirrors the shadow branch of engine.ts `PLACE_WORKER`:
 *   - writes the slot's `shadowOccupant`, never `occupant`;
 *   - marks the mage `isShadowing: true` (via `placeOfficeMageAsShadow`);
 *   - if an opposing mage sits at the base, opens a `mage-shadowed`
 *     reaction window; the instant-room reward (if any) fires via the
 *     `shadow-instant-reward` afterResume once the window closes;
 *   - otherwise routes through `patchWithMaybeInstantReward` so empty-
 *     base shadow placements at instant rooms still get the reward
 *     prompt.
 */
function shadowPlaceMysticismMage(
  ctx: EffectContext,
  placerMageId: string,
  spaceId: string,
  buff: ShadowOnPlaceBuff,
): EffectResult {
  const room = ctx.state.rooms.find((r) =>
    r.actionSpaces.some((s) => s.id === spaceId),
  );
  const space = room?.actionSpaces.find((s) => s.id === spaceId);
  if (!room || !space) {
    throw new Error(
      `mysticism-place-after-cast apply: space ${spaceId} not found`,
    );
  }
  const playerId = ctx.triggeringPlayerId;
  const placePatch = placeOfficeMageAsShadow(
    ctx.state,
    playerId,
    placerMageId,
    spaceId,
  );
  const baseOccupant = space.occupant;
  // No reaction window when the base is empty or already same-owner.
  // Fall through to the shared instant-reward helper. (The placePatch
  // from `placeOfficeMageAsShadow` already bakes in the Adventuring B
  // on-place pick prompt push when applicable.)
  if (!baseOccupant || baseOccupant.ownerId === playerId) {
    return patchWithMaybeInstantReward(
      ctx.state,
      placePatch,
      spaceId,
      playerId,
      'shadow',
    );
  }
  // Opposing base — fire mage-shadowed, then chain the instant-room
  // reward (if any) via the afterResume continuation.
  const placed: GameState = { ...ctx.state, ...placePatch };
  const source: ResolutionSource = {
    kind: 'spell',
    id: buff.spellCardId,
    triggeringPlayerId: playerId,
    description: buff.label,
  };
  return {
    kind: 'open-reaction',
    patch: placePatch,
    window: {
      triggerEvents: [
        {
          kind: 'mage-shadowed',
          mageId: baseOccupant.mageId,
          ownerId: baseOccupant.ownerId,
          byPlayerId: playerId,
          spaceId: space.id,
        },
      ],
      pendingResponderIds: buildReactionQueue(placed, playerId),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.shadow-instant-reward',
        context: { spaceId },
      },
      source,
    },
  };
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
  const { options, meritCost, goldCost } = buildResolutionChoiceOptions(
    state,
    space,
    playerId,
    position,
  );
  return {
    responderId: playerId,
    prompt: { kind: 'choose-from-options', options },
    resume: {
      effectId: 'base.system.resolution-choice',
      context: {
        spaceId: space.id,
        innerEffectId: space.effectId,
        meritCost,
        goldCost,
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
  // Under Inversion (mandatory shadow-on-place), the grey mage must
  // shadow-place. The slot picker offers shadow-eligible slots; the
  // `apply` step routes through `shadowPlaceMysticismMage`.
  const mandatoryShadow = findMandatoryShadowBuff(
    ctx.state,
    ctx.triggeringPlayerId,
  );
  let eligible: string[];
  if (mandatoryShadow) {
    eligible = listEligibleShadowSlots(ctx.state, ctx.triggeringPlayerId);
  } else {
    eligible = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    // Mages that ALSO act as red (i.e. the Archmage's Apprentice) can
    // Ars Magna an occupied slot via the Mysticism placement just like
    // they can via a normal PLACE_WORKER. Augment the eligible set
    // with any slot whose occupant is a valid Ars Magna target.
    const placer = ctx.state.players
      .find((p) => p.id === ctx.triggeringPlayerId)
      ?.mages.find((m) => m.id === placerMageId);
    if (placer && actsAsColor(placer, 'red')) {
      for (const r of ctx.state.rooms) {
        for (const s of r.actionSpaces) {
          if (!s.occupant) continue;
          if (canArsMagnaTakeSpace(ctx.state, ctx.triggeringPlayerId, s)) {
            eligible.push(s.id);
          }
        }
      }
    }
  }
  if (eligible.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-action-space',
        eligibleSpaceIds: eligible,
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
          pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
      const bonusPatch = applyInfirmaryBonusFromCtx(
        ctx.state,
        recipientId,
        ctx.resumeAnswer,
        ctx.resumeContext,
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
      if (r.noShadowSlots) continue;
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
  // When true, this is a genuine "place without powers" placement (Slow / Stop
  // Time, Great Hall) — the Technomancy "upon placement" Mage power is skipped.
  suppressMagePowers = false,
): GameStatePatch {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error('placeOfficeMageOnSpace: player not found');
  const mage = player.mages.find((m) => m.id === mageId);
  if (!mage) throw new Error('placeOfficeMageOnSpace: mage not in office');
  if (mage.location.kind !== 'office') {
    throw new Error('placeOfficeMageOnSpace: mage not in office');
  }
  const placePatch: GameStatePatch = {
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
  return {
    ...placePatch,
    ...adventuringBPlacementHookPatch(
      state,
      spaceId as ActionSpaceId,
      playerId,
    ),
    ...(suppressMagePowers
      ? {}
      : technomancyOnPlacePatch(state, playerId, mageId, spaceId as ActionSpaceId)),
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
 * "Draw a Spell Card" — pulls the top of the spell deck into the player's
 * spellbook and spends 1 INT to learn it (`intPlaced: true`), mirroring
 * Adventuring B's draft INT cost. Returns an empty patch when the deck
 * is empty. Throws if the player has no spare INT — callers should gate
 * the option behind an availability check so the prompt UI grays it out
 * before the engine has to defend itself.
 */
function drawAndLearnTopOfSpellDeck(
  state: GameState,
  playerId: PlayerId,
): GameStatePatch {
  const top = state.spellDeck[0];
  if (top === undefined) return {};
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.resources.intelligence < 1) {
    throw new Error(
      'drawAndLearnTopOfSpellDeck: requires 1 INT to learn the spell',
    );
  }
  return {
    spellDeck: state.spellDeck.slice(1),
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              intelligence: p.resources.intelligence - 1,
            },
            ownedSpells: [
              ...p.ownedSpells,
              {
                cardId: top,
                intPlaced: true,
                wisPlacedLevel2: false,
                wisPlacedLevel3: false,
                exhausted: false,
              },
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
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
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

  function teleportCandidates(state: GameState): string[] {
    const player = state.players.find(
      (p) => p.id === ctx.triggeringPlayerId,
    );
    return (
      player?.mages
        .filter(
          (m) =>
            (m.location.kind === 'action-space' && !m.isWounded) ||
            m.location.kind === 'infirmary',
        )
        .map((m) => m.id) ?? []
    );
  }

  // pick-mage uses `choose-target-mage` so the player can click the mage
  // directly on the board (Infirmary mages get clickable buttons in the
  // Infirmary roster). No "Stop" sibling on this prompt — a separate
  // Yes/No appears after the first move resolves for the optional second.
  if (step === 'pick-mage') {
    const candidates = teleportCandidates(ctx.state);
    if (candidates.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: candidates,
        },
        resume: { effectId: self, context: { step: 'pick-slot', done } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-slot expected mage-chosen`);
    }
    const sourceMageId = ctx.resumeAnswer.mageId;
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
          context: { step: 'apply', done, sourceMageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    const sourceMageId = ctx.resumeContext?.['sourceMageId'];
    if (typeof sourceMageId !== 'string') {
      throw new Error(`${self} apply: missing sourceMageId`);
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
    const candidates = teleportCandidates(stateAfter);
    if (candidates.length === 0) return { kind: 'done', patch: movePatch };
    // After the first move, ask Yes/No for the optional second move. Picking
    // "continue" loops back to pick-mage; "stop" ends the spell.
    return {
      kind: 'pause',
      patch: movePatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'continue', label: 'Move another Mage', payload: {} },
            { id: 'stop', label: 'Stop', payload: {} },
          ],
        },
        resume: {
          effectId: self,
          context: { step: 'maybe-continue', done: newDone },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'maybe-continue') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} maybe-continue expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') {
      return { kind: 'done', patch: {} };
    }
    const candidates = teleportCandidates(ctx.state);
    if (candidates.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: candidates,
        },
        resume: { effectId: self, context: { step: 'pick-slot', done } },
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
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
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
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
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
    // Include `rooms` if any heals released Infirmary B buffed slots.
    return {
      kind: 'done',
      patch: {
        players: working.players,
        ...(working.rooms !== ctx.state.rooms ? { rooms: working.rooms } : {}),
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
    patch: {
      players: working.players,
      ...(working.rooms !== ctx.state.rooms ? { rooms: working.rooms } : {}),
    },
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
  // Forward `rooms` too: `returnMageToOfficePatch` may release Infirmary B
  // buffed slots, and dropping that diff leaves the slot stuck "occupied"
  // even though the mage is no longer wounded.
  return {
    kind: 'done',
    patch: {
      players: working.players,
      ...(working.rooms !== ctx.state.rooms ? { rooms: working.rooms } : {}),
    },
  };
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
  // Forward `rooms` too so Infirmary B buffed slots vacated by any of the
  // chained heals actually clear in the engine state.
  const roomsPatch =
    working.rooms !== ctx.state.rooms ? { rooms: working.rooms } : {};
  const players = working.players;
  if (!healedOpponent) {
    return { kind: 'done', patch: { players, ...roomsPatch } };
  }
  // +2 IP for returning at least one opponent's mage.
  const stateWithHeals: GameState = { ...ctx.state, players };
  const ipPatch = bumpInfluencePatch(
    stateWithHeals,
    ctx.triggeringPlayerId,
    2,
  );
  return { kind: 'done', patch: { ...ipPatch, ...roomsPatch } };
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
          // Only target slots whose shadow position is empty, in rooms that
          // actually have shadow positions (skip Great Hall / Golem Lab).
          const spaceId = (
            m.location as { kind: 'action-space'; spaceId: string }
          ).spaceId;
          const room = ctx.state.rooms.find((r) =>
            r.actionSpaces.some((s) => s.id === spaceId),
          );
          if (!room || room.noShadowSlots) return false;
          const space = room.actionSpaces.find((s) => s.id === spaceId);
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
  const patch: GameStatePatch = {
    players: working.players,
    rooms: working.rooms,
  };
  // Carry forward any Revival enqueue side-effects from the per-wound patches.
  if (working.pendingRevivalChecks !== state.pendingRevivalChecks) {
    patch.pendingRevivalChecks = working.pendingRevivalChecks;
  }
  return { patch, events };
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

/** Spell-source woundable mages in a given room. When `ignorePowers` is set
 *  (Devastation Now L3), colour-based protections are bypassed. */
function buildWoundableMagesInRoom(
  state: GameState,
  casterId: string,
  roomId: string,
  ignorePowers = false,
): string[] {
  const eligible = new Set(
    ignorePowers
      ? buildHarmfulMageTargets(state, casterId, {
          source: 'spell',
          effect: 'wound',
          ignorePowers: true,
        })
      : buildBurnTargets(state, casterId),
  );
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

// ============================================================================
// Devastation Now (Sorcery, Mancers) — registered here for access to the
// wound-all-in-room / batch helpers above.
//   L1 Conflagration (3 Mana): Lock a room that currently has no Mages in it.
//   L2 Fire Storm   (4 Mana): Wound all Mages in a room, then lock that room.
//   L3 Devastation  (6 Mana, once/game): Wound all Mages in a non-central
//      campus room ignoring Mage powers, then destroy the room.
// ============================================================================

/** True when no Mage (base or shadow) occupies any slot of the room. */
function roomHasNoMages(state: GameState, roomId: string): boolean {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  return room.actionSpaces.every((s) => !s.occupant && !s.shadowOccupant);
}

/** Returns a room-name option list for a choose-from-options room picker. */
function roomOptions(state: GameState, roomIds: string[]): ChoiceOption[] {
  return roomIds.map((rid) => ({
    id: rid,
    label: state.rooms.find((r) => r.id === rid)?.name ?? rid,
    payload: {},
  }));
}

registerEffect('mancers.spell.devastation-now.l1', (ctx): EffectResult => {
  const self = 'mancers.spell.devastation-now.l1';
  if (!ctx.resumeAnswer) {
    const eligible = ctx.state.rooms
      .filter(
        (r) =>
          !r.cannotBeLocked &&
          !ctx.state.roomLocks.some((l) => l.roomId === r.id) &&
          roomHasNoMages(ctx.state, r.id),
      )
      .map((r) => r.id);
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options: roomOptions(ctx.state, eligible) },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(`${self} expected option-chosen`);
  }
  return { kind: 'done', patch: applyRoomLockPatch(ctx.state, ctx.resumeAnswer.optionId) };
});

registerEffect('mancers.spell.devastation-now.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.devastation-now.l2';
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    const eligible = ctx.state.rooms
      .filter(
        (r) =>
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id).length > 0,
      )
      .map((r) => r.id);
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options: roomOptions(ctx.state, eligible) },
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
    const mageIds = buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, roomId);
    if (mageIds.length === 0) return { kind: 'done', patch: {} };
    const wounded = woundManyMages(ctx.state, mageIds, ctx.triggeringPlayerId);
    const reactorQueue = buildBatchReactorQueue(
      ctx.state,
      ctx.triggeringPlayerId,
      wounded.events,
    );
    // "then lock that room" — unconditional, applied alongside the wounds.
    const lockPatch = ctx.state.rooms.find((r) => r.id === roomId)?.cannotBeLocked
      ? {}
      : applyRoomLockPatch(ctx.state, roomId);
    return {
      kind: 'open-reaction',
      patch: { ...wounded.patch, ...lockPatch },
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

/** Destroys a room: evicts any Mage still in it (a wound reaction may have
 *  repositioned one back) to its owner's office, removes the room from the
 *  board, and nulls its grid cell so adjacency treats it as a wall. */
function destroyRoomPatch(state: GameState, roomId: string): GameStatePatch {
  let working = state;
  const room = state.rooms.find((r) => r.id === roomId);
  const stragglers: string[] = [];
  if (room) {
    for (const s of room.actionSpaces) {
      if (s.occupant) stragglers.push(s.occupant.mageId);
      if (s.shadowOccupant) stragglers.push(s.shadowOccupant.mageId);
    }
  }
  for (const mid of stragglers) {
    working = { ...working, ...returnMageToOfficePatch(working, mid) };
  }
  const grid = working.roomLayout.grid.map((row) =>
    row.map((cell) => (cell === roomId ? null : cell)),
  );
  return {
    players: working.players,
    rooms: working.rooms.filter((r) => r.id !== roomId),
    roomLayout: { ...working.roomLayout, grid },
    roomLocks: working.roomLocks.filter((l) => l.roomId !== roomId),
  };
}

// Destroys the chosen room once the L3 wound's reaction window has resolved.
registerEffect('mancers.spell.devastation-now.l3.destroy', (ctx): EffectResult => {
  const roomId = ctx.resumeContext?.['roomId'];
  if (typeof roomId !== 'string') return { kind: 'done', patch: {} };
  return { kind: 'done', patch: destroyRoomPatch(ctx.state, roomId) };
});

registerEffect('mancers.spell.devastation-now.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.devastation-now.l3';
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    // Any non-central-campus room may be targeted (even an empty one — the
    // destruction still happens, the wound simply hits nobody).
    const eligible = ctx.state.rooms
      .filter((r) => !r.isUniversityCentral)
      .map((r) => r.id);
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options: roomOptions(ctx.state, eligible) },
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
      true, // ignore Mage powers
    );
    if (mageIds.length === 0) {
      // Nothing to wound — destroy the room outright.
      return { kind: 'done', patch: destroyRoomPatch(ctx.state, roomId) };
    }
    const wounded = woundManyMages(ctx.state, mageIds, ctx.triggeringPlayerId);
    const reactorQueue = buildBatchReactorQueue(
      ctx.state,
      ctx.triggeringPlayerId,
      wounded.events,
    );
    // Wound all (ignoring powers) now; destroy the room AFTER the wound's
    // reaction window settles (so reactions resolve before the room is gone).
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: wounded.events,
        pendingResponderIds: reactorQueue,
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'mancers.spell.devastation-now.l3.destroy',
          context: { roomId },
        },
        source: ctx.source,
      },
    };
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ============================================================================
// Divine Cataclysm (Divinity, Mancers) — registered here for access to the
// wound / banish / wound-all-in-room + Infirmary-bonus helpers.
//   L1 Holy Bolt    (1 Mana): Wound a Mage, then return a Mage from the
//      Infirmary to its owner's office.
//   L2 Holy Smite   (3 Mana): Banish a Mage, then return ALL of your Mages in
//      the Infirmary to your office.
//   L3 Holy Tempest (5 Mana): Wound all Mages in a room, then return ALL of
//      your Mages in the Infirmary to your office.
// ============================================================================

/** Returns every one of `playerId`'s Infirmary Mages to their office. */
function returnAllOwnInfirmaryPatch(
  state: GameState,
  playerId: string,
): GameStatePatch {
  let working = state;
  const player = state.players.find((p) => p.id === playerId);
  const ids =
    player?.mages
      .filter((m) => m.location.kind === 'infirmary')
      .map((m) => m.id) ?? [];
  for (const id of ids) {
    working = { ...working, ...returnMageToOfficePatch(working, id) };
  }
  if (ids.length === 0) return {};
  return {
    players: working.players,
    ...(working.rooms !== state.rooms ? { rooms: working.rooms } : {}),
  };
}

/** Prompt the caster to return one Mage from any Infirmary to its owner's
 *  office (Holy Bolt's "then" clause). Returns done when none are present. */
function holyBoltReturnStep(ctx: EffectContext, self: string): EffectResult {
  const infirmary = ctx.state.players
    .flatMap((p) => p.mages)
    .filter((m) => m.location.kind === 'infirmary')
    .map((m) => m.id);
  if (infirmary.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: infirmary,
        label: "Return which Mage from the Infirmary to its owner's office?",
      },
      resume: { effectId: self, context: { step: 'apply-return' } },
      source: ctx.source,
    },
  };
}

registerEffect('mancers.spell.divine-cataclysm.l1', (ctx): EffectResult => {
  const self = 'mancers.spell.divine-cataclysm.l1';
  const step = ctx.resumeContext?.['step'];

  if (step === 'after-wound') {
    // Standard victim Infirmary bonus first (if applicable), then the return.
    const event = readTriggerEvent(ctx);
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
          effectId: self,
          context: { step: 'after-bonus', recipientPlayerId: event.ownerId },
        }),
      };
    }
    return holyBoltReturnStep(ctx, self);
  }

  if (step === 'after-bonus') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} after-bonus expected option-chosen`);
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error(`${self} after-bonus: missing recipientPlayerId`);
    }
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
    );
    const next = holyBoltReturnStep({ ...ctx, state: { ...ctx.state, ...bonusPatch } }, self);
    if (next.kind === 'pause') {
      return { kind: 'pause', patch: bonusPatch, pending: next.pending };
    }
    return { kind: 'done', patch: { ...bonusPatch, ...(next.patch ?? {}) } };
  }

  if (step === 'apply-return') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply-return expected mage-chosen`);
    }
    return { kind: 'done', patch: returnMageToOfficePatch(ctx.state, ctx.resumeAnswer.mageId) };
  }

  if (step === 'wound') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} wound expected mage-chosen`);
    }
    const wound = woundMage(ctx.state, ctx.resumeAnswer.mageId, ctx.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: wound.patch,
      window: {
        triggerEvents: [wound.triggerEvent],
        pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
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

  // Initial: choose a Mage to wound. If none, the spell still tries the return.
  const targets = buildBurnTargets(ctx.state, ctx.triggeringPlayerId);
  if (targets.length === 0) return holyBoltReturnStep(ctx, self);
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: targets, label: 'Wound which Mage?' },
      resume: { effectId: self, context: { step: 'wound' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.divine-cataclysm.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.divine-cataclysm.l2';
  const step = ctx.resumeContext?.['step'];

  if (step === 'after-banish') {
    // The banish's reaction window has settled — return all your Infirmary Mages.
    return { kind: 'done', patch: returnAllOwnInfirmaryPatch(ctx.state, ctx.triggeringPlayerId) };
  }

  if (step === 'banish') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} banish expected mage-chosen`);
    }
    const banished = banishMage(ctx.state, ctx.resumeAnswer.mageId, ctx.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: banished.patch,
      window: {
        triggerEvents: [banished.triggerEvent],
        pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: { effectId: self, context: { step: 'after-banish' } },
        source: ctx.source,
      },
    };
  }

  // Initial: choose a Mage to banish. If none, still return your Infirmary Mages.
  const targets = buildBanishTargets(ctx.state, ctx.triggeringPlayerId);
  if (targets.length === 0) {
    return { kind: 'done', patch: returnAllOwnInfirmaryPatch(ctx.state, ctx.triggeringPlayerId) };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: targets, label: 'Banish which Mage?' },
      resume: { effectId: self, context: { step: 'banish' } },
      source: ctx.source,
    },
  };
});

// Returns all the caster's Infirmary Mages once Holy Tempest's wound reaction
// window has resolved.
registerEffect('mancers.spell.divine-cataclysm.l3.return', (ctx): EffectResult => ({
  kind: 'done',
  patch: returnAllOwnInfirmaryPatch(ctx.state, ctx.triggeringPlayerId),
}));

registerEffect('mancers.spell.divine-cataclysm.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.divine-cataclysm.l3';
  const step = ctx.resumeContext?.['step'];

  if (!ctx.resumeAnswer) {
    const eligible = ctx.state.rooms
      .filter(
        (r) =>
          buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, r.id).length > 0,
      )
      .map((r) => r.id);
    // No woundable Mages anywhere — still return your Infirmary Mages.
    if (eligible.length === 0) {
      return { kind: 'done', patch: returnAllOwnInfirmaryPatch(ctx.state, ctx.triggeringPlayerId) };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options: roomOptions(ctx.state, eligible) },
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
    const mageIds = buildWoundableMagesInRoom(ctx.state, ctx.triggeringPlayerId, roomId);
    if (mageIds.length === 0) {
      return { kind: 'done', patch: returnAllOwnInfirmaryPatch(ctx.state, ctx.triggeringPlayerId) };
    }
    const wounded = woundManyMages(ctx.state, mageIds, ctx.triggeringPlayerId);
    const reactorQueue = buildBatchReactorQueue(
      ctx.state,
      ctx.triggeringPlayerId,
      wounded.events,
    );
    // Like Nox, a room-wide wound grants no per-victim Infirmary bonus; the
    // caster's own "return all" benefit fires after the reaction window.
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: wounded.events,
        pendingResponderIds: reactorQueue,
        reactedPlayerIds: [],
        afterResume: { effectId: 'mancers.spell.divine-cataclysm.l3.return', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ============================================================================
// The Laws of Thaumodynamics (Technomancy, Mancers) — each level hits up to
// two Mages in a single room. Registered here for the batch banish/wound
// helpers and the place-chain primitive.
// ============================================================================

/** The id of the room a placed Mage occupies (base or shadow position). */
function roomIdOfPlacedMage(state: GameState, mageId: string): string | null {
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.occupant?.mageId === mageId || s.shadowOccupant?.mageId === mageId) {
        return r.id;
      }
    }
  }
  return null;
}

/**
 * Reusable "choose up to two Mages in a single room" selector. The first pick
 * fixes the room; the second (optional, pass-able) is restricted to that same
 * room. `eligible(state)` returns the candidate mage ids; once selection is
 * done, `apply(ctx, mageIds)` runs. Self-drives via `self` + the
 * 'two-in-room-*' resume steps.
 */
function chooseUpToTwoInRoom(
  ctx: EffectContext,
  self: string,
  eligible: (state: GameState) => string[],
  apply: (ctx: EffectContext, mageIds: string[]) => EffectResult,
  labels: { first: string; second: string },
): EffectResult {
  const step = ctx.resumeContext?.['step'];

  if (step === 'two-in-room-second') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} two-in-room-second expected mage-chosen`);
    }
    const firstId = ctx.resumeAnswer.mageId;
    const room = roomIdOfPlacedMage(ctx.state, firstId);
    const second = eligible(ctx.state).filter(
      (id) => id !== firstId && roomIdOfPlacedMage(ctx.state, id) === room,
    );
    if (second.length === 0) return apply(ctx, [firstId]);
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: second,
          canPass: true,
          label: labels.second,
        },
        resume: { effectId: self, context: { step: 'two-in-room-apply', firstId } },
        source: ctx.source,
      },
    };
  }

  if (step === 'two-in-room-apply') {
    const firstId = ctx.resumeContext?.['firstId'];
    if (typeof firstId !== 'string') return { kind: 'done', patch: {} };
    const ids = [firstId];
    if (ctx.resumeAnswer?.kind === 'mage-chosen') ids.push(ctx.resumeAnswer.mageId);
    return apply(ctx, ids);
  }

  // Initial: pick the first Mage (which fixes the room).
  const first = eligible(ctx.state);
  if (first.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: first, label: labels.first },
      resume: { effectId: self, context: { step: 'two-in-room-second' } },
      source: ctx.source,
    },
  };
}

/** Repositions a base-slot Mage into the SAME space's (empty) shadow position
 *  — Shadow Bomb's "move from a normal slot to the corresponding shadow slot". */
function moveMageBaseToShadowPatch(state: GameState, mageId: string): GameStatePatch {
  const space = state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.occupant?.mageId === mageId && !s.shadowOccupant);
  if (!space || !space.occupant) return {};
  const ownerId = space.occupant.ownerId;
  return {
    players: state.players.map((p) =>
      p.id !== ownerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId ? m : { ...m, isShadowing: true },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== space.id
          ? s
          : {
              ...s,
              occupant: null,
              shadowOccupant: { mageId, ownerId, isShadowing: true },
            },
      ),
    })),
  };
}

registerEffect('mancers.spell.the-laws-of-thaumodynamics.l1', (ctx): EffectResult => {
  const self = 'mancers.spell.the-laws-of-thaumodynamics.l1';
  // Eligible: move-targetable base-slot Mages whose space's shadow slot is open
  // and whose room actually has shadow positions.
  const eligible = (state: GameState): string[] => {
    const moveable = new Set(buildSpellMoveTargets(state, ctx.triggeringPlayerId));
    const out: string[] = [];
    for (const r of state.rooms) {
      if (r.cannotBePlacedInDirectly || r.noShadowSlots) continue;
      for (const s of r.actionSpaces) {
        if (s.occupant && !s.shadowOccupant && moveable.has(s.occupant.mageId)) {
          out.push(s.occupant.mageId);
        }
      }
    }
    return out;
  };
  const apply = (c: EffectContext, ids: string[]): EffectResult => {
    let working: GameState = c.state;
    const events: ReactionTriggerEvent[] = [];
    for (const id of ids) {
      const space = working.rooms
        .flatMap((r) => r.actionSpaces)
        .find((s) => s.occupant?.mageId === id && !s.shadowOccupant);
      if (!space || !space.occupant) continue;
      const ownerId = space.occupant.ownerId;
      working = { ...working, ...moveMageBaseToShadowPatch(working, id) };
      // Moving a Mage (even base→shadow in place) is a move — opponents may
      // react to it (Wrath of Heaven, Sacred Shield, Phase Steppers, …).
      events.push({
        kind: 'mage-moved',
        mageId: id,
        ownerId,
        fromSpaceId: space.id,
        toSpaceId: space.id,
        byPlayerId: c.triggeringPlayerId,
      });
    }
    if (events.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'open-reaction',
      patch: { players: working.players, rooms: working.rooms },
      window: {
        triggerEvents: events,
        pendingResponderIds: buildBatchReactorQueue(c.state, c.triggeringPlayerId, events),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: c.source,
      },
    };
  };
  return chooseUpToTwoInRoom(ctx, self, eligible, apply, {
    first: 'Move which Mage to its shadow slot?',
    second: 'Move a second Mage in the same room (or pass)',
  });
});

registerEffect('mancers.spell.the-laws-of-thaumodynamics.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.the-laws-of-thaumodynamics.l2';
  // Banishable Mages that are physically on a slot (banish can also reach the
  // Infirmary, but "in the same room" means placed).
  const eligible = (state: GameState): string[] => {
    const set = new Set(buildBanishTargets(state, ctx.triggeringPlayerId));
    return state.players
      .flatMap((p) => p.mages)
      .filter((m) => set.has(m.id) && m.location.kind === 'action-space')
      .map((m) => m.id);
  };
  const apply = (c: EffectContext, ids: string[]): EffectResult => {
    const banished = banishManyMages(c.state, ids, c.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: banished.patch,
      window: {
        triggerEvents: banished.events,
        pendingResponderIds: buildBatchReactorQueue(c.state, c.triggeringPlayerId, banished.events),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: c.source,
      },
    };
  };
  return chooseUpToTwoInRoom(ctx, self, eligible, apply, {
    first: 'Banish which Mage?',
    second: 'Banish a second Mage in the same room (or pass)',
  });
});

// "You may place a Mage into that room" — fires after Arcane Bomb's wound
// reaction window settles. Sets a single optional, room-restricted placement.
registerEffect('mancers.spell.the-laws-of-thaumodynamics.l3.place', (ctx): EffectResult => {
  const roomId = ctx.resumeContext?.['roomId'];
  if (typeof roomId !== 'string') return { kind: 'done', patch: {} };
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  const hasOffice = player?.mages.some((m) => m.location.kind === 'office') ?? false;
  if (!hasOffice) return { kind: 'done', patch: {} };
  if (listPlaceWithoutPowersSlots(ctx.state, ctx.triggeringPlayerId, roomId).length === 0) {
    return { kind: 'done', patch: {} };
  }
  return {
    kind: 'done',
    patch: {
      pendingPlaceChain: {
        playerId: ctx.triggeringPlayerId,
        source: ctx.source,
        remaining: 1,
        restrictRoomId: roomId,
        allowStop: true,
      },
    },
  };
});

registerEffect('mancers.spell.the-laws-of-thaumodynamics.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.the-laws-of-thaumodynamics.l3';
  const eligible = (state: GameState): string[] =>
    buildBurnTargets(state, ctx.triggeringPlayerId);
  const apply = (c: EffectContext, ids: string[]): EffectResult => {
    const roomId = roomIdOfPlacedMage(c.state, ids[0]!);
    const wounded = woundManyMages(c.state, ids, c.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvents: wounded.events,
        pendingResponderIds: buildBatchReactorQueue(c.state, c.triggeringPlayerId, wounded.events),
        reactedPlayerIds: [],
        // After the wounds resolve, optionally place a Mage into that room.
        afterResume: {
          effectId: 'mancers.spell.the-laws-of-thaumodynamics.l3.place',
          context: { roomId: roomId ?? '' },
        },
        source: c.source,
      },
    };
  };
  return chooseUpToTwoInRoom(ctx, self, eligible, apply, {
    first: 'Wound which Mage?',
    second: 'Wound a second Mage in the same room (or pass)',
  });
});

// ============================================================================
// Breath of Winter (Natural Magick, Mancers) — three single-target wound
// variants, all driven by the shared castSingleWound helper.
//   L1 Frost        (Free): wound a Mage in a room with one of yours.
//   L2 Frost Bolt   (1 Mana, Fast): wound any Mage.
//   L3 Freezing Bolt(1 Mana, Fast): wound a Mage in an opponent's office.
// ============================================================================

/**
 * Reusable "wound one chosen Mage" spell flow: prompt a target from
 * `targets(state)`, wound it (opening the standard wound reaction window),
 * then surface the victim's Infirmary bonus if applicable. Self-drives via
 * `self` + the 'wound' / 'after-wound' / 'after-bonus' resume steps.
 */
function castSingleWound(
  ctx: EffectContext,
  self: string,
  targets: (state: GameState) => string[],
): EffectResult {
  const step = ctx.resumeContext?.['step'];

  if (step === 'after-wound') {
    const event = readTriggerEvent(ctx);
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
          effectId: self,
          context: { step: 'after-bonus', recipientPlayerId: event.ownerId },
        }),
      };
    }
    return { kind: 'done', patch: {} };
  }

  if (step === 'after-bonus') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} after-bonus expected option-chosen`);
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error(`${self} after-bonus: missing recipientPlayerId`);
    }
    return {
      kind: 'done',
      patch: applyInfirmaryBonusFromCtx(ctx.state, recipientId, ctx.resumeAnswer, ctx.resumeContext),
    };
  }

  if (step === 'wound') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} wound expected mage-chosen`);
    }
    const wound = woundMage(ctx.state, ctx.resumeAnswer.mageId, ctx.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: wound.patch,
      window: {
        triggerEvents: [wound.triggerEvent],
        pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: {
          effectId: self,
          context: { step: 'after-wound', triggerEvent: triggerEventToContext(wound.triggerEvent) },
        },
        source: ctx.source,
      },
    };
  }

  const eligible = targets(ctx.state);
  if (eligible.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: eligible, label: 'Wound which Mage?' },
      resume: { effectId: self, context: { step: 'wound' } },
      source: ctx.source,
    },
  };
}

/** Woundable Mages sharing a room with one of the caster's own Mages. */
function buildCoLocatedWoundTargets(state: GameState, casterId: string): string[] {
  const casterRooms = new Set<string>();
  for (const r of state.rooms) {
    if (
      r.actionSpaces.some(
        (s) => s.occupant?.ownerId === casterId || s.shadowOccupant?.ownerId === casterId,
      )
    ) {
      casterRooms.add(r.id);
    }
  }
  return buildBurnTargets(state, casterId).filter((id) => {
    const room = roomIdOfPlacedMage(state, id);
    return room !== null && casterRooms.has(room);
  });
}

/** Mages in an OPPONENT's office that a spell can wound — green (wound-immune)
 *  and opposing-blue (spell-immune) are protected unless Mages have lost their
 *  powers (Mesmerize), in which case green's protection drops. */
function buildOpponentOfficeWoundTargets(state: GameState, casterId: string): string[] {
  const powersLost = magesLosePowers(state);
  const out: string[] = [];
  for (const p of state.players) {
    if (p.id === casterId) continue;
    for (const m of p.mages) {
      if (m.location.kind !== 'office' || m.isWounded) continue;
      if (!powersLost && colorAbilityActive(state, m, 'green')) continue;
      if (colorAbilityActive(state, m, 'blue')) continue;
      out.push(m.id);
    }
  }
  return out;
}

registerEffect('mancers.spell.breath-of-winter.l1', (ctx): EffectResult =>
  castSingleWound(ctx, 'mancers.spell.breath-of-winter.l1', (state) =>
    buildCoLocatedWoundTargets(state, ctx.triggeringPlayerId),
  ),
);
registerEffect('mancers.spell.breath-of-winter.l2', (ctx): EffectResult =>
  castSingleWound(ctx, 'mancers.spell.breath-of-winter.l2', (state) =>
    buildBurnTargets(state, ctx.triggeringPlayerId),
  ),
);
registerEffect('mancers.spell.breath-of-winter.l3', (ctx): EffectResult =>
  castSingleWound(ctx, 'mancers.spell.breath-of-winter.l3', (state) =>
    buildOpponentOfficeWoundTargets(state, ctx.triggeringPlayerId),
  ),
);

// ============================================================================
// Beyond the Beyonds (Planar Studies, Mancers) — room control.
//   L1 Rift  (1 Mana, Fast): lock a room until the start of your next turn.
//   L2 Shift (2 Mana):       swap two Mages in two different rooms.
//   L3 Flux  (5 Mana):       flip a non-central room to its other side, then
//      rearrange the Mages that were in it onto the new side.
// ============================================================================

/** A placed Mage's slot, position, and owner. */
function placedAt(
  state: GameState,
  mageId: string,
): { spaceId: string; position: 'base' | 'shadow'; ownerId: string } | null {
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.occupant?.mageId === mageId) {
        return { spaceId: s.id, position: 'base', ownerId: s.occupant.ownerId };
      }
      if (s.shadowOccupant?.mageId === mageId) {
        return { spaceId: s.id, position: 'shadow', ownerId: s.shadowOccupant.ownerId };
      }
    }
  }
  return null;
}

registerEffect('mancers.spell.beyond-the-beyonds.l1', (ctx): EffectResult => {
  const self = 'mancers.spell.beyond-the-beyonds.l1';
  if (!ctx.resumeAnswer) {
    const eligible = ctx.state.rooms
      .filter(
        (r) => !r.cannotBeLocked && !ctx.state.roomLocks.some((l) => l.roomId === r.id),
      )
      .map((r) => r.id);
    if (eligible.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options: roomOptions(ctx.state, eligible) },
        resume: { effectId: self, context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(`${self} expected option-chosen`);
  }
  // The lock clears at the start of the caster's next turn (or Resolution).
  return {
    kind: 'done',
    patch: {
      roomLocks: [
        ...ctx.state.roomLocks,
        { roomId: ctx.resumeAnswer.optionId, untilTurnStartOf: ctx.triggeringPlayerId },
      ],
    },
  };
});

/** Swaps the slot positions of two placed Mages, emitting a mage-moved event
 *  for each (so opponents may react to being moved). */
function swapTwoPlacedMagesPatch(
  state: GameState,
  idA: string,
  idB: string,
  byPlayerId: string,
): { patch: GameStatePatch; events: ReactionTriggerEvent[] } {
  const a = placedAt(state, idA);
  const b = placedAt(state, idB);
  if (!a || !b) return { patch: {}, events: [] };
  const occA = { mageId: idA, ownerId: a.ownerId, isShadowing: b.position === 'shadow' };
  const occB = { mageId: idB, ownerId: b.ownerId, isShadowing: a.position === 'shadow' };
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) => {
      let occupant = s.occupant;
      let shadowOccupant: WorkerOccupancy | null = s.shadowOccupant ?? null;
      if (s.id === a.spaceId) {
        // A's old slot now holds B.
        if (a.position === 'base') occupant = occB;
        else shadowOccupant = occB;
      }
      if (s.id === b.spaceId) {
        if (b.position === 'base') occupant = occA;
        else shadowOccupant = occA;
      }
      return { ...s, occupant, shadowOccupant };
    }),
  }));
  const players = state.players.map((p) => ({
    ...p,
    mages: p.mages.map((m) => {
      if (m.id === idA) {
        return { ...m, location: { kind: 'action-space' as const, spaceId: b.spaceId }, isShadowing: b.position === 'shadow' };
      }
      if (m.id === idB) {
        return { ...m, location: { kind: 'action-space' as const, spaceId: a.spaceId }, isShadowing: a.position === 'shadow' };
      }
      return m;
    }),
  }));
  const events: ReactionTriggerEvent[] = [
    { kind: 'mage-moved', mageId: idA, ownerId: a.ownerId, fromSpaceId: a.spaceId, toSpaceId: b.spaceId, byPlayerId },
    { kind: 'mage-moved', mageId: idB, ownerId: b.ownerId, fromSpaceId: b.spaceId, toSpaceId: a.spaceId, byPlayerId },
  ];
  return { patch: { players, rooms }, events };
}

registerEffect('mancers.spell.beyond-the-beyonds.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.beyond-the-beyonds.l2';
  const step = ctx.resumeContext?.['step'];
  const placedMoveable = (state: GameState): string[] =>
    buildSpellMoveTargets(state, ctx.triggeringPlayerId).filter(
      (id) => roomIdOfPlacedMage(state, id) !== null,
    );

  if (step === 'second') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} second expected mage-chosen`);
    }
    const firstId = ctx.resumeAnswer.mageId;
    const firstRoom = roomIdOfPlacedMage(ctx.state, firstId);
    const second = placedMoveable(ctx.state).filter(
      (id) => id !== firstId && roomIdOfPlacedMage(ctx.state, id) !== firstRoom,
    );
    if (second.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: second, label: 'Swap with which Mage (in a different room)?' },
        resume: { effectId: self, context: { step: 'apply', firstId } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const firstId = ctx.resumeContext?.['firstId'];
    if (typeof firstId !== 'string') return { kind: 'done', patch: {} };
    const { patch, events } = swapTwoPlacedMagesPatch(
      ctx.state,
      firstId,
      ctx.resumeAnswer.mageId,
      ctx.triggeringPlayerId,
    );
    if (events.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'open-reaction',
      patch,
      window: {
        triggerEvents: events,
        pendingResponderIds: buildBatchReactorQueue(ctx.state, ctx.triggeringPlayerId, events),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }

  // Initial: need a placed Mage with at least one other placed Mage elsewhere.
  const first = placedMoveable(ctx.state).filter((id) => {
    const room = roomIdOfPlacedMage(ctx.state, id);
    return placedMoveable(ctx.state).some((o) => o !== id && roomIdOfPlacedMage(ctx.state, o) !== room);
  });
  if (first.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: first, label: 'Swap which Mage?' },
      resume: { effectId: self, context: { step: 'second' } },
      source: ctx.source,
    },
  };
});

/** The room id of the opposite side (`.a` ↔ `.b`). */
function oppositeSideRoomId(roomId: string): string {
  if (roomId.endsWith('.a')) return `${roomId.slice(0, -2)}.b`;
  if (roomId.endsWith('.b')) return `${roomId.slice(0, -2)}.a`;
  return roomId;
}

/** Looks up a room definition (any side) from the active packs' content. */
function lookupRoomDef(state: GameState, roomId: string): Room | null {
  for (const pid of state.activePackIds) {
    const pack = getPack(pid);
    const found = pack?.rooms.find((r) => r.id === roomId);
    if (found) return found;
  }
  return null;
}

/** Directly seats a Mage on a base slot (no powers, no reactions) — used by
 *  Flux's rearrange step. */
function placeMageDirect(state: GameState, mageId: string, spaceId: string): GameStatePatch {
  const owner = state.players.find((p) => p.mages.some((m) => m.id === mageId));
  if (!owner) return {};
  return {
    players: state.players.map((p) =>
      p.id !== owner.id
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : { ...m, location: { kind: 'action-space' as const, spaceId }, isShadowing: false },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId ? s : { ...s, occupant: { mageId, ownerId: owner.id, isShadowing: false } },
      ),
    })),
  };
}

/** Flips a room to its opposite side: swaps in a fresh copy of the other-side
 *  definition (empty slots), repoints the grid cell, drops any lock, and parks
 *  the room's Mages in their owners' offices to be rearranged. */
function flipRoomPatch(
  state: GameState,
  roomId: string,
): { patch: GameStatePatch; newRoomId: string; queue: string[] } | null {
  const oldRoom = state.rooms.find((r) => r.id === roomId);
  if (!oldRoom) return null;
  const newRoomId = oppositeSideRoomId(roomId);
  const def = lookupRoomDef(state, newRoomId);
  if (!def) return null;
  const queue: string[] = [];
  for (const s of oldRoom.actionSpaces) {
    if (s.occupant) queue.push(s.occupant.mageId);
    if (s.shadowOccupant) queue.push(s.shadowOccupant.mageId);
  }
  const fresh: Room = {
    ...def,
    actionSpaces: def.actionSpaces.map((s) => ({ ...s, occupant: null, shadowOccupant: null })),
  };
  const moved = new Set(queue);
  const patch: GameStatePatch = {
    rooms: state.rooms.map((r) => (r.id === roomId ? fresh : r)),
    roomLayout: {
      ...state.roomLayout,
      grid: state.roomLayout.grid.map((row) => row.map((c) => (c === roomId ? newRoomId : c))),
    },
    players: state.players.map((p) => ({
      ...p,
      mages: p.mages.map((m) =>
        moved.has(m.id)
          ? { ...m, location: { kind: 'office' as const, playerId: p.id }, isShadowing: false }
          : m,
      ),
    })),
    roomLocks: state.roomLocks.filter((l) => l.roomId !== roomId),
  };
  return { patch, newRoomId, queue };
}

/** Surfaces the next "place a Mage onto the flipped room" prompt, or finishes
 *  when the queue is empty / the room is full (leftover Mages stay in office). */
function fluxNextPlacement(
  ctx: EffectContext,
  self: string,
  deltaPatch: GameStatePatch,
  newRoomId: string,
  queue: string[],
): EffectResult {
  const working: GameState = { ...ctx.state, ...deltaPatch };
  const open = openBaseSlotsInRoom(working, newRoomId);
  if (queue.length === 0 || open.length === 0) {
    return { kind: 'done', patch: deltaPatch };
  }
  return {
    kind: 'pause',
    patch: deltaPatch,
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-action-space',
        eligibleSpaceIds: open,
        label: 'Rearrange: place the next Mage onto a slot',
      },
      resume: { effectId: self, context: { step: 'flux-place', newRoomId, queue } },
      source: ctx.source,
    },
  };
}

registerEffect('mancers.spell.beyond-the-beyonds.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.beyond-the-beyonds.l3';
  const step = ctx.resumeContext?.['step'];

  if (step === 'flux-place') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} flux-place expected space-chosen`);
    }
    const newRoomId = ctx.resumeContext?.['newRoomId'];
    const queue = ctx.resumeContext?.['queue'];
    if (typeof newRoomId !== 'string' || !Array.isArray(queue) || queue.length === 0) {
      return { kind: 'done', patch: {} };
    }
    const placePatch = placeMageDirect(ctx.state, queue[0] as string, ctx.resumeAnswer.spaceId);
    return fluxNextPlacement(ctx, self, placePatch, newRoomId, (queue as string[]).slice(1));
  }

  if (step === 'flip') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} flip expected option-chosen`);
    }
    const flip = flipRoomPatch(ctx.state, ctx.resumeAnswer.optionId);
    if (!flip) return { kind: 'done', patch: {} };
    return fluxNextPlacement(ctx, self, flip.patch, flip.newRoomId, flip.queue);
  }

  // Initial: choose a non-central room that has an opposite-side definition.
  const eligible = ctx.state.rooms
    .filter((r) => !r.isUniversityCentral && lookupRoomDef(ctx.state, oppositeSideRoomId(r.id)) !== null)
    .map((r) => r.id);
  if (eligible.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options: roomOptions(ctx.state, eligible) },
      resume: { effectId: self, context: { step: 'flip' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// The Black Chronicle, v13 (Mysticism, Mancers) — shadow-pair manipulation.
//   L1 Creep   (Free):   wound a Mage shadowed by one of yours.
//   L2 Envelop (1 Mana):  swap a base Mage and the Mage shadowing it.
//   L3 Death   (4 Mana):  remove a Mage shadowed by one of yours from the
//      game, then put a supply Mage of your choice into its owner's office.
// ============================================================================

/** Base Mages whose slot is shadowed by one of `casterId`'s Mages. */
function magesShadowedByCaster(state: GameState, casterId: string): string[] {
  const out: string[] = [];
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.occupant && s.shadowOccupant?.ownerId === casterId) {
        out.push(s.occupant.mageId);
      }
    }
  }
  return out;
}

registerEffect('mancers.spell.the-black-chronicle-v13.l1', (ctx): EffectResult =>
  castSingleWound(ctx, 'mancers.spell.the-black-chronicle-v13.l1', (state) => {
    const shadowed = new Set(magesShadowedByCaster(state, ctx.triggeringPlayerId));
    return buildBurnTargets(state, ctx.triggeringPlayerId).filter((id) => shadowed.has(id));
  }),
);

/** Swaps a base Mage and the Mage shadowing its slot (positions flip in place),
 *  emitting a mage-moved event for each so opponents may react. */
function swapBaseAndShadowPatch(
  state: GameState,
  baseMageId: string,
  byPlayerId: string,
): { patch: GameStatePatch; events: ReactionTriggerEvent[] } {
  const space = state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.occupant?.mageId === baseMageId && s.shadowOccupant);
  if (!space?.occupant || !space.shadowOccupant) return { patch: {}, events: [] };
  const baseOcc = space.occupant;
  const shadowOcc = space.shadowOccupant;
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) =>
      s.id !== space.id
        ? s
        : {
            ...s,
            occupant: { ...shadowOcc, isShadowing: false },
            shadowOccupant: { ...baseOcc, isShadowing: true },
          },
    ),
  }));
  const players = state.players.map((p) => ({
    ...p,
    mages: p.mages.map((m) => {
      if (m.id === baseOcc.mageId) return { ...m, isShadowing: true };
      if (m.id === shadowOcc.mageId) return { ...m, isShadowing: false };
      return m;
    }),
  }));
  const events: ReactionTriggerEvent[] = [
    { kind: 'mage-moved', mageId: baseOcc.mageId, ownerId: baseOcc.ownerId, fromSpaceId: space.id, toSpaceId: space.id, byPlayerId },
    { kind: 'mage-moved', mageId: shadowOcc.mageId, ownerId: shadowOcc.ownerId, fromSpaceId: space.id, toSpaceId: space.id, byPlayerId },
  ];
  return { patch: { players, rooms }, events };
}

registerEffect('mancers.spell.the-black-chronicle-v13.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.the-black-chronicle-v13.l2';
  // Any base Mage that currently has a Mage shadowing it.
  const eligible = (state: GameState): string[] => {
    const out: string[] = [];
    for (const r of state.rooms) {
      for (const s of r.actionSpaces) {
        if (s.occupant && s.shadowOccupant) out.push(s.occupant.mageId);
      }
    }
    return out;
  };
  if (ctx.resumeContext?.['step'] === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} apply expected mage-chosen`);
    }
    const { patch, events } = swapBaseAndShadowPatch(ctx.state, ctx.resumeAnswer.mageId, ctx.triggeringPlayerId);
    if (events.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'open-reaction',
      patch,
      window: {
        triggerEvents: events,
        pendingResponderIds: buildBatchReactorQueue(ctx.state, ctx.triggeringPlayerId, events),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  const targets = eligible(ctx.state);
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: targets, label: 'Swap which Mage with the one shadowing it?' },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

/** Colours currently available in the supply pool (for Death's replacement). */
const SUPPLY_MAGE_COLORS: MageColor[] = ['red', 'grey', 'green', 'purple', 'blue', 'orange', 'off-white'];

/** Removes a Mage from the game (cleared from its slot AND its owner's roster —
 *  it goes back to the box, NOT the supply) and, when a colour is given, seats
 *  a fresh supply Mage of that colour in the removed Mage's owner's office. */
function deathRemoveAndReplacePatch(
  state: GameState,
  targetMageId: string,
  color: MageColor | null,
): GameStatePatch {
  const owner = state.players.find((p) => p.mages.some((m) => m.id === targetMageId));
  if (!owner) return {};
  const canAdd = color !== null && (state.mageDraftPool[color] ?? 0) > 0;
  const seq = state.nextSequenceId;
  const pool = { ...state.mageDraftPool };
  if (canAdd) pool[color] = (pool[color] ?? 0) - 1;
  const players = state.players.map((p) => {
    if (p.id !== owner.id) return p;
    const without = p.mages.filter((m) => m.id !== targetMageId);
    if (!canAdd) return { ...p, mages: without };
    return {
      ...p,
      mages: [
        ...without,
        {
          id: `m-${seq}`,
          cardId: MAGE_CARD_BY_COLOR[color],
          color,
          location: { kind: 'office' as const, playerId: p.id },
          isShadowing: false,
          isWounded: false,
        },
      ],
    };
  });
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) =>
      s.occupant?.mageId === targetMageId ? { ...s, occupant: null } : s,
    ),
  }));
  return { players, rooms, mageDraftPool: pool, ...(canAdd ? { nextSequenceId: seq + 1 } : {}) };
}

registerEffect('mancers.spell.the-black-chronicle-v13.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.the-black-chronicle-v13.l3';
  const step = ctx.resumeContext?.['step'];

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const targetMageId = ctx.resumeContext?.['targetMageId'];
    if (typeof targetMageId !== 'string') return { kind: 'done', patch: {} };
    return {
      kind: 'done',
      patch: deathRemoveAndReplacePatch(ctx.state, targetMageId, ctx.resumeAnswer.optionId as MageColor),
    };
  }

  if (step === 'pick-color') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-color expected mage-chosen`);
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const avail = SUPPLY_MAGE_COLORS.filter((c) => (ctx.state.mageDraftPool[c] ?? 0) > 0);
    // Supply empty for every colour — just remove the Mage from the game.
    if (avail.length === 0) {
      return { kind: 'done', patch: deathRemoveAndReplacePatch(ctx.state, targetMageId, null) };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: avail.map((c) => ({ id: c, label: `Supply: ${c} Mage`, payload: {} })),
        },
        resume: { effectId: self, context: { step: 'apply', targetMageId } },
        source: ctx.source,
      },
    };
  }

  // Initial: choose a Mage shadowed by one of yours.
  const targets = magesShadowedByCaster(ctx.state, ctx.triggeringPlayerId);
  if (targets.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-target-mage', eligibleMageIds: targets, label: 'Remove which shadowed Mage from the game?' },
      resume: { effectId: self, context: { step: 'pick-color' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Metamorphic Remediaries (Technomancy, Mancers) — Vault-card tricks.
//   L1 Arcane Copy (2 Mana, Fast): keep the next Vault Card you'd discard OR
//      exhaust this turn (sets both keep-flags; engine consumes one on play).
//   L2 Replicate   (3 Mana): use a wired Vault Card in an opponent's office
//      WITHOUT exhausting/discarding their copy.
//   L3 Transmute   (3 Mana, Fast): gain Gold = your INT, OR Mana = your WIS.
// ============================================================================

registerEffect('mancers.spell.metamorphic-remediaries.l1', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    players: ctx.state.players.map((p) =>
      p.id === ctx.triggeringPlayerId
        ? { ...p, nextVaultDiscardKept: true, nextVaultExhaustKept: true }
        : p,
    ),
  },
}));

registerEffect('mancers.spell.metamorphic-remediaries.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.metamorphic-remediaries.l2';
  if (ctx.resumeContext?.['step'] === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const cardId = ctx.resumeAnswer.optionId.split('::')[1];
    const def = cardId ? lookupVaultCardDef(ctx.state, cardId) : null;
    if (!def || !hasEffect(def.effectId)) return { kind: 'done', patch: {} };
    // Run the opponent's card AS the caster; their copy is untouched (not
    // exhausted/discarded), so we never go through PLAY_VAULT_CARD.
    return getEffect(def.effectId)({
      state: ctx.state,
      source: {
        kind: 'vault-card',
        id: def.id,
        triggeringPlayerId: ctx.triggeringPlayerId,
        description: def.name,
      },
      triggeringPlayerId: ctx.triggeringPlayerId,
      allowReactions: ctx.allowReactions,
    });
  }
  // Initial: list wired, non-reaction Vault Cards in opponents' offices.
  const options: ChoiceOption[] = [];
  for (const p of ctx.state.players) {
    if (p.id === ctx.triggeringPlayerId) continue;
    for (const v of p.vaultCards) {
      const def = lookupVaultCardDef(ctx.state, v.cardId);
      if (!def || def.timing === 'reaction' || !hasEffect(def.effectId)) continue;
      options.push({ id: `${p.id}::${v.cardId}`, label: `${def.name} (${p.id})`, payload: {} });
    }
  }
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.metamorphic-remediaries.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.metamorphic-remediaries.l3';
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  if (ctx.resumeContext?.['step'] === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    return ctx.resumeAnswer.optionId === 'gold'
      ? { kind: 'done', patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', player.resources.intelligence) }
      : { kind: 'done', patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', player.resources.wisdom) };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'gold', label: `Gain ${player.resources.intelligence} Gold (your INT)`, payload: {} },
          { id: 'mana', label: `Gain ${player.resources.wisdom} Mana (your WIS)`, payload: {} },
        ],
      },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Applied Entropy (Technomancy, Mancers) — Treasure disruption.
//   L1 Sap          (Free, Fast): exhaust an opponent's Treasure.
//   L2 Disintegrate (2 Mana): discard a Treasure to its owner's discard pile.
//   L3 Control      (3 Mana): use an opponent's Treasure as the caster, then
//      exhaust their copy.
// ============================================================================

/** `ownerId::cardId` option id used by the Treasure pickers. */
function parseOwnerCard(optionId: string): { ownerId: string; cardId: string } {
  const i = optionId.indexOf('::');
  return { ownerId: optionId.slice(0, i), cardId: optionId.slice(i + 2) };
}

/** Treasure options across players, filtered. id = `ownerId::cardId`. */
function treasureOptions(
  state: GameState,
  casterId: string,
  opts: { opponentsOnly: boolean; unexhaustedOnly: boolean; wiredOnly: boolean },
): ChoiceOption[] {
  const out: ChoiceOption[] = [];
  for (const p of state.players) {
    if (opts.opponentsOnly && p.id === casterId) continue;
    for (const v of p.vaultCards) {
      const def = lookupVaultCardDef(state, v.cardId);
      if (!def || def.type !== 'treasure') continue;
      if (opts.unexhaustedOnly && v.exhausted) continue;
      if (opts.wiredOnly && (def.timing === 'reaction' || !hasEffect(def.effectId))) continue;
      out.push({ id: `${p.id}::${v.cardId}`, label: `${def.name} (${p.id})`, payload: {} });
    }
  }
  return out;
}

/** Exhausts the first matching unexhausted Treasure copy in `ownerId`'s vault. */
function exhaustTreasurePatch(state: GameState, ownerId: string, cardId: string): GameStatePatch {
  return {
    players: state.players.map((p) => {
      if (p.id !== ownerId) return p;
      let done = false;
      return {
        ...p,
        vaultCards: p.vaultCards.map((v) => {
          if (!done && v.cardId === cardId && !v.exhausted) {
            done = true;
            return { ...v, exhausted: true };
          }
          return v;
        }),
      };
    }),
  };
}

registerEffect('mancers.spell.applied-entropy.l1', (ctx): EffectResult => {
  const self = 'mancers.spell.applied-entropy.l1';
  if (ctx.resumeAnswer?.kind === 'option-chosen') {
    const { ownerId, cardId } = parseOwnerCard(ctx.resumeAnswer.optionId);
    return { kind: 'done', patch: exhaustTreasurePatch(ctx.state, ownerId, cardId) };
  }
  const options = treasureOptions(ctx.state, ctx.triggeringPlayerId, {
    opponentsOnly: true,
    unexhaustedOnly: true,
    wiredOnly: false,
  });
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.applied-entropy.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.applied-entropy.l2';
  if (ctx.resumeAnswer?.kind === 'option-chosen') {
    const { ownerId, cardId } = parseOwnerCard(ctx.resumeAnswer.optionId);
    return {
      kind: 'done',
      patch: {
        players: ctx.state.players.map((p) => {
          if (p.id !== ownerId) return p;
          let removed = false;
          const vaultCards = p.vaultCards.filter((v) => {
            if (!removed && v.cardId === cardId) {
              removed = true;
              return false;
            }
            return true;
          });
          if (!removed) return p;
          return {
            ...p,
            vaultCards,
            personalDiscard: [...p.personalDiscard, { kind: 'consumable' as const, cardId }],
          };
        }),
      },
    };
  }
  // Any Treasure (its owner's discard pile receives it).
  const options = treasureOptions(ctx.state, ctx.triggeringPlayerId, {
    opponentsOnly: false,
    unexhaustedOnly: false,
    wiredOnly: false,
  });
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.applied-entropy.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.applied-entropy.l3';
  if (ctx.resumeAnswer?.kind === 'option-chosen') {
    const { ownerId, cardId } = parseOwnerCard(ctx.resumeAnswer.optionId);
    const def = lookupVaultCardDef(ctx.state, cardId);
    if (!def || !hasEffect(def.effectId)) return { kind: 'done', patch: {} };
    // Exhaust their copy, then run its effect AS the caster on that state. The
    // delegate's patches build on the exhausted state, so merging keeps it.
    const exhaustPatch = exhaustTreasurePatch(ctx.state, ownerId, cardId);
    const working: GameState = { ...ctx.state, ...exhaustPatch };
    const result = getEffect(def.effectId)({
      state: working,
      source: { kind: 'vault-card', id: def.id, triggeringPlayerId: ctx.triggeringPlayerId, description: def.name },
      triggeringPlayerId: ctx.triggeringPlayerId,
      allowReactions: ctx.allowReactions,
    });
    return { ...result, patch: { ...exhaustPatch, ...(result.patch ?? {}) } } as EffectResult;
  }
  const options = treasureOptions(ctx.state, ctx.triggeringPlayerId, {
    opponentsOnly: true,
    unexhaustedOnly: true,
    wiredOnly: true,
  });
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// The Eternal Engine (Technomancy, Mancers) — recycle Vault Cards to the deck.
//   L1 Extract  (Free): discard a ready Vault Card from office to the deck →
//      gain 4 Mana.
//   L2 Dissolve (1 Mana, Fast): discard a Vault Card from office to the deck →
//      move two of your Mages to their corresponding shadow slots.
//   L3 Absorb   (2 Mana): return a Vault Card from office or discard to the
//      deck → gain 1 WIS, 1 INT, or 7 Mana.
// ============================================================================

/** Removes a Vault Card from `playerId`'s office (or discard) and appends it to
 *  the bottom of the Vault Deck. Returns `{}` if the card wasn't found. */
function returnVaultCardToDeckPatch(
  state: GameState,
  playerId: string,
  cardId: string,
  from: 'office' | 'discard',
): GameStatePatch {
  let removed = false;
  const players = state.players.map((p) => {
    if (p.id !== playerId) return p;
    if (from === 'office') {
      const vaultCards = p.vaultCards.filter((v) => {
        if (!removed && v.cardId === cardId) {
          removed = true;
          return false;
        }
        return true;
      });
      return removed ? { ...p, vaultCards } : p;
    }
    const personalDiscard = p.personalDiscard.filter((e) => {
      if (!removed && e.kind === 'consumable' && e.cardId === cardId) {
        removed = true;
        return false;
      }
      return true;
    });
    return removed ? { ...p, personalDiscard } : p;
  });
  if (!removed) return {};
  return { players, vaultDeck: [...state.vaultDeck, cardId] };
}

/** The caster's base-slot Mages whose space's shadow slot is open. */
function ownBaseMagesWithOpenShadow(state: GameState, playerId: string): string[] {
  const out: string[] = [];
  for (const r of state.rooms) {
    if (r.noShadowSlots) continue;
    for (const s of r.actionSpaces) {
      if (s.occupant?.ownerId === playerId && !s.shadowOccupant) out.push(s.occupant.mageId);
    }
  }
  return out;
}

const vaultName = (state: GameState, cardId: string): string =>
  lookupVaultCardDef(state, cardId)?.name ?? cardId;

registerEffect('mancers.spell.the-eternal-engine.l1', (ctx): EffectResult => {
  const self = 'mancers.spell.the-eternal-engine.l1';
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  if (ctx.resumeAnswer?.kind === 'option-chosen') {
    const ret = returnVaultCardToDeckPatch(ctx.state, ctx.triggeringPlayerId, ctx.resumeAnswer.optionId, 'office');
    if (!ret.players) return { kind: 'done', patch: {} };
    const after: GameState = { ...ctx.state, ...ret };
    return {
      kind: 'done',
      patch: { vaultDeck: after.vaultDeck, ...gainResourcePatch(after, ctx.triggeringPlayerId, 'mana', 4) },
    };
  }
  // Only READY (unexhausted) Vault Cards qualify for Extract.
  const options: ChoiceOption[] = player.vaultCards
    .filter((v) => !v.exhausted)
    .map((v) => ({ id: v.cardId, label: vaultName(ctx.state, v.cardId), payload: {} }));
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.the-eternal-engine.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.the-eternal-engine.l2';
  const step = ctx.resumeContext?.['step'];
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  // A second Mage move (or pass) — the discard already happened.
  if (step === 'move2') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') return { kind: 'done', patch: {} };
    return { kind: 'done', patch: moveMageBaseToShadowPatch(ctx.state, ctx.resumeAnswer.mageId) };
  }
  // First Mage move; then offer a same-effect second.
  if (step === 'move1') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') return { kind: 'done', patch: {} };
    const movePatch = moveMageBaseToShadowPatch(ctx.state, ctx.resumeAnswer.mageId);
    const after: GameState = { ...ctx.state, ...movePatch };
    const more = ownBaseMagesWithOpenShadow(after, ctx.triggeringPlayerId);
    if (more.length === 0) return { kind: 'done', patch: movePatch };
    return {
      kind: 'pause',
      patch: movePatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: more, canPass: true, label: 'Move a second Mage to its shadow slot (or pass)' },
        resume: { effectId: self, context: { step: 'move2' } },
        source: ctx.source,
      },
    };
  }
  // The Vault Card was chosen — discard it to the deck, then start moving.
  if (step === 'discard') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} discard expected option-chosen`);
    }
    const discardPatch = returnVaultCardToDeckPatch(ctx.state, ctx.triggeringPlayerId, ctx.resumeAnswer.optionId, 'office');
    const after: GameState = { ...ctx.state, ...discardPatch };
    const movable = ownBaseMagesWithOpenShadow(after, ctx.triggeringPlayerId);
    if (movable.length === 0) return { kind: 'done', patch: discardPatch };
    return {
      kind: 'pause',
      patch: discardPatch,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: movable, canPass: true, label: 'Move which Mage to its shadow slot?' },
        resume: { effectId: self, context: { step: 'move1' } },
        source: ctx.source,
      },
    };
  }
  // Initial: choose a Vault Card from your office to discard to the deck.
  const options: ChoiceOption[] = player.vaultCards.map((v) => ({ id: v.cardId, label: vaultName(ctx.state, v.cardId), payload: {} }));
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'discard' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.the-eternal-engine.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.the-eternal-engine.l3';
  const step = ctx.resumeContext?.['step'];
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} apply expected option-chosen`);
    }
    const ref = ctx.resumeContext?.['cardRef'];
    if (typeof ref !== 'string') return { kind: 'done', patch: {} };
    const { ownerId: from, cardId } = parseOwnerCard(ref); // reuse "a::b" parser
    const ret = returnVaultCardToDeckPatch(ctx.state, ctx.triggeringPlayerId, cardId, from === 'discard' ? 'discard' : 'office');
    const after: GameState = { ...ctx.state, ...ret };
    const reward =
      ctx.resumeAnswer.optionId === 'wis'
        ? gainResourcePatch(after, ctx.triggeringPlayerId, 'wisdom', 1)
        : ctx.resumeAnswer.optionId === 'int'
          ? gainResourcePatch(after, ctx.triggeringPlayerId, 'intelligence', 1)
          : gainResourcePatch(after, ctx.triggeringPlayerId, 'mana', 7);
    return { kind: 'done', patch: { ...ret, ...reward } };
  }

  if (step === 'reward') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} reward expected option-chosen`);
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'wis', label: 'Gain 1 WIS', payload: {} },
            { id: 'int', label: 'Gain 1 INT', payload: {} },
            { id: 'mana', label: 'Gain 7 Mana', payload: {} },
          ],
        },
        resume: { effectId: self, context: { step: 'apply', cardRef: ctx.resumeAnswer.optionId } },
        source: ctx.source,
      },
    };
  }

  // Initial: choose a Vault Card from office OR discard. id = `office::id` /
  // `discard::id`.
  const options: ChoiceOption[] = [];
  for (const v of player.vaultCards) {
    options.push({ id: `office::${v.cardId}`, label: `${vaultName(ctx.state, v.cardId)} (office)`, payload: {} });
  }
  for (const e of player.personalDiscard) {
    if (e.kind === 'consumable') {
      options.push({ id: `discard::${e.cardId}`, label: `${vaultName(ctx.state, e.cardId)} (discard)`, payload: {} });
    }
  }
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'reward' } },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Codex Optimus (Technomancy, Mancers) — Spell/Treasure state control.
//   L1 Semaphore   (Free, Fast): your next action this turn can't be reacted
//      to (sets nextActionUnreactable; the engine arms suppression on the
//      following fresh action).
//   L2 Deactivate  (Free, Fast): exhaust an opponent's Spell or Treasure.
//   L3 Reactivate  (2 Mana, Fast): ready one of your Spells or Treasures.
// ============================================================================

/** Sets the exhausted state of the first matching Spell in `ownerId`'s book. */
function setSpellExhaustedPatch(
  state: GameState,
  ownerId: string,
  spellCardId: string,
  exhausted: boolean,
): GameStatePatch {
  return {
    players: state.players.map((p) => {
      if (p.id !== ownerId) return p;
      let done = false;
      return {
        ...p,
        ownedSpells: p.ownedSpells.map((s) => {
          if (!done && s.cardId === spellCardId && s.exhausted !== exhausted) {
            done = true;
            return { ...s, exhausted };
          }
          return s;
        }),
      };
    }),
  };
}

/** Sets the exhausted state of the first matching Treasure in a vault. */
function setTreasureExhaustedPatch(
  state: GameState,
  ownerId: string,
  cardId: string,
  exhausted: boolean,
): GameStatePatch {
  return {
    players: state.players.map((p) => {
      if (p.id !== ownerId) return p;
      let done = false;
      return {
        ...p,
        vaultCards: p.vaultCards.map((v) => {
          if (!done && v.cardId === cardId && v.exhausted !== exhausted) {
            done = true;
            return { ...v, exhausted };
          }
          return v;
        }),
      };
    }),
  };
}

/** Spell + Treasure options across owners, by exhausted state. id is
 *  `spell::owner::card` or `treasure::owner::card`. */
function spellTreasureOptions(
  state: GameState,
  includeOwner: (pid: string) => boolean,
  wantExhausted: boolean,
): ChoiceOption[] {
  const out: ChoiceOption[] = [];
  for (const p of state.players) {
    if (!includeOwner(p.id)) continue;
    for (const s of p.ownedSpells) {
      if (s.exhausted !== wantExhausted) continue;
      out.push({
        id: `spell::${p.id}::${s.cardId}`,
        label: `${lookupSpellCardDef(state, s.cardId)?.name ?? s.cardId} (Spell, ${p.id})`,
        payload: {},
      });
    }
    for (const v of p.vaultCards) {
      const def = lookupVaultCardDef(state, v.cardId);
      if (!def || def.type !== 'treasure' || v.exhausted !== wantExhausted) continue;
      out.push({
        id: `treasure::${p.id}::${v.cardId}`,
        label: `${def.name} (Treasure, ${p.id})`,
        payload: {},
      });
    }
  }
  return out;
}

registerEffect('mancers.spell.codex-optimus.l1', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    players: ctx.state.players.map((p) =>
      p.id === ctx.triggeringPlayerId ? { ...p, nextActionUnreactable: true } : p,
    ),
  },
}));

registerEffect('mancers.spell.codex-optimus.l2', (ctx): EffectResult => {
  const self = 'mancers.spell.codex-optimus.l2';
  if (ctx.resumeAnswer?.kind === 'option-chosen') {
    const [kind, ownerId, cardId] = ctx.resumeAnswer.optionId.split('::');
    if (!kind || !ownerId || !cardId) return { kind: 'done', patch: {} };
    return {
      kind: 'done',
      patch:
        kind === 'spell'
          ? setSpellExhaustedPatch(ctx.state, ownerId, cardId, true)
          : setTreasureExhaustedPatch(ctx.state, ownerId, cardId, true),
    };
  }
  const options = spellTreasureOptions(ctx.state, (pid) => pid !== ctx.triggeringPlayerId, false);
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
});

registerEffect('mancers.spell.codex-optimus.l3', (ctx): EffectResult => {
  const self = 'mancers.spell.codex-optimus.l3';
  if (ctx.resumeAnswer?.kind === 'option-chosen') {
    const [kind, ownerId, cardId] = ctx.resumeAnswer.optionId.split('::');
    if (!kind || !ownerId || !cardId) return { kind: 'done', patch: {} };
    return {
      kind: 'done',
      patch:
        kind === 'spell'
          ? setSpellExhaustedPatch(ctx.state, ownerId, cardId, false)
          : setTreasureExhaustedPatch(ctx.state, ownerId, cardId, false),
    };
  }
  const options = spellTreasureOptions(ctx.state, (pid) => pid === ctx.triggeringPlayerId, true);
  if (options.length === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: { effectId: self, context: { step: 'apply' } },
      source: ctx.source,
    },
  };
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
    const patch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
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
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
                    location: {
                      kind: 'infirmary' as const,
                      bed: allocateInfirmaryBed(ctx.state),
                    },
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
 *  shadow/wound slot types. Pass `restrictRoomId` to limit slots to a
 *  specific room (Slow Time). */
export function listPlaceWithoutPowersSlots(
  state: GameState,
  playerId: string,
  restrictRoomId?: string,
): string[] {
  const slots: string[] = [];
  for (const r of state.rooms) {
    if (restrictRoomId && r.id !== restrictRoomId) continue;
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
    const chain = ctx.state.pendingPlaceChain;
    const restrictRoomId =
      chain?.playerId === ctx.triggeringPlayerId
        ? chain.restrictRoomId
        : undefined;
    const allowStop =
      chain?.playerId === ctx.triggeringPlayerId && chain.allowStop === true;
    const suppressMagePowers =
      chain?.playerId === ctx.triggeringPlayerId &&
      chain.suppressMagePowers === true;

    if (step === 'pick-mage') {
      const mages = listPlaceWithoutPowersMages(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      const slots = listPlaceWithoutPowersSlots(
        ctx.state,
        ctx.triggeringPlayerId,
        restrictRoomId,
      );
      if (mages.length === 0 || slots.length === 0) {
        // No legal placement — clear the chain so the drain pump doesn't
        // re-fire on the next idle moment.
        return clearChainResult(ctx.state, ctx.triggeringPlayerId);
      }
      if (allowStop) {
        const options: ChoiceOption[] = mages.map((mid) => ({
          id: mid,
          label: `Place ${mid}`,
          payload: {},
        }));
        options.push({ id: 'stop', label: 'Stop here', payload: {} });
        return {
          kind: 'pause',
          pending: {
            responderId: ctx.triggeringPlayerId,
            prompt: { kind: 'choose-from-options', options },
            resume: {
              effectId: 'base.system.place-mage-without-powers',
              context: { step: 'after-mage-choice' },
            },
            source: ctx.source,
          },
        };
      }
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

    if (step === 'after-mage-choice') {
      if (ctx.resumeAnswer?.kind !== 'option-chosen') {
        throw new Error(
          'place-mage-without-powers after-mage-choice expected option-chosen',
        );
      }
      if (ctx.resumeAnswer.optionId === 'stop') {
        return clearChainResult(ctx.state, ctx.triggeringPlayerId);
      }
      const placerMageId = ctx.resumeAnswer.optionId;
      const slots = listPlaceWithoutPowersSlots(
        ctx.state,
        ctx.triggeringPlayerId,
        restrictRoomId,
      );
      if (slots.length === 0) {
        return clearChainResult(ctx.state, ctx.triggeringPlayerId);
      }
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
            context: { step: 'apply', placerMageId },
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
        restrictRoomId,
      );
      if (slots.length === 0) {
        return clearChainResult(ctx.state, ctx.triggeringPlayerId);
      }
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
        suppressMagePowers,
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

/** Clears the current pendingPlaceChain (used by Slow Time / Stop Time when
 *  the player stops early or no legal placement remains). */
function clearChainResult(
  state: GameState,
  playerId: string,
): EffectResult {
  if (state.pendingPlaceChain?.playerId !== playerId) {
    return { kind: 'done', patch: {} };
  }
  return { kind: 'done', patch: { pendingPlaceChain: null } };
}

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

/**
 * Temporal Calculus, 6th Ed. L1 "Slow Time" — Choose a room. Place up to two
 * of your Mages into it. Cost: 2 Mana, Action. The chosen room must have at
 * least one open base slot and not be locked / at the caster's per-room cap.
 *
 * After the room is chosen, the spell sets `pendingPlaceChain` with
 * `restrictRoomId` so each placement (drained one at a time by the engine
 * pump) targets only that room's open slots. `allowStop` lets the caster
 * end the chain early — the spell text says "up to two", not "exactly two".
 * The first placement fires inline so the chain reaches `remaining=1` after
 * the first apply and drains naturally for the second.
 */
registerEffect(
  'base.spell.temporal-calculus-6th-ed.l1',
  (ctx): EffectResult => {
    const self = 'base.spell.temporal-calculus-6th-ed.l1';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const eligibleRoomIds: string[] = [];
      for (const r of ctx.state.rooms) {
        const slots = listPlaceWithoutPowersSlots(
          ctx.state,
          ctx.triggeringPlayerId,
          r.id,
        );
        if (slots.length > 0) eligibleRoomIds.push(r.id);
      }
      if (eligibleRoomIds.length === 0) return { kind: 'done', patch: {} };
      const mages = listPlaceWithoutPowersMages(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (mages.length === 0) return { kind: 'done', patch: {} };
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
          resume: { effectId: self, context: { step: 'room-chosen' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'room-chosen') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} room-chosen expected option-chosen`);
      }
      const roomId = ctx.resumeAnswer.optionId;
      // Set up the place chain (1 future placement queued) and immediately
      // kick off the first placement via the shared helper.
      const withChain: GameState = {
        ...ctx.state,
        pendingPlaceChain: {
          playerId: ctx.triggeringPlayerId,
          source: ctx.source,
          remaining: 1,
          restrictRoomId: roomId,
          allowStop: true,
          // Slow Time places Mages without using powers.
          suppressMagePowers: true,
        },
      };
      const delegate = getEffect('base.system.place-mage-without-powers')({
        state: withChain,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: false,
      });
      return composeWithDelegate(delegate, {
        pendingPlaceChain: withChain.pendingPlaceChain,
      });
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

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
        // Stop Time places Mages without using powers.
        suppressMagePowers: true,
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
        pending: bonusPromptFor(ctx.state, wounded.triggerEvent, ctx.triggeringPlayerId),
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
 *  into a single room, then Lock that room. Chain:
 *    initial → pick-room (choose-from-options)
 *    after-room → Yes/No "place a Mage in <room>?"
 *      no → apply lock + done
 *      yes → choose-target-mage (board-clickable) → choose-target-action-space
 *            → apply → back to Yes/No (until the room is full / office empty,
 *            at which point we auto-lock).
 */
registerEffect('base.spell.moste-holie-litanies.l3', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const self = 'base.spell.moste-holie-litanies.l3';

  if (!ctx.resumeAnswer) {
    // Step 0: pick a room. The room must be placeable, not locked, not at
    // the caster's cap, AND have at least one empty base slot.
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
        resume: { effectId: self, context: { step: 'after-room' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-room') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} after-room expected option-chosen`);
    }
    const roomId = ctx.resumeAnswer.optionId;
    return mosteHolieMaybePlaceMore(ctx, self, roomId, {});
  }

  if (step === 'maybe-continue') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} maybe-continue expected option-chosen`);
    }
    const roomId = String(ctx.resumeContext?.['roomId'] ?? '');
    if (!roomId) return { kind: 'done', patch: {} };
    if (ctx.resumeAnswer.optionId === 'stop') {
      return { kind: 'done', patch: applyRoomLockPatch(ctx.state, roomId) };
    }
    // 'continue' → surface the clickable mage picker.
    return mosteHolieSurfaceMagePrompt(ctx, self, roomId);
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-slot expected mage-chosen`);
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const roomId = String(ctx.resumeContext?.['roomId'] ?? '');
    if (!roomId) return { kind: 'done', patch: {} };
    const room = ctx.state.rooms.find((r) => r.id === roomId);
    const openSlots =
      room?.actionSpaces.filter((s) => !s.occupant).map((s) => s.id) ?? [];
    if (openSlots.length === 0) {
      return { kind: 'done', patch: applyRoomLockPatch(ctx.state, roomId) };
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
    const roomId = String(ctx.resumeContext?.['roomId'] ?? '');
    const placerMageId = String(ctx.resumeContext?.['placerMageId'] ?? '');
    if (!roomId || !placerMageId) return { kind: 'done', patch: {} };
    const placePatch = placeOfficeMageOnSpace(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      ctx.resumeAnswer.spaceId,
    );
    const afterPlace: GameState = { ...ctx.state, ...placePatch };
    return mosteHolieMaybePlaceMore({ ...ctx, state: afterPlace }, self, roomId, placePatch);
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** After a (potentially zero-count) placement, decide whether to ask for
 *  another mage or auto-lock the room. If the player has no office mages
 *  left OR the room has no open slots, lock immediately. Otherwise surface
 *  a Yes/No "place a Mage?" prompt. */
function mosteHolieMaybePlaceMore(
  ctx: EffectContext,
  self: string,
  roomId: string,
  carryPatch: GameStatePatch,
): EffectResult {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  const officeAvailable =
    player?.mages.some(
      (m) => m.location.kind === 'office' && !m.isWounded,
    ) ?? false;
  const roomHasSlot = ctx.state.rooms
    .find((r) => r.id === roomId)
    ?.actionSpaces.some((s) => !s.occupant) ?? false;
  if (!officeAvailable || !roomHasSlot) {
    return {
      kind: 'done',
      patch: { ...carryPatch, ...applyRoomLockPatch(ctx.state, roomId) },
    };
  }
  const pending = {
    responderId: ctx.triggeringPlayerId,
    prompt: {
      kind: 'choose-from-options' as const,
      options: [
        {
          id: 'continue',
          label: 'Place a Mage in this room',
          payload: {},
        },
        {
          id: 'stop',
          label: 'Stop (lock the room)',
          payload: {},
        },
      ],
    },
    resume: {
      effectId: self,
      context: { step: 'maybe-continue', roomId },
    },
    source: ctx.source,
  };
  return Object.keys(carryPatch).length === 0
    ? { kind: 'pause', pending }
    : { kind: 'pause', patch: carryPatch, pending };
}

/** Surfaces the mage picker as `choose-target-mage` so the player can click
 *  the office mage directly in the player card. */
function mosteHolieSurfaceMagePrompt(
  ctx: EffectContext,
  self: string,
  roomId: string,
): EffectResult {
  const player = ctx.state.players.find(
    (p) => p.id === ctx.triggeringPlayerId,
  );
  const officeMages =
    player?.mages
      .filter((m) => m.location.kind === 'office' && !m.isWounded)
      .map((m) => m.id) ?? [];
  if (officeMages.length === 0) {
    return { kind: 'done', patch: applyRoomLockPatch(ctx.state, roomId) };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-mage',
        eligibleMageIds: officeMages,
      },
      resume: {
        effectId: self,
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
  /**
   * Reaction-trigger events accumulated across the walk. Each step that
   * actually applies an effect (wound / banish / move-dest) appends its
   * event here. The final reaction window fires with this list at the end.
   */
  events?: ReactionTriggerEvent[];
};

/**
 * Walks the Ice Comet pick sequence. Effects are applied step-by-step:
 *   - When the wound step resolves with a target, `woundMage` patches the
 *     state immediately (mage moves to infirmary, slot empties) and the
 *     event is appended to `picks.events`.
 *   - When the banish step resolves with a target, `banishMage` patches
 *     the state (mage returns to office, slot empties).
 *   - When the move-dest step resolves, `moveMageToSpace` patches the
 *     state.
 *
 * So by the time the move-source / move-dest prompts open, the board
 * already reflects the wound + banish — vacated slots are available as
 * move destinations. The walk carries `patchSoFar` so the engine sees
 * the updated state when the next prompt is pushed; subsequent resume
 * steps receive the post-patch state via `ctx.state`.
 */
function iceCometWalk(
  ctx: EffectContext,
  self: string,
  picks: IceCometPicks,
  patchSoFar: GameStatePatch = {},
): EffectResult {
  // Wound pick — optional.
  if (picks.woundMageId === undefined) {
    const targets = buildWoundableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      picks.roomId,
    );
    if (targets.length === 0) {
      return iceCometWalk(
        ctx,
        self,
        { ...picks, woundMageId: ICE_COMET_SKIP },
        patchSoFar,
      );
    }
    return {
      kind: 'pause',
      patch: patchSoFar,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: targets,
          canPass: true,
          label: 'Choose a Mage to wound (or pass)',
        },
        resume: {
          effectId: self,
          context: { step: 'wound-chosen', picks: picksToContext(picks) },
        },
        source: ctx.source,
      },
    };
  }
  // Banish pick — optional. The wounded mage is now in the infirmary so
  // it's already excluded from `buildBanishableMagesInRoom`; no extra
  // exclusion filter needed.
  if (picks.banishMageId === undefined) {
    const targets = buildBanishableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      picks.roomId,
    );
    if (targets.length === 0) {
      return iceCometWalk(
        ctx,
        self,
        { ...picks, banishMageId: ICE_COMET_SKIP },
        patchSoFar,
      );
    }
    return {
      kind: 'pause',
      patch: patchSoFar,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: targets,
          canPass: true,
          label: 'Choose a Mage to banish (or pass)',
        },
        resume: {
          effectId: self,
          context: { step: 'banish-chosen', picks: picksToContext(picks) },
        },
        source: ctx.source,
      },
    };
  }
  // Move source — optional. Wound + banish patches are already applied,
  // so wounded/banished mages aren't in the room. Move source needs ≥1
  // open dest (other than its own slot); openBaseSlotsInRoom now includes
  // vacated slots from prior steps.
  if (picks.moveMageId === undefined) {
    const candidates = buildMovableMagesInRoom(
      ctx.state,
      ctx.triggeringPlayerId,
      picks.roomId,
    );
    const opens = openBaseSlotsInRoom(ctx.state, picks.roomId);
    const sources = candidates.filter((mid) => {
      const pos = findMageSlotPosition(ctx.state, mid);
      const otherOpens = opens.filter((sid) => pos?.spaceId !== sid);
      return otherOpens.length > 0;
    });
    if (sources.length === 0) {
      return iceCometWalk(
        ctx,
        self,
        {
          ...picks,
          moveMageId: ICE_COMET_SKIP,
          moveDestSpaceId: ICE_COMET_SKIP,
        },
        patchSoFar,
      );
    }
    return {
      kind: 'pause',
      patch: patchSoFar,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: sources,
          canPass: true,
          label: 'Choose a Mage to move (or pass)',
        },
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
  // Move dest (mandatory once a source is picked).
  if (picks.moveDestSpaceId === undefined) {
    if (picks.moveMageId === ICE_COMET_SKIP) {
      return iceCometWalk(
        ctx,
        self,
        { ...picks, moveDestSpaceId: ICE_COMET_SKIP },
        patchSoFar,
      );
    }
    const pos = findMageSlotPosition(
      ctx.state,
      picks.moveMageId as OwnedMageId,
    );
    const dests = openBaseSlotsInRoom(ctx.state, picks.roomId).filter(
      (sid) => pos?.spaceId !== sid,
    );
    if (dests.length === 0) {
      return iceCometWalk(
        ctx,
        self,
        {
          ...picks,
          moveMageId: ICE_COMET_SKIP,
          moveDestSpaceId: ICE_COMET_SKIP,
        },
        patchSoFar,
      );
    }
    return {
      kind: 'pause',
      patch: patchSoFar,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-action-space',
          eligibleSpaceIds: dests,
          label: 'Choose the destination slot',
        },
        resume: {
          effectId: self,
          context: { step: 'move-dest-chosen', picks: picksToContext(picks) },
        },
        source: ctx.source,
      },
    };
  }
  return iceCometFinalize(ctx, picks, patchSoFar);
}

function picksToContext(picks: IceCometPicks): SerializableContext {
  const out: SerializableContext = { roomId: picks.roomId };
  if (picks.woundMageId !== undefined) out['woundMageId'] = picks.woundMageId;
  if (picks.banishMageId !== undefined) out['banishMageId'] = picks.banishMageId;
  if (picks.moveMageId !== undefined) out['moveMageId'] = picks.moveMageId;
  if (picks.moveDestSpaceId !== undefined)
    out['moveDestSpaceId'] = picks.moveDestSpaceId;
  if (picks.events !== undefined && picks.events.length > 0) {
    out['events'] = eventsArrayToContext(picks.events);
  }
  return out;
}

function picksFromContext(ctx: EffectContext): IceCometPicks {
  const raw = (ctx.resumeContext?.['picks'] ?? {}) as SerializableContext;
  const out: IceCometPicks = { roomId: String(raw['roomId'] ?? '') };
  if (typeof raw['woundMageId'] === 'string') out.woundMageId = raw['woundMageId'];
  if (typeof raw['banishMageId'] === 'string') out.banishMageId = raw['banishMageId'];
  if (typeof raw['moveMageId'] === 'string') out.moveMageId = raw['moveMageId'];
  if (typeof raw['moveDestSpaceId'] === 'string') out.moveDestSpaceId = raw['moveDestSpaceId'];
  if (Array.isArray(raw['events'])) {
    out.events = raw['events'] as unknown as ReactionTriggerEvent[];
  }
  return out;
}

/**
 * Opens the single combined reaction window for any events accumulated
 * across the walk. By this point the wound / banish / move patches are
 * already merged into `ctx.state` (and any not-yet-emitted patch lives
 * in `patchSoFar`). Fizzles silently when nothing actually fired.
 */
function iceCometFinalize(
  ctx: EffectContext,
  picks: IceCometPicks,
  patchSoFar: GameStatePatch,
): EffectResult {
  const events = picks.events ?? [];
  if (events.length === 0) {
    return { kind: 'done', patch: patchSoFar };
  }
  const byPlayerId = ctx.triggeringPlayerId;
  const reactorQueue = buildBatchReactorQueue(ctx.state, byPlayerId, events);
  const orderedEvents = orderEventsByTurn(ctx.state, byPlayerId, events);
  return {
    kind: 'open-reaction',
    patch: patchSoFar,
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
      const ans = ctx.resumeAnswer;
      if (ans.kind === 'pass') {
        return iceCometWalk(ctx, self, {
          ...picks,
          woundMageId: ICE_COMET_SKIP,
        });
      }
      if (ans.kind !== 'mage-chosen') {
        throw new Error(`${self} wound-chosen expected mage-chosen or pass`);
      }
      // Apply the wound NOW so the banish + move prompts see the
      // post-wound board (mage in infirmary, slot empty).
      const w = woundMage(ctx.state, ans.mageId, ctx.triggeringPlayerId);
      const newCtx: EffectContext = { ...ctx, state: { ...ctx.state, ...w.patch } };
      return iceCometWalk(
        newCtx,
        self,
        {
          ...picks,
          woundMageId: ans.mageId,
          events: [...(picks.events ?? []), w.triggerEvent],
        },
        w.patch,
      );
    }
    if (step === 'banish-chosen') {
      const ans = ctx.resumeAnswer;
      if (ans.kind === 'pass') {
        return iceCometWalk(ctx, self, {
          ...picks,
          banishMageId: ICE_COMET_SKIP,
        });
      }
      if (ans.kind !== 'mage-chosen') {
        throw new Error(`${self} banish-chosen expected mage-chosen or pass`);
      }
      // Apply the banish NOW so the move prompts see the freed slot.
      const b = banishMage(ctx.state, ans.mageId, ctx.triggeringPlayerId);
      const newCtx: EffectContext = { ...ctx, state: { ...ctx.state, ...b.patch } };
      return iceCometWalk(
        newCtx,
        self,
        {
          ...picks,
          banishMageId: ans.mageId,
          events: [...(picks.events ?? []), b.triggerEvent],
        },
        b.patch,
      );
    }
    if (step === 'move-source-chosen') {
      const ans = ctx.resumeAnswer;
      if (ans.kind === 'pass') {
        // Pass on move = skip both source and dest.
        return iceCometWalk(ctx, self, {
          ...picks,
          moveMageId: ICE_COMET_SKIP,
          moveDestSpaceId: ICE_COMET_SKIP,
        });
      }
      if (ans.kind !== 'mage-chosen') {
        throw new Error(`${self} move-source-chosen expected mage-chosen or pass`);
      }
      // No patch yet — source just records the choice; the move applies
      // once the dest is also picked.
      return iceCometWalk(ctx, self, {
        ...picks,
        moveMageId: ans.mageId,
      });
    }
    if (step === 'move-dest-chosen') {
      if (ctx.resumeAnswer.kind !== 'space-chosen') {
        throw new Error(`${self} move-dest-chosen expected space-chosen`);
      }
      // Apply the move NOW; the final reaction window then fires with
      // all accumulated events.
      const m = moveMageToSpace(
        ctx.state,
        picks.moveMageId!,
        ctx.resumeAnswer.spaceId,
        ctx.triggeringPlayerId,
      );
      const newCtx: EffectContext = { ...ctx, state: { ...ctx.state, ...m.patch } };
      return iceCometWalk(
        newCtx,
        self,
        {
          ...picks,
          moveDestSpaceId: ctx.resumeAnswer.spaceId,
          events: [...(picks.events ?? []), m.triggerEvent],
        },
        m.patch,
      );
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

// ============================================================================
// The Darkness Within L2 "Haunt" — reaction spell. When one of your Mages is
// wounded, moved, or banished, it instead shadows the slot it previously
// occupied. Mana cost: 2; exhausts on use. Mirrors Phase Steppers'
// repositioning, sourced from a spell instead of a vault card.
// ============================================================================

registerEffect(
  'base.spell.the-darkness-within.l2.react',
  (ctx): EffectResult => {
    const paid = payAndExhaustSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.the-darkness-within',
      2,
    );
    if (!paid) return { kind: 'done', patch: {} };
    const raw = ctx.resumeContext?.['triggerEvent'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Haunt: missing triggerEvent in resumeContext');
    }
    const event = raw as unknown as ReactionTriggerEvent;
    if (
      event.kind !== 'mage-wounded' &&
      event.kind !== 'mage-banished' &&
      event.kind !== 'mage-moved'
    ) {
      throw new Error(`Haunt cannot react to ${event.kind}`);
    }
    if (event.ownerId !== ctx.triggeringPlayerId) {
      throw new Error("Haunt only reacts to the caster's own Mage");
    }
    const originalSpaceId =
      event.kind === 'mage-moved' ? event.fromSpaceId : event.originalSpaceId;
    if (!originalSpaceId) return { kind: 'done', patch: { players: paid.players } };
    const mageId = event.mageId;
    const ownerId = event.ownerId;
    const occupancy: WorkerOccupancy = {
      mageId,
      ownerId,
      isShadowing: true,
    };
    const players = paid.players.map((p): Player =>
      p.id !== ownerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : {
                    ...m,
                    isWounded: false,
                    isShadowing: true,
                    location: {
                      kind: 'action-space' as const,
                      spaceId: originalSpaceId,
                    },
                  },
            ),
          },
    );
    const rooms = paid.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== originalSpaceId ? s : { ...s, shadowOccupant: occupancy },
      ),
    }));
    return { kind: 'done', patch: { players, rooms } };
  },
);

// ============================================================================
// The Darkness Within L3 "Possession" — Swap ownership badges between two
// Mages on the board. The swap is permanent. Targets:
//   - any mage on a slot (base or shadow) — both positions count as "on the
//     board";
//   - opposing blue mages are spell-immune and excluded;
//   - locked rooms do NOT protect — Possession isn't wound/banish/move/shadow.
//
// Mana cost: 4, Action timing. Effect:
//   - mage A and mage B exchange which player.mages array they live in;
//   - the slot occupant (or shadowOccupant) ownerId on each slot is updated
//     to reflect the new owner;
//   - mage.id, color, cardId, location, and shadow/wound flags are unchanged.
// ============================================================================

function buildPossessionTargets(
  state: GameState,
  casterId: string,
  excludeMageId?: string,
): string[] {
  const out: string[] = [];
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind !== 'action-space') continue;
      // Opposing-blue spell-immunity (also picks up the apprentice) — Side A only.
      if (colorAbilityActive(state, m, 'blue') && p.id !== casterId) continue;
      if (m.id === excludeMageId) continue;
      out.push(m.id);
    }
  }
  return out;
}

function applyOwnershipSwap(
  state: GameState,
  mageAId: string,
  mageBId: string,
): GameStatePatch {
  let ownerA: string | null = null;
  let ownerB: string | null = null;
  let mageA: OwnedMage | null = null;
  let mageB: OwnedMage | null = null;
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.id === mageAId) {
        ownerA = p.id;
        mageA = m;
      }
      if (m.id === mageBId) {
        ownerB = p.id;
        mageB = m;
      }
    }
  }
  if (!ownerA || !ownerB || !mageA || !mageB) {
    throw new Error(
      `applyOwnershipSwap: could not locate both mages (${mageAId}, ${mageBId})`,
    );
  }
  if (ownerA === ownerB) {
    // Same owner — no actual swap to perform, slot ownerIds unchanged.
    return {};
  }
  const players = state.players.map((p): Player => {
    if (p.id === ownerA) {
      return {
        ...p,
        mages: [...p.mages.filter((m) => m.id !== mageAId), mageB!],
      };
    }
    if (p.id === ownerB) {
      return {
        ...p,
        mages: [...p.mages.filter((m) => m.id !== mageBId), mageA!],
      };
    }
    return p;
  });
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) => {
      let next = s;
      if (next.occupant?.mageId === mageAId) {
        next = { ...next, occupant: { ...next.occupant, ownerId: ownerB! } };
      }
      if (next.occupant?.mageId === mageBId) {
        next = { ...next, occupant: { ...next.occupant, ownerId: ownerA! } };
      }
      if (next.shadowOccupant?.mageId === mageAId) {
        next = {
          ...next,
          shadowOccupant: { ...next.shadowOccupant, ownerId: ownerB! },
        };
      }
      if (next.shadowOccupant?.mageId === mageBId) {
        next = {
          ...next,
          shadowOccupant: { ...next.shadowOccupant, ownerId: ownerA! },
        };
      }
      return next;
    }),
  }));
  return { players, rooms };
}

registerEffect(
  'base.spell.the-darkness-within.l3',
  (ctx): EffectResult => {
    const self = 'base.spell.the-darkness-within.l3';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const targets = buildPossessionTargets(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (targets.length < 2) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
          resume: { effectId: self, context: { step: 'pick-second' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'pick-second') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} pick-second expected mage-chosen`);
      }
      const mageA = ctx.resumeAnswer.mageId;
      const remaining = buildPossessionTargets(
        ctx.state,
        ctx.triggeringPlayerId,
        mageA,
      );
      if (remaining.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: remaining },
          resume: { effectId: self, context: { step: 'apply', mageA } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'mage-chosen') {
        throw new Error(`${self} apply expected mage-chosen`);
      }
      const mageA = String(ctx.resumeContext?.['mageA'] ?? '');
      const mageB = ctx.resumeAnswer.mageId;
      if (!mageA || mageA === mageB) return { kind: 'done', patch: {} };
      return {
        kind: 'done',
        patch: applyOwnershipSwap(ctx.state, mageA, mageB),
      };
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Memoirs of the Future-Past L1 "Future Power" — Cast a Spell that you have
// not yet researched from among your learned Spells (paying all mana costs).
//
// Candidates are L2 or L3 of any owned spell where:
//   - L1 is researched (intPlaced = true),
//   - that level's WIS is NOT placed,
//   - the level's timing is action or fast-action (reaction-timing levels
//     can't be invoked outside a reaction window),
//   - the caster can afford the level's printed mana cost,
//   - the level's effect is actually registered.
// Future Power itself is excluded as a candidate.
//
// Cast flow: CAST_SPELL pays Future Power's (0) mana and exhausts it. This
// effect prompts for a (spell, level) option, deducts the borrowed level's
// mana, and delegates to the chosen level's effect. The borrowed spell does
// NOT exhaust — this counts as a single spell (Future Power's cast).
// ============================================================================

type FuturePowerCandidate = {
  spellCardId: string;
  level: 2 | 3;
  manaCost: number;
  effectId: string;
  label: string;
};

function listFuturePowerCandidates(
  state: GameState,
  casterId: string,
): FuturePowerCandidate[] {
  const player = state.players.find((p) => p.id === casterId);
  if (!player) return [];
  const out: FuturePowerCandidate[] = [];
  for (const owned of player.ownedSpells) {
    if (!owned.intPlaced) continue;
    if (owned.cardId === 'base.spell.memoirs-of-the-future-past') continue;
    const def = lookupSpellCardDef(state, owned.cardId);
    if (!def) continue;
    const levels: (2 | 3)[] = [];
    if (!owned.wisPlacedLevel2) levels.push(2);
    if (!owned.wisPlacedLevel3) levels.push(3);
    for (const lvl of levels) {
      const lvlDef = def.levels.find((l) => l.level === lvl);
      if (!lvlDef) continue;
      if (lvlDef.timing === 'reaction') continue;
      if (!hasEffect(lvlDef.effectId)) continue;
      if (player.resources.mana < lvlDef.manaCost) continue;
      out.push({
        spellCardId: owned.cardId,
        level: lvl,
        manaCost: lvlDef.manaCost,
        effectId: lvlDef.effectId,
        label: `${def.name} L${lvl} "${lvlDef.title}" (${lvlDef.manaCost} Mana): ${lvlDef.description ?? ''}`,
      });
    }
  }
  return out;
}

registerEffect(
  'base.spell.memoirs-of-the-future-past.l1',
  (ctx): EffectResult => {
    const self = 'base.spell.memoirs-of-the-future-past.l1';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const candidates = listFuturePowerCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.spellCardId}::${c.level}`,
        label: c.label,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
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
      const [chosenSpellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
      const level = Number(levelStr) as 2 | 3;
      // Re-check eligibility against current state (mana could have changed
      // via a reaction earlier in the spell stack, etc.).
      const candidate = listFuturePowerCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      ).find((c) => c.spellCardId === chosenSpellId && c.level === level);
      if (!candidate) return { kind: 'done', patch: {} };
      const paidState: GameState = {
        ...ctx.state,
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                resources: {
                  ...p.resources,
                  mana: p.resources.mana - candidate.manaCost,
                },
              },
        ),
      };
      const delegate = getEffect(candidate.effectId)({
        state: paidState,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: ctx.allowReactions,
      });
      return composeWithDelegate(delegate, { players: paidState.players });
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Will of the Divines L1 "Concentration" — The next time you cast a Spell
// this turn, do not exhaust it. Fast Action, 0 Mana. Sets the caster's
// `nextSpellSkipsExhaust` flag; CAST_SPELL consumes and clears it on the
// very next cast. Cleared unconditionally at turn-end if unused.
// ============================================================================

registerEffect(
  'base.spell.will-of-the-divines.l1',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: {
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, nextSpellSkipsExhaust: true },
      ),
    },
  }),
);

// ============================================================================
// A Brighter Flame L1 "Inner Fire" — For the rest of the round, your Spells
// cost 1 less Mana. Adds a caster-scoped SpellsCheaperBuff (discount = 1,
// expiresAt = round-end). The same buff shape as the Power bell tower
// offering — both stack via spellManaDiscountFor if a player somehow had
// both active, which is fine since each discount is fixed at 1 Mana per
// spell and clamped to 0.
// ============================================================================

registerEffect(
  'base.spell.a-brighter-flame.l1',
  (ctx): EffectResult => {
    const buff: SpellsCheaperBuff = {
      kind: 'spells-cheaper',
      casterPlayerId: ctx.triggeringPlayerId,
      sourceId: 'base.spell.a-brighter-flame',
      label: 'Inner Fire',
      discount: 1,
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
// Will of the Divines L2 "Silence" — Until the start of your next turn,
// players may not cast Spells. Action, 1 Mana. Adds a global SpellsBlockedBuff
// scoped to the caster's turn-start (or round-end as the global fallback).
// Reaction-timing spells fired from reaction windows remain allowed; only
// CAST_SPELL action-time casting is blocked.
// ============================================================================

registerEffect(
  'base.spell.will-of-the-divines.l2',
  (ctx): EffectResult => {
    const buff: SpellsBlockedBuff = {
      kind: 'spells-blocked',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.will-of-the-divines',
      label: 'Silence',
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
// Will of the Divines L3 "Revival" — For the rest of this round, you may
// move your wounded Mages after the action that wounded them. Still gain
// Infirmary Bonuses.
//
// Adds a caster-scoped RevivalBuff (round-end). woundMage enqueues a
// pendingRevivalChecks entry whenever an opposing action wounds one of the
// caster's mages while the buff is active; the engine's
// drainRevivalCheckIfIdle pump surfaces a Yes/No "heal-and-place to any
// open slot" prompt for the mage's owner once the wound's reaction window
// and infirmary-bonus chain are idle. The Infirmary bonus is granted by
// the wound's normal post-wound chain — Revival doesn't suppress it.
// ============================================================================

registerEffect(
  'base.spell.will-of-the-divines.l3',
  (ctx): EffectResult => {
    const buff: RevivalBuff = {
      kind: 'revival',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.will-of-the-divines',
      label: 'Revival',
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

/**
 * Revival prompt — multi-step:
 *   1. (no resumeAnswer): Yes/No on whether to use Revival for this mage.
 *   2. step='pick-slot' (option-chosen=yes): pick an open base slot to
 *      place the wounded mage on (or fizzle if no slots remain).
 *   3. step='apply' (space-chosen): clear isWounded + place at the slot.
 * The wounded mage id rides in `ctx.resumeContext.mageId` from the drain pump
 * onward.
 */
registerEffect('base.system.revival-prompt', (ctx: EffectContext): EffectResult => {
  const self = 'base.system.revival-prompt';
  const step = ctx.resumeContext?.['step'];
  const mageId = String(ctx.resumeContext?.['mageId'] ?? '');
  if (!mageId) return { kind: 'done', patch: {} };

  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'yes', label: `Revival: move ${mageId} to an open slot`, payload: {} },
            { id: 'no', label: 'Skip Revival', payload: {} },
          ],
        },
        resume: {
          effectId: self,
          context: { step: 'after-choice', mageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'after-choice') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} after-choice expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'no') {
      return { kind: 'done', patch: {} };
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
        resume: { effectId: self, context: { step: 'apply', mageId } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply expected space-chosen`);
    }
    return {
      kind: 'done',
      patch: healMageToSpace(ctx.state, mageId, ctx.resumeAnswer.spaceId),
    };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

// ============================================================================
// Tenets of Dominance L3 "Shadow Puppet" — Gain a Secret Supporter. Action,
// 4 Mana. Delegates to `applySecretSupporterDraw` — the same helper backing
// the Telepathy vault card's draw-as-secret path. The drawn card lands
// face-down in the caster's personal discard and counts for "Most Supporters"
// voter scoring. Fizzles silently when the supporter deck is empty.
// ============================================================================

registerEffect(
  'base.spell.tenets-of-dominance.l3',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: applySecretSupporterDraw(ctx.state, ctx.triggeringPlayerId),
  }),
);

// ============================================================================
// Memoirs of the Future-Past L2 "Past Power" — Cast one of your regular
// Action Spells at a level less than the highest level you've researched.
// Do not pay any additional mana or exhaust it.
//
// Candidates: levels 1 .. (highestResearched-1) of any owned spell where:
//   - L1 is researched (intPlaced); the spell's highest researched level
//     comes from wisPlacedLevel3 > wisPlacedLevel2 > intPlaced;
//   - the candidate level has action timing (the card says "regular Action
//     Spells" — fast-action and reaction levels are excluded);
//   - the level's effect is actually registered.
// Past Power itself is excluded from candidates.
//
// On apply: NO mana deduction (Past Power's 3 Mana is paid via CAST_SPELL),
// NO exhaust on the borrowed spell. Past Power exhausts via the normal cast
// path. This is a "single spell" cast: the borrowed effect runs in-line.
// ============================================================================

type PastPowerCandidate = {
  spellCardId: string;
  level: 1 | 2;
  effectId: string;
  label: string;
};

function listPastPowerCandidates(
  state: GameState,
  casterId: string,
): PastPowerCandidate[] {
  const player = state.players.find((p) => p.id === casterId);
  if (!player) return [];
  const out: PastPowerCandidate[] = [];
  for (const owned of player.ownedSpells) {
    if (owned.cardId === 'base.spell.memoirs-of-the-future-past') continue;
    if (!owned.intPlaced) continue;
    const highest: 1 | 2 | 3 = owned.wisPlacedLevel3
      ? 3
      : owned.wisPlacedLevel2
        ? 2
        : 1;
    if (highest === 1) continue;
    const def = lookupSpellCardDef(state, owned.cardId);
    if (!def) continue;
    const eligible: (1 | 2)[] = highest === 3 ? [1, 2] : [1];
    for (const lvl of eligible) {
      const lvlDef = def.levels.find((l) => l.level === lvl);
      if (!lvlDef) continue;
      if (lvlDef.timing !== 'action') continue;
      if (!hasEffect(lvlDef.effectId)) continue;
      out.push({
        spellCardId: owned.cardId,
        level: lvl,
        effectId: lvlDef.effectId,
        label: `${def.name} L${lvl} "${lvlDef.title}": ${lvlDef.description ?? ''}`,
      });
    }
  }
  return out;
}

registerEffect(
  'base.spell.memoirs-of-the-future-past.l2',
  (ctx): EffectResult => {
    const self = 'base.spell.memoirs-of-the-future-past.l2';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const candidates = listPastPowerCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.spellCardId}::${c.level}`,
        label: c.label,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
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
      const [chosenSpellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
      const level = Number(levelStr) as 1 | 2;
      // Re-validate against the current state.
      const candidate = listPastPowerCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      ).find((c) => c.spellCardId === chosenSpellId && c.level === level);
      if (!candidate) return { kind: 'done', patch: {} };
      // No mana deduction, no extra exhaust — just invoke the chosen level.
      const delegate = getEffect(candidate.effectId)({
        state: ctx.state,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: ctx.allowReactions,
      });
      return delegate;
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Memoirs of the Future-Past L3 "Eternal Power" — Cast one of your regular
// Action Spells of any level (it need not even be researched). Do not pay
// any additional mana or exhaust it.
//
// Like Past Power but the candidate filter widens to every level (1/2/3) of
// every owned spell — no "highest researched" constraint. You still need to
// own the spell at L1 (intPlaced) for it to appear on your player board;
// the L2 / L3 levels need not be researched. Memoirs itself is excluded so
// the spell doesn't recurse into Future / Past / Eternal Power.
// ============================================================================

type EternalPowerCandidate = {
  spellCardId: string;
  level: 1 | 2 | 3;
  effectId: string;
  label: string;
};

function listEternalPowerCandidates(
  state: GameState,
  casterId: string,
): EternalPowerCandidate[] {
  const player = state.players.find((p) => p.id === casterId);
  if (!player) return [];
  const out: EternalPowerCandidate[] = [];
  for (const owned of player.ownedSpells) {
    if (owned.cardId === 'base.spell.memoirs-of-the-future-past') continue;
    if (!owned.intPlaced) continue;
    const def = lookupSpellCardDef(state, owned.cardId);
    if (!def) continue;
    for (const lvlDef of def.levels) {
      if (lvlDef.timing !== 'action') continue;
      if (!hasEffect(lvlDef.effectId)) continue;
      out.push({
        spellCardId: owned.cardId,
        level: lvlDef.level,
        effectId: lvlDef.effectId,
        label: `${def.name} L${lvlDef.level} "${lvlDef.title}": ${lvlDef.description ?? ''}`,
      });
    }
  }
  return out;
}

registerEffect(
  'base.spell.memoirs-of-the-future-past.l3',
  (ctx): EffectResult => {
    const self = 'base.spell.memoirs-of-the-future-past.l3';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const candidates = listEternalPowerCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.spellCardId}::${c.level}`,
        label: c.label,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
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
      const [chosenSpellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
      const level = Number(levelStr) as 1 | 2 | 3;
      const candidate = listEternalPowerCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      ).find((c) => c.spellCardId === chosenSpellId && c.level === level);
      if (!candidate) return { kind: 'done', patch: {} };
      const delegate = getEffect(candidate.effectId)({
        state: ctx.state,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: ctx.allowReactions,
      });
      return delegate;
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Songs of Springtime L2 "Regrowth" — Reaction. When one of your Mages is
// wounded or moved, place it into an empty slot (clear `isWounded`). Cost:
// 1 Mana; the spell exhausts.
//
// The reaction option is surfaced from buildReactionOptionsFor when the
// caster owns Songs of Springtime researched to L2 (intPlaced +
// wisPlacedLevel2), unexhausted, with ≥1 Mana, and the trigger is a
// `mage-wounded` or `mage-moved` event targeting one of their own mages.
// ============================================================================

registerEffect(
  'base.spell.songs-of-springtime.l2.react',
  (ctx: EffectContext): EffectResult => {
    const selfRegrowth = 'base.spell.songs-of-springtime.l2.react';
    const step = ctx.resumeContext?.['step'];

    if (!step) {
      const paid = payAndExhaustSpell(
        ctx.state,
        ctx.triggeringPlayerId,
        'base.spell.songs-of-springtime',
        1,
      );
      if (!paid) return { kind: 'done', patch: {} };
      const raw = ctx.resumeContext?.['triggerEvent'];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Regrowth: missing triggerEvent in resumeContext');
      }
      const event = raw as unknown as ReactionTriggerEvent;
      if (event.kind !== 'mage-wounded' && event.kind !== 'mage-moved') {
        throw new Error(`Regrowth cannot react to ${event.kind}`);
      }
      if (event.ownerId !== ctx.triggeringPlayerId) {
        throw new Error("Regrowth only reacts to the caster's own Mage");
      }
      const slots = listPlaceWithoutPowersSlots(paid, ctx.triggeringPlayerId);
      if (slots.length === 0) {
        return { kind: 'done', patch: { players: paid.players } };
      }
      return {
        kind: 'pause',
        patch: { players: paid.players },
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-action-space',
            eligibleSpaceIds: slots,
          },
          resume: {
            effectId: selfRegrowth,
            context: { step: 'apply', mageId: event.mageId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer?.kind !== 'space-chosen') {
        throw new Error(`${selfRegrowth} apply expected space-chosen`);
      }
      const mageId = String(ctx.resumeContext?.['mageId'] ?? '');
      if (!mageId) return { kind: 'done', patch: {} };
      const destSpaceId = ctx.resumeAnswer.spaceId;
      const ownerId = ctx.triggeringPlayerId;
      const mage = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === mageId);
      if (!mage) return { kind: 'done', patch: {} };
      const fromSpaceId =
        mage.location.kind === 'action-space' ? mage.location.spaceId : null;
      const occupancy: WorkerOccupancy = {
        mageId,
        ownerId,
        isShadowing: false,
      };
      const players = ctx.state.players.map((p): Player => {
        if (p.id !== ownerId) return p;
        return {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== mageId
              ? m
              : {
                  ...m,
                  isWounded: false,
                  isShadowing: false,
                  location: {
                    kind: 'action-space' as const,
                    spaceId: destSpaceId,
                  },
                },
          ),
        };
      });
      const rooms = ctx.state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) => {
          if (fromSpaceId && s.id === fromSpaceId && s.occupant?.mageId === mageId) {
            return { ...s, occupant: null };
          }
          if (s.id === destSpaceId) {
            return { ...s, occupant: occupancy };
          }
          return s;
        }),
      }));
      return { kind: 'done', patch: { players, rooms } };
    }

    throw new Error(`${selfRegrowth} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Songs of Springtime L3 "Renewal" — Reaction, 2 Mana. When one of your Mages
// is wounded or moved, place it into an empty slot (clear isWounded), THEN
// refresh an exhausted Spell or Treasure. Combines Regrowth's reposition
// with Regeneration's refresh. The refresh step is skipped silently if the
// responder has nothing exhausted by the time it fires.
// ============================================================================

registerEffect(
  'base.spell.songs-of-springtime.l3.react',
  (ctx: EffectContext): EffectResult => {
    const selfRenewal = 'base.spell.songs-of-springtime.l3.react';
    const step = ctx.resumeContext?.['step'];

    if (!step) {
      const paid = payAndExhaustSpell(
        ctx.state,
        ctx.triggeringPlayerId,
        'base.spell.songs-of-springtime',
        2,
      );
      if (!paid) return { kind: 'done', patch: {} };
      const raw = ctx.resumeContext?.['triggerEvent'];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Renewal: missing triggerEvent in resumeContext');
      }
      const event = raw as unknown as ReactionTriggerEvent;
      if (event.kind !== 'mage-wounded' && event.kind !== 'mage-moved') {
        throw new Error(`Renewal cannot react to ${event.kind}`);
      }
      if (event.ownerId !== ctx.triggeringPlayerId) {
        throw new Error("Renewal only reacts to the caster's own Mage");
      }
      const slots = listPlaceWithoutPowersSlots(paid, ctx.triggeringPlayerId);
      if (slots.length === 0) {
        return { kind: 'done', patch: { players: paid.players } };
      }
      return {
        kind: 'pause',
        patch: { players: paid.players },
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-action-space',
            eligibleSpaceIds: slots,
          },
          resume: {
            effectId: selfRenewal,
            context: { step: 'apply-place', mageId: event.mageId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply-place') {
      if (ctx.resumeAnswer?.kind !== 'space-chosen') {
        throw new Error(`${selfRenewal} apply-place expected space-chosen`);
      }
      const mageId = String(ctx.resumeContext?.['mageId'] ?? '');
      if (!mageId) return { kind: 'done', patch: {} };
      const destSpaceId = ctx.resumeAnswer.spaceId;
      const ownerId = ctx.triggeringPlayerId;
      const mage = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === mageId);
      if (!mage) return { kind: 'done', patch: {} };
      const fromSpaceId =
        mage.location.kind === 'action-space' ? mage.location.spaceId : null;
      const occupancy: WorkerOccupancy = {
        mageId,
        ownerId,
        isShadowing: false,
      };
      const players = ctx.state.players.map((p): Player => {
        if (p.id !== ownerId) return p;
        return {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== mageId
              ? m
              : {
                  ...m,
                  isWounded: false,
                  isShadowing: false,
                  location: {
                    kind: 'action-space' as const,
                    spaceId: destSpaceId,
                  },
                },
          ),
        };
      });
      const rooms = ctx.state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) => {
          if (fromSpaceId && s.id === fromSpaceId && s.occupant?.mageId === mageId) {
            return { ...s, occupant: null };
          }
          if (s.id === destSpaceId) {
            return { ...s, occupant: occupancy };
          }
          return s;
        }),
      }));
      const placed: GameState = { ...ctx.state, players, rooms };
      // Surface the refresh prompt. Skip silently if there's nothing
      // exhausted to refresh.
      const reactor = placed.players.find((p) => p.id === ownerId);
      const exhaustedSpells =
        reactor?.ownedSpells.filter((s) => s.exhausted) ?? [];
      const exhaustedTreasures =
        reactor?.vaultCards.filter((v) => v.exhausted) ?? [];
      if (exhaustedSpells.length + exhaustedTreasures.length === 0) {
        return { kind: 'done', patch: { players, rooms } };
      }
      const options: ChoiceOption[] = [
        ...exhaustedSpells.map((s) => ({
          id: `spell:${s.cardId}`,
          label: `Refresh Spell — ${spellLabel(placed, s.cardId)}`,
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
        patch: { players, rooms },
        pending: {
          responderId: ownerId,
          prompt: { kind: 'choose-from-options', options },
          resume: {
            effectId: selfRenewal,
            context: { step: 'apply-refresh' },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply-refresh') {
      if (ctx.resumeAnswer?.kind !== 'option-chosen') {
        throw new Error(`${selfRenewal} apply-refresh expected option-chosen`);
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
      return { kind: 'done', patch: {} };
    }

    throw new Error(`${selfRenewal} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Tome of Protection L3 "Absorb Mana" — Reaction, 0 Mana. After one of your
// Mages would be moved, wounded, or banished by a spell, gain Mana equal to
// the cost of that spell. The reaction option is only surfaced when the
// trigger's source is a spell (not a mage power, vault card, etc.).
//
// The mana amount is the SPELL'S PRINTED COST at the level cast. We resolve
// that via the trigger source's spellCardId + level (level is encoded in
// the source's description as "Name LN"). When level isn't recoverable we
// fall back to L1's cost so the reaction still pays out reasonably.
// ============================================================================

function castLevelFromSourceDescription(description?: string): 1 | 2 | 3 {
  if (!description) return 1;
  const match = description.match(/L(\d+)$/);
  if (!match || !match[1]) return 1;
  const n = Number.parseInt(match[1], 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

function spellCastedManaCost(
  state: GameState,
  source: ResolutionSource,
): number {
  if (source.kind !== 'spell') return 0;
  const def = lookupSpellCardDef(state, source.id);
  if (!def) return 0;
  const level = castLevelFromSourceDescription(source.description);
  const lvlDef = def.levels.find((l) => l.level === level);
  return lvlDef?.manaCost ?? 0;
}

registerEffect(
  'base.spell.tome-of-protection.l3.react',
  (ctx: EffectContext): EffectResult => {
    const paid = payAndExhaustSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.tome-of-protection',
      0,
    );
    if (!paid) return { kind: 'done', patch: {} };
    const raw = ctx.resumeContext?.['triggerEvent'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Absorb Mana: missing triggerEvent in resumeContext');
    }
    const event = raw as unknown as ReactionTriggerEvent;
    if (
      event.kind !== 'mage-wounded' &&
      event.kind !== 'mage-banished' &&
      event.kind !== 'mage-moved'
    ) {
      throw new Error(`Absorb Mana cannot react to ${event.kind}`);
    }
    if (event.ownerId !== ctx.triggeringPlayerId) {
      throw new Error("Absorb Mana only reacts to the caster's own Mage");
    }
    const sourceRaw = ctx.resumeContext?.['triggerSource'];
    if (!sourceRaw || typeof sourceRaw !== 'object' || Array.isArray(sourceRaw)) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const triggerSource = sourceRaw as unknown as ResolutionSource;
    const amount = spellCastedManaCost(paid, triggerSource);
    if (amount <= 0) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    return {
      kind: 'done',
      patch: gainResourcePatch(paid, ctx.triggeringPlayerId, 'mana', amount),
    };
  },
);

// ============================================================================
// Wrath of Heaven L3 "Retribution" — Reaction, 3 Mana. After one of your
// Mages is wounded by an opponent, wound TWO mages owned by that opponent.
//
// Two-pick chain: pick targets one at a time (the second excludes the first),
// then apply both wounds in a batch and surface the attacker's Infirmary
// bonus prompts via batch-post-wound-bonus. No reaction window opens for
// the retaliation wounds (reactions cannot be reacted to per rulebook).
//
// Falls back to a single wound if the attacker only has one eligible mage.
// Fizzles entirely if the attacker has no eligible mages (responder still
// pays the 3 Mana + exhausts via payAndExhaustSpell, matching how the
// other Wrath levels handle "no targets").
// ============================================================================

registerEffect('base.spell.wrath-of-heaven.l3.react', (ctx): EffectResult => {
  const selfRetribution = 'base.spell.wrath-of-heaven.l3.react';
  const step = ctx.resumeContext?.['step'];

  function placedMagesOf(state: GameState, playerId: string): string[] {
    const p = state.players.find((pp) => pp.id === playerId);
    return (
      p?.mages
        .filter((m) => m.location.kind === 'action-space' && !m.isWounded)
        .map((m) => m.id) ?? []
    );
  }

  function applyRetributionWounds(
    workingState: GameState,
    woundPatch: GameStatePatch,
    targets: string[],
  ): EffectResult {
    if (targets.length === 0) return { kind: 'done', patch: woundPatch };
    const wounded = woundManyMages(
      workingState,
      targets,
      ctx.triggeringPlayerId,
    );
    const composedPatch: GameStatePatch = { ...woundPatch, ...wounded.patch };
    const afterWounds: GameState = { ...workingState, ...wounded.patch };
    const ordered = orderEventsByTurn(
      workingState,
      ctx.triggeringPlayerId,
      wounded.events,
    );
    // Invoke the existing batch-post-wound-bonus pump directly — reactions
    // can't open another reaction window for these wounds, so we skip
    // straight to the bonus chain.
    const bonusResult = getEffect('base.system.batch-post-wound-bonus')({
      state: afterWounds,
      source: ctx.source,
      triggeringPlayerId: ctx.triggeringPlayerId,
      resumeContext: { events: eventsArrayToContext(ordered) },
      allowReactions: false,
    });
    return composeWithDelegate(bonusResult, composedPatch);
  }

  if (!step) {
    const paid = payAndExhaustSpell(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.wrath-of-heaven',
      3,
    );
    if (!paid) return { kind: 'done', patch: {} };
    const rawEvent = ctx.resumeContext?.['triggerEvent'];
    if (!rawEvent || typeof rawEvent !== 'object') {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const event = rawEvent as unknown as ReactionTriggerEvent;
    if (event.kind !== 'mage-wounded') {
      return { kind: 'done', patch: { players: paid.players } };
    }
    if (!('byPlayerId' in event) || event.byPlayerId === event.ownerId) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    const attackerId = event.byPlayerId;
    const targets = placedMagesOf(paid, attackerId);
    if (targets.length === 0) {
      return { kind: 'done', patch: { players: paid.players } };
    }
    return {
      kind: 'pause',
      patch: { players: paid.players },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: {
          effectId: selfRetribution,
          context: { step: 'pick-second', attackerId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-second') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${selfRetribution} pick-second expected mage-chosen`);
    }
    const target1 = ctx.resumeAnswer.mageId;
    const attackerId = String(ctx.resumeContext?.['attackerId'] ?? '');
    if (!attackerId) {
      return applyRetributionWounds(ctx.state, {}, [target1]);
    }
    const remaining = placedMagesOf(ctx.state, attackerId).filter(
      (m) => m !== target1,
    );
    if (remaining.length === 0) {
      // Only one target available — apply the single wound.
      return applyRetributionWounds(ctx.state, {}, [target1]);
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: remaining,
        },
        resume: {
          effectId: selfRetribution,
          context: { step: 'apply', target1 },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
      throw new Error(`${selfRetribution} apply expected mage-chosen`);
    }
    const target1 = String(ctx.resumeContext?.['target1'] ?? '');
    const target2 = ctx.resumeAnswer.mageId;
    if (!target1 || target1 === target2) {
      return applyRetributionWounds(ctx.state, {}, [target2]);
    }
    return applyRetributionWounds(ctx.state, {}, [target1, target2]);
  }

  throw new Error(`${selfRetribution} unexpected step ${String(step)}`);
});

// ============================================================================
// The Light That Leads L2 "Flare" / L3 "Dazzle" — Take 1 / 2 normal actions.
// Both are Fast Action timing, so the caster can layer the bonus actions
// onto the same turn AFTER they cast. The engine's `extraActions` counter
// on the errands phase carries the grant; `consumeActionBudget` decrements
// it on each "Action" spend once the base Action is gone. The counter
// resets to 0 on every turn change.
//
// Flare grants 1 extra action; Dazzle grants 2.
// ============================================================================

function grantExtraActions(state: GameState, count: number): GameStatePatch {
  if (state.phase.kind !== 'errands') return {};
  return {
    phase: {
      ...state.phase,
      extraActions: (state.phase.extraActions ?? 0) + count,
    },
  };
}

registerEffect(
  'base.spell.the-light-that-leads.l2',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: grantExtraActions(ctx.state, 1),
  }),
);

registerEffect(
  'base.spell.the-light-that-leads.l3',
  (ctx): EffectResult => ({
    kind: 'done',
    patch: grantExtraActions(ctx.state, 2),
  }),
);

// ============================================================================
// `base.system.cast-another-spell` — shared "cast a Spell you own" sub-effect.
// Used by Accelerate Time (Paralocation L2), Mystic Link (Tenets L2), Chain
// Lightning (Lightning L3), and any future effect that says "Cast another
// Spell." Candidates are owned, intPlaced, unexhausted spells whose chosen
// level isn't reaction-timing, has a registered effect, and the caster can
// afford. Higher levels show up as separate options when researched.
//
// On apply: deducts the level's mana, exhausts the spell, then delegates to
// the level's effect with the caster's allowReactions setting preserved.
// Borrowed effect's reactions (wound windows, etc.) fire normally — this is
// a "full" cast, not a Future Power-style preview.
//
// Pass `excludeSpellId` in resumeContext to keep the calling spell out of
// the candidate list (so it can't recurse into itself).
// ============================================================================

type CastAnotherCandidate = {
  spellCardId: string;
  level: 1 | 2 | 3;
  manaCost: number;
  effectId: string;
  /** Borrowed cast's timing — action-timed borrows queue their own
   *  Mysticism post-cast trigger (in addition to the outer spell's). */
  timing: 'action' | 'fast-action';
  label: string;
};

function listCastAnotherCandidates(
  state: GameState,
  casterId: string,
  excludeSpellId?: string,
): CastAnotherCandidate[] {
  const player = state.players.find((p) => p.id === casterId);
  if (!player) return [];
  const out: CastAnotherCandidate[] = [];
  for (const owned of player.ownedSpells) {
    if (excludeSpellId && owned.cardId === excludeSpellId) continue;
    if (!owned.intPlaced) continue;
    if (owned.exhausted) continue;
    const def = lookupSpellCardDef(state, owned.cardId);
    if (!def) continue;
    const researched: (1 | 2 | 3)[] = [1];
    if (owned.wisPlacedLevel2) researched.push(2);
    if (owned.wisPlacedLevel3) researched.push(3);
    for (const lvl of researched) {
      const lvlDef = def.levels.find((l) => l.level === lvl);
      if (!lvlDef) continue;
      if (lvlDef.timing === 'reaction') continue;
      if (!hasEffect(lvlDef.effectId)) continue;
      if (player.resources.mana < lvlDef.manaCost) continue;
      out.push({
        spellCardId: owned.cardId,
        level: lvl,
        manaCost: lvlDef.manaCost,
        effectId: lvlDef.effectId,
        timing: lvlDef.timing,
        label: `${def.name} L${lvl} "${lvlDef.title}" (${lvlDef.manaCost} Mana)`,
      });
    }
  }
  return out;
}

registerEffect(
  'base.system.cast-another-spell',
  (ctx: EffectContext): EffectResult => {
    const self = 'base.system.cast-another-spell';
    const step = ctx.resumeContext?.['step'];
    const excludeRaw = ctx.resumeContext?.['excludeSpellId'];
    const excludeSpellId =
      typeof excludeRaw === 'string' ? excludeRaw : undefined;

    if (!ctx.resumeAnswer || step === undefined) {
      const candidates = listCastAnotherCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
        excludeSpellId,
      );
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.spellCardId}::${c.level}`,
        label: c.label,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-from-options', options },
          resume: {
            effectId: self,
            context: {
              step: 'apply',
              ...(excludeSpellId ? { excludeSpellId } : {}),
            },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply expected option-chosen`);
      }
      const [chosenSpellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
      const level = Number(levelStr) as 1 | 2 | 3;
      const candidate = listCastAnotherCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
        excludeSpellId,
      ).find((c) => c.spellCardId === chosenSpellId && c.level === level);
      if (!candidate) return { kind: 'done', patch: {} };
      // Borrowed action-timed casts queue their own Mysticism post-cast
      // trigger (in addition to whatever the outer spell already queued).
      const mysticismQueue =
        candidate.timing === 'action'
          ? [...ctx.state.pendingMysticismPostCast, ctx.triggeringPlayerId]
          : ctx.state.pendingMysticismPostCast;
      const paidState: GameState = {
        ...ctx.state,
        pendingMysticismPostCast: mysticismQueue,
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                resources: {
                  ...p.resources,
                  mana: p.resources.mana - candidate.manaCost,
                },
                ownedSpells: p.ownedSpells.map((o) =>
                  o.cardId !== candidate.spellCardId
                    ? o
                    : { ...o, exhausted: true },
                ),
              },
        ),
      };
      const delegate = getEffect(candidate.effectId)({
        state: paidState,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: ctx.allowReactions,
      });
      return composeWithDelegate(delegate, {
        players: paidState.players,
        pendingMysticismPostCast: paidState.pendingMysticismPostCast,
      });
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Everyday Paralocation L2 "Accelerate Time" — Fast Action, 2 Mana. Cast
// another Spell. Delegates straight to base.system.cast-another-spell with
// Paralocation itself excluded.
// ============================================================================

registerEffect(
  'base.spell.everyday-paralocation.l2',
  (ctx: EffectContext): EffectResult => {
    return getEffect('base.system.cast-another-spell')({
      state: ctx.state,
      source: ctx.source,
      triggeringPlayerId: ctx.triggeringPlayerId,
      allowReactions: ctx.allowReactions,
      resumeContext: { excludeSpellId: 'base.spell.everyday-paralocation' },
    });
  },
);

// ============================================================================
// Tenets of Dominance L2 "Mystic Link" — Action, 2 Mana. Cast another Spell.
// Then, place any Mage you control. The post-cast placement uses the
// existing pendingPlaceChain machinery (the engine's drain pump fires it
// once the borrowed spell's chain is fully idle).
// ============================================================================

registerEffect(
  'base.spell.tenets-of-dominance.l2',
  (ctx: EffectContext): EffectResult => {
    const self = 'base.spell.tenets-of-dominance.l2';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer || step === undefined) {
      const candidates = listCastAnotherCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
        'base.spell.tenets-of-dominance',
      );
      if (candidates.length === 0) {
        // No castable other spell — still queue the placement.
        const placeOnlyChain: GameState = {
          ...ctx.state,
          pendingPlaceChain: {
            playerId: ctx.triggeringPlayerId,
            source: ctx.source,
            remaining: 1,
          },
        };
        return {
          kind: 'done',
          patch: { pendingPlaceChain: placeOnlyChain.pendingPlaceChain },
        };
      }
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: `${c.spellCardId}::${c.level}`,
        label: c.label,
        payload: {},
      }));
      // Add a "Skip the cast, just place" option (rare case where the
      // player has nothing useful to cast but still gets the placement).
      options.push({
        id: 'skip',
        label: 'Skip the borrowed cast (place a Mage only)',
        payload: {},
      });
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-from-options', options },
          resume: { effectId: self, context: { step: 'apply-cast' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply-cast') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} apply-cast expected option-chosen`);
      }
      // Queue the post-cast placement no matter what — Mystic Link's place
      // happens "then" after the cast (or as a standalone if skipped).
      const baseChainState: GameState = {
        ...ctx.state,
        pendingPlaceChain: {
          playerId: ctx.triggeringPlayerId,
          source: ctx.source,
          remaining: 1,
        },
      };
      if (ctx.resumeAnswer.optionId === 'skip') {
        return {
          kind: 'done',
          patch: { pendingPlaceChain: baseChainState.pendingPlaceChain },
        };
      }
      const [chosenSpellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
      const level = Number(levelStr) as 1 | 2 | 3;
      const candidate = listCastAnotherCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
        'base.spell.tenets-of-dominance',
      ).find((c) => c.spellCardId === chosenSpellId && c.level === level);
      if (!candidate) {
        return {
          kind: 'done',
          patch: { pendingPlaceChain: baseChainState.pendingPlaceChain },
        };
      }
      // Borrowed action-timed casts get their own Mysticism post-cast
      // trigger queued in addition to Mystic Link's own.
      const mysticismQueue =
        candidate.timing === 'action'
          ? [
              ...baseChainState.pendingMysticismPostCast,
              ctx.triggeringPlayerId,
            ]
          : baseChainState.pendingMysticismPostCast;
      const paidState: GameState = {
        ...baseChainState,
        pendingMysticismPostCast: mysticismQueue,
        players: baseChainState.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                resources: {
                  ...p.resources,
                  mana: p.resources.mana - candidate.manaCost,
                },
                ownedSpells: p.ownedSpells.map((o) =>
                  o.cardId !== candidate.spellCardId
                    ? o
                    : { ...o, exhausted: true },
                ),
              },
        ),
      };
      const delegate = getEffect(candidate.effectId)({
        state: paidState,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: ctx.allowReactions,
      });
      return composeWithDelegate(delegate, {
        players: paidState.players,
        pendingPlaceChain: paidState.pendingPlaceChain,
        pendingMysticismPostCast: paidState.pendingMysticismPostCast,
      });
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Lightning and You L3 "Chain Lightning" — Action, 5 Mana. Wound an
// opponent's Mage, then place a Mage of your own. You may then cast another
// Spell.
//
// Mirrors L2 "Lightning"'s wound→bonus→place chain, then adds an optional
// "may cast another Spell" tail. Inline implementation (the L2 effect uses
// self-references to its own id in resume contexts, so it can't be cleanly
// delegated to and chained beyond).
// ============================================================================

registerEffect('base.spell.lightning-and-you.l3', (ctx): EffectResult => {
  const self = 'base.spell.lightning-and-you.l3';
  const step = ctx.resumeContext?.['step'];

  // Steps that resume without a resumeAnswer (afterResume from open-reaction
  // windows) must be checked BEFORE the initial-entry guard.
  if (step === 'after-wound') {
    const event = readTriggerEvent(ctx);
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
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
    if (!placerPrompt) {
      return chainLightningCastAnotherPrompt(ctx, self);
    }
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
      throw new Error(`${self} wound expected mage-chosen`);
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
      throw new Error(`${self} after-bonus expected option-chosen`);
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error(`${self} after-bonus: missing recipientPlayerId`);
    }
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    const placerPrompt = placeAnyOfficeMagePrompt(
      afterBonus,
      ctx.triggeringPlayerId,
      self,
      ctx.source,
      { step: 'pick-slot' },
    );
    if (!placerPrompt) {
      return chainLightningCastAnotherPrompt(
        { ...ctx, state: afterBonus },
        self,
        bonusPatch,
      );
    }
    return { kind: 'pause', patch: bonusPatch, pending: placerPrompt };
  }

  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${self} pick-slot expected mage-chosen`);
    }
    const placerMageId = ctx.resumeAnswer.mageId;
    const openSlots = listEligiblePlacementSlots(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (openSlots.length === 0) {
      return chainLightningCastAnotherPrompt(ctx, self);
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
          context: { step: 'apply-place', placerMageId },
        },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply-place') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} apply-place expected space-chosen`);
    }
    const placerMageId = ctx.resumeContext?.['placerMageId'];
    if (typeof placerMageId !== 'string') {
      throw new Error(`${self} apply-place: missing placerMageId`);
    }
    const placePatch = placeOfficeMageOnSpaceCrediting(
      ctx.state,
      ctx.triggeringPlayerId,
      placerMageId,
      ctx.resumeAnswer.spaceId,
    );
    const afterPlace: GameState = { ...ctx.state, ...placePatch };
    return chainLightningCastAnotherPrompt(
      { ...ctx, state: afterPlace },
      self,
      placePatch,
    );
  }

  if (step === 'after-may-cast') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} after-may-cast expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'skip') {
      return { kind: 'done', patch: {} };
    }
    // Delegate to cast-another-spell with the chosen spell preselected by
    // re-invoking its apply step.
    const [chosenSpellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
    const level = Number(levelStr) as 1 | 2 | 3;
    const candidate = listCastAnotherCandidates(
      ctx.state,
      ctx.triggeringPlayerId,
      'base.spell.lightning-and-you',
    ).find((c) => c.spellCardId === chosenSpellId && c.level === level);
    if (!candidate) return { kind: 'done', patch: {} };
    const mysticismQueue =
      candidate.timing === 'action'
        ? [...ctx.state.pendingMysticismPostCast, ctx.triggeringPlayerId]
        : ctx.state.pendingMysticismPostCast;
    const paidState: GameState = {
      ...ctx.state,
      pendingMysticismPostCast: mysticismQueue,
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                mana: p.resources.mana - candidate.manaCost,
              },
              ownedSpells: p.ownedSpells.map((o) =>
                o.cardId !== candidate.spellCardId
                  ? o
                  : { ...o, exhausted: true },
              ),
            },
      ),
    };
    const delegate = getEffect(candidate.effectId)({
      state: paidState,
      source: ctx.source,
      triggeringPlayerId: ctx.triggeringPlayerId,
      allowReactions: ctx.allowReactions,
    });
    return composeWithDelegate(delegate, {
      players: paidState.players,
      pendingMysticismPostCast: paidState.pendingMysticismPostCast,
    });
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

/** Surfaces the "may cast another Spell" prompt for Chain Lightning. */
function chainLightningCastAnotherPrompt(
  ctx: EffectContext,
  self: string,
  carryPatch?: GameStatePatch,
): EffectResult {
  const candidates = listCastAnotherCandidates(
    ctx.state,
    ctx.triggeringPlayerId,
    'base.spell.lightning-and-you',
  );
  if (candidates.length === 0) {
    return { kind: 'done', patch: carryPatch ?? {} };
  }
  const options: ChoiceOption[] = candidates.map((c) => ({
    id: `${c.spellCardId}::${c.level}`,
    label: c.label,
    payload: {},
  }));
  options.push({ id: 'skip', label: 'Skip the bonus cast', payload: {} });
  const pending: PendingResolutionInput = {
    responderId: ctx.triggeringPlayerId,
    prompt: { kind: 'choose-from-options', options },
    resume: { effectId: self, context: { step: 'after-may-cast' } },
    source: ctx.source,
  };
  return carryPatch
    ? { kind: 'pause', patch: carryPatch, pending }
    : { kind: 'pause', pending };
}

// ============================================================================
// Indefinite Definitives L1 "Cut Plane" — Action, 1 Mana. An opponent's Mage
// is now shadowing its slot. Place one of your Mages into the slot they
// were in.
//
// Two-step chain: pick the opposing target (a placed mage whose shadow slot
// is empty AND whose room isn't at the caster's per-room cap), then pick one
// of the caster's office mages to seat at the now-vacated base position.
// Opposing blue mages are spell-immune and excluded from the target list.
// Forcing the opponent's Mage to its shadow position is a move, so it opens a
// mage-moved reaction window (Phase Steppers / Invisibility Cloak / Ancient
// Armor, …); the caster's Mage is seated only after the window drains.
// ============================================================================

function listCutPlaneTargets(
  state: GameState,
  casterId: string,
): { mageId: string; spaceId: string; ownerId: string }[] {
  const out: { mageId: string; spaceId: string; ownerId: string }[] = [];
  for (const r of state.rooms) {
    if (isRoomLocked(state, r.id)) continue;
    if (r.noShadowSlots) continue;
    if (isRoomAtPlayerCap(state, casterId, r.id)) continue;
    for (const s of r.actionSpaces) {
      if (!s.occupant) continue;
      if (s.occupant.ownerId === casterId) continue;
      if (s.shadowOccupant) continue;
      const owner = state.players.find((p) => p.id === s.occupant!.ownerId);
      const mage = owner?.mages.find((m) => m.id === s.occupant!.mageId);
      // Opposing-blue (and apprentice acting as blue) spell-immunity — Side A only.
      if (!mage || colorAbilityActive(state, mage, 'blue')) continue;
      out.push({
        mageId: s.occupant.mageId,
        spaceId: s.id,
        ownerId: s.occupant.ownerId,
      });
    }
  }
  return out;
}

registerEffect(
  'base.spell.indefinite-definitives.l1',
  (ctx: EffectContext): EffectResult => {
    const self = 'base.spell.indefinite-definitives.l1';
    const step = ctx.resumeContext?.['step'];

    if (step === undefined) {
      const targets = listCutPlaneTargets(ctx.state, ctx.triggeringPlayerId);
      if (targets.length === 0) return { kind: 'done', patch: {} };
      const officeMages = listPlaceWithoutPowersMages(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (officeMages.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-target-mage',
            eligibleMageIds: targets.map((t) => t.mageId),
          },
          resume: { effectId: self, context: { step: 'apply-shadow' } },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply-shadow') {
      if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
        throw new Error(`${self} apply-shadow expected mage-chosen`);
      }
      const targetMageId = ctx.resumeAnswer.mageId;
      const target = ctx.state.players
        .flatMap((p) => p.mages)
        .find((m) => m.id === targetMageId);
      if (!target || target.location.kind !== 'action-space') {
        return { kind: 'done', patch: {} };
      }
      const spaceId = target.location.spaceId;
      const targetOwner = ctx.state.players.find((p) =>
        p.mages.some((m) => m.id === targetMageId),
      );
      if (!targetOwner) return { kind: 'done', patch: {} };
      const occupancy: WorkerOccupancy = {
        mageId: targetMageId,
        ownerId: targetOwner.id,
        isShadowing: true,
      };
      const players = ctx.state.players.map((p): Player =>
        p.id !== targetOwner.id
          ? p
          : {
              ...p,
              mages: p.mages.map((m) =>
                m.id !== targetMageId ? m : { ...m, isShadowing: true },
              ),
            },
      );
      const rooms = ctx.state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== spaceId
            ? s
            : { ...s, occupant: null, shadowOccupant: occupancy },
        ),
      }));
      // Forcing the opponent's Mage to its shadow position is a move — open the
      // standard mage-moved reaction window so its owner may respond. The
      // caster's Mage is seated afterward, via the afterResume continuation,
      // so a reaction that returns the Mage to the base foils the takeover.
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
        patch: { players, rooms },
        window: {
          triggerEvents: [event],
          pendingResponderIds: buildReactionQueue(
            ctx.state,
            ctx.triggeringPlayerId,
          ),
          reactedPlayerIds: [],
          afterResume: { effectId: self, context: { step: 'after-react', spaceId } },
          source: ctx.source,
        },
      };
    }

    if (step === 'after-react') {
      // Continuation once the move window drains: seat one of the caster's
      // office Mages in the vacated base, if it's still empty.
      const spaceId = String(ctx.resumeContext?.['spaceId'] ?? '');
      if (!spaceId) return { kind: 'done', patch: {} };
      const space = ctx.state.rooms
        .flatMap((r) => r.actionSpaces)
        .find((s) => s.id === spaceId);
      if (!space || space.occupant) return { kind: 'done', patch: {} };
      const officeMages = listPlaceWithoutPowersMages(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (officeMages.length === 0) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: { kind: 'choose-target-mage', eligibleMageIds: officeMages },
          resume: {
            effectId: self,
            context: { step: 'apply-place', spaceId },
          },
          source: ctx.source,
        },
      };
    }

    if (step === 'apply-place') {
      if (ctx.resumeAnswer?.kind !== 'mage-chosen') {
        throw new Error(`${self} apply-place expected mage-chosen`);
      }
      const placerMageId = ctx.resumeAnswer.mageId;
      const spaceId = String(ctx.resumeContext?.['spaceId'] ?? '');
      if (!spaceId) return { kind: 'done', patch: {} };
      const space = ctx.state.rooms
        .flatMap((r) => r.actionSpaces)
        .find((s) => s.id === spaceId);
      if (!space || space.occupant) return { kind: 'done', patch: {} };
      return {
        kind: 'done',
        patch: placeOfficeMageOnSpace(
          ctx.state,
          ctx.triggeringPlayerId,
          placerMageId,
          spaceId,
        ),
      };
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Parallel Synchronicity L2 "Fade" — Action, 2 Mana. Move any number of
// Mages (yours or opponents') in a room into the shadow position.
//
// Sister to Inversion's mass-move, but room-scoped and applied to any mix of
// owners. Two-step chain: pick a room (must contain ≥1 base-position mage
// whose slot's shadow is empty), then a multi-pick prompt that lets the
// caster toggle which placed mages in that room shift to their slot's
// shadow position. Opposing blue mages are spell-immune and excluded.
// Each base→shadow shift is a move, so the spell opens a mage-moved reaction
// window for any shifted OPPONENT Mage (own-Mage shifts can't be reacted to —
// the caster is excluded from the reactor queue). Unlike Inversion (which only
// moves the caster's OWN Mages and so fires nothing), Fade can move opponents.
// ============================================================================

function listFadeRooms(state: GameState, casterId: string): string[] {
  const out: string[] = [];
  for (const r of state.rooms) {
    if (isRoomLocked(state, r.id)) continue;
    if (r.noShadowSlots) continue;
    let eligibleInRoom = 0;
    for (const s of r.actionSpaces) {
      if (!s.occupant) continue;
      if (s.shadowOccupant) continue;
      const owner = state.players.find((p) => p.id === s.occupant!.ownerId);
      const mage = owner?.mages.find((m) => m.id === s.occupant!.mageId);
      if (!mage) continue;
      // Opposing blue is spell-immune (apprentice acts as blue too) — Side A only.
      if (colorAbilityActive(state, mage, 'blue') && s.occupant.ownerId !== casterId)
        continue;
      eligibleInRoom++;
    }
    if (eligibleInRoom > 0) out.push(r.id);
  }
  return out;
}

function listFadeCandidates(
  state: GameState,
  casterId: string,
  roomId: string,
): { mageId: string; spaceId: string; ownerId: string }[] {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.noShadowSlots) return [];
  const out: { mageId: string; spaceId: string; ownerId: string }[] = [];
  for (const s of room.actionSpaces) {
    if (!s.occupant) continue;
    if (s.shadowOccupant) continue;
    const owner = state.players.find((p) => p.id === s.occupant!.ownerId);
    const mage = owner?.mages.find((m) => m.id === s.occupant!.mageId);
    if (!mage) continue;
    // Opposing blue (apprentice acts as blue) is spell-immune — Side A only.
    if (colorAbilityActive(state, mage, 'blue') && s.occupant.ownerId !== casterId)
      continue;
    out.push({
      mageId: s.occupant.mageId,
      spaceId: s.id,
      ownerId: s.occupant.ownerId,
    });
  }
  return out;
}

function applyFadeShift(
  state: GameState,
  shifts: { mageId: string; spaceId: string; ownerId: string }[],
): GameStatePatch {
  let working = state;
  for (const shift of shifts) {
    const occupancy: WorkerOccupancy = {
      mageId: shift.mageId,
      ownerId: shift.ownerId,
      isShadowing: true,
    };
    working = {
      ...working,
      players: working.players.map((p) =>
        p.id !== shift.ownerId
          ? p
          : {
              ...p,
              mages: p.mages.map((m) =>
                m.id !== shift.mageId ? m : { ...m, isShadowing: true },
              ),
            },
      ),
      rooms: working.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== shift.spaceId
            ? s
            : { ...s, occupant: null, shadowOccupant: occupancy },
        ),
      })),
    };
  }
  return { players: working.players, rooms: working.rooms };
}

registerEffect(
  'base.spell.parallel-synchronicity.l2',
  (ctx: EffectContext): EffectResult => {
    const self = 'base.spell.parallel-synchronicity.l2';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const eligibleRoomIds = listFadeRooms(ctx.state, ctx.triggeringPlayerId);
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
      const picked = (ctx.resumeContext?.['picked'] as string[] | undefined) ?? [];
      return surfaceFadeMagePrompt(ctx, self, roomId, picked);
    }

    if (step === 'toggle') {
      if (ctx.resumeAnswer.kind !== 'option-chosen') {
        throw new Error(`${self} toggle expected option-chosen`);
      }
      const roomId = String(ctx.resumeContext?.['roomId'] ?? '');
      const picked = (ctx.resumeContext?.['picked'] as string[] | undefined) ?? [];
      const optionId = ctx.resumeAnswer.optionId;
      if (optionId === 'done') {
        const candidates = listFadeCandidates(
          ctx.state,
          ctx.triggeringPlayerId,
          roomId,
        );
        const shifts = candidates.filter((c) => picked.includes(c.mageId));
        if (shifts.length === 0) return { kind: 'done', patch: {} };
        const patch = applyFadeShift(ctx.state, shifts);
        // Each base→shadow shift is a move — opponents whose Mage was shifted
        // may react (Phase Steppers / Invisibility Cloak / Ancient Armor, …).
        // Own-Mage shifts emit events too but are harmless: the caster is
        // excluded from the reactor queue.
        const events: ReactionTriggerEvent[] = shifts.map((sh) => ({
          kind: 'mage-moved',
          mageId: sh.mageId,
          ownerId: sh.ownerId,
          fromSpaceId: sh.spaceId,
          toSpaceId: sh.spaceId,
          byPlayerId: ctx.triggeringPlayerId,
        }));
        return {
          kind: 'open-reaction',
          patch,
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
      const next = picked.includes(optionId)
        ? picked.filter((id) => id !== optionId)
        : [...picked, optionId];
      return surfaceFadeMagePrompt(ctx, self, roomId, next);
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

function surfaceFadeMagePrompt(
  ctx: EffectContext,
  self: string,
  roomId: string,
  picked: string[],
): EffectResult {
  const candidates = listFadeCandidates(
    ctx.state,
    ctx.triggeringPlayerId,
    roomId,
  );
  if (candidates.length === 0) return { kind: 'done', patch: {} };
  const options: ChoiceOption[] = candidates.map((c) => ({
    id: c.mageId,
    label: picked.includes(c.mageId)
      ? `[x] ${c.mageId} (${c.ownerId})`
      : `[ ] ${c.mageId} (${c.ownerId})`,
    payload: {},
  }));
  options.push({
    id: 'done',
    label: `Apply (${picked.length} selected)`,
    payload: {},
  });
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: { kind: 'choose-from-options', options },
      resume: {
        effectId: self,
        context: { step: 'toggle', roomId, picked },
      },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Thirteen Greater Mysteries L2 "Tap the Well" — Action, 0 Mana. Cast a Level
// 1 Spell from the Spell Tableau, paying all costs.
//
// Candidates come from `state.spellTableau` (the 3 face-up spell books), not
// from the caster's owned spells. The L1 effect must be registered and the
// caster must be able to afford the L1 mana cost; reaction-timing L1s are
// excluded. The borrowed cast does NOT remove the card from the tableau and
// does NOT mark anything exhausted (the tableau card isn't owned).
// ============================================================================

type TapTheWellCandidate = {
  spellCardId: string;
  manaCost: number;
  effectId: string;
  label: string;
};

function listTapTheWellCandidates(
  state: GameState,
  casterId: string,
): TapTheWellCandidate[] {
  const player = state.players.find((p) => p.id === casterId);
  if (!player) return [];
  const out: TapTheWellCandidate[] = [];
  for (const cardId of state.spellTableau) {
    const def = lookupSpellCardDef(state, cardId);
    if (!def) continue;
    const lvl1 = def.levels.find((l) => l.level === 1);
    if (!lvl1) continue;
    if (lvl1.timing === 'reaction') continue;
    if (!hasEffect(lvl1.effectId)) continue;
    if (player.resources.mana < lvl1.manaCost) continue;
    out.push({
      spellCardId: cardId,
      manaCost: lvl1.manaCost,
      effectId: lvl1.effectId,
      label: `${def.name} L1 "${lvl1.title}" (${lvl1.manaCost} Mana): ${lvl1.description ?? ''}`,
    });
  }
  return out;
}

registerEffect(
  'base.spell.thirteen-greater-mysteries.l2',
  (ctx: EffectContext): EffectResult => {
    const self = 'base.spell.thirteen-greater-mysteries.l2';
    const step = ctx.resumeContext?.['step'];

    if (!ctx.resumeAnswer) {
      const candidates = listTapTheWellCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      );
      if (candidates.length === 0) return { kind: 'done', patch: {} };
      const options: ChoiceOption[] = candidates.map((c) => ({
        id: c.spellCardId,
        label: c.label,
        payload: {},
      }));
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
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
      const chosenSpellId = ctx.resumeAnswer.optionId;
      const candidate = listTapTheWellCandidates(
        ctx.state,
        ctx.triggeringPlayerId,
      ).find((c) => c.spellCardId === chosenSpellId);
      if (!candidate) return { kind: 'done', patch: {} };
      const paidState: GameState = {
        ...ctx.state,
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                resources: {
                  ...p.resources,
                  mana: p.resources.mana - candidate.manaCost,
                },
              },
        ),
      };
      const delegate = getEffect(candidate.effectId)({
        state: paidState,
        source: ctx.source,
        triggeringPlayerId: ctx.triggeringPlayerId,
        allowReactions: ctx.allowReactions,
      });
      return composeWithDelegate(delegate, { players: paidState.players });
    }

    throw new Error(`${self} unexpected step ${String(step)}`);
  },
);

// ============================================================================
// Thirteen Greater Mysteries L3 "Energy Drain" — Action, 0 Mana. During this
// round, opponents must pay 1 extra Mana to cast a Spell — that Mana flows
// to the caster. Implemented via an EnergyDrainBuff (round-end expiry) +
// spellManaSurchargesAgainst, which the CAST_SPELL handler reads when
// computing effectiveManaCost. Multiple Energy Drain buffs stack additively;
// the buff holder's own casts are unaffected by their own buff.
// ============================================================================

registerEffect(
  'base.spell.thirteen-greater-mysteries.l3',
  (ctx: EffectContext): EffectResult => {
    const buff: EnergyDrainBuff = {
      kind: 'energy-drain',
      casterPlayerId: ctx.triggeringPlayerId,
      spellCardId: 'base.spell.thirteen-greater-mysteries',
      label: 'Energy Drain',
      surcharge: 1,
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
// Temporal Calculus 6th Ed. L3 "Bend Time" — Action, 4 Mana. Take up to 3
// more bonus actions, each of a DIFFERENT type. The engine recognises four
// action kinds: place a mage (`place`), cast an Action spell (`spell`), play
// an Action Supporter (`supporter`), and play an Action Vault Card —
// Treasure or Consumable (`vault`).
//
// Implementation:
//   - +3 extra actions on the errands phase (shared counter with Flare /
//     Dazzle / etc.).
//   - Seeds `bendTimeUsedKinds: []` on the phase. While this array is set,
//     `consumeActionBudget` rejects any bonus-action spend that repeats a
//     kind already in the list, and records each new kind as it's used.
//   - The DISCARD_BONUS_ACTIONS action drops any remaining bonus actions
//     and clears the tracker. The tracker also clears on turn change via
//     `processErrandsAdvance`.
//   - Each bonus action runs through the normal handler, so each gets its
//     own Mysticism post-cast trigger, reaction window, etc.
// ============================================================================

registerEffect(
  'base.spell.temporal-calculus-6th-ed.l3',
  (ctx: EffectContext): EffectResult => {
    if (ctx.state.phase.kind !== 'errands') {
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'done',
      patch: {
        phase: {
          ...ctx.state.phase,
          extraActions: (ctx.state.phase.extraActions ?? 0) + 3,
          bendTimeUsedKinds: [],
        },
      },
    };
  },
);

// ============================================================================
// Taming of the Storm L2 "Tornado" — Action, 2 Mana. Rearrange all Mages in
// a room. The caster picks a room (must contain ≥1 base-position mage), then
// assigns each base-position mage to a base slot in that room one-by-one.
// Each pick excludes slots already claimed by earlier picks. Mages stay
// with the same owner; per-room caps don't shift because no mages enter or
// leave the room. Shadow occupants stay in place. Opposing blue mages are
// NOT excluded — rearranging isn't wound/banish/move/shadow in the
// reaction-event sense, and the card text doesn't restrict by color.
// ============================================================================

function listTornadoRooms(state: GameState): string[] {
  const out: string[] = [];
  for (const r of state.rooms) {
    if (isRoomLocked(state, r.id)) continue;
    if (r.actionSpaces.some((s) => s.occupant !== null)) out.push(r.id);
  }
  return out;
}

function baseMagesInRoom(
  state: GameState,
  roomId: string,
): { mageId: string; ownerId: string; spaceId: string }[] {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const out: { mageId: string; ownerId: string; spaceId: string }[] = [];
  for (const s of room.actionSpaces) {
    if (!s.occupant) continue;
    out.push({
      mageId: s.occupant.mageId,
      ownerId: s.occupant.ownerId,
      spaceId: s.id,
    });
  }
  return out;
}

function baseSlotsInRoom(state: GameState, roomId: string): string[] {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  return room.actionSpaces
    .filter(
      (s) =>
        s.slotType === 'regular' ||
        s.slotType === 'merit' ||
        s.slotType === 'wound',
    )
    .map((s) => s.id);
}

function applyRearrangement(
  state: GameState,
  roomId: string,
  assignments: { mageId: string; ownerId: string; spaceId: string }[],
): GameStatePatch {
  const players = state.players.map((p): Player => ({
    ...p,
    mages: p.mages.map((m) => {
      const assign = assignments.find((a) => a.mageId === m.id);
      if (!assign) return m;
      return {
        ...m,
        location: { kind: 'action-space' as const, spaceId: assign.spaceId },
      };
    }),
  }));
  const rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    return {
      ...r,
      actionSpaces: r.actionSpaces.map((s) => {
        const assign = assignments.find((a) => a.spaceId === s.id);
        if (assign) {
          return {
            ...s,
            occupant: {
              mageId: assign.mageId,
              ownerId: assign.ownerId,
              isShadowing: false,
            },
          };
        }
        // Slot got no assignment — clear its base occupant (the previous
        // occupant has moved elsewhere).
        return { ...s, occupant: null };
      }),
    };
  });
  return { players, rooms };
}

registerEffect(
  'base.spell.taming-of-the-storm.l2',
  (ctx: EffectContext): EffectResult => tornadoStart(ctx),
);

function tornadoStart(ctx: EffectContext): EffectResult {
  const self = 'base.spell.taming-of-the-storm.l2';
  const step = ctx.resumeContext?.['step'];

  if (!ctx.resumeAnswer) {
    const rooms = listTornadoRooms(ctx.state);
    if (rooms.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: rooms.map((rid) => {
            const r = ctx.state.rooms.find((rr) => rr.id === rid)!;
            return { id: rid, label: r.name, payload: {} };
          }),
        },
        resume: { effectId: self, context: { step: 'pick-room' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-room') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} pick-room expected option-chosen`);
    }
    const roomId = ctx.resumeAnswer.optionId;
    return tornadoSurfaceNextPick(ctx, self, roomId, [], []);
  }

  if (step === 'assign-slot') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error(`${self} assign-slot expected space-chosen`);
    }
    const roomId = String(ctx.resumeContext?.['roomId'] ?? '');
    const queueRaw = ctx.resumeContext?.['queue'];
    const assignedRaw = ctx.resumeContext?.['assigned'];
    const queue = Array.isArray(queueRaw)
      ? (queueRaw as unknown as string[])
      : [];
    const assigned = Array.isArray(assignedRaw)
      ? (assignedRaw as unknown as { mageId: string; ownerId: string; spaceId: string }[])
      : [];
    const mageId = String(ctx.resumeContext?.['currentMageId'] ?? '');
    const ownerId = String(ctx.resumeContext?.['currentOwnerId'] ?? '');
    if (!mageId) return { kind: 'done', patch: {} };
    const nextAssigned = [
      ...assigned,
      { mageId, ownerId, spaceId: ctx.resumeAnswer.spaceId },
    ];
    return tornadoSurfaceNextPick(ctx, self, roomId, queue, nextAssigned);
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
}

function tornadoSurfaceNextPick(
  ctx: EffectContext,
  self: string,
  roomId: string,
  queue: string[],
  assigned: { mageId: string; ownerId: string; spaceId: string }[],
): EffectResult {
  // First call: seed queue from baseMagesInRoom.
  if (queue.length === 0 && assigned.length === 0) {
    const mages = baseMagesInRoom(ctx.state, roomId);
    if (mages.length === 0) return { kind: 'done', patch: {} };
    return tornadoSurfaceMagePrompt(
      ctx,
      self,
      roomId,
      mages[0]!,
      mages.slice(1).map((m) => m.mageId),
      [],
    );
  }
  if (queue.length === 0) {
    // All mages assigned — apply.
    return { kind: 'done', patch: applyRearrangement(ctx.state, roomId, assigned) };
  }
  // Next mage in queue. Look up its current owner.
  const nextMageId = queue[0]!;
  const remaining = queue.slice(1);
  const owner = ctx.state.players.find((p) =>
    p.mages.some((m) => m.id === nextMageId),
  );
  if (!owner) {
    // Mage vanished — skip.
    return tornadoSurfaceNextPick(ctx, self, roomId, remaining, assigned);
  }
  return tornadoSurfaceMagePrompt(
    ctx,
    self,
    roomId,
    { mageId: nextMageId, ownerId: owner.id, spaceId: '' },
    remaining,
    assigned,
  );
}

function tornadoSurfaceMagePrompt(
  ctx: EffectContext,
  self: string,
  roomId: string,
  current: { mageId: string; ownerId: string; spaceId: string },
  queue: string[],
  assigned: { mageId: string; ownerId: string; spaceId: string }[],
): EffectResult {
  const allBaseSlots = baseSlotsInRoom(ctx.state, roomId);
  const claimedSlots = assigned.map((a) => a.spaceId);
  const available = allBaseSlots.filter((s) => !claimedSlots.includes(s));
  if (available.length === 0) {
    // Nowhere to put this mage — apply what we have and bail.
    return {
      kind: 'done',
      patch: applyRearrangement(ctx.state, roomId, assigned),
    };
  }
  return {
    kind: 'pause',
    pending: {
      responderId: ctx.triggeringPlayerId,
      prompt: {
        kind: 'choose-target-action-space',
        eligibleSpaceIds: available,
      },
      resume: {
        effectId: self,
        context: {
          step: 'assign-slot',
          roomId,
          currentMageId: current.mageId,
          currentOwnerId: current.ownerId,
          queue: queue as unknown as SerializableContext['queue'],
          assigned: assigned as unknown as SerializableContext['assigned'],
        },
      },
      source: ctx.source,
    },
  };
}

// ============================================================================
// Taming of the Storm L3 "Hurricane" — Action, 3 Mana. Wound a Mage, then
// rearrange the rest of the Mages in that room. Two-stage chain: pick the
// wound target (must be in some room with rearrangeable peers + still satisfy
// the spell-source wound filter), wound them (opens a reaction window),
// then after the window settles, run the room's rearrangement against the
// REMAINING base-position mages.
// ============================================================================

registerEffect('base.spell.taming-of-the-storm.l3', (ctx): EffectResult => {
  const self = 'base.spell.taming-of-the-storm.l3';
  const step = ctx.resumeContext?.['step'];

  // afterResume from the wound's reaction window — bonus chain then enter
  // the rearrangement phase against the same room.
  if (step === 'after-wound') {
    const event = readTriggerEvent(ctx);
    if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
      return {
        kind: 'pause',
        pending: bonusPromptFor(ctx.state, event, ctx.triggeringPlayerId, {
          effectId: self,
          context: {
            step: 'after-bonus',
            recipientPlayerId: event.ownerId,
            roomId: String(ctx.resumeContext?.['roomId'] ?? ''),
          },
        }),
      };
    }
    return hurricaneEnterRearrange(
      ctx.state,
      ctx,
      String(ctx.resumeContext?.['roomId'] ?? ''),
      {},
    );
  }

  if (step === 'after-bonus') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error(`${self} after-bonus expected option-chosen`);
    }
    const recipientId = ctx.resumeContext?.['recipientPlayerId'];
    if (typeof recipientId !== 'string') {
      throw new Error(`${self} after-bonus: missing recipientPlayerId`);
    }
    const bonusPatch = applyInfirmaryBonusFromCtx(
      ctx.state,
      recipientId,
      ctx.resumeAnswer,
      ctx.resumeContext,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    return hurricaneEnterRearrange(
      afterBonus,
      ctx,
      String(ctx.resumeContext?.['roomId'] ?? ''),
      bonusPatch,
    );
  }

  if (step === 'assign-slot') {
    if (ctx.resumeAnswer?.kind !== 'space-chosen') {
      throw new Error(`${self} assign-slot expected space-chosen`);
    }
    const roomId = String(ctx.resumeContext?.['roomId'] ?? '');
    const queueRaw = ctx.resumeContext?.['queue'];
    const assignedRaw = ctx.resumeContext?.['assigned'];
    const queue = Array.isArray(queueRaw) ? (queueRaw as unknown as string[]) : [];
    const assigned = Array.isArray(assignedRaw)
      ? (assignedRaw as unknown as { mageId: string; ownerId: string; spaceId: string }[])
      : [];
    const mageId = String(ctx.resumeContext?.['currentMageId'] ?? '');
    const ownerId = String(ctx.resumeContext?.['currentOwnerId'] ?? '');
    if (!mageId) return { kind: 'done', patch: {} };
    const nextAssigned = [
      ...assigned,
      { mageId, ownerId, spaceId: ctx.resumeAnswer.spaceId },
    ];
    return hurricaneNextPick(ctx, self, roomId, queue, nextAssigned);
  }

  if (!ctx.resumeAnswer) {
    // Step 0: pick wound target. Eligible: any spell-woundable mage in a
    // room that has the target as its current occupant (we filter the
    // target list to placed mages; the chosen target's room becomes the
    // rearrangement room).
    const targets = buildBurnTargets(ctx.state, ctx.triggeringPlayerId);
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
      throw new Error(`${self} wound expected mage-chosen`);
    }
    const targetMageId = ctx.resumeAnswer.mageId;
    const targetMage = ctx.state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === targetMageId);
    const roomId =
      targetMage?.location.kind === 'action-space'
        ? findRoomBySpaceId(ctx.state, targetMage.location.spaceId)?.id
        : null;
    const wound = woundMage(ctx.state, targetMageId, ctx.triggeringPlayerId);
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
            roomId: roomId ?? '',
          },
        },
        source: ctx.source,
      },
    };
  }

  throw new Error(`${self} unexpected step ${String(step)}`);
});

function hurricaneEnterRearrange(
  state: GameState,
  ctx: EffectContext,
  roomId: string,
  carryPatch: GameStatePatch,
): EffectResult {
  if (!roomId) return { kind: 'done', patch: carryPatch };
  const mages = baseMagesInRoom(state, roomId);
  if (mages.length === 0) return { kind: 'done', patch: carryPatch };
  const first = mages[0]!;
  return hurricaneSurfaceMagePrompt(
    { ...ctx, state },
    'base.spell.taming-of-the-storm.l3',
    roomId,
    first,
    mages.slice(1).map((m) => m.mageId),
    [],
    carryPatch,
  );
}

function hurricaneNextPick(
  ctx: EffectContext,
  self: string,
  roomId: string,
  queue: string[],
  assigned: { mageId: string; ownerId: string; spaceId: string }[],
): EffectResult {
  if (queue.length === 0) {
    return {
      kind: 'done',
      patch: applyRearrangement(ctx.state, roomId, assigned),
    };
  }
  const nextMageId = queue[0]!;
  const remaining = queue.slice(1);
  const owner = ctx.state.players.find((p) =>
    p.mages.some((m) => m.id === nextMageId),
  );
  if (!owner) {
    return hurricaneNextPick(ctx, self, roomId, remaining, assigned);
  }
  return hurricaneSurfaceMagePrompt(
    ctx,
    self,
    roomId,
    { mageId: nextMageId, ownerId: owner.id, spaceId: '' },
    remaining,
    assigned,
  );
}

function hurricaneSurfaceMagePrompt(
  ctx: EffectContext,
  self: string,
  roomId: string,
  current: { mageId: string; ownerId: string; spaceId: string },
  queue: string[],
  assigned: { mageId: string; ownerId: string; spaceId: string }[],
  carryPatch?: GameStatePatch,
): EffectResult {
  const allBaseSlots = baseSlotsInRoom(ctx.state, roomId);
  const claimedSlots = assigned.map((a) => a.spaceId);
  const available = allBaseSlots.filter((s) => !claimedSlots.includes(s));
  if (available.length === 0) {
    const patch = {
      ...(carryPatch ?? {}),
      ...applyRearrangement(ctx.state, roomId, assigned),
    };
    return { kind: 'done', patch };
  }
  const pending = {
    responderId: ctx.triggeringPlayerId,
    prompt: {
      kind: 'choose-target-action-space' as const,
      eligibleSpaceIds: available,
    },
    resume: {
      effectId: self,
      context: {
        step: 'assign-slot',
        roomId,
        currentMageId: current.mageId,
        currentOwnerId: current.ownerId,
        queue: queue as unknown as SerializableContext['queue'],
        assigned: assigned as unknown as SerializableContext['assigned'],
      },
    },
    source: ctx.source,
  };
  return carryPatch
    ? { kind: 'pause', patch: carryPatch, pending }
    : { kind: 'pause', pending };
}
