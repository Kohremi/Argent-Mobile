import type {
  ConsortiumVoter,
  GameState,
  Player,
  PlayerId,
  ScoringCriterion,
} from './types';

/**
 * Returns the player's score for a given criterion. Most criteria look at
 * resources or card counts; some (Most Diversity, departmental control) need
 * card metadata that's still stubbed.
 *
 * Used at end-game scoring; `most-research` is always 0 because Research is
 * transient (not stored).
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
      // TODO: implement second-place ranking (computed across players)
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
  // TODO: filter by VaultCardType === 'treasure'. Without card definitions
  // available here, every owned vault card counts as 1 — fix when card lookup
  // is wired in.
  return player.vaultCards.length;
}

function countConsumables(player: Player): number {
  return player.personalDiscard.filter((d) => d.kind === 'consumable').length;
}

/**
 * Determines which player wins a given voter's vote, or null if the voter
 * goes unawarded (everyone tied at 0, or tied through tiebreakers).
 *
 * Tiebreakers per rulebook: most marks placed on this voter, then lowest
 * Influence Track position. Tiebreakers are TODO.
 */
export function computeVoterWinner(
  state: GameState,
  voter: ConsortiumVoter,
): PlayerId | null {
  if (state.players.length === 0) return null;

  const scored = state.players.map((p) => ({
    playerId: p.id,
    score: scorePlayerForCriterion(state, p, voter.criterion),
  }));

  let max = -1;
  for (const s of scored) {
    if (s.score > max) max = s.score;
  }
  if (max <= 0) return null;

  const tied = scored.filter((s) => s.score === max);
  if (tied.length === 1) return tied[0]?.playerId ?? null;

  // TODO: tiebreaker — marks on this voter, then IP track position.
  return null;
}

export interface FinalScoringResult {
  votesPerPlayer: Record<PlayerId, number>;
  archmage: PlayerId | null;
}

export function computeFinalScoring(state: GameState): FinalScoringResult {
  const votesPerPlayer: Record<PlayerId, number> = {};
  for (const p of state.players) votesPerPlayer[p.id] = 0;

  for (const voter of state.voters) {
    const winner = computeVoterWinner(state, voter);
    if (winner !== null) {
      votesPerPlayer[winner] = (votesPerPlayer[winner] ?? 0) + voter.votes;
    }
  }

  let archmage: PlayerId | null = null;
  let maxVotes = 0;
  let tiedAtMax = false;
  for (const [playerId, votes] of Object.entries(votesPerPlayer)) {
    if (votes > maxVotes) {
      maxVotes = votes;
      archmage = playerId;
      tiedAtMax = false;
    } else if (votes === maxVotes && votes > 0) {
      tiedAtMax = true;
    }
  }
  if (tiedAtMax || maxVotes === 0) archmage = null;

  return { votesPerPlayer, archmage };
}

/** Mid-game scoring hook — base game has none. Reserved for expansions. */
export function resolveMidGameScoring(state: GameState): GameState {
  return state;
}
