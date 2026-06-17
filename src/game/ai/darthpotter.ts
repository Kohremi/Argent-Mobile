// DarthPotter — a win-optimizing bot built on Klank's safe baseline.
//
// Pure decision functions (engine truth in, legal GameAction / ResolutionAnswer
// out), same contract as the other personalities — legality is always enumerated
// with the engine's own dry-run selectors so a bot can never attempt an illegal
// move. DarthPotter inherits ALL of Klank's safeguards (merit-badge budgeting,
// disruption detection, research gating, bell-tower fallback) plus the shared
// "always use a reaction" / "never rearrange Research" rules and Thickhide's
// "never wound your own Mage" guard.
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

import { applyAction } from '../engine';
import { createRng, type Rng } from '../../utils/rng';
import { scorePlayerForCriterion } from '../scoring';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../effects/helpers';
import {
  castableSpellLevels,
  claimableBellCards,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
  playableSupporters,
  playableVaultCards,
} from '../../utils/uiSelectors';
import type {
  ActionSpace,
  ConsortiumVoter,
  GameAction,
  GameState,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  Room,
  ScoringCriterion,
} from '../types';
import type { BotPersonality } from './types';

// ============================================================================
// Shared plumbing (mirrors Klank — kept self-contained per personality).
// ============================================================================

/** A PRNG seeded from the state + a salt, so within-tier picks are reproducible. */
function makeRng(state: GameState, salt: string): Rng {
  let h = (state.rngSeed | 0) ^ Math.imul(state.nextSequenceId + 1, 2654435761);
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 16777619);
  }
  return createRng(h);
}

function pickRandom<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)] ?? arr[0]!;
}

function findSpace(
  state: GameState,
  spaceId: string,
): { room: Room; space: ActionSpace } | null {
  for (const room of state.rooms) {
    const space = room.actionSpaces.find((s) => s.id === spaceId);
    if (space) return { room, space };
  }
  return null;
}

/** Unspent research currency in hand (INT + WIS pool, not yet placed on spells). */
function unspentResearch(player: Player): number {
  return player.resources.intelligence + player.resources.wisdom;
}

/** Merit / shadow-merit seats cost a Merit Badge to activate (paid at Resolution). */
function isMeritSlot(space: ActionSpace): boolean {
  return space.slotType === 'merit' || space.slotType === 'shadow-merit';
}

/** Merit Badges already committed to merit seats this round (charged at Resolution). */
function meritBadgesCommitted(state: GameState, playerId: PlayerId): number {
  let committed = 0;
  for (const room of state.rooms) {
    for (const sp of room.actionSpaces) {
      if (!isMeritSlot(sp)) continue;
      const cost = sp.costToActivate?.meritBadges ?? 1;
      if (sp.occupant?.ownerId === playerId) committed += cost;
      if (sp.shadowOccupant?.ownerId === playerId) committed += cost;
    }
  }
  return committed;
}

// --- Reward classification from a slot's human-readable summary -------------

const RESEARCH_RE = /\bresearch\b/;
const SUPPORTER_DRAFT_RE = /draft[^.]*supporter/;
const INT_WIS_RE = /\bint\b|intelligence|\bwis\b|wisdom/;

function providesResearch(desc: string): boolean {
  return RESEARCH_RE.test(desc);
}

/** Largest "<n> mana"/"<n> gold" amount named in the reward text. */
function maxAmount(desc: string, unit: 'mana' | 'gold'): number {
  let best = 0;
  for (const m of desc.matchAll(new RegExp(`(\\d+)\\s*${unit}`, 'g'))) {
    best = Math.max(best, Number(m[1]));
  }
  return best;
}

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

// --- Disruption detection for spells / items (verbatim Klank logic) ---------

const HARMFUL_LABEL_RE = /wound|banish|move|shadow|displace/i;
const DISRUPT_VERB_RE = /\b(wound|banish|shadow|displace|move)\b/i;
const GLOBAL_DISRUPT_RE = /\bsteal\b|lose (their|its) power|may not cast|more mana|extra mana/i;

function actionDisruptsOpponent(
  state: GameState,
  player: Player,
  action: GameAction,
  sourceText: string,
): boolean {
  let next: GameState;
  try {
    next = applyAction(state, action);
  } catch {
    return false;
  }
  const me = player.id;
  const ownIds = new Set(player.mages.map((m) => m.id));

  for (const w of next.activeReactionWindows) {
    for (const e of w.triggerEvents) {
      if (
        (e.kind === 'mage-wounded' ||
          e.kind === 'mage-banished' ||
          e.kind === 'mage-moved' ||
          e.kind === 'mage-shadowed') &&
        e.byPlayerId === me &&
        e.ownerId !== me
      ) {
        return true;
      }
    }
  }

  const top = next.pendingResolutionStack[next.pendingResolutionStack.length - 1];
  if (top && top.responderId === me && top.prompt.kind === 'choose-target-mage') {
    const eligible = top.prompt.eligibleMageIds;
    const opponentEligible = eligible.some((id) => !ownIds.has(id));
    const opponentsOnly = eligible.length > 0 && eligible.every((id) => !ownIds.has(id));
    const harmful =
      opponentsOnly ||
      HARMFUL_LABEL_RE.test(top.prompt.label ?? '') ||
      DISRUPT_VERB_RE.test(sourceText);
    if (opponentEligible && harmful) return true;
  }

  return GLOBAL_DISRUPT_RE.test(sourceText);
}

/** Castable spells + playable items whose effect wounds or disrupts an opponent. */
function disruptiveCardActions(state: GameState, player: Player): GameAction[] {
  const out: GameAction[] = [];
  for (const [spellCardId, levels] of castableSpellLevels(state, player.id)) {
    const def = lookupSpellCardDef(state, spellCardId);
    for (const level of levels) {
      const text = def?.levels.find((l) => l.level === level)?.description ?? '';
      const action: GameAction = { type: 'CAST_SPELL', playerId: player.id, spellCardId, level };
      if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
    }
  }
  for (const vaultCardId of playableVaultCards(state, player.id)) {
    const text = lookupVaultCardDef(state, vaultCardId)?.description ?? '';
    const action: GameAction = { type: 'PLAY_VAULT_CARD', playerId: player.id, vaultCardId };
    if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
  }
  for (const supporterCardId of playableSupporters(state, player.id)) {
    const text = lookupSupporterCardDef(state, supporterCardId)?.description ?? '';
    const action: GameAction = { type: 'PLAY_SUPPORTER', playerId: player.id, supporterCardId };
    if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
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
// matters, with Klank/Thickhide safeguards layered over safe defaults.
// ============================================================================

/** Research-rearrange option ids — bots never shuffle placed Research. */
function isMoveResearchOption(id: string): boolean {
  return id === 'move-wis' || id === 'move-int';
}

/** Wound/banish target prompts — negative effects only ever aimed at rivals. */
const HARMFUL_TARGET_RE = /\b(wound|banish)\b/i;

/**
 * First eligible card whose pick is actually LEGAL, found by dry-running the
 * resolution (engine-truth — the same safeguard Klank/Thickhide use for
 * actions). A `choose-vault-card` BUY prompt can list cards the bot can't
 * afford; picking the first blindly would throw an illegal-move error, so we
 * skip any candidate the engine rejects. Falls back to the first id if none
 * dry-run cleanly (no worse than before, and never an *extra* illegal move).
 */
function firstLegalCard(
  state: GameState,
  pending: PendingResolution,
  cardIds: readonly string[],
): string | undefined {
  for (const cardId of cardIds) {
    try {
      applyAction(state, {
        type: 'RESOLVE_PENDING',
        resolutionId: pending.id,
        answer: { kind: 'card-chosen', cardId },
      });
      return cardId;
    } catch {
      // Illegal (e.g. an unaffordable buy) — try the next candidate.
    }
  }
  return cardIds[0];
}

/**
 * Choose a LEGAL reaction answer for an open reaction window, verified by
 * dry-running each candidate (engine-truth). The engine only offers reactions
 * the bot owns and can pay, but a multi-Mage window can still reject a naive
 * play: e.g. Mystic Amulet over a window whose FIRST event is an opponent's
 * Mage — with no `forMageId` the engine matches event[0] and the reaction
 * throws "only protects your own Mage". So we try the option's own forMageId,
 * then each of the responder's affected Mages, and commit only to an answer the
 * engine accepts; if none do, we pass (always legal). A repeatable option
 * (Sacred Shield) is preferred so it keeps its slot and can save several Mages.
 * `reactionContext: {}` resolves a slot-pick reaction by keeping the Mage on
 * its original slot.
 */
function chooseReaction(state: GameState, pending: PendingResolution): ResolutionAnswer {
  const prompt = pending.prompt;
  if (prompt.kind !== 'reaction-window' || prompt.reactionOptions.length === 0) {
    return { kind: 'reaction-passed' };
  }
  const ownAffected = prompt.triggerEvents
    .filter((e) => 'ownerId' in e && e.ownerId === pending.responderId && 'mageId' in e)
    .map((e) => (e as { mageId: string }).mageId);
  const legal = (answer: ResolutionAnswer): boolean => {
    try {
      applyAction(state, { type: 'RESOLVE_PENDING', resolutionId: pending.id, answer });
      return true;
    } catch {
      return false;
    }
  };
  const ordered = [...prompt.reactionOptions].sort(
    (a, b) => Number(b.repeatable ?? false) - Number(a.repeatable ?? false),
  );
  for (const o of ordered) {
    const targets = o.forMageId ? [o.forMageId] : [undefined, ...ownAffected];
    for (const forMageId of targets) {
      const answer: ResolutionAnswer = {
        kind: 'reaction-played',
        effectId: o.effectId,
        reactionContext: {},
        ...(forMageId ? { forMageId } : {}),
      };
      if (legal(answer)) return answer;
    }
  }
  return { kind: 'reaction-passed' };
}

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
      // never turn the effect on our own Mage — pass instead (Thickhide guard).
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
      if (prompt.eligibleVoterIds.length === 0) return { kind: 'pass' };
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
