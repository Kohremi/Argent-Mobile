import { describe, expect, it } from 'vitest';
import type { GameState, MageColor, OwnedMage } from '../../game/types';
import { describeBoardAction } from './boardAction';

/** Minimal Mage with just the fields describeBoardAction reads. */
function mage(
  id: string,
  color: MageColor,
  location: OwnedMage['location'],
  isWounded = false,
): OwnedMage {
  return { id, color, location, isWounded } as unknown as OwnedMage;
}

/** A board with one room holding a single action-space `s1`. */
function state(players: { id: string; name: string; mages: OwnedMage[] }[]): GameState {
  return {
    players,
    rooms: [{ id: 'room.catacombs', actionSpaces: [{ id: 's1' }, { id: 's2' }] }],
  } as unknown as GameState;
}

describe('describeBoardAction', () => {
  it('reports an Ars Magna takeover: actor room + wounded victim caption', () => {
    const prev = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'office', playerId: 'p1' })] },
      { id: 'p2', name: 'Klank', mages: [mage('m2', 'blue', { kind: 'action-space', spaceId: 's1' })] },
    ]);
    const next = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'action-space', spaceId: 's1' })] },
      { id: 'p2', name: 'Klank', mages: [mage('m2', 'blue', { kind: 'infirmary' }, true)] },
    ]);

    const info = describeBoardAction(prev, next);
    expect(info).not.toBeNull();
    expect(info!.roomId).toBe('room.catacombs');
    expect(info!.wounded).toBe(true);
    expect(info!.actorOwnerId).toBe('p1');
    expect(info!.caption).toContain("You's red mage wounded");
    expect(info!.caption).toContain("Klank's blue mage");
  });

  it('reports a plain placement with no wound (no caption)', () => {
    const prev = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'office', playerId: 'p1' })] },
    ]);
    const next = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'action-space', spaceId: 's1' })] },
    ]);
    const info = describeBoardAction(prev, next);
    expect(info).not.toBeNull();
    expect(info!.roomId).toBe('room.catacombs');
    expect(info!.wounded).toBe(false);
    expect(info!.caption).toBeNull();
  });

  it('does not mistake a displaced occupant (slot→slot) for the placer', () => {
    // p1 places into s1; p2's existing s1 mage is shoved to s2 (Natural B style).
    const prev = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'green', { kind: 'office', playerId: 'p1' })] },
      { id: 'p2', name: 'Klank', mages: [mage('m2', 'blue', { kind: 'action-space', spaceId: 's1' })] },
    ]);
    const next = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'green', { kind: 'action-space', spaceId: 's1' })] },
      { id: 'p2', name: 'Klank', mages: [mage('m2', 'blue', { kind: 'action-space', spaceId: 's2' })] },
    ]);
    const info = describeBoardAction(prev, next);
    expect(info!.actorOwnerId).toBe('p1'); // the placer, not the displaced p2
    expect(info!.wounded).toBe(false);
  });

  it('returns null when no Mage was placed (resource-only change)', () => {
    const prev = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'action-space', spaceId: 's1' })] },
    ]);
    const next = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'action-space', spaceId: 's1' })] },
    ]);
    expect(describeBoardAction(prev, next)).toBeNull();
  });
});
