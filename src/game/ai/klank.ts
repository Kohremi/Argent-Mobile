// Klank — the AI that plays bot-controlled seats.
//
// Pure decision functions: given a GameState (engine truth) they return a legal
// GameAction / ResolutionAnswer. They never touch React or the store — the
// `useKlankDriver` hook wires them up and paces dispatch. Legality is enumerated
// with the same engine dry-run selectors the human UI uses (src/utils/uiSelectors),
// so a bot can never attempt a move the rules forbid.
//
// Klank plays a strict priority cascade each Errands turn:
//   1. RESEARCH — if he holds ≥2 unspent INT+WIS, place into a space that
//      provides Research (so he has the INT/WIS to actually convert it).
//   2. DISRUPT  — else cast spells / play items / use slot-taking abilities
//      that wound or disrupt an OPPONENT.
//   3. VALUE    — else place into a space giving a large supporter draft, large
//      Mana/Gold, or (failing those) any INT/WIS.
//   4. PLACE    — else place a Mage in any (random) space.
//   5. BELL     — if he can't place a Mage at all, take a Bell Tower card
//      (which keeps the round advancing toward its end).
// Each tier "fails over" to the next. Picks within a tier are seeded from the
// state, so they're reproducible yet vary across the game.

import { applyAction } from '../engine';
import { createRng, type Rng } from '../../utils/rng';
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
  GameAction,
  GameState,
  PendingResolution,
  Player,
  PlayerId,
  ReactionOption,
  ResolutionAnswer,
  Room,
} from '../types';
import type { BotPersonality } from './types';

/**
 * Option ids on a `choose-from-options` research menu that REARRANGE already
 * placed Research (relocate a WIS/INT token between Spells). Bots never do this
 * — they can't judge it strategically — so these are filtered out of the menu,
 * leaving "Done moving Research" (`discard`) as the move-only menu's choice.
 */
function isMoveResearchOption(id: string): boolean {
  return id === 'move-wis' || id === 'move-int';
}

/**
 * Pick a reaction to play from an open reaction window's offered options, or
 * pass when none are offered. The engine only ever offers reactions the bot
 * can legally play (it owns the card and can pay), and a reaction always
 * protects one of the bot's OWN Mages from the triggering harm, so the bots
 * react whenever they can. A repeatable option (Sacred Shield) is preferred so
 * the bot keeps its slot in the window and can save several affected Mages;
 * `reactionContext: {}` lets the engine resolve a slot-pick reaction by keeping
 * the Mage on its original slot.
 */
function chooseReaction(options: readonly ReactionOption[]): ResolutionAnswer {
  if (options.length === 0) return { kind: 'reaction-passed' };
  const choice = options.find((o) => o.repeatable) ?? options[0]!;
  return {
    kind: 'reaction-played',
    effectId: choice.effectId,
    reactionContext: {},
    ...(choice.forMageId ? { forMageId: choice.forMageId } : {}),
  };
}

// ============================================================================
// Errands turn — a tiered priority cascade (see file header).
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
// The ActionSpace `description` is the room file's reward summary (the same text
// a human reads off the slot), so Klank classifies seats by keyword.

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

/**
 * Tier-3 "value" weight of a placement reward; 0 means it isn't a value seat.
 * Mirrors the user's order: large supporter drafts and large Mana/Gold rank
 * top, ordinary Mana/Gold next, and bare INT/WIS last.
 */
function valueScore(desc: string): number {
  if (SUPPORTER_DRAFT_RE.test(desc)) return 3; // large draftable supporters
  const mana = maxAmount(desc, 'mana');
  const gold = maxAmount(desc, 'gold');
  if (mana >= 3 || gold >= 4) return 3; // large amounts of mana / gold
  if (mana > 0 || gold > 0) return 2; // some mana / gold
  if (INT_WIS_RE.test(desc)) return 1; // any int / wis
  return 0;
}

interface PlacementOption {
  action: GameAction;
  /** Lower-cased reward summary for the target slot. */
  desc: string;
  /** True when the placement seizes/over-shadows an OPPONENT-occupied slot
   *  (Ars Magna wound, Natural-B displace, shadow-over-rival) — a disruption. */
  disrupts: boolean;
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

// --- Disruption detection for spells / items --------------------------------

/** Target-prompt labels that name a harmful effect. */
const HARMFUL_LABEL_RE = /wound|banish|move|shadow|displace/i;
/** Card text describing a targeted disruption of a Mage. */
const DISRUPT_VERB_RE = /\b(wound|banish|shadow|displace|move)\b/i;
/** Card text describing global control that disrupts opponents without a Mage target. */
const GLOBAL_DISRUPT_RE = /\bsteal\b|lose (their|its) power|may not cast|more mana|extra mana/i;

/**
 * True when taking `action` would wound or disrupt an OPPONENT. Engine-truth:
 * dry-run the action and inspect the result —
 *   (a) a reaction window already records a harmful event on a rival's Mage,
 *   (b) the next prompt asks Klank to pick an opponent's Mage to hit, or
 *   (c) the source card's text is global control (Mesmerize / Silence / Energy
 *       Drain / steal) that hurts opponents without targeting a Mage.
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

function chooseErrandsAction(state: GameState, playerId: PlayerId): GameAction {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { type: 'PASS_TURN', playerId };
  const rng = makeRng(state, playerId);
  const placements = enumeratePlacements(state, player);

  // 1) Research seats — only when he holds research to spend (≥2 unspent INT+WIS).
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

  // 3) Value seats — biggest reward wins (supporter draft / large Mana·Gold,
  //    then any INT/WIS), ties broken at random.
  const valued = placements
    .map((p) => ({ p, v: valueScore(p.desc) }))
    .filter((x) => x.v > 0);
  if (valued.length > 0) {
    const best = Math.max(...valued.map((x) => x.v));
    return pickRandom(
      valued.filter((x) => x.v === best).map((x) => x.p),
      rng,
    ).action;
  }

  // 4) Otherwise drop a Mage into any (random) seat.
  if (placements.length > 0) return pickRandom(placements, rng).action;

  // 5) Can't place a Mage → take a Bell Tower card (keeps the round ending).
  const bells = [...claimableBellCards(state, playerId)];
  if (bells.length > 0) {
    return { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: pickRandom(bells, rng) };
  }

  return { type: 'PASS_TURN', playerId };
}

// ============================================================================
// Prompt answers — a valid answer for EVERY prompt kind (never stalls), with
// light heuristics layered over safe defaults.
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
      // Bots never rearrange placed Research — they lack the strategic read to
      // do it well. Drop the move-Research actions so e.g. the Research Archive's
      // "Move a WIS token / Done moving Research" menu resolves to "Done moving
      // Research" instead of shuffling tokens around. (Falls back to the full
      // pool only in the impossible case that move actions were the sole menu.)
      const noMove = base.filter((o) => !isMoveResearchOption(o.id));
      const pool = noMove.length > 0 ? noMove : base;
      // Light preferences by option id (covers the common engine menus):
      //   merit resolution-choice → take the reward (gold variant if needed),
      //   research menu → upgrade then draft before discarding,
      //   infirmary bonus → take Gold.
      const prefer = ['reward', 'reward-gold', 'add-wis', 'draft', 'gold', 'mana'];
      const pick =
        prefer.map((id) => pool.find((o) => o.id === id)).find(Boolean) ??
        pool[0]!;
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
      // Defensive: an empty list shouldn't occur, but never throw.
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
      // Highest offered level (most powerful); the engine only lists castable ones.
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
      // Always react when a reaction is available. The engine only offers
      // options Klank can actually play (he owns the card and can pay for it),
      // and every reaction is a defensive save of one of his OWN Mages, so
      // playing one is always to his benefit. Prefer a repeatable option (e.g.
      // Sacred Shield) so he stays in the window and can rescue more than one
      // affected Mage. `reactionContext: {}` lets the engine resolve any
      // slot-pick reaction by keeping the Mage on its original slot.
      return chooseReaction(prompt.reactionOptions);

    case 'confirm':
      return { kind: 'confirmed' };
  }
}

export const klank: BotPersonality = {
  id: 'klank',
  name: 'Klank',
  chooseErrandsAction,
  answerPendingResolution,
};
