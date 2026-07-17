import { useEffect, useRef } from 'react';
import type { GameState } from '../../game/types';
import {
  actsAsColor,
  magesLosePowers,
  sideForColor,
} from '../../game/effects/helpers';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import type { ResourceKind } from '../icons';

export type RoomFxKind =
  | 'wound'
  | 'banish'
  | 'flip'
  | 'mana-gain'
  | 'buff-activate'
  | 'reward';

/** One icon's worth of loot in a reward bubble. */
export interface RewardGain {
  icon: ResourceKind | 'spell' | 'vault' | 'supporter' | 'mage';
  amount: number;
}

/** One diff-derived room flourish; `value` carries the amount for mana-gain. */
export interface RoomFx {
  roomId: string;
  kind: RoomFxKind;
  value?: number;
  /** 'reward' only: what the departing mage's owner collected. */
  gains?: RewardGain[];
  /** 'reward' only: the owner's aura color, so the bubble reads as theirs. */
  aura?: string;
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

/** The storable resources a resolution reward can grant, → bubble icon. */
const REWARD_RESOURCE_ICON = {
  gold: 'gold',
  mana: 'mana',
  influence: 'influence',
  intelligence: 'intelligence',
  wisdom: 'wisdom',
  marks: 'marks',
  meritBadges: 'merit-badge',
} as const satisfies Partial<Record<string, ResourceKind>>;

/**
 * Round-end loot bubbles: when a mage steps off its action space back to the
 * office during the resolution phase, everything its owner collected since
 * `anchor` (the state where this slot's resolution chain began — resource
 * gains, drafted cards, recruits) becomes one 'reward' fx over the room it
 * left. Anchoring on the chain start rather than the last transition matters
 * for multi-prompt rewards (e.g. "gain 2 gold, then draft a spell"): the gold
 * lands one dispatch earlier than the departure. A forfeited slot honestly
 * bubbles its +1 influence consolation instead.
 */
export function computeRewardFx(anchor: GameState, next: GameState): RoomFx[] {
  if (anchor === next || anchor.phase.kind !== 'resolution') return [];

  const spaceToRoom = new Map<string, string>();
  for (const r of anchor.rooms) {
    for (const s of r.actionSpaces) spaceToRoom.set(s.id, r.id);
  }
  const wasOnSpace = new Map<string, string>(); // mageId → spaceId in `anchor`
  for (const p of anchor.players) {
    for (const m of p.mages) {
      if (m.location.kind === 'action-space') wasOnSpace.set(m.id, m.location.spaceId);
    }
  }

  const fx: RoomFx[] = [];
  const bubbledOwners = new Set<string>();
  for (const p of next.players) {
    const before = anchor.players.find((ap) => ap.id === p.id);
    if (!before) continue;
    for (const m of p.mages) {
      if (m.location.kind !== 'office') continue;
      const roomId = spaceToRoom.get(wasOnSpace.get(m.id) ?? '');
      if (!roomId) continue;
      // One bubble per owner per transition — the diff is per-player, so a
      // second departing mage would double-report the same loot.
      if (bubbledOwners.has(p.id)) continue;
      bubbledOwners.add(p.id);

      const gains: RewardGain[] = [];
      for (const [key, icon] of Object.entries(REWARD_RESOURCE_ICON)) {
        const k = key as keyof typeof REWARD_RESOURCE_ICON;
        const d = p.resources[k] - before.resources[k];
        if (d > 0) gains.push({ icon, amount: d });
      }
      const cardCounts = [
        ['spell', p.ownedSpells.length - before.ownedSpells.length],
        ['vault', p.vaultCards.length - before.vaultCards.length],
        ['supporter', p.supporters.length - before.supporters.length],
        ['mage', p.mages.length - before.mages.length],
      ] as const;
      for (const [icon, d] of cardCounts) {
        if (d > 0) gains.push({ icon, amount: d });
      }
      if (gains.length > 0) {
        fx.push({ roomId, kind: 'reward', gains, aura: PLAYER_AURA[p.color] });
      }
    }
  }
  return fx;
}

/**
 * Stateful per-transition reward tracking: feeds computeRewardFx the right
 * baseline. The anchor is the state at which the resolution pointer last moved
 * to a fresh slot (its forfeit-or-reward prompt was pushed); nested prompts
 * within one slot's chain keep the anchor, so their gains accumulate into one
 * bubble when the mage finally departs.
 */
export function createRewardTracker(): (prev: GameState, next: GameState) => RoomFx[] {
  let anchor: GameState | null = null;
  return (prev, next) => {
    const fx = computeRewardFx(anchor ?? prev, next);
    if (next.phase.kind !== 'resolution') {
      anchor = null;
    } else {
      const sameSlot =
        anchor?.phase.kind === 'resolution' &&
        anchor.phase.pendingRoomIndex === next.phase.pendingRoomIndex &&
        anchor.phase.pendingSpaceIndex === next.phase.pendingSpaceIndex &&
        (anchor.phase.pendingSlotPosition ?? 'base') ===
          (next.phase.pendingSlotPosition ?? 'base');
      if (!sameSlot) anchor = next;
    }
    return fx;
  };
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
  const trackRewards = useRef(createRewardTracker()).current;

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state || prev === state) return;

    const fx = [...computeRoomFx(prev, state), ...trackRewards(prev, state)];
    if (fx.length === 0) return;
    pushRoomFx(fx);
    // Expire after the longest overlay finishes. Reward bubbles are the beat
    // the player most wants to catch (what did that slot pay out?), so they
    // linger longest; the passive-power flourishes (mana-gain / buff-activate)
    // hold ~1s; the impact flashes clear sooner. Deliberately NOT cleaned up
    // on re-render: the store is global and rapid dispatches must not strand
    // earlier effects in the queue.
    const ttl = fx.some((f) => f.kind === 'reward')
      ? 1700
      : fx.some((f) => f.kind === 'mana-gain' || f.kind === 'buff-activate')
        ? 1100
        : 900;
    const snapshot = useUiStore.getState().roomFx.slice(-fx.length).map((f) => f.id);
    setTimeout(() => expireRoomFx(snapshot), ttl);
  }, [state, pushRoomFx, expireRoomFx]);
}
