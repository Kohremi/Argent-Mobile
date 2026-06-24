// Thickhide — a bot personality that mostly makes a RANDOM legal move, with a
// few instincts:
//   • Merit Badges: she seeks Merit slots when she holds Badges, but never
//     lines up more Merit slots than the Badges she has left this round (the
//     surplus would only forfeit for 1 IP at Resolution); with none she avoids
//     them entirely.
//   • She won't take a space whose activation cost (Merit Badges / Gold / Mana)
//     she can't meet — only "useful" spaces are considered.
//   • She spends a Fast Action first when one is available, then takes a
//     regular action.
//   • The regular action is chosen by rolling a category, then a random move
//     within it: while she still has Mages to place the categories are
//     place / spell / vault / supporter; once out of Mages they become
//     spell / supporter / vault / bell-tower.
//   • When resolving prompts she always takes the reward (never randomly
//     forfeits) and otherwise chooses at random.
//   • Negative effects (wound / banish) are only ever aimed at an OPPONENT —
//     never at her own Mages. If no opponent Mage is targetable she won't even
//     attempt the wound: she declines the target pick when allowed and skips
//     any action that would otherwise force her to wound herself.
//
// Randomness is seeded from the GameState so a given state always yields the
// same choice (reproducible / testable) while varying across the game. Shared
// plumbing (seeded RNG, board lookups, merit budgeting, the self-wound guard,
// the reaction save) lives in `./common`.

import {
  HARMFUL_TARGET_RE,
  type Rng,
  chooseReaction,
  findSpace,
  forcesSelfWound,
  isMeritSlot,
  isMoveResearchOption,
  makeRng,
  meritBadgesCommitted,
  ownMageIds,
  pickRandom,
} from './common';
import { applyAction } from '../engine';
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
  ResolutionAnswer,
} from '../types';
import type { BotPersonality } from './types';

type Category = 'place' | 'spell' | 'vault' | 'supporter' | 'bell';

interface Candidate {
  action: GameAction;
  category: Category;
}

/**
 * Whether Thickhide considers a placement space worthwhile: she can meet its
 * activation cost, and she still has Merit Badges left this round to pay for a
 * Merit seat. `meritBudget` is her Badges minus those already committed to
 * merit seats this round, so she never queues up more Merit seats than she can
 * actually pay for (the surplus would only forfeit for 1 IP at Resolution).
 * Spaces with no cost are always useful.
 *
 * NOTE: only the modelled costs (Merit Badges / Gold / Mana via
 * `costToActivate`) are checked. A "hand in a Treasure" style requirement isn't
 * represented in the data model, so it isn't filtered here.
 */
function spaceIsUseful(player: Player, space: ActionSpace, meritBudget: number): boolean {
  const cost = space.costToActivate;
  if (isMeritSlot(space)) {
    // No Badge to spare → skip (with 0 budget this also covers "no Badges").
    return (cost?.meritBadges ?? 1) <= meritBudget;
  }
  if (cost) {
    if ((cost.gold ?? 0) > player.resources.gold) return false;
    if ((cost.mana ?? 0) > player.resources.mana) return false;
    if ((cost.meritBadges ?? 0) > meritBudget) return false;
  }
  return true;
}

/**
 * Dry-run a candidate to see if it consumes ONLY the Fast Action (purple/Planar
 * placements, fast-action spells) rather than the regular Action. Engine-truth
 * classification: the budget is consumed synchronously, so the phase flags on
 * the resulting state tell us which slot it spent.
 */
function isFastAction(state: GameState, action: GameAction): boolean {
  if (state.phase.kind !== 'errands' || state.phase.fastActionUsed) return false;
  try {
    const next = applyAction(state, action);
    return (
      next.phase.kind === 'errands' &&
      next.phase.fastActionUsed === true &&
      next.phase.actionUsed === false
    );
  } catch {
    return false;
  }
}

function enumerateCandidates(state: GameState, player: Player): Candidate[] {
  const playerId = player.id;
  // Badges still free to spend this round, after those already on merit seats.
  const meritBudget =
    player.resources.meritBadges - meritBadgesCommitted(state, playerId);
  const out: Candidate[] = [];

  for (const mage of player.mages) {
    if (mage.location.kind !== 'office' || mage.isWounded) continue;
    const consider = (spaceId: string, shadow: boolean) => {
      const found = findSpace(state, spaceId);
      if (found && !spaceIsUseful(player, found.space, meritBudget)) return;
      out.push({
        action: shadow
          ? { type: 'PLACE_WORKER', playerId, mageId: mage.id, actionSpaceId: spaceId, isShadowing: true }
          : { type: 'PLACE_WORKER', playerId, mageId: mage.id, actionSpaceId: spaceId },
        category: 'place',
      });
    };
    for (const spaceId of eligiblePlacementSlots(state, playerId, mage.id)) {
      consider(spaceId, false);
    }
    for (const spaceId of eligibleShadowPlacementSlots(state, playerId, mage.id)) {
      consider(spaceId, true);
    }
  }

  for (const [spellCardId, levels] of castableSpellLevels(state, playerId)) {
    for (const level of levels) {
      out.push({ action: { type: 'CAST_SPELL', playerId, spellCardId, level }, category: 'spell' });
    }
  }
  for (const vaultCardId of playableVaultCards(state, playerId)) {
    out.push({ action: { type: 'PLAY_VAULT_CARD', playerId, vaultCardId }, category: 'vault' });
  }
  for (const supporterCardId of playableSupporters(state, playerId)) {
    out.push({ action: { type: 'PLAY_SUPPORTER', playerId, supporterCardId }, category: 'supporter' });
  }
  for (const cardId of claimableBellCards(state, playerId)) {
    out.push({ action: { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: cardId }, category: 'bell' });
  }

  // Drop any move that would force her to wound/banish one of her own Mages
  // because no opponent is targetable — she won't attempt a wound with no
  // opponents to hit.
  return out.filter((c) => !forcesSelfWound(state, c.action, playerId));
}

function chooseErrandsAction(state: GameState, playerId: PlayerId): GameAction {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { type: 'PASS_TURN', playerId };
  const rng = makeRng(state, playerId);
  const candidates = enumerateCandidates(state, player);
  if (candidates.length === 0) return { type: 'PASS_TURN', playerId };

  // 1) Spend a Fast Action first, if any is available — random among them.
  if (state.phase.kind === 'errands' && !state.phase.fastActionUsed) {
    const fast = candidates.filter((c) => isFastAction(state, c.action));
    if (fast.length > 0) return pickRandom(fast, rng).action;
  }

  // 2) Roll a category, then a random move within it. While she still has a
  //    Mage to place the pool is place/spell/vault/supporter (no bell-tower —
  //    that would rush the round); once out of Mages it's spell/supporter/
  //    vault/bell-tower.
  const hasPlace = candidates.some((c) => c.category === 'place');
  const pool: Category[] = hasPlace
    ? ['place', 'spell', 'vault', 'supporter']
    : ['spell', 'supporter', 'vault', 'bell'];
  const available = pool.filter((cat) => candidates.some((c) => c.category === cat));
  if (available.length === 0) return { type: 'PASS_TURN', playerId };

  const category = pickRandom(available, rng);
  const inCategory = candidates.filter((c) => c.category === category);

  // Merit instinct: holding Badges, she actively seeks Merit slots when placing.
  if (category === 'place' && player.resources.meritBadges > 0) {
    const meritMoves = inCategory.filter((c) => {
      if (c.action.type !== 'PLACE_WORKER') return false;
      const found = findSpace(state, c.action.actionSpaceId);
      return found !== null && isMeritSlot(found.space);
    });
    if (meritMoves.length > 0) return pickRandom(meritMoves, rng).action;
  }

  return pickRandom(inCategory, rng).action;
}

/**
 * Eligible cards whose pick is actually LEGAL, found by dry-running each
 * resolution (engine-truth — the same safeguard she uses for actions). A
 * `choose-vault-card` BUY prompt can list cards she can't afford; choosing one
 * would throw an illegal-move error, so unaffordable candidates are dropped
 * before the random pick. Returns the full list if none dry-run cleanly (no
 * worse than before).
 */
function legalCards(
  state: GameState,
  pending: PendingResolution,
  cardIds: readonly string[],
): string[] {
  const legal = cardIds.filter((cardId) => {
    try {
      applyAction(state, {
        type: 'RESOLVE_PENDING',
        resolutionId: pending.id,
        answer: { kind: 'card-chosen', cardId },
      });
      return true;
    } catch {
      return false;
    }
  });
  return legal.length > 0 ? legal : [...cardIds];
}

/** Fisher–Yates shuffle in place, seeded — Thickhide's "try reactions at random". */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ============================================================================
// Prompt answers — always take the reward (forfeit only when forced); otherwise
// choose at random among the legal options.
// ============================================================================

function answerPendingResolution(
  state: GameState,
  pending: PendingResolution,
): ResolutionAnswer {
  const prompt = pending.prompt;
  const rng = makeRng(state, pending.id);

  switch (prompt.kind) {
    case 'choose-from-options': {
      const available = prompt.options.filter((o) => o.available !== false);
      const base = available.length > 0 ? available : prompt.options;
      // Bots never rearrange placed Research (no strategic read for it), so drop
      // the move-Research actions before choosing — the Research Archive's move
      // menu then resolves to "Done moving Research" rather than a random shuffle.
      const noMove = base.filter((o) => !isMoveResearchOption(o.id));
      const pool = noMove.length > 0 ? noMove : base;
      // Always take a reward over forfeiting — prefer paying Badges, then the
      // Divinity Gold variant; only forfeit when neither reward is available.
      const reward =
        pool.find((o) => o.id === 'reward') ?? pool.find((o) => o.id === 'reward-gold');
      const pick = reward ?? pickRandom(pool, rng);
      return { kind: 'option-chosen', optionId: pick.id, payload: pick.payload };
    }

    case 'choose-target-mage': {
      if (prompt.eligibleMageIds.length === 0) return { kind: 'pass' };
      if (HARMFUL_TARGET_RE.test(prompt.label ?? '')) {
        // Negative effect: only ever wound/banish an OPPONENT's Mage. With no
        // opponent eligible she declines the effect when the prompt allows it;
        // if it can't be passed she's already committed (an action that would
        // force this is filtered out earlier), so she falls back to random.
        const own = ownMageIds(state, pending.responderId);
        const opponents = prompt.eligibleMageIds.filter((id) => !own.has(id));
        if (opponents.length > 0) {
          return { kind: 'mage-chosen', mageId: pickRandom(opponents, rng) };
        }
        if (prompt.canPass) return { kind: 'pass' };
      }
      return { kind: 'mage-chosen', mageId: pickRandom([...prompt.eligibleMageIds], rng) };
    }

    case 'choose-target-action-space': {
      if (prompt.eligibleSpaceIds.length === 0) return { kind: 'pass' };
      return { kind: 'space-chosen', spaceId: pickRandom([...prompt.eligibleSpaceIds], rng) };
    }

    case 'choose-vault-card':
    case 'choose-supporter-card':
    case 'choose-peeked-supporter': {
      if (prompt.eligibleCardIds.length === 0) return { kind: 'pass' };
      return { kind: 'card-chosen', cardId: pickRandom(legalCards(state, pending, prompt.eligibleCardIds), rng) };
    }

    case 'choose-spell-level':
      return { kind: 'level-chosen', level: pickRandom([...prompt.availableLevels], rng) };

    case 'choose-deck':
      return { kind: 'deck-chosen', deck: pickRandom([...prompt.eligibleDecks], rng) };

    case 'choose-voter': {
      if (prompt.eligibleVoterIds.length === 0) return { kind: 'pass' };
      return { kind: 'voter-chosen', voterId: pickRandom([...prompt.eligibleVoterIds], rng) };
    }

    case 'reaction-window':
      // Always react when a reaction is available — every offered option is a
      // defensive save of one of her own Mages. Non-repeatable options are tried
      // in random order (her usual idiom); the pick is dry-run-verified (correct
      // forMageId, else pass) so it's always legal.
      return chooseReaction(state, pending, (rest) => shuffle(rest, rng));

    case 'confirm':
      return { kind: 'confirmed' };
  }
}

export const thickhide: BotPersonality = {
  id: 'thickhide',
  name: 'Thickhide',
  chooseErrandsAction,
  answerPendingResolution,
};
