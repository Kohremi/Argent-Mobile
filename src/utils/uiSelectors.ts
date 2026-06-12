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
 * slots plus one open spot, so the room reads as "always one open seat;
 * seats appear as you fill them." `extraVisibleIds` (prompt-targeted slots)
 * are always shown so targeting can never point at a hidden slot.
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

  const visible = all.filter(
    (s) =>
      s.occupant ||
      s.shadowOccupant ||
      (extraVisibleIds?.has(s.id) ?? false),
  );
  const firstOpen = all.find((s) => !s.occupant);
  if (firstOpen && !visible.includes(firstOpen)) visible.push(firstOpen);
  return visible.sort((a, b) => a.index - b.index);
}

/**
 * The Infirmary's bed list (RoomScene renders it as a 3-wide bed grid that
 * grows as it fills, Great-Hall style). Side B's reward slots come first —
 * they're always on display — then a white bed per wounded mage resting in
 * the player-level `infirmary` location, then exactly one open white bed.
 */
export type InfirmaryBed =
  | { kind: 'reward'; space: ActionSpace }
  | { kind: 'rest'; entry: { mage: OwnedMage; owner: Player } }
  | { kind: 'open' };

export function infirmaryBeds(state: GameState, room: Room): InfirmaryBed[] {
  const beds: InfirmaryBed[] = room.actionSpaces.map((space) => ({ kind: 'reward', space }));
  // A mage who took a buffed bonus occupies that reward bed (the slot's
  // occupant flag) while its `location` STAYS 'infirmary' — engine design.
  // Skip those here or the patient would also get a white bed.
  const inRewardBeds = new Set(
    room.actionSpaces.map((s) => s.occupant?.mageId).filter((id): id is string => !!id),
  );
  for (const owner of state.players) {
    for (const mage of owner.mages) {
      if (mage.location.kind === 'infirmary' && !inRewardBeds.has(mage.id)) {
        beds.push({ kind: 'rest', entry: { mage, owner } });
      }
    }
  }
  beds.push({ kind: 'open' });
  return beds;
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
