import { getPack } from '../content/registry';
import type {
  ConsortiumVoter,
  ConsortiumVoterId,
  Department,
  GameState,
  Player,
  PlayerId,
  ScoringCriterion,
} from './types';

/**
 * Returns the player's score for a given criterion.
 *
 * `second-most-*` criteria return 0 here — second-place ranking is computed
 * across players in `computeVoterWinner`, not by per-player scoring.
 */
export function scorePlayerForCriterion(
  state: GameState,
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
      return countResearchLevels(player);
    case 'most-supporters':
      return countSupporters(player);
    case 'most-treasures':
      return countTreasures(state, player);
    case 'most-consumables':
      return countConsumables(player);
    case 'most-diversity':
      return countDiversity(state, player);
    case 'most-sorcery':
      return countDepartment(state, player, 'sorcery');
    case 'most-mysticism':
      return countDepartment(state, player, 'mysticism');
    case 'most-natural-magick':
      return countDepartment(state, player, 'natural-magick');
    case 'most-planar-studies':
      return countDepartment(state, player, 'planar-studies');
    case 'most-divinity':
      return countDepartment(state, player, 'divinity');
    case 'second-most-influence':
    case 'second-most-supporters':
      // Resolved by `computeVoterWinner` via second-place ranking; the
      // per-player score here is not used.
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

function countTreasures(state: GameState, player: Player): number {
  let n = 0;
  for (const owned of player.vaultCards) {
    if (lookupVaultType(state, owned.cardId) === 'treasure') n += 1;
  }
  return n;
}

function countConsumables(player: Player): number {
  return player.personalDiscard.filter((d) => d.kind === 'consumable').length;
}

/**
 * Total Spell Research = sum of researched levels across the player's owned
 * Spell cards (intPlaced + wisPlacedLevel2 + wisPlacedLevel3 each count 1).
 * Used by the Candide Malephaise / "Most Research" voter.
 */
function countResearchLevels(player: Player): number {
  let n = 0;
  for (const owned of player.ownedSpells) {
    if (owned.intPlaced) n += 1;
    if (owned.wisPlacedLevel2) n += 1;
    if (owned.wisPlacedLevel3) n += 1;
  }
  return n;
}

/**
 * "Most X Department" voters award their vote to whoever owns the most
 * cards (supporters + researched spells) of that department.
 *
 * Each Spell Book counts once if researched at any level (intPlaced) — the
 * extra L2/L3 research doesn't multiply the count toward department voters.
 * Each Supporter Card counts once.
 *
 * Wild-department supporters (White Ash): the player declares a department
 * before voters are revealed. The declared department is stored in
 * `player.wildDepartmentChoice` and counted here as +1 toward that
 * department's total. The wild supporter is NOT double-counted when the
 * chosen department matches the criterion.
 */
function countDepartment(
  state: GameState,
  player: Player,
  dept: Department,
): number {
  let n = 0;
  // Researched Spell Books in this department.
  for (const owned of player.ownedSpells) {
    if (!owned.intPlaced) continue;
    const card = lookupSpellDepartment(state, owned.cardId);
    if (card === dept) n += 1;
  }
  // Supporters in this department (office + in personal discard).
  // Wild-department supporters are handled below via wildDepartmentChoice.
  for (const sid of allSupporterIdsOf(player)) {
    const supDept = lookupSupporterDepartment(state, sid);
    if (supDept === dept) n += 1;
  }
  // Wild supporter contribution.
  if (
    player.wildDepartmentChoice === dept &&
    hasWildSupporter(state, player)
  ) {
    n += 1;
  }
  return n;
}

/**
 * "Most Diversity" awards their vote to whoever spans the most distinct
 * departments across their researched Spell Books and Supporter Cards.
 * Wild supporters count as the declared department (not as a separate
 * "wild" tally).
 */
function countDiversity(state: GameState, player: Player): number {
  const depts = new Set<Department>();
  for (const owned of player.ownedSpells) {
    if (!owned.intPlaced) continue;
    const d = lookupSpellDepartment(state, owned.cardId);
    if (d && d !== 'wild') depts.add(d);
  }
  for (const sid of allSupporterIdsOf(player)) {
    const d = lookupSupporterDepartment(state, sid);
    if (d && d !== 'wild') depts.add(d);
  }
  if (player.wildDepartmentChoice && hasWildSupporter(state, player)) {
    depts.add(player.wildDepartmentChoice);
  }
  return depts.size;
}

function allSupporterIdsOf(player: Player): string[] {
  return [
    ...player.supporters,
    ...player.personalDiscard
      .filter((d) => d.kind === 'supporter' || d.kind === 'secret-supporter')
      .map((d) => d.cardId),
  ];
}

/** True if the player owns at least one supporter whose department is 'wild'. */
function hasWildSupporter(state: GameState, player: Player): boolean {
  for (const sid of allSupporterIdsOf(player)) {
    if (lookupSupporterDepartment(state, sid) === 'wild') return true;
  }
  return false;
}

/** Exported lookup used by the wild-department-choice prompt step. */
export function playerOwnsWildSupporter(
  state: GameState,
  player: Player,
): boolean {
  return hasWildSupporter(state, player);
}

// ============================================================================
// Card lookups (active-pack scoped)
// ============================================================================

function lookupSpellDepartment(
  state: GameState,
  spellCardId: string,
): Department | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found =
      pack.spells.find((s) => s.id === spellCardId) ??
      pack.legendarySpells.find((s) => s.id === spellCardId);
    if (found) return found.department;
  }
  return null;
}

function lookupSupporterDepartment(
  state: GameState,
  supporterId: string,
): Department | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.supporters.find((s) => s.id === supporterId);
    if (found) return found.department;
  }
  return null;
}

function lookupVaultType(
  state: GameState,
  vaultId: string,
): 'treasure' | 'consumable' | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.vaultCards.find((v) => v.id === vaultId);
    if (found) return found.type;
  }
  return null;
}

// ============================================================================
// Tiebreakers
// ============================================================================

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
 * For "Most X" voters: returns the single player with the highest score for
 * the criterion (above 0), with tiebreakers applied. Returns null if every
 * player scored 0 or the tiebreakers exhaust without a winner.
 */
function computeMostWinner(
  state: GameState,
  voter: ConsortiumVoter,
  criterion: ScoringCriterion,
): PlayerId | null {
  if (state.players.length === 0) return null;

  const scored = state.players.map((p) => ({
    player: p,
    score: scorePlayerForCriterion(state, p, criterion),
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

/**
 * For "Second-Most X" voters: returns the player ranked second (by base
 * criterion). Tied-for-first counts as a single group — second place is the
 * highest scorer strictly below the top tier. If no player exists strictly
 * below the top tier, no one earns this voter's vote.
 */
function computeSecondMostWinner(
  state: GameState,
  voter: ConsortiumVoter,
  baseCriterion: ScoringCriterion,
): PlayerId | null {
  if (state.players.length === 0) return null;

  const scored = state.players.map((p) => ({
    player: p,
    score: scorePlayerForCriterion(state, p, baseCriterion),
  }));
  // Find top score.
  let top = -1;
  for (const s of scored) {
    if (s.score > top) top = s.score;
  }
  if (top <= 0) return null;
  // Find the highest score strictly below `top`.
  let second = -1;
  for (const s of scored) {
    if (s.score < top && s.score > second) second = s.score;
  }
  if (second <= 0) return null;
  const secondTier = scored
    .filter((s) => s.score === second)
    .map((s) => s.player);
  if (secondTier.length === 1) return secondTier[0]!.id;
  return breakVoterTie(state, voter, secondTier);
}

/**
 * Determines which player wins a given voter's vote, or null if no one
 * scored above 0 or the tiebreakers exhaust without a winner.
 */
export function computeVoterWinner(
  state: GameState,
  voter: ConsortiumVoter,
): PlayerId | null {
  if (voter.criterion === 'second-most-influence') {
    return computeSecondMostWinner(state, voter, 'most-influence');
  }
  if (voter.criterion === 'second-most-supporters') {
    return computeSecondMostWinner(state, voter, 'most-supporters');
  }
  return computeMostWinner(state, voter, voter.criterion);
}

/**
 * Per-voter award computed at end of game. `winnerPlayerId === null` means
 * the voter abstained (everyone scored 0 for its criterion, or tiebreakers
 * exhausted without a single leader).
 */
export interface VoterAward {
  voterId: ConsortiumVoterId;
  voterName: string;
  votes: number;
  winnerPlayerId: PlayerId | null;
}

export interface FinalScoringResult {
  votesPerPlayer: Record<PlayerId, number>;
  archmage: PlayerId | null;
  voterAwards: VoterAward[];
  /**
   * Why the final tiebreaker resolved the way it did. Useful for the UI to
   * explain "tied on votes, won on Influence" or "tied all the way; no
   * archmage." Set to 'votes' when a single leader emerges from votes alone.
   */
  tiebreaker: 'votes' | 'influence' | 'influence-arrival' | 'none';
}

/**
 * Sums voter awards per player and applies the game-end tiebreaker chain:
 *   1. Most votes wins outright.
 *   2. Tied → most total Influence (per rulebook).
 *   3. Still tied → player who REACHED that Influence value first
 *      (lowest `influenceArrivalSeq`).
 *   4. Still tied → no archmage.
 */
export function computeFinalScoring(state: GameState): FinalScoringResult {
  const votesPerPlayer: Record<PlayerId, number> = {};
  for (const p of state.players) votesPerPlayer[p.id] = 0;

  const voterAwards: VoterAward[] = [];
  for (const voter of state.voters) {
    const winner = computeVoterWinner(state, voter);
    if (winner !== null) {
      votesPerPlayer[winner] = (votesPerPlayer[winner] ?? 0) + voter.votes;
    }
    voterAwards.push({
      voterId: voter.id,
      voterName: voter.name,
      votes: voter.votes,
      winnerPlayerId: winner,
    });
  }

  // Find max-votes leaders.
  let maxVotes = 0;
  for (const v of Object.values(votesPerPlayer)) {
    if (v > maxVotes) maxVotes = v;
  }
  if (maxVotes === 0) {
    return { votesPerPlayer, archmage: null, voterAwards, tiebreaker: 'none' };
  }

  const voteLeaders = state.players.filter(
    (p) => votesPerPlayer[p.id] === maxVotes,
  );
  if (voteLeaders.length === 1) {
    return {
      votesPerPlayer,
      archmage: voteLeaders[0]!.id,
      voterAwards,
      tiebreaker: 'votes',
    };
  }

  // Tiebreaker 1: total Influence.
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
    return {
      votesPerPlayer,
      archmage: influenceLeaders[0]!.id,
      voterAwards,
      tiebreaker: 'influence',
    };
  }

  // Tiebreaker 2: who reached that Influence value first (lowest arrival seq).
  // Players who never gained Influence (seq === 0) are disqualified.
  const withArrival = influenceLeaders.filter(
    (p) => p.influenceArrivalSeq > 0,
  );
  if (withArrival.length === 1) {
    return {
      votesPerPlayer,
      archmage: withArrival[0]!.id,
      voterAwards,
      tiebreaker: 'influence-arrival',
    };
  }
  if (withArrival.length > 1) {
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
    if (seqLeaders.length === 1) {
      return {
        votesPerPlayer,
        archmage: seqLeaders[0]!.id,
        voterAwards,
        tiebreaker: 'influence-arrival',
      };
    }
  }

  return { votesPerPlayer, archmage: null, voterAwards, tiebreaker: 'none' };
}

export function resolveMidGameScoring(state: GameState): GameState {
  return state;
}
