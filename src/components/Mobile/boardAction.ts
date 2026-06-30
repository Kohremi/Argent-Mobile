import type { GameState, MageColor } from '../../game/types';

/**
 * What an opponent just did on the board, derived purely from the state diff
 * (prev → next). Used by the Smart Camera to follow a bot's move: scroll the
 * campus map to the room it placed into, pulse it (and the Infirmary when the
 * move wounded someone, e.g. Ars Magna), and caption who got wounded. Bot moves
 * are atomic single dispatches, so this is the only honest signal of "what just
 * happened" — there is no engine-level "pick mage / pick slot" to replay.
 */
export interface BoardActionInfo {
  /** The room the actor placed into — scroll / highlight target. */
  roomId: string;
  /** This move wounded an occupant into the Infirmary (Ars Magna takeover). */
  wounded: boolean;
  /** Seat id of the placing player, so the camera can ignore the local seat. */
  actorOwnerId: string;
  /** Player-facing caption naming the wound, or null for a plain placement. */
  caption: string | null;
}

function readablePlayerName(state: GameState, ownerId: string): string {
  return state.players.find((p) => p.id === ownerId)?.name ?? 'A player';
}

/**
 * Detect a worker PLACEMENT (the only move that lands a Mage on the board) and,
 * if it knocked an occupant into the Infirmary, the wound. Returns null for any
 * other transition (resource gains, casts, moves, passes) so the camera only
 * reacts to real board placements.
 */
export function describeBoardAction(
  prev: GameState,
  next: GameState,
): BoardActionInfo | null {
  // Previous position + status of every Mage, by id.
  const prevPos = new Map<
    string,
    { kind: string; spaceId: string | null; wounded: boolean }
  >();
  for (const p of prev.players) {
    for (const m of p.mages) {
      prevPos.set(m.id, {
        kind: m.location.kind,
        spaceId: m.location.kind === 'action-space' ? m.location.spaceId : null,
        wounded: m.isWounded,
      });
    }
  }

  const spaceRoomNext = new Map<string, string>();
  for (const r of next.rooms) {
    for (const s of r.actionSpaces) spaceRoomNext.set(s.id, r.id);
  }

  // The actor = a Mage now seated in an action-space (not a shadow) that was NOT
  // already on the board last state. That excludes a displaced occupant (it was
  // in an action-space before) so we never mistake the victim for the placer.
  let actor: { ownerId: string; roomId: string; color: MageColor } | null = null;
  for (const p of next.players) {
    for (const m of p.mages) {
      if (m.location.kind !== 'action-space' || m.isShadowing) continue;
      const was = prevPos.get(m.id);
      if (was?.kind === 'action-space') continue; // already on the board — a move
      const roomId = spaceRoomNext.get(m.location.spaceId);
      if (!roomId) continue;
      actor = { ownerId: p.id, roomId, color: m.color };
      break;
    }
    if (actor) break;
  }
  if (!actor) return null;

  // A wound from this move: a Mage freshly in the Infirmary, newly wounded, that
  // was standing in an action-space before (Ars Magna / any place-time wound).
  let victim: { ownerId: string; color: MageColor } | null = null;
  for (const p of next.players) {
    for (const m of p.mages) {
      const was = prevPos.get(m.id);
      if (!was) continue;
      if (
        m.location.kind === 'infirmary' &&
        m.isWounded &&
        !was.wounded &&
        was.spaceId
      ) {
        victim = { ownerId: p.id, color: m.color };
        break;
      }
    }
    if (victim) break;
  }

  const caption = victim
    ? `⚔ ${readablePlayerName(next, actor.ownerId)}'s ${actor.color} mage wounded ` +
      `${readablePlayerName(next, victim.ownerId)}'s ${victim.color} mage → Infirmary`
    : null;

  return { roomId: actor.roomId, wounded: !!victim, actorOwnerId: actor.ownerId, caption };
}
