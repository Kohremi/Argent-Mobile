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
 * "Most X Department" voters award their vote based on the player's total
 * weight in that department:
 *   - Each Supporter card of the department: +1.
 *   - Each researched level of a Spell Book in the department: +1 (so an
 *     L3-researched spell contributes 3 toward its department's total,
 *     L2 contributes 2, L1 contributes 1).
 *
 * Example: 2 Mysticism supporters + one L3-researched Mysticism spell
 *          = 2 + 3 = 5 toward Most Mysticism.
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
  // Researched levels per spell book in this department.
  for (const owned of player.ownedSpells) {
    const card = lookupSpellDepartment(state, owned.cardId);
    if (card !== dept) continue;
    if (owned.intPlaced) n += 1;
    if (owned.wisPlacedLevel2) n += 1;
    if (owned.wisPlacedLevel3) n += 1;
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
 * Resolves an IP-based tiebreak among a set of players. Most total
 * Influence wins; if multiple are tied at the top, the one who reached
 * that value first (lowest `influenceArrivalSeq`) wins. Returns null if
 * the tie still can't be resolved (every leader has seq === 0, meaning
 * none has ever gained Influence, or the seq itself is tied).
 *
 * Treated as a single "IP tiebreak" concept since arrival-seq is the
 * inner discriminator when current Influence is tied. The `via` field
 * lets the game-end caller distinguish "won on IP" vs "won on arrival"
 * for the UI label.
 */
function resolveByInfluence(
  pool: Player[],
): { winner: PlayerId; via: 'influence' | 'influence-arrival' } | null {
  if (pool.length === 0) return null;
  let bestInfluence = -1;
  let leaders: Player[] = [];
  for (const p of pool) {
    if (p.resources.influence > bestInfluence) {
      bestInfluence = p.resources.influence;
      leaders = [p];
    } else if (p.resources.influence === bestInfluence) {
      leaders.push(p);
    }
  }
  if (leaders.length === 1) {
    return { winner: leaders[0]!.id, via: 'influence' };
  }

  // Tied at top IP — who arrived first? seq === 0 means "never gained IP"
  // and disqualifies from this step.
  const withArrival = leaders.filter((p) => p.influenceArrivalSeq > 0);
  if (withArrival.length === 0) return null;
  if (withArrival.length === 1) {
    return { winner: withArrival[0]!.id, via: 'influence-arrival' };
  }
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
    return { winner: seqLeaders[0]!.id, via: 'influence-arrival' };
  }
  return null;
}

/**
 * Resolves a multi-way tie at the per-voter level. Marks are binary
 * (a player has either marked the voter or not — max 1 mark per voter).
 *
 * Chain:
 *   1. Among the candidates tied on the voter's criterion, see who marked
 *      the voter.
 *      - Exactly ONE marked → that player wins.
 *      - Otherwise (zero markers OR multiple markers) the IP tiebreak
 *        runs on the appropriate subset:
 *          * zero markers     → IP across ALL tied candidates.
 *          * multiple markers → IP among the markers only.
 *   2. IP tiebreak = most Influence, then "who reached that Influence
 *      value first" (lowest `influenceArrivalSeq`) as the inner step.
 *   3. Still tied → voter abstains.
 */
function breakVoterTie(
  state: GameState,
  voter: ConsortiumVoter,
  candidates: Player[],
): PlayerId | null {
  const markers = candidates.filter(
    (p) => countMarksOnVoter(state, voter.id, p.id) > 0,
  );

  // Step 1: marks (binary).
  if (markers.length === 1) return markers[0]!.id;

  // Step 2 + 3: IP tiebreak on the appropriate subset.
  const ipPool = markers.length === 0 ? candidates : markers;
  return resolveByInfluence(ipPool)?.winner ?? null;
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

  // IP tiebreak (most Influence, then who reached that value first).
  const ipResult = resolveByInfluence(voteLeaders);
  if (ipResult) {
    return {
      votesPerPlayer,
      archmage: ipResult.winner,
      voterAwards,
      tiebreaker: ipResult.via,
    };
  }

  return { votesPerPlayer, archmage: null, voterAwards, tiebreaker: 'none' };
}

export function resolveMidGameScoring(state: GameState): GameState {
  return state;
}
