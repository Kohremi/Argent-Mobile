import type {
  ConsortiumVoter,
  GameState,
  Player,
  PlayerId,
  ScoringCriterion,
} from './types';

/**
 * Returns the player's score for a given criterion.
 *
 * `most-research` is always 0 because Research is transient (not stored).
 *
 * `second-most-*` criteria return 0 here — second-place ranking is computed
 * across players in `computeVoterWinner`, not by per-player scoring.
 */
export function scorePlayerForCriterion(
  _state: GameState,
  player: Player,
  criterion: ScoringCriterion,
): number {
  switch (criterion) {
    case 'most-gold':
      return player.resources.gold;
    case 'most-mana':
      return player.resources.mana;
    case 'most-influence':
      return player.resources.influence;
    case 'most-marks':
      return player.resources.marks;
    case 'most-intelligence':
      return player.resources.intelligence;
    case 'most-wisdom':
      return player.resources.wisdom;
    case 'most-research':
      return 0;
    case 'most-supporters':
      return countSupporters(player);
    case 'most-treasures':
      return countTreasures(player);
    case 'most-consumables':
      return countConsumables(player);
    case 'most-diversity':
      // TODO: distinct departments across player's cards
      return 0;
    case 'most-sorcery':
    case 'most-mysticism':
    case 'most-natural-magick':
    case 'most-planar-studies':
    case 'most-divinity':
      // TODO: count cards in player's tableau matching the department
      return 0;
    case 'second-most-influence':
    case 'second-most-supporters':
      return 0;
    case 'custom':
      // TODO: invoke voter.customScoringEffectId via the effect registry
      return 0;
  }
}

function countSupporters(player: Player): number {
  const inDiscard = player.personalDiscard.filter(
    (d) => d.kind === 'supporter' || d.kind === 'secret-supporter',
  ).length;
  return player.supporters.length + inDiscard;
}

function countTreasures(player: Player): number {
  // TODO: filter by VaultCardType === 'treasure' (requires card lookup).
  return player.vaultCards.length;
}

function countConsumables(player: Player): number {
  return player.personalDiscard.filter((d) => d.kind === 'consumable').length;
}

function countMarksOnVoter(
  state: GameState,
  voterId: string,
  playerId: PlayerId,
): number {
  return state.voterMarks.filter(
    (m) => m.voterId === voterId && m.playerId === playerId,
  ).length;
}

/**
 * Resolves a multi-way tie at the per-voter level. Per rulebook:
 *   1. Most marks placed on this voter wins.
 *   2. Lowest IP arrival sequence wins (placed on the IP track first).
 *   3. Still tied → no winner (no votes awarded for this voter).
 */
function breakVoterTie(
  state: GameState,
  voter: ConsortiumVoter,
  candidates: Player[],
): PlayerId | null {
  // Tiebreaker 1: marks on this voter.
  let bestMarks = -1;
  let marksLeaders: Player[] = [];
  for (const p of candidates) {
    const marks = countMarksOnVoter(state, voter.id, p.id);
    if (marks > bestMarks) {
      bestMarks = marks;
      marksLeaders = [p];
    } else if (marks === bestMarks) {
      marksLeaders.push(p);
    }
  }
  if (marksLeaders.length === 1) return marksLeaders[0]!.id;

  // Tiebreaker 2: lowest influenceArrivalSeq (placed on IP first).
  // 0 means the player has never increased their IP — treat as no-arrival
  // and disqualify from this tiebreaker.
  const withArrival = marksLeaders.filter((p) => p.influenceArrivalSeq > 0);
  if (withArrival.length === 1) return withArrival[0]!.id;
  if (withArrival.length === 0) return null;

  let bestSeq = Infinity;
  let seqLeaders: Player[] = [];
  for (const p of withArrival) {
    if (p.influenceArrivalSeq < bestSeq) {
      bestSeq = p.influenceArrivalSeq;
      seqLeaders = [p];
    } else if (p.influenceArrivalSeq === bestSeq) {
      seqLeaders.push(p);
    }
  }
  if (seqLeaders.length === 1) return seqLeaders[0]!.id;

  // Still tied: no winner.
  return null;
}

/**
 * Determines which player wins a given voter's vote, or null if no one
 * scored above 0 or the tiebreakers exhaust without a winner.
 */
export function computeVoterWinner(
  state: GameState,
  voter: ConsortiumVoter,
): PlayerId | null {
  if (state.players.length === 0) return null;

  const scored = state.players.map((p) => ({
    player: p,
    score: scorePlayerForCriterion(state, p, voter.criterion),
  }));

  let max = -1;
  for (const s of scored) {
    if (s.score > max) max = s.score;
  }
  if (max <= 0) return null;

  const tied = scored.filter((s) => s.score === max).map((s) => s.player);
  if (tied.length === 1) return tied[0]!.id;

  return breakVoterTie(state, voter, tied);
}

export interface FinalScoringResult {
  votesPerPlayer: Record<PlayerId, number>;
  archmage: PlayerId | null;
}

/**
 * Sums voter awards per player and applies the game-end tiebreaker (per
 * rulebook: total Influence). If still tied, returns null archmage.
 */
export function computeFinalScoring(state: GameState): FinalScoringResult {
  const votesPerPlayer: Record<PlayerId, number> = {};
  for (const p of state.players) votesPerPlayer[p.id] = 0;

  for (const voter of state.voters) {
    const winner = computeVoterWinner(state, voter);
    if (winner !== null) {
      votesPerPlayer[winner] = (votesPerPlayer[winner] ?? 0) + voter.votes;
    }
  }

  // Find max-votes leaders.
  let maxVotes = 0;
  for (const v of Object.values(votesPerPlayer)) {
    if (v > maxVotes) maxVotes = v;
  }
  if (maxVotes === 0) return { votesPerPlayer, archmage: null };

  const voteLeaders = state.players.filter(
    (p) => votesPerPlayer[p.id] === maxVotes,
  );
  if (voteLeaders.length === 1) {
    return { votesPerPlayer, archmage: voteLeaders[0]!.id };
  }

  // Game-end tiebreaker: total influence.
  let bestInfluence = -1;
  let influenceLeaders: Player[] = [];
  for (const p of voteLeaders) {
    if (p.resources.influence > bestInfluence) {
      bestInfluence = p.resources.influence;
      influenceLeaders = [p];
    } else if (p.resources.influence === bestInfluence) {
      influenceLeaders.push(p);
    }
  }
  if (influenceLeaders.length === 1) {
    return { votesPerPlayer, archmage: influenceLeaders[0]!.id };
  }

  return { votesPerPlayer, archmage: null };
}

export function resolveMidGameScoring(state: GameState): GameState {
  return state;
}
