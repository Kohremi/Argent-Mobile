// The Archmage's Staff effect implementations.

import { getEffect, hasEffect, registerEffect } from './registry';
import { findPlayer, gainResourcesPatch, lookupSpellCardDef } from './helpers';
import { registerCustomScoring } from '../scoring';
import {
  STAFF_A_CARD_ID,
  STAFF_B_CARD_ID,
  STAFF_VOTER_SCORING_ID,
  staffHolderId,
} from '../../content/packs/archmage';
import type {
  ChoiceOption,
  EffectContext,
  EffectResult,
  GameState,
  GameStatePatch,
  Player,
  ResolutionSource,
} from '../types';

// ============================================================================
// Gain control — runs as the Staff room slot's resolution effect. The placing
// player (ctx.triggeringPlayerId is the slot occupant) takes the matching Staff
// Treasure card: it is removed from any current holder's office and appended,
// readied, to the new holder's. If nobody places on the slot in a later round,
// this never runs and the holder keeps the Staff. The Staff re-readies at
// round-setup via the standard `refreshPlayerCardsAndMerit` treasure refresh.
// ============================================================================

function gainControlPatch(state: GameState, newHolderId: string, staffCardId: string): GameStatePatch {
  // No-op if the new holder already owns it (re-claiming your own Staff).
  const newHolder = findPlayer(state, newHolderId);
  if (newHolder && newHolder.vaultCards.some((v) => v.cardId === staffCardId)) {
    return {};
  }
  const players: Player[] = state.players.map((p) => {
    // Strip the Staff from any prior holder.
    const stripped = p.vaultCards.filter((v) => v.cardId !== staffCardId);
    if (p.id === newHolderId) {
      return { ...p, vaultCards: [...stripped, { cardId: staffCardId, exhausted: false }] };
    }
    if (stripped.length !== p.vaultCards.length) {
      return { ...p, vaultCards: stripped };
    }
    return p;
  });
  return { players };
}

// ============================================================================
// Voter scoring — Uleyle Kimbhe awards a vote to whoever holds the Staff.
// The holder scores 1, everyone else 0, so `computeMostWinner` picks the
// holder (or abstains when no one holds it).
// ============================================================================

registerCustomScoring(STAFF_VOTER_SCORING_ID, (state, player) =>
  staffHolderId(state) === player.id ? 1 : 0,
);

registerEffect('archmage.room.staff-a.gain-control', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainControlPatch(ctx.state, ctx.triggeringPlayerId, STAFF_A_CARD_ID),
}));

registerEffect('archmage.room.staff-b.gain-control', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainControlPatch(ctx.state, ctx.triggeringPlayerId, STAFF_B_CARD_ID),
}));

// ============================================================================
// Staff Side A — "The Will to Power" (Action): gain your choice of 3 Mana,
// 2 Research, 1 INT, or 1 WIS. The Staff Treasure is already exhausted by the
// PLAY_VAULT_CARD handler before this runs.
// ============================================================================

registerEffect('archmage.vault.staff-a.use', (ctx: EffectContext): EffectResult => {
  // First call (no resumeAnswer): surface the choice.
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'mana', label: 'Gain 3 Mana', payload: {} },
            { id: 'research', label: 'Gain 2 Research', payload: {} },
            { id: 'int', label: 'Gain 1 INT', payload: {} },
            { id: 'wis', label: 'Gain 1 WIS', payload: {} },
          ],
        },
        resume: {
          effectId: 'archmage.vault.staff-a.use',
          context: {},
        },
        source: ctx.source,
      },
    };
  }
  const playerId = ctx.triggeringPlayerId;
  switch (ctx.resumeAnswer.optionId) {
    case 'mana':
      return { kind: 'done', patch: gainResourcesPatch(ctx.state, playerId, { mana: 3 }) };
    case 'int':
      return { kind: 'done', patch: gainResourcesPatch(ctx.state, playerId, { intelligence: 1 }) };
    case 'wis':
      return { kind: 'done', patch: gainResourcesPatch(ctx.state, playerId, { wisdom: 1 }) };
    case 'research': {
      // Two Research opportunities, drained one at a time by the engine pump
      // (same pattern as appendResearchQueue in base.ts).
      const source: ResolutionSource = {
        kind: 'vault-card',
        id: STAFF_A_CARD_ID,
        triggeringPlayerId: playerId,
        description: "The Archmage's Staff — Research",
      };
      return {
        kind: 'done',
        patch: {
          researchQueue: [
            ...ctx.state.researchQueue,
            { playerId, source },
            { playerId, source },
          ],
        },
      };
    }
    default:
      throw new Error(`staff-a.use: unknown optionId ${ctx.resumeAnswer.optionId}`);
  }
});

// ============================================================================
// Staff Side B — "The Force of Magic" (Action): cast a Spell you own — even one
// you have not researched — at any level, without paying any Mana. The Staff is
// already exhausted by the PLAY_VAULT_CARD handler. Three steps:
//   1. choose which owned Spell to cast,
//   2. choose its level (any castable level 1-3),
//   3. invoke that level's effect as a fresh spell cast (free, no research gate).
// Reaction-timing and once-per-game levels are excluded from the offer.
// ============================================================================

/** Levels of `spellCardId` castable by the Staff: non-reaction, not once-per-game. */
function castableLevels(state: GameState, spellCardId: string): (1 | 2 | 3)[] {
  const def = lookupSpellCardDef(state, spellCardId);
  if (!def) return [];
  const levels: (1 | 2 | 3)[] = [];
  for (const lvl of def.levels) {
    if (lvl.timing === 'reaction') continue;
    if (lvl.oncePerGame && state.oncePerGameSpellsCast.includes(spellCardId)) continue;
    levels.push(lvl.level);
  }
  return levels;
}

registerEffect('archmage.vault.staff-b.use', (ctx: EffectContext): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  const playerId = ctx.triggeringPlayerId;

  // Step 1: pick the Spell.
  if (step === undefined) {
    const player = findPlayer(ctx.state, playerId);
    const options: ChoiceOption[] = (player?.ownedSpells ?? [])
      .filter((s) => castableLevels(ctx.state, s.cardId).length > 0)
      .map((s) => {
        const def = lookupSpellCardDef(ctx.state, s.cardId);
        return {
          id: s.cardId,
          label: def?.name ?? s.cardId,
          payload: {},
        };
      });
    if (options.length === 0) {
      // No castable spell — Staff fizzles (already exhausted).
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: playerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: 'archmage.vault.staff-b.use', context: { step: 'pick-level' } },
        source: ctx.source,
      },
    };
  }

  // Step 2: pick the level.
  if (step === 'pick-level') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('staff-b.use pick-level expected option-chosen');
    }
    const spellCardId = ctx.resumeAnswer.optionId;
    const levels = castableLevels(ctx.state, spellCardId);
    if (levels.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: playerId,
        prompt: { kind: 'choose-spell-level', spellId: spellCardId, availableLevels: levels },
        resume: { effectId: 'archmage.vault.staff-b.use', context: { step: 'cast', spellCardId } },
        source: ctx.source,
      },
    };
  }

  // Step 3: cast the chosen level for free (no research / mana / budget cost).
  if (step === 'cast') {
    if (ctx.resumeAnswer?.kind !== 'level-chosen') {
      throw new Error('staff-b.use cast expected level-chosen');
    }
    const chosenLevel = ctx.resumeAnswer.level;
    const spellCardId = ctx.resumeContext?.['spellCardId'];
    if (typeof spellCardId !== 'string') {
      throw new Error('staff-b.use cast: missing spellCardId');
    }
    const def = lookupSpellCardDef(ctx.state, spellCardId);
    const levelDef = def?.levels.find((l) => l.level === chosenLevel);
    if (!def || !levelDef) return { kind: 'done', patch: {} };
    if (!hasEffect(levelDef.effectId)) return { kind: 'done', patch: {} };
    const source: ResolutionSource = {
      kind: 'spell',
      id: spellCardId,
      triggeringPlayerId: playerId,
      description: `${def.name} L${levelDef.level} (via the Archmage's Staff)`,
    };
    // Invoke the spell level's effect as a fresh cast against the current state.
    const result = getEffect(levelDef.effectId)({
      state: ctx.state,
      source,
      triggeringPlayerId: playerId,
      allowReactions: true,
    });
    // Record a once-per-game cast so it cannot be repeated (defensive — such
    // levels are excluded from the offer once already cast). Merge into the
    // spell effect's own patch so it isn't lost when the engine applies it.
    if (!levelDef.oncePerGame) return result;
    const oncePatch: GameStatePatch = {
      oncePerGameSpellsCast: [...ctx.state.oncePerGameSpellsCast, spellCardId],
    };
    return { ...result, patch: { ...oncePatch, ...(result.patch ?? {}) } };
  }

  throw new Error(`staff-b.use: unknown step ${String(step)}`);
});
