// Summer Break round-end scenario effects. Each is invoked once per player in
// turn order by the engine's round-end scenario pump
// (`drainRoundEndScenarioIfIdle`): first with no `resumeAnswer` to push that
// player's prompt, then again with the answer to apply it. Returning `done`
// with an empty patch is a clean "nothing to do" skip for that player.
//
// Rounds 1-3 "Students Return"     → draft a Mage from the supply
// Round 4   "Summer Study Credits" → may swap one owned Mage for a supply Mage
// Round 5   "Opening Ceremony"     → draft one reward from a shared pool

import { registerEffect } from './registry';
import {
  applySecretSupporterDraw,
  bumpInfluencePatch,
  findPlayer,
  gainResourcePatch,
  MAGE_CARD_BY_COLOR,
} from './helpers';
import { MAGE_COLORS } from '../types';
import type {
  ChoiceOption,
  EffectContext,
  EffectResult,
  GameState,
  GameStatePatch,
  MageColor,
  Player,
} from '../types';

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Mage colours the player can draw from the supply right now: stock remains in
 * the draft pool, the colour isn't the special 'rainbow', and the rulebook
 * 2-per-colour cap isn't already met (neutral / off-white is uncapped).
 */
function draftableColors(state: GameState, player: Player): MageColor[] {
  return MAGE_COLORS.filter((c) => {
    if (c === 'rainbow') return false;
    if ((state.mageDraftPool[c] ?? 0) <= 0) return false;
    if (c === 'off-white') return true;
    return player.mages.filter((m) => m.color === c).length < 2;
  });
}

/** Adds a freshly-minted supply Mage of `color` to the player's office. */
function addMagePatch(
  state: GameState,
  playerId: string,
  color: MageColor,
): GameStatePatch {
  const seq = state.nextSequenceId;
  return {
    nextSequenceId: seq + 1,
    mageDraftPool: {
      ...state.mageDraftPool,
      [color]: (state.mageDraftPool[color] ?? 0) - 1,
    },
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: [
              ...p.mages,
              {
                id: `m-${seq}`,
                cardId: MAGE_CARD_BY_COLOR[color],
                color,
                location: { kind: 'office' as const, playerId },
                isShadowing: false,
                isWounded: false,
              },
            ],
          },
    ),
  };
}

// ============================================================================
// Students Return (rounds 1-3) — draft a Mage from the supply
// ============================================================================

registerEffect('summerbreak.scenario.draft-mage', (ctx): EffectResult => {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  const colors = draftableColors(ctx.state, player);
  if (colors.length === 0) return { kind: 'done', patch: {} };

  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: colors.map((c) => ({
            id: c,
            label: `Draft a ${c} Mage`,
            payload: {},
          })),
        },
        resume: { effectId: 'summerbreak.scenario.draft-mage', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('summerbreak.scenario.draft-mage expected option-chosen');
  }
  const color = ctx.resumeAnswer.optionId as MageColor;
  if (!colors.includes(color)) return { kind: 'done', patch: {} };
  return { kind: 'done', patch: addMagePatch(ctx.state, ctx.triggeringPlayerId, color) };
});

// ============================================================================
// Summer Study Credits (round 4) — MAY swap an owned Mage for a supply Mage
// ============================================================================

registerEffect('summerbreak.scenario.swap-mage', (ctx): EffectResult => {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  const swappable = player.mages.filter(
    (m) => m.location.kind === 'office' && m.color !== 'rainbow' && !m.isTemporary,
  );
  const step = ctx.resumeContext?.['step'];

  // Step 1 — pick which owned Mage to swap, or skip (the swap is optional).
  if (!ctx.resumeAnswer) {
    if (swappable.length === 0) return { kind: 'done', patch: {} };
    const options: ChoiceOption[] = [
      ...swappable.map((m) => ({
        id: m.id,
        label: `Swap your ${m.color} Mage`,
        payload: {},
      })),
      { id: 'skip', label: 'Keep your Mages', payload: {} },
    ];
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: 'summerbreak.scenario.swap-mage', context: { step: 'pick-color' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-color') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('summerbreak.scenario.swap-mage pick-color expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'skip') return { kind: 'done', patch: {} };
    const mageId = ctx.resumeAnswer.optionId;
    const source = player.mages.find((m) => m.id === mageId);
    if (!source || source.location.kind !== 'office') return { kind: 'done', patch: {} };
    // The swapped-out Mage returns to the supply, so its colour is available
    // again for the incoming pick.
    const returned: GameState = {
      ...ctx.state,
      mageDraftPool: {
        ...ctx.state.mageDraftPool,
        [source.color]: (ctx.state.mageDraftPool[source.color] ?? 0) + 1,
      },
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, mages: p.mages.filter((m) => m.id !== mageId) },
      ),
    };
    const incoming = findPlayer(returned, ctx.triggeringPlayerId);
    const colors = incoming ? draftableColors(returned, incoming) : [];
    if (colors.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      patch: {
        mageDraftPool: returned.mageDraftPool,
        players: returned.players,
      },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: colors.map((c) => ({ id: c, label: `Take a ${c} Mage`, payload: {} })),
        },
        resume: { effectId: 'summerbreak.scenario.swap-mage', context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('summerbreak.scenario.swap-mage apply expected option-chosen');
    }
    const color = ctx.resumeAnswer.optionId as MageColor;
    if ((ctx.state.mageDraftPool[color] ?? 0) <= 0) return { kind: 'done', patch: {} };
    return { kind: 'done', patch: addMagePatch(ctx.state, ctx.triggeringPlayerId, color) };
  }

  throw new Error('summerbreak.scenario.swap-mage: unexpected state');
});

// ============================================================================
// Opening Ceremony (round 5) — draft one reward from a shared pool. The pool
// is drafted WITHOUT replacement: each pick is recorded in the scenario's
// `consumedOptionIds` so later players in turn order can't take it again.
// ============================================================================

interface RewardDef {
  id: string;
  label: string;
}

const REWARD_POOL: RewardDef[] = [
  { id: 'neutral-mage', label: '+1 Neutral Mage' },
  { id: 'ip', label: '1 IP' },
  { id: 'mana', label: '2 Mana' },
  { id: 'gold', label: '3 Gold' },
  { id: 'research', label: '1 Research' },
  { id: 'vault', label: 'Draw a Vault Card' },
  { id: 'supporter', label: 'Draw a Supporter' },
];

/** The reward grant (without the consumed-pool bookkeeping). */
function applyReward(ctx: EffectContext, rewardId: string): GameStatePatch {
  const self = ctx.triggeringPlayerId;
  switch (rewardId) {
    case 'neutral-mage':
      // Neutral / off-white is uncapped; mint one even if the pool ran dry.
      return addNeutralMagePatch(ctx.state, self);
    case 'ip':
      return bumpInfluencePatch(ctx.state, self, 1);
    case 'mana':
      return gainResourcePatch(ctx.state, self, 'mana', 2);
    case 'gold':
      return gainResourcePatch(ctx.state, self, 'gold', 3);
    case 'research':
      return {
        researchQueue: [
          ...ctx.state.researchQueue,
          { playerId: self, source: ctx.source },
        ],
      };
    case 'vault': {
      const top = ctx.state.vaultDeck[0];
      if (top === undefined) return {};
      return {
        vaultDeck: ctx.state.vaultDeck.slice(1),
        players: ctx.state.players.map((p) =>
          p.id !== self
            ? p
            : { ...p, vaultCards: [...p.vaultCards, { cardId: top, exhausted: false }] },
        ),
      };
    }
    case 'supporter':
      return applySecretSupporterDraw(ctx.state, self);
    default:
      return {};
  }
}

/** Adds a neutral (off-white) Mage; decrements the supply only if stock exists. */
function addNeutralMagePatch(state: GameState, playerId: string): GameStatePatch {
  const seq = state.nextSequenceId;
  const poolNow = state.mageDraftPool['off-white'] ?? 0;
  return {
    nextSequenceId: seq + 1,
    mageDraftPool: {
      ...state.mageDraftPool,
      'off-white': Math.max(0, poolNow - 1),
    },
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: [
              ...p.mages,
              {
                id: `m-${seq}`,
                cardId: MAGE_CARD_BY_COLOR['off-white'],
                color: 'off-white' as const,
                location: { kind: 'office' as const, playerId },
                isShadowing: false,
                isWounded: false,
              },
            ],
          },
    ),
  };
}

registerEffect('summerbreak.scenario.reward-draft', (ctx): EffectResult => {
  const consumed = ctx.state.pendingRoundEndScenario?.consumedOptionIds ?? [];
  const available = REWARD_POOL.filter((r) => !consumed.includes(r.id));

  if (!ctx.resumeAnswer) {
    if (available.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: available.map((r) => ({ id: r.id, label: r.label, payload: {} })),
        },
        resume: { effectId: 'summerbreak.scenario.reward-draft', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('summerbreak.scenario.reward-draft expected option-chosen');
  }
  const rewardId = ctx.resumeAnswer.optionId;
  if (consumed.includes(rewardId) || !REWARD_POOL.some((r) => r.id === rewardId)) {
    return { kind: 'done', patch: {} };
  }
  const rewardPatch = applyReward(ctx, rewardId);
  // Record the pick so later players in this chain can't draft it again. The
  // scenario object is still live (it clears only once every player is done).
  const sc = ctx.state.pendingRoundEndScenario;
  return {
    kind: 'done',
    patch: {
      ...rewardPatch,
      ...(sc
        ? {
            pendingRoundEndScenario: {
              ...sc,
              consumedOptionIds: [...consumed, rewardId],
            },
          }
        : {}),
    },
  };
});
