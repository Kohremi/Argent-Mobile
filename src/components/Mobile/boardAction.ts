import type { GameState, MageColor, VoterMark } from '../../game/types';
import type { MobileTab } from '../../store/uiStore';

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

/**
 * A surfaced opponent action — a superset of {@link BoardActionInfo} that also
 * covers off-board moves (placing a Mark, recruiting a Supporter). The Smart
 * Camera publishes it so the shell can follow the action to the right tab and
 * narrate it, not just pan the campus map.
 */
export interface OpponentActionInfo {
  /** Campus room to pan to + pulse (a placement), else null. */
  roomId: string | null;
  /** The placement also wounded an occupant (Ars Magna). */
  wounded: boolean;
  /** Council voter that just gained a Mark, else null. */
  voterId: string | null;
  /** Tab to follow the move to, so off-board actions are visible. */
  tab: MobileTab | null;
  /** Seat id of the acting player, so the camera can ignore the local seat. */
  actorOwnerId: string;
  /** Player-facing narration of what just happened. */
  caption: string | null;
}

/** The single Mark added between two states (multiset diff), or null. */
function newMark(prev: GameState, next: GameState): VoterMark | null {
  const remaining = new Map<string, number>();
  for (const m of prev.voterMarks ?? []) {
    const k = `${m.voterId}|${m.playerId}`;
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  for (const m of next.voterMarks ?? []) {
    const k = `${m.voterId}|${m.playerId}`;
    const left = remaining.get(k) ?? 0;
    if (left > 0) remaining.set(k, left - 1);
    else return m; // a mark in `next` not accounted for in `prev` → freshly placed
  }
  return null;
}

/** The first player whose count of `pick(player)` grew between states, or null. */
function whoGained(
  prev: GameState,
  next: GameState,
  pick: (p: GameState['players'][number]) => number,
): string | null {
  const before = new Map(prev.players.map((p) => [p.id, pick(p)] as const));
  for (const p of next.players) {
    if (pick(p) > (before.get(p.id) ?? 0)) return p.id;
  }
  return null;
}

/**
 * What an opponent just did, derived purely from the state diff — the Smart
 * Camera's "follow the flow" signal. Returns the single highest-priority change
 * (bot moves are atomic dispatches, so usually exactly one thing changed):
 *  1. a Mage placement (incl. an Ars Magna wound) — the richest, with a glide;
 *  2. a Mark placed on a Council voter;
 *  3. a Supporter recruited or a Consumable taken into the tableau.
 * Returns null for resource-only churn so the camera doesn't twitch.
 */
export function describeOpponentAction(
  prev: GameState,
  next: GameState,
): OpponentActionInfo | null {
  // 1. Board placement — reuse the placement detector (carries the glide + pan).
  const placed = describeBoardAction(prev, next);
  if (placed) {
    return {
      roomId: placed.roomId,
      wounded: placed.wounded,
      voterId: null,
      tab: 'campus',
      actorOwnerId: placed.actorOwnerId,
      caption: placed.caption,
    };
  }

  // 2. A Mark on a voter. Don't name a still-sealed voter (it would leak it).
  const mark = newMark(prev, next);
  if (mark) {
    const voter = next.voters.find((v) => v.id === mark.voterId);
    const named = voter && (voter.revealed || voter.isAlwaysFaceUp) ? voter.name : 'a sealed voter';
    return {
      roomId: null,
      wounded: false,
      voterId: mark.voterId,
      tab: 'council',
      actorOwnerId: mark.playerId,
      caption: `◆ ${readablePlayerName(next, mark.playerId)} marked ${named}`,
    };
  }

  // 3. A Supporter recruited (office grew), then a Consumable taken (vault grew).
  const recruiter = whoGained(prev, next, (p) => p.supporters.length);
  if (recruiter) {
    return {
      roomId: null,
      wounded: false,
      voterId: null,
      tab: 'rivals',
      actorOwnerId: recruiter,
      caption: `✦ ${readablePlayerName(next, recruiter)} recruited a Supporter`,
    };
  }
  const buyer = whoGained(prev, next, (p) => p.vaultCards.length);
  if (buyer) {
    return {
      roomId: null,
      wounded: false,
      voterId: null,
      tab: 'rivals',
      actorOwnerId: buyer,
      caption: `✦ ${readablePlayerName(next, buyer)} took a Consumable`,
    };
  }

  return null;
}
