// The Well of Souls scenario round-end effects. Each runs once per player in
// turn order via the engine's round-end pump (`drainRoundEndScenarioIfIdle`):
// first with no `resumeAnswer` to push that player's prompt, then again with the
// answer to apply it. Returning `done` with an empty patch is a clean skip.
//
//   R1 Rumours of Hauntings    → gain 2 Research
//   R2 Visions in the Night    → gain 1 INT or 1 WIS
//   R3 Whispers in the Shadows → gain 1 Research
//
// (R4/R5 are ongoing casting rules handled in the engine, not here.)

import { registerEffect } from './registry';
import { gainResourcePatch } from './helpers';
import type { EffectResult, GameState, ResolutionSource } from '../types';

/**
 * Appends `count` Research opportunities for `playerId` to the queue. The engine
 * surfaces them one at a time via `drainResearchQueueIfIdle` (so each menu sees
 * the up-to-date board). Mirrors base.ts's private `appendResearchQueue`.
 */
function appendResearch(
  state: GameState,
  playerId: string,
  source: ResolutionSource,
  count: number,
): GameState['researchQueue'] {
  const entries: GameState['researchQueue'] = [];
  for (let i = 0; i < count; i++) entries.push({ playerId, source });
  return [...state.researchQueue, ...entries];
}

// ============================================================================
// R1 — Rumours of Hauntings: gain 2 Research.
// ============================================================================

registerEffect('wellofsouls.scenario.research-2', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    researchQueue: appendResearch(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.source,
      2,
    ),
  },
}));

// ============================================================================
// R3 — Whispers in the Shadows: gain 1 Research.
// ============================================================================

registerEffect('wellofsouls.scenario.research-1', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    researchQueue: appendResearch(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.source,
      1,
    ),
  },
}));

// ============================================================================
// R2 — Visions in the Night: gain 1 INT or 1 WIS (choice).
// ============================================================================

registerEffect('wellofsouls.scenario.int-or-wis', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'int', label: 'Gain 1 Intelligence', payload: {} },
            { id: 'wis', label: 'Gain 1 Wisdom', payload: {} },
          ],
        },
        resume: { effectId: 'wellofsouls.scenario.int-or-wis', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('wellofsouls.scenario.int-or-wis expected option-chosen');
  }
  const resource =
    ctx.resumeAnswer.optionId === 'wis' ? 'wisdom' : 'intelligence';
  return {
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, resource, 1),
  };
});
