import { applyAction } from '../game/engine';
import type { GameState, OwnedMage, Player, PlayerColor } from '../game/types';

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
