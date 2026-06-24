// Political Struggle scenario round-end effect. Rounds 1–4 "Tensions Escalate"
// hand every player a Mark in turn order; via the persistent rule the player may
// instead place a Support Marker into a faction. Run once per player by the
// engine's round-end pump (`drainRoundEndScenarioIfIdle`): the first call pushes
// the gain-mark prompt (resuming to itself), the answer applies it.
//
// The prompt is built by `buildGainMarkChooseVoterPrompt`, so it carries the
// faction Support options automatically; `applyGainMark` routes a `support:*`
// pick to the faction tally instead of a voter mark. (R5 "Reckoning Day" has no
// effect — and round-end effects never fire on the final round anyway.)

import { registerEffect } from './registry';
import { applyGainMark, buildGainMarkChooseVoterPrompt } from './helpers';
import type { EffectResult } from '../types';

registerEffect('political.scenario.gain-mark', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const prompt = buildGainMarkChooseVoterPrompt(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (!prompt) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt,
        resume: { effectId: 'political.scenario.gain-mark', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'voter-chosen') {
    throw new Error(
      `political.scenario.gain-mark expected voter-chosen, got ${ctx.resumeAnswer.kind}`,
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
