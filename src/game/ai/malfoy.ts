// Malfoy — a cloned-from-Klank personality with a Mana-then-big-spells plan.
//
// Pure decision functions (engine truth in, legal GameAction / ResolutionAnswer
// out), same contract as Klank — see klank.ts. Malfoy's Errands priority:
//
//   0. TRUMP — cast a harmful, disruptive Spell on an opponent. This beats
//      everything below; if he can hurt a rival with a Spell, he does.
//   1. MANA   — take the best open seat that grants ≥2 Mana, ONCE per round
//      (and, when a seat offers Mana OR Gold, he takes the Mana).
//   2. RESEARCH — he's really after big Spells, so once he's flush with Mana
//      (≥6) OR there are no more 2+ Mana seats left, he pivots to a Research
//      seat. (After his one Mana grab he's also chasing Research.)
//   3. INT/WIS — if he can't get Research, he settles for an INT or WIS seat.
//   4. otherwise place anywhere; if he can't place a Mage, take a Bell Tower
//      card (which keeps the round advancing toward its end).
//
// Within-tier picks are seeded from the state, so they're reproducible yet
// vary across the game. "Once per round" is read off the board: a placed Mage
// sits on its seat until Resolution, so "already grabbed Mana this round" =
// "Malfoy already occupies a 2+ Mana seat".

import { applyAction } from '../engine';
import { createRng, type Rng } from '../../utils/rng';
import { lookupSpellCardDef } from '../effects/helpers';
import {
  castableSpellLevels,
  claimableBellCards,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
} from '../../utils/uiSelectors';
import type {
  ActionSpace,
  GameAction,
  GameState,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  Room,
} from '../types';
import type { BotPersonality } from './types';

// ============================================================================
// Errands turn — Mana grab → big-spell research, all trumped by disruption.
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

// --- Reward classification from a slot's human-readable summary -------------
// The ActionSpace `description` is the room file's reward summary (the same
// text a human reads off the slot), so Malfoy classifies seats by keyword.

const RESEARCH_RE = /\bresearch\b/;
const INT_WIS_RE = /\bint\b|intelligence|\bwis\b|wisdom/;

function providesResearch(desc: string): boolean {
  return RESEARCH_RE.test(desc);
}

function providesIntWis(desc: string): boolean {
  return INT_WIS_RE.test(desc);
}

/** Largest fixed "<n> mana" amount named in the reward text (0 if none). */
function manaAmount(desc: string): number {
  let best = 0;
  for (const m of desc.matchAll(/(\d+)\s*mana/g)) best = Math.max(best, Number(m[1]));
  return best;
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

interface PlacementOption {
  action: GameAction;
  /** Lower-cased reward summary for the target slot. */
  desc: string;
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
    out.push({
      action: shadow
        ? { type: 'PLACE_WORKER', playerId: player.id, mageId, actionSpaceId: spaceId, isShadowing: true }
        : { type: 'PLACE_WORKER', playerId: player.id, mageId, actionSpaceId: spaceId },
      desc: (found?.space.description ?? '').toLowerCase(),
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

// --- Disruption detection for spells ----------------------------------------

/** Target-prompt labels that name a harmful effect. */
const HARMFUL_LABEL_RE = /wound|banish|move|shadow|displace/i;
/** Card text describing a targeted disruption of a Mage. */
const DISRUPT_VERB_RE = /\b(wound|banish|shadow|displace|move)\b/i;
/** Card text describing global control that disrupts opponents without a Mage target. */
const GLOBAL_DISRUPT_RE = /\bsteal\b|lose (their|its) power|may not cast|more mana|extra mana/i;

/**
 * True when casting `action` would wound or disrupt an OPPONENT. Engine-truth:
 * dry-run the cast and inspect the result —
 *   (a) a reaction window already records a harmful event on a rival's Mage,
 *   (b) the next prompt asks Malfoy to pick an opponent's Mage to hit, or
 *   (c) the Spell's text is global control (Mesmerize / Silence / Energy Drain
 *       / steal) that hurts opponents without targeting a Mage.
 */
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

  // (a) Already harmed an opponent's Mage (a reaction window just opened).
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

  // (b) About to choose an opponent's Mage to hit.
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

  // (c) Global control that disrupts opponents without a Mage target.
  return GLOBAL_DISRUPT_RE.test(sourceText);
}

/** Castable Spells whose effect wounds or disrupts an opponent. */
function disruptiveSpellActions(state: GameState, player: Player): GameAction[] {
  const out: GameAction[] = [];
  for (const [spellCardId, levels] of castableSpellLevels(state, player.id)) {
    const def = lookupSpellCardDef(state, spellCardId);
    for (const level of levels) {
      const text = def?.levels.find((l) => l.level === level)?.description ?? '';
      const action: GameAction = { type: 'CAST_SPELL', playerId: player.id, spellCardId, level };
      if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
    }
  }
  return out;
}

function chooseErrandsAction(state: GameState, playerId: PlayerId): GameAction {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { type: 'PASS_TURN', playerId };
  const rng = makeRng(state, playerId);
  const placements = enumeratePlacements(state, player);

  // 0) TRUMP — cast a harmful, disruptive Spell on an opponent.
  const disruptiveSpells = disruptiveSpellActions(state, player);
  if (disruptiveSpells.length > 0) return pickRandom(disruptiveSpells, rng);

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

  // 2) Research — to fuel big Spells.
  const research = placements.filter((p) => providesResearch(p.desc));
  if (research.length > 0) return pickRandom(research, rng).action;

  // 3) INT / WIS — if he can't research.
  const intWis = placements.filter((p) => providesIntWis(p.desc) && !providesResearch(p.desc));
  if (intWis.length > 0) return pickRandom(intWis, rng).action;

  // 4) Otherwise drop a Mage into any seat; if he can't place, take a Bell card.
  if (placements.length > 0) return pickRandom(placements, rng).action;
  const bells = [...claimableBellCards(state, playerId)];
  if (bells.length > 0) {
    return { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: pickRandom(bells, rng) };
  }
  return { type: 'PASS_TURN', playerId };
}

// ============================================================================
// Prompt answers — cloned from Klank, but Malfoy takes MANA over Gold and the
// biggest Spell level (he's building toward big casts).
// ============================================================================

function answerPendingResolution(
  state: GameState,
  pending: PendingResolution,
): ResolutionAnswer {
  const prompt = pending.prompt;
  switch (prompt.kind) {
    case 'choose-from-options': {
      const available = prompt.options.filter((o) => o.available !== false);
      const pool = available.length > 0 ? available : prompt.options;
      // Same menu heuristics as Klank, but Mana is preferred ahead of Gold.
      const prefer = ['reward', 'reward-gold', 'add-wis', 'draft', 'mana', 'gold'];
      const pick =
        prefer.map((id) => pool.find((o) => o.id === id)).find(Boolean) ?? pool[0]!;
      return { kind: 'option-chosen', optionId: pick.id, payload: pick.payload };
    }

    case 'choose-target-mage': {
      const responder = state.players.find((p) => p.id === pending.responderId);
      const ownIds = new Set(responder?.mages.map((m) => m.id) ?? []);
      // Harmful target prompts dominate — prefer an opponent's mage.
      const opponent = prompt.eligibleMageIds.find((id) => !ownIds.has(id));
      const target = opponent ?? prompt.eligibleMageIds[0];
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
      const cardId = prompt.eligibleCardIds[0];
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
      if (voterId === undefined) return { kind: 'pass' };
      return { kind: 'voter-chosen', voterId };
    }

    case 'reaction-window':
      // Reactions are situational and passing is always safe.
      return { kind: 'reaction-passed' };

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
