import { applyAction } from '../game/engine';
import type {
  ActionSpace,
  GameState,
  OwnedMage,
  Player,
  PlayerColor,
  Room,
} from '../game/types';

/**
 * Read-model helpers for the presentation layer. Eligibility is derived by
 * dry-running the engine (applyAction throws on illegal actions), so the UI
 * can never drift from the rules — see docs/UI_DESIGN.md §8.
 */

/** The player whose turn it is during Errands, else null. */
export function activePlayer(state: GameState): Player | null {
  if (state.phase.kind !== 'errands') return null;
  return state.players[state.phase.activePlayerIndex] ?? null;
}

/** Action-space ids where `mageId` may legally be placed right now. */
export function eligiblePlacementSlots(
  state: GameState,
  playerId: string,
  mageId: string,
): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  for (const room of state.rooms) {
    for (const space of room.actionSpaces) {
      try {
        applyAction(state, {
          type: 'PLACE_WORKER',
          playerId,
          mageId,
          actionSpaceId: space.id,
        });
        out.add(space.id);
      } catch {
        // Illegal placement — the engine said no; that's the whole check.
      }
    }
  }
  return out;
}

/**
 * The action spaces a room should RENDER. Pool rooms — many identical slots
 * pre-allocated by the engine (Great Hall's 10) — collapse to the occupied
 * slots plus EXACTLY ONE open spot, so the room reads as "always one open
 * seat; the next seat appears only once this one is filled." The slots are
 * interchangeable, so even when a prompt offers several open slots as targets
 * (`extraVisibleIds`) we still surface just one — preferring a targeted open
 * slot so targeting always has a visible, clickable seat. Targeted *occupied*
 * slots are shown regardless (they're occupied), so targeting never points at
 * a hidden slot either way.
 */
export function visibleRoomSpaces(
  room: Room,
  extraVisibleIds?: Set<string>,
): ActionSpace[] {
  const all = room.actionSpaces;
  if (all.length <= 5) return all;
  const sig = (s: ActionSpace) =>
    `${s.slotType}|${s.effectId}|${s.costToActivate?.gold ?? 0}|${s.costToActivate?.mana ?? 0}|${s.costToActivate?.meritBadges ?? 0}`;
  const first = all[0]!;
  if (!all.every((s) => sig(s) === sig(first))) return all;

  // Occupied (base or shadow) seats always show.
  const occupied = all.filter((s) => s.occupant || s.shadowOccupant);
  // Exactly one open seat: the first targeted open slot if a prompt is
  // pointing at the pool, else the lowest-index open slot.
  const openSlots = all.filter((s) => !s.occupant && !s.shadowOccupant);
  const openToShow =
    openSlots.find((s) => extraVisibleIds?.has(s.id)) ?? openSlots[0];
  const visible = openToShow ? [...occupied, openToShow] : occupied;
  return visible.sort((a, b) => a.index - b.index);
}

/**
 * Research standing for a player: INT/WIS still unspent in the pool
 * ("remaining") versus that plus what's already been placed on spells
 * ("total"). One INT is placed per learned spell; one WIS per unlocked
 * level (L2, L3). Used by the dock and the rival rail.
 */
export function researchTotals(player: Player): {
  intRemaining: number;
  intTotal: number;
  wisRemaining: number;
  wisTotal: number;
} {
  const intRemaining = player.resources.intelligence;
  const wisRemaining = player.resources.wisdom;
  const intPlaced = player.ownedSpells.filter((s) => s.intPlaced).length;
  const wisPlaced = player.ownedSpells.reduce(
    (n, s) => n + (s.wisPlacedLevel2 ? 1 : 0) + (s.wisPlacedLevel3 ? 1 : 0),
    0,
  );
  return {
    intRemaining,
    intTotal: intRemaining + intPlaced,
    wisRemaining,
    wisTotal: wisRemaining + wisPlaced,
  };
}

/** Quick index from mage id → { mage, owner } across all players. */
export function buildMageIndex(
  state: GameState,
): Map<string, { mage: OwnedMage; owner: Player }> {
  const map = new Map<string, { mage: OwnedMage; owner: Player }>();
  for (const owner of state.players) {
    for (const mage of owner.mages) map.set(mage.id, { mage, owner });
  }
  return map;
}

/** Engine PlayerColor → design-system aura hex (docs/UI_DESIGN.md §3.3). */
export const PLAYER_AURA: Record<PlayerColor, string> = {
  red: '#ff6b6b',
  blue: '#4d96ff',
  green: '#6bcb77',
  yellow: '#ffd93d',
  purple: '#b388eb',
  orange: '#ff9f43',
};

/** Department → hue, following the engine's canonical color mapping
 *  (sorcery=red, mysticism=grey, natural-magick=green, planar-studies=purple,
 *  divinity=blue, technomancy=orange). */
export const DEPT_HUE: Record<string, string> = {
  sorcery: '#ff5d5d',
  mysticism: '#9aa0b4',
  'natural-magick': '#5fd068',
  'planar-studies': '#b16cea',
  divinity: '#5aa9e6',
  technomancy: '#ff9f43',
  students: '#e8e4da',
  wild: '#ffd93d',
};

/** Spell levels castable right now, by spell card id (engine dry-run). */
export function castableSpellLevels(
  state: GameState,
  playerId: string,
): Map<string, Set<1 | 2 | 3>> {
  const out = new Map<string, Set<1 | 2 | 3>>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const owned of player.ownedSpells) {
    for (const level of [1, 2, 3] as const) {
      try {
        applyAction(state, {
          type: 'CAST_SPELL',
          playerId,
          spellCardId: owned.cardId,
          level,
        });
        const set = out.get(owned.cardId) ?? new Set<1 | 2 | 3>();
        set.add(level);
        out.set(owned.cardId, set);
      } catch {
        // not castable at this level right now
      }
    }
  }
  return out;
}

/** Vault cards playable right now (engine dry-run). */
export function playableVaultCards(state: GameState, playerId: string): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const v of player.vaultCards) {
    if (out.has(v.cardId)) continue;
    try {
      applyAction(state, { type: 'PLAY_VAULT_CARD', playerId, vaultCardId: v.cardId });
      out.add(v.cardId);
    } catch {
      // not playable right now
    }
  }
  return out;
}

/** Supporters playable right now (engine dry-run). */
export function playableSupporters(state: GameState, playerId: string): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const cardId of player.supporters) {
    if (out.has(cardId)) continue;
    try {
      applyAction(state, { type: 'PLAY_SUPPORTER', playerId, supporterCardId: cardId });
      out.add(cardId);
    } catch {
      // not playable right now
    }
  }
  return out;
}

/** Bell tower cards claimable right now (engine dry-run). */
export function claimableBellCards(state: GameState, playerId: string): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  for (const card of state.bellTower.available) {
    try {
      applyAction(state, { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: card.id });
      out.add(card.id);
    } catch {
      // not claimable right now
    }
  }
  return out;
}
