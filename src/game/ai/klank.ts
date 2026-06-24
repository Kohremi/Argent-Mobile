// Klank — the AI that plays bot-controlled seats.
//
// Pure decision functions: given a GameState (engine truth) they return a legal
// GameAction / ResolutionAnswer. They never touch React or the store — the
// `useKlankDriver` hook wires them up and paces dispatch. Legality is enumerated
// with the same engine dry-run selectors the human UI uses, so a bot can never
// attempt a move the rules forbid. The shared plumbing (seeded RNG, board
// lookups, merit budgeting, disruption detection, reaction saves) lives in
// `./common`; this file is just Klank's policy.
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
import {
  claimableBellCards,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
} from '../../utils/uiSelectors';
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
// Errands turn — a tiered priority cascade (see file header).
// ============================================================================

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
      const cardId = firstLegalCard(state, pending, prompt.eligibleCardIds);
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
      if (voterId === undefined)
        return markAlternativeAnswer(prompt) ?? { kind: 'pass' };
      return { kind: 'voter-chosen', voterId };
    }

    case 'reaction-window':
      // Always react when a reaction is available — every offered reaction is a
      // defensive save of one of Klank's OWN Mages. The answer is dry-run-
      // verified (correct forMageId, else pass) so it's always legal.
      return chooseReaction(state, pending);

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
