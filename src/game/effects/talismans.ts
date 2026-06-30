// Talismans of Magic scenario effects.
//
// Round-end rewards (R1/R2/R4) run once per player in turn order via the
// engine's round-end scenario pump (`drainRoundEndScenarioIfIdle`): first with
// no `resumeAnswer` to push that player's prompt, then again with the answer to
// apply it. Returning `done` with an empty patch is a clean "nothing to do"
// skip for that player.
//
//   R1 Research Grants            → +5 Gold (no prompt)
//   R2 Opening the Vaults         → draw 2 Vault cards, keep 1
//   R4 Student Testing Incentives → retrieve a Consumable from discard
//
// `choose-starting-item` is not a round-end effect — it applies a neutral
// leader's starting Synthesis pick (the prompt is pushed at round-1 setup by
// the engine's `grantStartingScenarioItems`).

import { registerEffect } from './registry';
import { findPlayer, gainResourcePatch, lookupVaultCardDef } from './helpers';
import { getScenario } from '../../content/scenarios';
import type {
  EffectResult,
  GameState,
  Player,
  VaultCardId,
} from '../types';

/** Appends a readied Vault card to a player's vault. */
function addVaultCardToPlayer(
  state: GameState,
  playerId: string,
  cardId: VaultCardId,
): Player[] {
  return state.players.map((p) =>
    p.id !== playerId
      ? p
      : { ...p, vaultCards: [...p.vaultCards, { cardId, exhausted: false }] },
  );
}

// ============================================================================
// R1 — Research Grants: every player gains 5 Gold.
// ============================================================================

registerEffect('talismans.scenario.research-grants', (ctx): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 5),
}));

// ============================================================================
// R2 — Opening the Vaults: draw 2 Vault cards, keep 1 (the other returns to the
// bottom of the deck).
// ============================================================================

registerEffect('talismans.scenario.opening-vaults', (ctx): EffectResult => {
  const playerId = ctx.triggeringPlayerId;

  if (!ctx.resumeAnswer) {
    const deck = ctx.state.vaultDeck;
    const drawn = deck.slice(0, 2);
    if (drawn.length === 0) return { kind: 'done', patch: {} };
    const remainingDeck = deck.slice(drawn.length);
    if (drawn.length === 1) {
      // Only one card left in the deck — no choice, just take it.
      return {
        kind: 'done',
        patch: {
          vaultDeck: remainingDeck,
          players: addVaultCardToPlayer(ctx.state, playerId, drawn[0]!),
        },
      };
    }
    return {
      kind: 'pause',
      patch: { vaultDeck: remainingDeck },
      pending: {
        responderId: playerId,
        prompt: {
          kind: 'choose-from-options',
          options: drawn.map((id) => ({
            id,
            label: lookupVaultCardDef(ctx.state, id)?.name ?? id,
            payload: {},
          })),
        },
        resume: {
          effectId: 'talismans.scenario.opening-vaults',
          context: { drawn },
        },
        source: ctx.source,
      },
    };
  }

  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('talismans.scenario.opening-vaults expected option-chosen');
  }
  const drawn = (ctx.resumeContext?.['drawn'] as unknown as string[]) ?? [];
  const chosen = ctx.resumeAnswer.optionId;
  const keep = drawn.includes(chosen) ? chosen : (drawn[0] ?? null);
  if (!keep) return { kind: 'done', patch: {} };
  const returned = drawn.find((id) => id !== keep);
  return {
    kind: 'done',
    patch: {
      players: addVaultCardToPlayer(ctx.state, playerId, keep),
      // Unchosen card goes to the bottom of the deck.
      ...(returned ? { vaultDeck: [...ctx.state.vaultDeck, returned] } : {}),
    },
  };
});

// ============================================================================
// R4 — Student Testing Incentives: retrieve one Consumable from your discard
// into your vault (may skip).
// ============================================================================

registerEffect('talismans.scenario.testing-incentives', (ctx): EffectResult => {
  const playerId = ctx.triggeringPlayerId;
  const player = findPlayer(ctx.state, playerId);
  if (!player) return { kind: 'done', patch: {} };
  const consumables = player.personalDiscard
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.kind === 'consumable');

  if (!ctx.resumeAnswer) {
    if (consumables.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: playerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            ...consumables.map(({ entry, i }) => {
              const cardId = (entry as { cardId: VaultCardId }).cardId;
              return {
                id: `idx-${i}`,
                label: lookupVaultCardDef(ctx.state, cardId)?.name ?? cardId,
                payload: {},
                cardId,
              };
            }),
            { id: 'skip', label: 'Skip', payload: {} },
          ],
        },
        resume: {
          effectId: 'talismans.scenario.testing-incentives',
          context: {},
        },
        source: ctx.source,
      },
    };
  }

  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      'talismans.scenario.testing-incentives expected option-chosen',
    );
  }
  const opt = ctx.resumeAnswer.optionId;
  if (opt === 'skip') return { kind: 'done', patch: {} };
  const idx = Number(opt.replace('idx-', ''));
  const entry = player.personalDiscard[idx];
  if (!entry || entry.kind !== 'consumable') return { kind: 'done', patch: {} };
  const cardId = entry.cardId;
  return {
    kind: 'done',
    patch: {
      players: ctx.state.players.map((p) =>
        p.id !== playerId
          ? p
          : {
              ...p,
              personalDiscard: p.personalDiscard.filter((_, i) => i !== idx),
              vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
            },
      ),
    },
  };
});

// ============================================================================
// Starting items — applies a neutral (Students) leader's pick of an unused
// Synthesis Treasure. The prompt is pushed at round-1 setup by the engine; this
// effect only applies the choice, re-validating against currently-owned items so
// two neutral leaders can't claim the same treasure.
// ============================================================================

registerEffect(
  'talismans.scenario.choose-starting-item',
  (ctx): EffectResult => {
    const playerId = ctx.triggeringPlayerId;
    const scenario = ctx.state.scenarioId
      ? getScenario(ctx.state.scenarioId)
      : undefined;
    const pool = scenario?.startingItemPool ?? [];
    if (!ctx.resumeAnswer || ctx.resumeAnswer.kind !== 'option-chosen') {
      return { kind: 'done', patch: {} };
    }
    const owned = new Set(
      ctx.state.players.flatMap((p) => p.vaultCards.map((v) => v.cardId)),
    );
    let itemId: string | null = ctx.resumeAnswer.optionId;
    if (!pool.includes(itemId) || owned.has(itemId)) {
      itemId = pool.find((id) => !owned.has(id)) ?? null;
    }
    if (!itemId) return { kind: 'done', patch: {} };
    return {
      kind: 'done',
      patch: { players: addVaultCardToPlayer(ctx.state, playerId, itemId) },
    };
  },
);
