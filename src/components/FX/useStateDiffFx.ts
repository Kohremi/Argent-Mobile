import { useEffect, useRef } from 'react';
import type { GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

export type RoomFxKind = 'wound' | 'banish' | 'flip';

/**
 * Pure diff: which one-shot room effects does this state transition imply?
 * (docs/UI_DESIGN.md §8 "FX from state diffs".)
 *
 * Detected transitions:
 *  - a mage leaves a slot for the Infirmary, newly wounded   → 'wound'
 *  - a mage leaves a slot for an office, unwounded           → 'banish'
 *    (covers banish + bounce-style returns; close enough visually)
 *  - a room id swaps to its opposite side (Flux)             → 'flip'
 */
export function computeRoomFx(
  prev: GameState,
  next: GameState,
): { roomId: string; kind: RoomFxKind }[] {
  const fx: { roomId: string; kind: RoomFxKind }[] = [];

  // Index the previous state: where each mage stood, and its wound flag.
  const spaceToRoom = new Map<string, string>();
  for (const r of prev.rooms) {
    for (const s of r.actionSpaces) spaceToRoom.set(s.id, r.id);
  }
  const prevMage = new Map<string, { spaceId: string | null; isWounded: boolean }>();
  for (const p of prev.players) {
    for (const m of p.mages) {
      prevMage.set(m.id, {
        spaceId: m.location.kind === 'action-space' ? m.location.spaceId : null,
        isWounded: m.isWounded,
      });
    }
  }

  for (const p of next.players) {
    for (const m of p.mages) {
      const was = prevMage.get(m.id);
      if (!was?.spaceId) continue;
      const roomId = spaceToRoom.get(was.spaceId);
      if (!roomId) continue;
      if (m.location.kind === 'infirmary' && m.isWounded && !was.isWounded) {
        fx.push({ roomId, kind: 'wound' });
      } else if (m.location.kind === 'office' && !m.isWounded) {
        fx.push({ roomId, kind: 'banish' });
      }
    }
  }

  // Room flips (Flux): a previous id vanished and its opposite side exists.
  for (const r of prev.rooms) {
    if (next.rooms.some((n) => n.id === r.id)) continue;
    const opp = r.id.endsWith('.a')
      ? `${r.id.slice(0, -2)}.b`
      : r.id.endsWith('.b')
        ? `${r.id.slice(0, -2)}.a`
        : null;
    if (opp && next.rooms.some((n) => n.id === opp)) {
      fx.push({ roomId: opp, kind: 'flip' });
    }
  }

  return fx;
}

/**
 * Compares consecutive GameStates after every dispatch and enqueues one-shot
 * room effects. Because the diff runs on engine truth, effects can never
 * desync from the rules — there are no imperative "play the wound animation"
 * calls anywhere.
 */
export function useStateDiffFx() {
  const state = useGameStore((s) => s.state);
  const pushRoomFx = useUiStore((s) => s.pushRoomFx);
  const expireRoomFx = useUiStore((s) => s.expireRoomFx);
  const prevRef = useRef<GameState | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state || prev === state) return;

    const fx = computeRoomFx(prev, state);
    if (fx.length === 0) return;
    pushRoomFx(fx);
    // Expire after the longest overlay finishes. Deliberately NOT cleaned up
    // on re-render: the store is global and rapid dispatches must not strand
    // earlier effects in the queue.
    const snapshot = useUiStore.getState().roomFx.slice(-fx.length).map((f) => f.id);
    setTimeout(() => expireRoomFx(snapshot), 900);
  }, [state, pushRoomFx, expireRoomFx]);
}
