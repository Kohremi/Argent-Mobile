// DarthPotter — a win-optimizing bot built on Klank's safe baseline.
//
// Pure decision functions (engine truth in, legal GameAction / ResolutionAnswer
// out), same contract as the other personalities — legality is always enumerated
// with the engine's own dry-run selectors so a bot can never attempt an illegal
// move. DarthPotter inherits ALL of the shared safeguards in `./common`
// (merit-badge budgeting, disruption detection, the reaction save, the
// "never rearrange Research" / "always use a reaction" / "never wound your own
// Mage" rules) — this file is its voter-aware win policy.
//
// What makes DarthPotter different is that it plays to WIN the vote. The game is
// won by collecting the most votes from the Consortium, and each revealed voter
// awards its votes to whoever is "most X" for some concrete resource (most Gold,
// most Influence, most Supporters, …). So DarthPotter:
//
//   • Reads the REVEALED voters and scores how valuable each criterion is to it
//     right now — votes-at-stake weighted by how winnable that criterion looks
//     (contestable seats it can flip are worth the most; runaway leads and
//     hopeless gaps are worth little).
//   • Steers its value placements and reward picks toward the resources those
//     voters reward, and prizes Influence above all (it is BOTH a scoring
//     criterion AND the universal tiebreaker at the per-voter and game-end
//     levels).
//   • Marks contested voters — a mark wins a tie on that voter — choosing the
//     voter where a mark buys the most votes.
//
// Errands priority cascade (each tier fails over to the next):
//   1. RESEARCH — with ≥2 unspent INT+WIS, take a Research seat (fuels spells,
//      Most Research, and department voters).
//   2. DISRUPT  — wound / disrupt an OPPONENT (denies their voter standing too).
//   3. VALUE    — the seat with the best combined (base reward + voter) score.
//   4. PLACE    — otherwise any seat.
//   5. BELL     — can't place a Mage → take a Bell Tower card (ends the round).

import {
  INT_WIS_RE,
  SUPPORTER_DRAFT_RE,
  chooseReaction,
  disruptiveCardActions,
  findSpace,
  firstLegalCard,
  isMeritSlot,
  isMoveResearchOption,
  makeRng,
  maxAmount,
  meritBadgesCommitted,
  pickRandom,
  providesResearch,
  unspentResearch,
  markAlternativeAnswer,
} from './common';
import { scorePlayerForCriterion } from '../scoring';
import {
  claimableBellCards,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
} from '../../utils/uiSelectors';
import type {
  ConsortiumVoter,
  GameAction,
  GameState,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  ScoringCriterion,
} from '../types';
import type { BotPersonality } from './types';

const INFLUENCE_RE = /influence|\bip\b/;

interface PlacementOption {
  action: GameAction;
  /** Lower-cased reward summary for the target slot. */
  desc: string;
  /** True when the placement seizes/over-shadows an OPPONENT-occupied slot. */
  disrupts: boolean;
}

function enumeratePlacements(state: GameState, player: Player): PlacementOption[] {
  const out: PlacementOption[] = [];
  const meritBudget =
    player.resources.meritBadges - meritBadgesCommitted(state, player.id);
  const make = (mageId: string, spaceId: string, shadow: boolean) => {
    const found = findSpace(state, spaceId);
    if (found && isMeritSlot(found.space)) {
      const cost = found.space.costToActivate?.meritBadges ?? 1;
      if (cost > meritBudget) return; // can't pay the Badge — skip this seat
    }
    const occupant = found?.space.occupant ?? null;
    out.push({
      action: shadow
        ? { type: 'PLACE_WORKER', playerId: player.id, mageId, actionSpaceId: spaceId, isShadowing: true }
        : { type: 'PLACE_WORKER', playerId: player.id, mageId, actionSpaceId: spaceId },
      desc: (found?.space.description ?? '').toLowerCase(),
      disrupts: occupant !== null && occupant.ownerId !== player.id,
    });
  };
  for (const mage of player.mages) {
    if (mage.location.kind !== 'office' || mage.isWounded) continue;
    for (const spaceId of eligiblePlacementSlots(state, player.id, mage.id)) {
      make(mage.id, spaceId, false);
    }
    for (const spaceId of eligibleShadowPlacementSlots(state, player.id, mage.id)) {
      make(mage.id, spaceId, true);
    }
  }
  return out;
}

// ============================================================================
// Voter awareness — the heart of DarthPotter.
// ============================================================================

/** Influence is also the universal tiebreaker, so reward it beyond its voters. */
const INFLUENCE_TIEBREAK_BONUS = 0.6;
/** How hard the voter layer pulls relative to the base reward value. */
const VOTER_WEIGHT = 2;

/** Voters whose criterion the bot can actually see (face-up or already revealed). */
function revealedVoters(state: GameState): ConsortiumVoter[] {
  return state.voters.filter((v) => v.revealed || v.isAlwaysFaceUp);
}

/** Map "Second-Most X" onto its base resource so we can score standing on it. */
function baseCriterionOf(c: ScoringCriterion): ScoringCriterion {
  if (c === 'second-most-influence') return 'most-influence';
  if (c === 'second-most-supporters') return 'most-supporters';
  return c;
}

/** Best score any OPPONENT currently has on a criterion (−1 if none). */
function bestOpponentScore(
  state: GameState,
  meId: PlayerId,
  crit: ScoringCriterion,
): number {
  let best = -1;
  for (const p of state.players) {
    if (p.id === meId) continue;
    const s = scorePlayerForCriterion(state, p, crit);
    if (s > best) best = s;
  }
  return best;
}

/**
 * How much a marginal point of progress on `crit` is worth to the bot right now,
 * based on its standing vs. the field. The game is won on "most X" voters, so
 * the bot should SECURE and EXTEND the leads it can hold and FLIP the close
 * deficits — not abandon a winning position to chase a coin-flip:
 *   - locked lead (ahead by ≥3)     → low (the voter is effectively won)
 *   - narrow lead / tie (−2…0 gap)  → high (an opponent can still take it back)
 *   - close deficit (behind 1–2)    → highest (a flippable voter)
 *   - hopeless deficit (behind ≥3)  → low (spend the turn elsewhere)
 */
function winnability(state: GameState, me: Player, crit: ScoringCriterion): number {
  const mine = scorePlayerForCriterion(state, me, crit);
  const bestOpp = bestOpponentScore(state, me.id, crit);
  const gap = bestOpp - mine; // >0 behind, <=0 leading/tied
  if (gap <= -3) return 0.3; // locked lead — little marginal value
  if (gap <= 0) return 0.9; // narrow lead or tie — secure / extend it
  if (gap <= 2) return 1; // within striking distance — flip it
  return 0.2; // far behind — not worth chasing
}

/**
 * Priority weight for advancing a given criterion = votes-at-stake across the
 * revealed voters that reward it, scaled by how winnable each looks. Second-Most
 * voters get a light flat weight (pushing the base resource toward FIRST place
 * doesn't reliably help a second-place voter).
 */
function criterionPriority(
  state: GameState,
  me: Player,
  crit: ScoringCriterion,
): number {
  let total = 0;
  for (const voter of revealedVoters(state)) {
    const c = voter.criterion;
    if (c === 'second-most-influence' || c === 'second-most-supporters') {
      if (baseCriterionOf(c) === crit) total += voter.votes * 0.3;
      continue;
    }
    if (c !== crit) continue;
    total += voter.votes * winnability(state, me, crit);
  }
  return total;
}

/** Scoring criteria a reward summary advances (best-effort from its keywords). */
function criteriaInText(text: string): ScoringCriterion[] {
  const t = text.toLowerCase();
  const out: ScoringCriterion[] = [];
  if (/\bgold\b/.test(t)) out.push('most-gold');
  if (/\bmana\b/.test(t)) out.push('most-mana');
  if (/influence|\bip\b/.test(t)) out.push('most-influence');
  if (/\bint\b|intelligence/.test(t)) out.push('most-intelligence');
  if (/\bwis\b|wisdom/.test(t)) out.push('most-wisdom');
  if (/\bresearch\b/.test(t)) out.push('most-research');
  if (/supporter/.test(t)) out.push('most-supporters', 'most-diversity');
  if (/treasure/.test(t)) out.push('most-treasures');
  if (/consumable/.test(t)) out.push('most-consumables');
  if (/\bmark\b|\bmarks\b/.test(t)) out.push('most-marks');
  return out;
}

/** Voter value of a reward summary for this bot (0 when nothing live matches). */
function voterValueOfText(state: GameState, me: Player, text: string): number {
  let v = 0;
  const crits = criteriaInText(text);
  for (const c of crits) v += criterionPriority(state, me, c);
  if (crits.includes('most-influence')) v += INFLUENCE_TIEBREAK_BONUS;
  return v;
}

/**
 * Value of a placement reward to a win-seeking bot. Two layers:
 *
 *   (1) SUBSTANCE — a voter-agnostic base reflecting that a handful of resources
 *       feed MANY of the 12 voters (only 2 of which are face-up during play, so
 *       playing the broad odds matters more than the 2 we can see):
 *         • INT/WIS tokens are the research engine → Most Research, every
 *           department, Most Diversity, plus the Spells they unlock.
 *         • Supporter drafts → Most/Second-Most Supporters, departments,
 *           diversity.
 *         • Influence → Most/Second-Most Influence AND the universal tiebreaker.
 *       (Research SEATS are valued only when we hold tokens to spend there; the
 *       conversion itself is the Errands tier-1 priority below.)
 *
 *   (2) SHARPENING — the revealed voters add `voterValueOfText` on top, pulling
 *       the bot toward the specific criteria it can see and can still win.
 */
function rewardValue(state: GameState, me: Player, desc: string): number {
  let v = 0;
  if (SUPPORTER_DRAFT_RE.test(desc)) v += 4;
  if (INT_WIS_RE.test(desc)) v += 3;
  if (providesResearch(desc) && unspentResearch(me) >= 1) v += 3;
  if (INFLUENCE_RE.test(desc)) v += 3;
  v += Math.min(maxAmount(desc, 'mana'), 4) * 0.6;
  v += Math.min(maxAmount(desc, 'gold'), 6) * 0.4;
  v += VOTER_WEIGHT * voterValueOfText(state, me, desc);
  return v;
}

// ============================================================================
// Errands turn.
// ============================================================================

function chooseErrandsAction(state: GameState, playerId: PlayerId): GameAction {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { type: 'PASS_TURN', playerId };
  const rng = makeRng(state, playerId);
  const placements = enumeratePlacements(state, player);

  // 1) Research seats — only when holding research to spend (≥2 unspent INT+WIS).
  if (unspentResearch(player) >= 2) {
    const research = placements.filter((p) => providesResearch(p.desc));
    if (research.length > 0) return pickRandom(research, rng).action;
  }

  // 2) Wound / disrupt opponents — slot-taking abilities, then spells & items.
  const disrupt: GameAction[] = [
    ...placements.filter((p) => p.disrupts).map((p) => p.action),
    ...disruptiveCardActions(state, player),
  ];
  if (disrupt.length > 0) return pickRandom(disrupt, rng);

  // 3) Value seats — the best substance + voter score wins; ties random.
  if (placements.length > 0) {
    const scored = placements.map((p) => ({ p, v: rewardValue(state, player, p.desc) }));
    const best = Math.max(...scored.map((x) => x.v));
    if (best > 0) {
      return pickRandom(
        scored.filter((x) => x.v === best).map((x) => x.p),
        rng,
      ).action;
    }
    // 4) Nothing scored — drop a Mage into any (random) seat.
    return pickRandom(placements, rng).action;
  }

  // 5) Can't place a Mage → take a Bell Tower card (keeps the round ending).
  const bells = [...claimableBellCards(state, playerId)];
  if (bells.length > 0) {
    return { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: pickRandom(bells, rng) };
  }

  return { type: 'PASS_TURN', playerId };
}

// ============================================================================
// Prompt answers — a valid answer for EVERY prompt kind, voter-aware where it
// matters, with the shared safeguards layered over safe defaults.
// ============================================================================

/** Wound/banish target prompts — negative effects only ever aimed at rivals. */
const HARMFUL_TARGET_RE = /\b(wound|banish)\b/i;

/**
 * Choose which voter to Mark. A mark wins a TIE on that voter, so it's worth the
 * most when the bot is tied at the top (or leading and protecting against a
 * future tie) — and is wasted when the bot scores 0 there. Weighted by the
 * voter's vote value; falls back to the first eligible voter.
 */
function bestVoterToMark(
  state: GameState,
  me: Player,
  eligibleVoterIds: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestVal = -Infinity;
  for (const id of eligibleVoterIds) {
    const voter = state.voters.find((v) => v.id === id);
    if (!voter) continue;
    const crit = baseCriterionOf(voter.criterion);
    const mine = scorePlayerForCriterion(state, me, crit);
    const bestOpp = bestOpponentScore(state, me.id, crit);
    let usefulness: number;
    if (mine <= 0) usefulness = 0.1; // not in contention
    else if (mine === bestOpp) usefulness = 1.0; // tied at the top — mark wins it
    else if (mine > bestOpp) usefulness = 0.5; // leading — insure against ties
    else if (bestOpp - mine <= 1) usefulness = 0.4; // one push behind
    else usefulness = 0.15;
    const val = voter.votes * usefulness;
    if (val > bestVal) {
      bestVal = val;
      best = id;
    }
  }
  return best ?? eligibleVoterIds[0];
}

function answerPendingResolution(
  state: GameState,
  pending: PendingResolution,
): ResolutionAnswer {
  const prompt = pending.prompt;
  const me = state.players.find((p) => p.id === pending.responderId);

  switch (prompt.kind) {
    case 'choose-from-options': {
      const available = prompt.options.filter((o) => o.available !== false);
      const base = available.length > 0 ? available : prompt.options;
      // Bots never rearrange placed Research — drop the move actions so the
      // Research Archive's move menu resolves to "Done moving Research".
      const noMove = base.filter((o) => !isMoveResearchOption(o.id));
      const pool = noMove.length > 0 ? noMove : base;
      // Always take a named reward / research action over forfeiting or
      // discarding (merit resolution, research upgrade-then-draft).
      const prefer = ['reward', 'reward-gold', 'add-wis', 'draft'];
      const preferred = prefer.map((id) => pool.find((o) => o.id === id)).find(Boolean);
      if (preferred) {
        return { kind: 'option-chosen', optionId: preferred.id, payload: preferred.payload };
      }
      // Otherwise pick the resource option that best advances a live voter
      // criterion (gold vs. mana vs. IP …); Influence carries a tiebreak bonus.
      let pick = pool[0]!;
      let bestVal = -Infinity;
      for (const o of pool) {
        const val = me ? voterValueOfText(state, me, o.label ?? o.id) : 0;
        if (val > bestVal) {
          bestVal = val;
          pick = o;
        }
      }
      return { kind: 'option-chosen', optionId: pick.id, payload: pick.payload };
    }

    case 'choose-target-mage': {
      const ownIds = new Set(me?.mages.map((m) => m.id) ?? []);
      // Harmful target prompts dominate — prefer an opponent's mage.
      const opponent = prompt.eligibleMageIds.find((id) => !ownIds.has(id));
      if (opponent !== undefined) return { kind: 'mage-chosen', mageId: opponent };
      // No opponent eligible. For a wound/banish prompt that can be declined,
      // never turn the effect on our own Mage — pass instead.
      if (HARMFUL_TARGET_RE.test(prompt.label ?? '') && prompt.canPass) {
        return { kind: 'pass' };
      }
      const target = prompt.eligibleMageIds[0];
      if (target === undefined) return { kind: 'pass' };
      return { kind: 'mage-chosen', mageId: target };
    }

    case 'choose-target-action-space': {
      const spaceId = prompt.eligibleSpaceIds[0];
      if (spaceId === undefined) return { kind: 'pass' };
      return { kind: 'space-chosen', spaceId };
    }

    case 'choose-vault-card':
    case 'choose-supporter-card':
    case 'choose-peeked-supporter': {
      const cardId = firstLegalCard(state, pending, prompt.eligibleCardIds);
      if (cardId === undefined) return { kind: 'pass' };
      return { kind: 'card-chosen', cardId };
    }

    case 'choose-spell-level': {
      const level = [...prompt.availableLevels].sort((a, b) => b - a)[0];
      return { kind: 'level-chosen', level: level ?? prompt.availableLevels[0]! };
    }

    case 'choose-deck':
      return { kind: 'deck-chosen', deck: prompt.eligibleDecks[0] ?? 'spell' };

    case 'choose-voter': {
      if (prompt.eligibleVoterIds.length === 0)
        return markAlternativeAnswer(prompt) ?? { kind: 'pass' };
      const voterId = me
        ? bestVoterToMark(state, me, prompt.eligibleVoterIds)
        : prompt.eligibleVoterIds[0];
      if (voterId === undefined) return { kind: 'pass' };
      return { kind: 'voter-chosen', voterId };
    }

    case 'reaction-window':
      return chooseReaction(state, pending);

    case 'confirm':
      return { kind: 'confirmed' };
  }
}

export const darthPotter: BotPersonality = {
  id: 'darthpotter',
  name: 'DarthPotter',
  chooseErrandsAction,
  answerPendingResolution,
};
