// Klank — the AI that plays bot-controlled seats.
//
// Pure decision functions: given a GameState (engine truth) they return a legal
// GameAction / ResolutionAnswer. They never touch React or the store — the
// `useKlankDriver` hook wires them up and paces dispatch. Legality is enumerated
// with the same engine dry-run selectors the human UI uses (src/utils/uiSelectors),
// so a bot can never attempt a move the rules forbid.
//
// v1 is a single heuristic/greedy personality. The `BotPersonality` shape +
// registry below leave room for per-seat personalities later (a future
// `Player.botPersonalityId` would pick one); for now every bot seat is Klank.

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
  Room,
} from '../types';
import type { BotPersonality } from './types';

// ============================================================================
// Errands turn — enumerate legal actions, score them, play the best (or pass).
// ============================================================================

/** A scored candidate action the bot could take this turn. */
interface ScoredAction {
  action: GameAction;
  score: number;
  /** Stable tiebreak key so ties resolve deterministically (reproducible). */
  key: string;
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

/**
 * Heuristic value of placing into a given slot. Worker placement is the core
 * engine action, so it scores solidly; small bonuses/penalties nudge toward
 * the better seats without needing per-room rules knowledge.
 */
function scorePlacement(
  state: GameState,
  player: Player,
  spaceId: string,
  shadow: boolean,
): number {
  let score = shadow ? 22 : 30; // shadow costs Mana, so it's a touch lower
  const found = findSpace(state, spaceId);
  if (found) {
    const { room, space } = found;
    if (room.isInstantRoom) score += 6; // immediate reward this turn
    const meritCost = space.costToActivate?.meritBadges ?? 0;
    if (space.slotType === 'merit' && meritCost > player.resources.meritBadges) {
      score -= 5; // can't pay → likely forfeit for 1 IP
    }
    // Taking an occupied opposing slot (Ars Magna / displace) is aggressive and
    // costs resources/tempo — only mildly preferred over an empty seat.
    if (space.occupant && space.occupant.ownerId !== player.id) score += 2;
  }
  return score;
}

function enumerateErrandsActions(
  state: GameState,
  playerId: PlayerId,
): ScoredAction[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  const out: ScoredAction[] = [];

  // Placements — every office mage onto every legal base/shadow slot.
  for (const mage of player.mages) {
    if (mage.location.kind !== 'office' || mage.isWounded) continue;
    for (const spaceId of eligiblePlacementSlots(state, playerId, mage.id)) {
      out.push({
        action: {
          type: 'PLACE_WORKER',
          playerId,
          mageId: mage.id,
          actionSpaceId: spaceId,
        },
        score: scorePlacement(state, player, spaceId, false),
        key: `place:${mage.id}:${spaceId}`,
      });
    }
    for (const spaceId of eligibleShadowPlacementSlots(state, playerId, mage.id)) {
      out.push({
        action: {
          type: 'PLACE_WORKER',
          playerId,
          mageId: mage.id,
          actionSpaceId: spaceId,
          isShadowing: true,
        },
        score: scorePlacement(state, player, spaceId, true),
        key: `shadow:${mage.id}:${spaceId}`,
      });
    }
  }

  // Cast a researched spell — situational; scored below placement so the bot
  // doesn't burn spells when a plain placement is just as good.
  const castable = castableSpellLevels(state, playerId);
  for (const [spellCardId, levels] of castable) {
    for (const level of levels) {
      out.push({
        action: { type: 'CAST_SPELL', playerId, spellCardId, level },
        score: 16 + level, // mild preference for higher levels
        key: `spell:${spellCardId}:${level}`,
      });
    }
  }

  // Play a vault card / supporter — modest value.
  for (const vaultCardId of playableVaultCards(state, playerId)) {
    out.push({
      action: { type: 'PLAY_VAULT_CARD', playerId, vaultCardId },
      score: 18,
      key: `vault:${vaultCardId}`,
    });
  }
  for (const supporterCardId of playableSupporters(state, playerId)) {
    out.push({
      action: { type: 'PLAY_SUPPORTER', playerId, supporterCardId },
      score: 18,
      key: `supporter:${supporterCardId}`,
    });
  }

  // Claim a Bell Tower offering — LOWEST priority. Claiming drains the tower,
  // which is the round timer (a round ends only when the tower empties), so a
  // bot that grabbed bell cards eagerly would rush the whole game to its end.
  // Klank therefore values placing a Mage — and even casting spells / playing
  // items — over a bell card, and only claims one when it's out of more
  // beneficial actions. It still scores above passing, so once nothing better
  // remains Klank claims a card and the round can progress to its end.
  for (const cardId of claimableBellCards(state, playerId)) {
    out.push({
      action: { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: cardId },
      score: 12,
      key: `bell:${cardId}`,
    });
  }

  return out;
}

function chooseErrandsAction(state: GameState, playerId: PlayerId): GameAction {
  const candidates = enumerateErrandsActions(state, playerId);
  if (candidates.length === 0) {
    // Nothing worthwhile (or possible) — end the turn.
    return { type: 'PASS_TURN', playerId };
  }
  // Highest score wins; ties break on the stable key for reproducibility.
  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return candidates[0]!.action;
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
      const pool = available.length > 0 ? available : prompt.options;
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
      // v1: never react. Reactions are situational and passing is always safe.
      return { kind: 'reaction-passed' };

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
