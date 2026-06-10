import type {
  GameState,
  PendingResolution,
  ReactionTriggerEvent,
} from '../../game/types';

/** Top of the engine's pending-resolution stack (the prompt to answer now). */
export function topPending(state: GameState): PendingResolution | null {
  return state.pendingResolutionStack[state.pendingResolutionStack.length - 1] ?? null;
}

/** Player display name. */
export function playerName(state: GameState, playerId: string): string {
  return state.players.find((p) => p.id === playerId)?.name ?? playerId;
}

/** Human summary of a reaction trigger event (cut-in headline). */
export function describeTrigger(state: GameState, ev: ReactionTriggerEvent): string {
  const who = (ownerId: string) => `${playerName(state, ownerId)}'s student`;
  switch (ev.kind) {
    case 'mage-wounded':
      return `${who(ev.ownerId)} was wounded!`;
    case 'mage-banished':
      return `${who(ev.ownerId)} was banished!`;
    case 'mage-moved':
      return `${who(ev.ownerId)} was moved!`;
    case 'mage-shadowed':
      return `${who(ev.ownerId)} was shadowed!`;
    case 'spell-cast':
      return `A spell is being cast!`;
    case 'bell-tower-last-claimed':
      return `The last bell has been claimed!`;
    default:
      return 'Something happened!';
  }
}

/**
 * Open base slots a reaction-reposition may land on (Shield Potion etc.).
 * Mirrors the engine's rule as implemented in the console UI: returning to
 * the original room is always allowed; otherwise neither the origin room
 * nor the destination room may be locked. Infirmary-style rooms excluded.
 */
export function reactionDestinationSlots(
  state: GameState,
  pending: PendingResolution,
): Set<string> {
  const out = new Set<string>();
  if (pending.prompt.kind !== 'reaction-window') return out;
  const lockedRoomIds = new Set(state.roomLocks.map((l) => l.roomId));

  let fromRoomId: string | null = null;
  const ev = pending.prompt.triggerEvents[0];
  const originalSpaceId = ev
    ? ev.kind === 'mage-moved'
      ? ev.fromSpaceId
      : ev.kind === 'mage-shadowed'
        ? ev.spaceId
        : 'originalSpaceId' in ev
          ? (ev as { originalSpaceId: string | null }).originalSpaceId
          : null
    : null;
  if (originalSpaceId) {
    for (const r of state.rooms) {
      if (r.actionSpaces.some((s) => s.id === originalSpaceId)) {
        fromRoomId = r.id;
        break;
      }
    }
  }
  const fromLocked = fromRoomId !== null && lockedRoomIds.has(fromRoomId);
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    const sameRoom = r.id === fromRoomId;
    if (!sameRoom && (fromLocked || lockedRoomIds.has(r.id))) continue;
    for (const s of r.actionSpaces) {
      if (!s.occupant) out.add(s.id);
    }
  }
  return out;
}
