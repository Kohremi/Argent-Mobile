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
// same choice (reproducible / testable) while varying across the game.

import { applyAction } from '../engine';
import { createRng, type Rng } from '../../utils/rng';
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
  PendingPrompt,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  Room,
} from '../types';
import type { BotPersonality } from './types';

type Category = 'place' | 'spell' | 'vault' | 'supporter' | 'bell';

interface Candidate {
  action: GameAction;
  category: Category;
}

/** A PRNG seeded from the state + a salt, so choices are reproducible. */
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

/** Wound/banish target prompts — the negative effects she only aims at rivals. */
const HARMFUL_TARGET_RE = /\b(wound|banish)\b/i;

/** The set of Mage ids owned by `playerId`. */
function ownMageIds(state: GameState, playerId: PlayerId): Set<string> {
  const player = state.players.find((p) => p.id === playerId);
  return new Set(player?.mages.map((m) => m.id) ?? []);
}

/**
 * A `choose-target-mage` prompt that wounds or banishes — i.e. a NEGATIVE
 * effect Thickhide should only ever aim at an opponent. Detected from the
 * prompt's banner, which the engine labels "Wound which Mage?" / "Banish which
 * Mage?" / "Choose a Mage to wound" / etc. Prompts that already restrict their
 * eligible list to opponents (Arcane Surge) and beneficial self-target prompts
 * ("Place which of your Mages…") carry no such label, so they're unaffected.
 */
function isHarmfulTargetPrompt(
  prompt: Extract<PendingPrompt, { kind: 'choose-target-mage' }>,
): boolean {
  return HARMFUL_TARGET_RE.test(prompt.label ?? '');
}

/**
 * True when taking `action` would immediately force Thickhide into a harmful
 * (wound / banish) target pick whose only eligible Mages are her OWN — there
 * are no opponents to hit and the prompt can't be passed. Rather than turn the
 * effect on herself she declines to attempt it, so such actions are dropped
 * from her candidate pool. Engine-truth: we dry-run the action and inspect the
 * prompt it leaves on top of the stack (same approach as `isFastAction`).
 */
function forcesSelfWound(state: GameState, action: GameAction, botId: PlayerId): boolean {
  let next: GameState;
  try {
    next = applyAction(state, action);
  } catch {
    return false;
  }
  const top = next.pendingResolutionStack[next.pendingResolutionStack.length - 1];
  if (!top || top.responderId !== botId) return false;
  const prompt = top.prompt;
  if (prompt.kind !== 'choose-target-mage') return false;
  // An optional leg can simply be passed at prompt time, so it's not a dead end.
  if (!isHarmfulTargetPrompt(prompt) || prompt.canPass) return false;
  const own = ownMageIds(next, botId);
  return prompt.eligibleMageIds.every((id) => own.has(id));
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
      const pool = available.length > 0 ? available : prompt.options;
      // Always take a reward over forfeiting — prefer paying Badges, then the
      // Divinity Gold variant; only forfeit when neither reward is available.
      const reward =
        pool.find((o) => o.id === 'reward') ?? pool.find((o) => o.id === 'reward-gold');
      const pick = reward ?? pickRandom(pool, rng);
      return { kind: 'option-chosen', optionId: pick.id, payload: pick.payload };
    }

    case 'choose-target-mage': {
      if (prompt.eligibleMageIds.length === 0) return { kind: 'pass' };
      if (isHarmfulTargetPrompt(prompt)) {
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
      return { kind: 'card-chosen', cardId: pickRandom([...prompt.eligibleCardIds], rng) };
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
      // Reactions are situational; passing is always safe.
      return { kind: 'reaction-passed' };

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
