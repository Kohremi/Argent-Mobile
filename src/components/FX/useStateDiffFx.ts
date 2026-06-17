import { useEffect, useRef } from 'react';
import type { GameState } from '../../game/types';
import {
  actsAsColor,
  magesLosePowers,
  sideForColor,
} from '../../game/effects/helpers';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

export type RoomFxKind =
  | 'wound'
  | 'banish'
  | 'flip'
  | 'mana-gain'
  | 'buff-activate';

/** One diff-derived room flourish; `value` carries the amount for mana-gain. */
export interface RoomFx {
  roomId: string;
  kind: RoomFxKind;
  value?: number;
}

/**
 * Pure diff: which one-shot room effects does this state transition imply?
 * (docs/UI_DESIGN.md §8 "FX from state diffs".)
 *
 * Detected transitions:
 *  - a mage leaves a slot for the Infirmary, newly wounded   → 'wound'
 *  - a mage leaves a slot for an office, unwounded           → 'banish'
 *    (covers banish + bounce-style returns; close enough visually)
 *  - a room id swaps to its opposite side (Flux)             → 'flip'
 *  - a Sorcery (Side B) Mage is freshly placed into a slot   → 'mana-gain'
 *    (carries the Mana gained: 1 per other Mage in the room, capped at 3)
 *  - a Mysticism (Side B) Mage is freshly placed into a slot → 'buff-activate'
 *    (its In-Place "Spells cost 1 less" power switches on)
 */
export function computeRoomFx(prev: GameState, next: GameState): RoomFx[] {
  const fx: RoomFx[] = [];

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

  // Passive on-place powers (Sorcery / Mysticism Side B). These leave no
  // dedicated marker in state, so we recognise the freshly-placed Mage (was
  // off the board, now in a base slot) and re-derive the flourish from the
  // same rules the engine used — keeping the FX honest. Shadow placements
  // (Planar B) don't qualify: neither power triggers from the shadow position.
  const roomByIdNext = new Map(next.rooms.map((r) => [r.id, r] as const));
  const spaceToRoomNext = new Map<string, string>();
  for (const r of next.rooms) {
    for (const s of r.actionSpaces) spaceToRoomNext.set(s.id, r.id);
  }
  const powersLost = magesLosePowers(next);
  for (const p of next.players) {
    for (const m of p.mages) {
      if (m.location.kind !== 'action-space' || m.isShadowing) continue;
      const was = prevMage.get(m.id);
      if (was?.spaceId) continue; // already on a slot → a move, not a placement
      const roomId = spaceToRoomNext.get(m.location.spaceId);
      if (!roomId || powersLost) continue;

      if (actsAsColor(m, 'red') && sideForColor(next, 'red') === 'B') {
        const room = roomByIdNext.get(roomId);
        const inRoom = room
          ? room.actionSpaces.reduce(
              (n, sp) => n + (sp.occupant ? 1 : 0) + (sp.shadowOccupant ? 1 : 0),
              0,
            )
          : 0;
        // "Each OTHER Mage in the room" — exclude the one just placed.
        const gain = Math.min(3, Math.max(0, inRoom - 1));
        if (gain > 0) fx.push({ roomId, kind: 'mana-gain', value: gain });
      }

      if (actsAsColor(m, 'grey') && sideForColor(next, 'grey') === 'B') {
        fx.push({ roomId, kind: 'buff-activate' });
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
    // Expire after the longest overlay finishes. The passive-power flourishes
    // (mana-gain / buff-activate) read as a beat the player should catch, so
    // they linger ~1s; the impact flashes clear sooner. Deliberately NOT
    // cleaned up on re-render: the store is global and rapid dispatches must
    // not strand earlier effects in the queue.
    const hasFlourish = fx.some(
      (f) => f.kind === 'mana-gain' || f.kind === 'buff-activate',
    );
    const snapshot = useUiStore.getState().roomFx.slice(-fx.length).map((f) => f.id);
    setTimeout(() => expireRoomFx(snapshot), hasFlourish ? 1100 : 900);
  }, [state, pushRoomFx, expireRoomFx]);
}
