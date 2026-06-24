// Key to the University scenario round-end effects. Each runs once per player in
// turn order via the engine's round-end pump (`drainRoundEndScenarioIfIdle`).
// They grant Influence only, so they never prompt — every invocation returns
// `done` (with a patch when the player earns IP, or an empty patch to skip).
//
//   R1 & R2 Recognition for Merit       → gain 1 IP per unused Merit Badge
//   R3      Recognition for Research     → most total Research gains 3 IP (ties: all)
//   R4      Recognition for Involvement  → most total Marks gains 3 IP (ties: all)
//
// (R5 "Awards Ceremony" has no effect — and round-end effects never fire on the
// final round anyway.)
//
// The comparative R3/R4 rewards work *per player*: since the pump invokes the
// effect once for each player, every player whose own score equals the table's
// maximum earns the IP, and everyone else skips — so all tied leaders are paid
// with no special "global" effect kind. IP grants don't change Research or
// Marks, so the maximum is stable across the whole pass.

import { registerEffect } from './registry';
import { bumpInfluencePatch } from './helpers';
import { scorePlayerForCriterion } from '../scoring';
import type { EffectResult, GameState, ScoringCriterion } from '../types';

const RECOGNITION_IP = 3;

/**
 * "Recognition" reward for a comparative criterion: the triggering player earns
 * `ip` Influence iff their score for `criterion` ties the table maximum (and the
 * maximum is above 0). Otherwise a clean skip.
 */
function recognizeMost(
  state: GameState,
  playerId: string,
  criterion: ScoringCriterion,
  ip: number,
): EffectResult {
  let max = -1;
  let myScore = 0;
  for (const p of state.players) {
    const score = scorePlayerForCriterion(state, p, criterion);
    if (score > max) max = score;
    if (p.id === playerId) myScore = score;
  }
  if (max <= 0 || myScore !== max) return { kind: 'done', patch: {} };
  return { kind: 'done', patch: bumpInfluencePatch(state, playerId, ip) };
}

// ============================================================================
// R1 & R2 — Recognition for Merit: gain 1 IP per unused Merit Badge.
// ============================================================================

registerEffect('key.scenario.merit-recognition', (ctx): EffectResult => {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  const badges = player?.resources.meritBadges ?? 0;
  if (badges <= 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, badges),
  };
});

// ============================================================================
// R3 — Recognition for Research: most total Research gains 3 IP (ties: all).
// ============================================================================

registerEffect('key.scenario.research-recognition', (ctx): EffectResult =>
  recognizeMost(
    ctx.state,
    ctx.triggeringPlayerId,
    'most-research',
    RECOGNITION_IP,
  ),
);

// ============================================================================
// R4 — Recognition for Involvement: most total Marks gains 3 IP (ties: all).
// ============================================================================

registerEffect('key.scenario.involvement-recognition', (ctx): EffectResult =>
  recognizeMost(ctx.state, ctx.triggeringPlayerId, 'most-marks', RECOGNITION_IP),
);
