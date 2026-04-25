import type { GameState, PlayerId } from './types';

/**
 * Resolves end-of-round scoring effects (some councils score mid-game; some
 * room round-end effects fire here).
 *
 * TODO: walk councils + rooms looking for round-end triggers and apply.
 */
export function resolveMidGameScoring(state: GameState): GameState {
  return state;
}

/**
 * Final scoring: reveal all councils, total votes per player, return ranking.
 *
 * TODO: implement criterion → winner resolution. For ties, Argent uses
 * specific tie-breakers per council; defer until criteria are firmed up.
 */
export interface FinalScoringResult {
  votesPerPlayer: Record<PlayerId, number>;
  archmage: PlayerId | null;
}

export function resolveFinalScoring(_state: GameState): FinalScoringResult {
  // TODO: iterate councils, evaluate scoringCriterion (or customScoringEffectId)
  // against each player, award votes, break ties, name the archmage.
  return { votesPerPlayer: {}, archmage: null };
}
