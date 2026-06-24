// Malfoy — a disruption-first personality built on Klank's safe baseline.
//
// Pure decision functions (engine truth in, legal GameAction / ResolutionAnswer
// out), same contract as the other personalities — legality is always enumerated
// with the engine's own dry-run selectors so a bot can never attempt an illegal
// move. The shared plumbing (seeded RNG, board lookups, merit budgeting,
// reaction saves, the self-wound guard) lives in `./common`; this file is
// Malfoy's policy: BOARD DISRUPTION and WOUNDING, fuelled by RESEARCH and MANA
// for ever-bigger Spells.
//
// Errands priority cascade (each tier fails over to the next):
//   0. DISRUPT — the single highest-impact way to hurt a rival, considered
//      across ALL channels (not just Spells): a Spell, a Vault/Consumable card,
//      a Supporter, OR a placement that seizes / over-shadows an opponent's
//      seat. Options are ranked by impact (banish > wound > shadow/move >
//      global control) and then by how juicy the target is (the rival's
//      Influence — the vote tiebreaker — plus the value of the seat the victim
//      sits on). This beats everything below.
//   1. MANA — the best open seat granting ≥2 Mana, ONCE per round, while still
//      mana-hungry. He pivots off Mana once flush (≥6) or no 2+ Mana seat is
//      left (he's saving Mana for big casts, not hoarding forever).
//   2. RESEARCH ENGINE — he wants big Spells, so he builds the research engine:
//      with ≥2 unspent INT+WIS to convert he takes a Research seat; otherwise he
//      gathers the INT/WIS fuel FIRST (and still takes Research if that's all
//      that's open).
//   3. otherwise place anywhere; if he can't place a Mage, take a Bell Tower
//      card (which keeps the round advancing toward its end).
//
// Within-tier picks are seeded from the state, so they're reproducible yet vary
// across the game. "Once per round" is read off the board: a placed Mage sits on
// its seat until Resolution, so "already grabbed Mana this round" = "Malfoy
// already occupies a 2+ Mana seat".

import {
  DISRUPT_VERB_RE,
  GLOBAL_DISRUPT_RE,
  HARMFUL_LABEL_RE,
  HARMFUL_TARGET_RE,
  INT_WIS_RE,
  chooseReaction,
  findSpace,
  firstLegalCard,
  forcesSelfWound,
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
import {
  castableSpellLevels,
  claimableBellCards,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
  playableSupporters,
  playableVaultCards,
} from '../../utils/uiSelectors';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../effects/helpers';
import { applyAction } from '../engine';
import type {
  GameAction,
  GameState,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
} from '../types';
import type { BotPersonality } from './types';

// ============================================================================
// Reward / target classification (Malfoy-specific helpers over shared regexes).
// ============================================================================

function providesIntWis(desc: string): boolean {
  return INT_WIS_RE.test(desc);
}

/** Largest fixed "<n> mana" amount named in the reward text (0 if none). */
function manaAmount(desc: string): number {
  return maxAmount(desc, 'mana');
}

/** Rough "how much is this seat worth" score, for valuing a victim's seat. */
function seatRewardValue(desc: string): number {
  let v = manaAmount(desc) + maxAmount(desc, 'gold') * 0.5;
  if (providesResearch(desc)) v += 2;
  if (providesIntWis(desc)) v += 1;
  if (/supporter/.test(desc)) v += 2;
  return v;
}

/** Current Influence of a player (the vote tiebreaker — our "who's leading" proxy). */
function influenceOf(state: GameState, playerId: PlayerId): number {
  return state.players.find((p) => p.id === playerId)?.resources.influence ?? 0;
}

/** The player who owns `mageId`, if any. */
function ownerOfMage(state: GameState, mageId: string): Player | undefined {
  return state.players.find((p) => p.mages.some((m) => m.id === mageId));
}

/** Lower-cased reward summary of the seat `mageId` currently occupies ('' if none). */
function seatDescOfMage(state: GameState, mageId: string): string {
  for (const p of state.players) {
    const mage = p.mages.find((m) => m.id === mageId);
    if (!mage) continue;
    if (mage.location.kind !== 'action-space') return '';
    return (findSpace(state, mage.location.spaceId)?.space.description ?? '').toLowerCase();
  }
  return '';
}

interface PlacementOption {
  action: GameAction;
  /** Lower-cased reward summary for the target slot. */
  desc: string;
  /** True when the placement seizes/over-shadows an OPPONENT-occupied slot. */
  disrupts: boolean;
  /** Owner of the seat's current occupant when `disrupts` (for target valuation). */
  victimOwnerId?: PlayerId;
}

function enumeratePlacements(state: GameState, player: Player): PlacementOption[] {
  const out: PlacementOption[] = [];
  // Never queue up more Merit seats than we hold Badges for — the surplus would
  // only forfeit for 1 IP at Resolution. Budget = Badges minus those already
  // committed to merit seats this round.
  const meritBudget =
    player.resources.meritBadges - meritBadgesCommitted(state, player.id);
  const make = (mageId: string, spaceId: string, shadow: boolean) => {
    const found = findSpace(state, spaceId);
    if (found && isMeritSlot(found.space)) {
      const cost = found.space.costToActivate?.meritBadges ?? 1;
      if (cost > meritBudget) return; // can't pay the Badge — skip this seat
    }
    const occupant = found?.space.occupant ?? null;
    const disrupts = occupant !== null && occupant.ownerId !== player.id;
    out.push({
      action: shadow
        ? { type: 'PLACE_WORKER', playerId: player.id, mageId, actionSpaceId: spaceId, isShadowing: true }
        : { type: 'PLACE_WORKER', playerId: player.id, mageId, actionSpaceId: spaceId },
      desc: (found?.space.description ?? '').toLowerCase(),
      disrupts,
      ...(disrupts && occupant ? { victimOwnerId: occupant.ownerId } : {}),
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
  // Never line up a move that would FORCE Malfoy to wound/banish his own Mage
  // because no opponent is targetable (he won't turn the effect on himself).
  return out.filter((p) => !forcesSelfWound(state, p.action, player.id));
}

/** True once Malfoy already occupies a 2+ Mana seat this round (his one grab). */
function alreadyTookManaSeat(state: GameState, playerId: PlayerId): boolean {
  for (const room of state.rooms) {
    for (const sp of room.actionSpaces) {
      if (
        sp.occupant?.ownerId === playerId &&
        manaAmount((sp.description ?? '').toLowerCase()) >= 2
      ) {
        return true;
      }
    }
  }
  return false;
}

// --- Disruption scoring (Malfoy ranks his strikes; he doesn't just pick any) -

/** Harm severity of a recorded board event (bigger = nastier disruption). */
const EVENT_IMPACT: Record<string, number> = {
  'mage-banished': 4,
  'mage-wounded': 3,
  'mage-shadowed': 2,
  'mage-moved': 2,
};

/** Harm severity implied by a verb in a prompt label / card text (0 if none). */
function verbImpact(text: string): number {
  if (/\bbanish\b/i.test(text)) return 4;
  if (/\bwound\b/i.test(text)) return 3;
  if (/\bshadow\b/i.test(text)) return 2;
  if (/\b(move|displace)\b/i.test(text)) return 2;
  return 0;
}

/** How juicy a victim Mage is: its owner's Influence + the value of its seat. */
function mageThreat(state: GameState, mageId: string): number {
  const owner = ownerOfMage(state, mageId);
  return (owner ? owner.resources.influence : 0) + seatRewardValue(seatDescOfMage(state, mageId));
}

/**
 * Disruption value of `action` against an OPPONENT, or 0 if it doesn't disrupt
 * one. Engine-truth: dry-run the action and read the result —
 *   (a) a reaction window already recorded a harmful event on a rival's Mage,
 *   (b) the next prompt asks Malfoy to pick an opponent's Mage to hit, or
 *   (c) the source text is global control (Mesmerize / Silence / steal …).
 * Score = impact·100 + best target's threat, so a bigger HIT always outranks a
 * lesser one, and among equal hits he goes for the juiciest target.
 */
function disruptionScore(
  state: GameState,
  player: Player,
  action: GameAction,
  sourceText: string,
): number {
  let next: GameState;
  try {
    next = applyAction(state, action);
  } catch {
    return 0;
  }
  const me = player.id;
  const ownIds = new Set(player.mages.map((m) => m.id));
  let impact = 0;
  let targetThreat = 0;

  // (a) Already harmed an opponent's Mage (a reaction window just opened).
  for (const w of next.activeReactionWindows) {
    for (const e of w.triggerEvents) {
      if (
        'ownerId' in e &&
        'byPlayerId' in e &&
        e.byPlayerId === me &&
        e.ownerId !== me &&
        EVENT_IMPACT[e.kind]
      ) {
        impact = Math.max(impact, EVENT_IMPACT[e.kind]!);
        targetThreat = Math.max(targetThreat, influenceOf(next, e.ownerId));
      }
    }
  }

  // (b) About to choose an opponent's Mage to hit.
  const top = next.pendingResolutionStack[next.pendingResolutionStack.length - 1];
  if (top && top.responderId === me && top.prompt.kind === 'choose-target-mage') {
    const eligible = top.prompt.eligibleMageIds;
    const opponentEligible = eligible.filter((id) => !ownIds.has(id));
    const opponentsOnly = eligible.length > 0 && opponentEligible.length === eligible.length;
    const harmful =
      opponentsOnly ||
      HARMFUL_LABEL_RE.test(top.prompt.label ?? '') ||
      DISRUPT_VERB_RE.test(sourceText);
    if (opponentEligible.length > 0 && harmful) {
      const verb = Math.max(verbImpact(top.prompt.label ?? ''), verbImpact(sourceText));
      impact = Math.max(impact, verb || 1);
      for (const id of opponentEligible) {
        targetThreat = Math.max(targetThreat, mageThreat(next, id));
      }
    }
  }

  // (c) Global control that disrupts opponents without a Mage target.
  if (GLOBAL_DISRUPT_RE.test(sourceText)) impact = Math.max(impact, 1.5);

  return impact === 0 ? 0 : impact * 100 + targetThreat;
}

interface ScoredAction {
  action: GameAction;
  score: number;
}

/**
 * Every way Malfoy can disrupt a rival this turn, scored: a Spell, a
 * Vault/Consumable card, a Supporter, or a placement that seizes / over-shadows
 * an opponent's seat. A seize that doesn't itself wound still counts as mild
 * board disruption (taking the rival's spot), valued by the victim's standing
 * and seat.
 */
function disruptiveActions(
  state: GameState,
  player: Player,
  placements: PlacementOption[],
): ScoredAction[] {
  const out: ScoredAction[] = [];
  const add = (action: GameAction, score: number) => {
    if (score > 0) out.push({ action, score });
  };

  for (const p of placements) {
    let score = disruptionScore(state, player, p.action, p.desc);
    if (p.disrupts) {
      const seize =
        100 + (p.victimOwnerId ? influenceOf(state, p.victimOwnerId) : 0) + seatRewardValue(p.desc);
      score = Math.max(score, seize);
    }
    add(p.action, score);
  }
  for (const [spellCardId, levels] of castableSpellLevels(state, player.id)) {
    const def = lookupSpellCardDef(state, spellCardId);
    for (const level of levels) {
      const text = def?.levels.find((l) => l.level === level)?.description ?? '';
      const action: GameAction = { type: 'CAST_SPELL', playerId: player.id, spellCardId, level };
      add(action, disruptionScore(state, player, action, text));
    }
  }
  for (const vaultCardId of playableVaultCards(state, player.id)) {
    const text = lookupVaultCardDef(state, vaultCardId)?.description ?? '';
    const action: GameAction = { type: 'PLAY_VAULT_CARD', playerId: player.id, vaultCardId };
    add(action, disruptionScore(state, player, action, text));
  }
  for (const supporterCardId of playableSupporters(state, player.id)) {
    const text = lookupSupporterCardDef(state, supporterCardId)?.description ?? '';
    const action: GameAction = { type: 'PLAY_SUPPORTER', playerId: player.id, supporterCardId };
    add(action, disruptionScore(state, player, action, text));
  }
  return out;
}

// ============================================================================
// Errands turn — disruption first, then Mana, then the research engine.
// ============================================================================

function chooseErrandsAction(state: GameState, playerId: PlayerId): GameAction {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { type: 'PASS_TURN', playerId };
  const rng = makeRng(state, playerId);
  const placements = enumeratePlacements(state, player);

  // 0) DISRUPT — the highest-impact strike at a rival, across every channel.
  const disrupt = disruptiveActions(state, player, placements);
  if (disrupt.length > 0) {
    const best = Math.max(...disrupt.map((d) => d.score));
    return pickRandom(
      disrupt.filter((d) => d.score === best).map((d) => d.action),
      rng,
    );
  }

  // Mana seats worth grabbing: an open slot granting ≥2 Mana.
  const manaSeats = placements.filter((p) => manaAmount(p.desc) >= 2);
  // He's really after big Spells: pivot off Mana once he's flush (≥6) or the
  // board has no 2+ Mana seats left.
  const pivotToResearch = player.resources.mana >= 6 || manaSeats.length === 0;

  // 1) Best Mana seat — once per round, while still chasing Mana.
  if (!pivotToResearch && !alreadyTookManaSeat(state, playerId)) {
    const best = Math.max(...manaSeats.map((p) => manaAmount(p.desc)));
    return pickRandom(
      manaSeats.filter((p) => manaAmount(p.desc) === best),
      rng,
    ).action;
  }

  // 2) Research engine — to fuel big Spells. With fuel in hand (≥2 unspent
  //    INT+WIS) he CONVERTS at a Research seat; otherwise he gathers INT/WIS
  //    fuel first, still taking a Research seat if that's all that's open.
  const research = placements.filter((p) => providesResearch(p.desc));
  const intWis = placements.filter((p) => providesIntWis(p.desc) && !providesResearch(p.desc));
  const haveFuel = unspentResearch(player) >= 2;
  const researchTiers = haveFuel ? [research, intWis] : [intWis, research];
  for (const tier of researchTiers) {
    if (tier.length > 0) return pickRandom(tier, rng).action;
  }

  // 3) Otherwise drop a Mage into any seat; if he can't place, take a Bell card.
  if (placements.length > 0) return pickRandom(placements, rng).action;
  const bells = [...claimableBellCards(state, playerId)];
  if (bells.length > 0) {
    return { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: pickRandom(bells, rng) };
  }
  return { type: 'PASS_TURN', playerId };
}

// ============================================================================
// Prompt answers — cloned from Klank, but Malfoy takes MANA over Gold, the
// biggest Spell level (he's building toward big casts), and hits the JUICIEST
// rival Mage — never his own.
// ============================================================================

function answerPendingResolution(
  state: GameState,
  pending: PendingResolution,
): ResolutionAnswer {
  const prompt = pending.prompt;
  switch (prompt.kind) {
    case 'choose-from-options': {
      const available = prompt.options.filter((o) => o.available !== false);
      const base = available.length > 0 ? available : prompt.options;
      // Bots never rearrange placed Research (they can't judge it strategically),
      // so drop the move-Research actions — the Research Archive's move menu then
      // resolves to "Done moving Research".
      const noMove = base.filter((o) => !isMoveResearchOption(o.id));
      const pool = noMove.length > 0 ? noMove : base;
      // Same menu heuristics as Klank, but Mana is preferred ahead of Gold.
      const prefer = ['reward', 'reward-gold', 'add-wis', 'draft', 'mana', 'gold'];
      const pick =
        prefer.map((id) => pool.find((o) => o.id === id)).find(Boolean) ?? pool[0]!;
      return { kind: 'option-chosen', optionId: pick.id, payload: pick.payload };
    }

    case 'choose-target-mage': {
      const responder = state.players.find((p) => p.id === pending.responderId);
      const ownIds = new Set(responder?.mages.map((m) => m.id) ?? []);
      // Harmful target prompts dominate — hit the juiciest OPPONENT Mage (the
      // rival's Influence plus the value of the seat we'd deny).
      const opponents = prompt.eligibleMageIds.filter((id) => !ownIds.has(id));
      if (opponents.length > 0) {
        let best = opponents[0]!;
        let bestVal = -1;
        for (const id of opponents) {
          const v = mageThreat(state, id);
          if (v > bestVal) {
            bestVal = v;
            best = id;
          }
        }
        return { kind: 'mage-chosen', mageId: best };
      }
      // No opponent eligible: for a wound/banish prompt that can be declined,
      // never turn the effect on his own Mage — pass instead.
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
      // Highest offered level — Malfoy wants the big Spell.
      const level = [...prompt.availableLevels].sort((a, b) => b - a)[0];
      return { kind: 'level-chosen', level: level ?? prompt.availableLevels[0]! };
    }

    case 'choose-deck':
      return { kind: 'deck-chosen', deck: prompt.eligibleDecks[0] ?? 'spell' };

    case 'choose-voter': {
      const voterId = prompt.eligibleVoterIds[0];
      if (voterId === undefined)
        return markAlternativeAnswer(prompt) ?? { kind: 'pass' };
      return { kind: 'voter-chosen', voterId };
    }

    case 'reaction-window':
      // Always react when a reaction is available — every offered option is a
      // defensive save of one of Malfoy's own Mages. The pick is dry-run-
      // verified (correct forMageId, else pass) so it's always legal.
      return chooseReaction(state, pending);

    case 'confirm':
      return { kind: 'confirmed' };
  }
}

export const malfoy: BotPersonality = {
  id: 'malfoy',
  name: 'Malfoy',
  chooseErrandsAction,
  answerPendingResolution,
};
