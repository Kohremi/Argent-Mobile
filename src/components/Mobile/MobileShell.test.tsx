// @vitest-environment happy-dom
// Smoke tests for the mobile shell: the roomPlacementEligibility selector and a
// render + pick-mage → drill-into-room → place flow through the mobile UI.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MobileShell } from './MobileShell';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { initGame } from '../../game/engine';
import {
  eligiblePlacementSlots,
  roomPlacementEligibility,
} from '../../utils/uiSelectors';
import type { GameState, OwnedMage } from '../../game/types';

afterEach(cleanup);

function errandsState(): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['Akko', 'Diana'],
    rngSeed: 7,
  });
  const p1 = s.players[0]!;
  const mage: OwnedMage = {
    id: 'm-ui-1',
    cardId: 'base.mage.neutral',
    color: 'red',
    location: { kind: 'office', playerId: p1.id },
    isShadowing: false,
    isWounded: false,
  };
  return {
    ...s,
    firstPlayerIndex: 0,
    players: s.players.map((p, i) => (i === 0 ? { ...p, mages: [...p.mages, mage] } : p)),
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
}

describe('roomPlacementEligibility', () => {
  it('returns exactly the rooms that contain an eligible slot for the mage', () => {
    const s = errandsState();
    const p1 = s.players[0]!;
    const slots = eligiblePlacementSlots(s, p1.id, 'm-ui-1');
    expect(slots.size).toBeGreaterThan(0);

    const rooms = roomPlacementEligibility(s, p1.id, 'm-ui-1');
    // Every returned room has at least one eligible slot…
    for (const roomId of rooms) {
      const room = s.rooms.find((r) => r.id === roomId)!;
      expect(room.actionSpaces.some((sp) => slots.has(sp.id))).toBe(true);
    }
    // …and every eligible slot's room is in the set (no room is missed).
    for (const room of s.rooms) {
      const hasEligible = room.actionSpaces.some((sp) => slots.has(sp.id));
      expect(rooms.has(room.id)).toBe(hasEligible);
    }
    // The Infirmary can't be placed into directly, so it's never eligible.
    const infirmary = s.rooms.find((r) => r.cannotBePlacedInDirectly);
    if (infirmary) expect(rooms.has(infirmary.id)).toBe(false);
  });
});

describe('MobileShell (smoke)', () => {
  it('renders the tabs and completes pick-mage → open-room → place', () => {
    useGameStore.setState({ state: errandsState() });
    useUiStore.setState({
      selectedMageId: null,
      mobileTab: 'campus',
      openRoomId: null,
      // The bench lives in the expanded dock; start expanded so it's visible.
      dockExpanded: true,
      lastError: null,
    });

    render(<MobileShell />);

    // Bottom tab bar is present.
    expect(screen.getByText('Campus')).toBeTruthy();
    expect(screen.getByText('Rivals')).toBeTruthy();
    expect(screen.getByText('Council')).toBeTruthy();

    // Pick the bench student in the dock — this also auto-collapses the dock.
    fireEvent.click(screen.getByTitle('red student'));
    expect(useUiStore.getState().selectedMageId).toBe('m-ui-1');
    expect(useUiStore.getState().dockExpanded).toBe(false);

    // A placeable room tile glows (data-available) — drill into it.
    const roomTile = document.querySelector(
      'button[data-room][data-available="true"]',
    ) as HTMLButtonElement | null;
    expect(roomTile).toBeTruthy();
    fireEvent.click(roomTile!);

    // The enlarged room sheet opens with a placeable slot — tap it.
    const slot = document.querySelector(
      '[data-room-sheet] button[data-available="true"]',
    ) as HTMLButtonElement | null;
    expect(slot).toBeTruthy();
    fireEvent.click(slot!);

    // Engine accepted the placement; the student is now on a board slot.
    const after = useGameStore.getState().state!;
    expect(useUiStore.getState().lastError).toBeNull();
    const placed = after.players[0]!.mages.find((m) => m.id === 'm-ui-1')!;
    expect(placed.location.kind).toBe('action-space');
  });
});
