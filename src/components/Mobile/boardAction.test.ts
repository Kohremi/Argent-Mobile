import { describe, expect, it } from 'vitest';
import type { GameState, MageColor, OwnedMage } from '../../game/types';
import { describeBoardAction, describeOpponentAction } from './boardAction';

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

/** A minimal off-board state: two seats with empty boards, voters + tableaus. */
function offBoard(over: Partial<GameState> = {}): GameState {
  return {
    players: [
      { id: 'p1', name: 'You', mages: [], supporters: [], vaultCards: [] },
      { id: 'p2', name: 'Klank', mages: [], supporters: [], vaultCards: [] },
    ],
    rooms: [],
    voters: [
      { id: 'v1', name: 'The Dean', revealed: true, isAlwaysFaceUp: true },
      { id: 'v2', name: 'Secret Donor', revealed: false, isAlwaysFaceUp: false },
    ],
    voterMarks: [],
    ...over,
  } as unknown as GameState;
}

describe('describeOpponentAction', () => {
  it('delegates a Mage placement to the Campus tab (with the wound caption)', () => {
    const prev = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'office', playerId: 'p1' })] },
      { id: 'p2', name: 'Klank', mages: [mage('m2', 'blue', { kind: 'action-space', spaceId: 's1' })] },
    ]);
    const next = state([
      { id: 'p1', name: 'You', mages: [mage('m1', 'red', { kind: 'action-space', spaceId: 's1' })] },
      { id: 'p2', name: 'Klank', mages: [mage('m2', 'blue', { kind: 'infirmary' }, true)] },
    ]);
    const info = describeOpponentAction(prev, next);
    expect(info).not.toBeNull();
    expect(info!.tab).toBe('campus');
    expect(info!.roomId).toBe('room.catacombs');
    expect(info!.wounded).toBe(true);
    expect(info!.voterId).toBeNull();
    expect(info!.caption).toContain('wounded');
  });

  it('reports a Mark on a face-up voter → Council tab + the voter to pulse', () => {
    const info = describeOpponentAction(
      offBoard(),
      offBoard({ voterMarks: [{ voterId: 'v1', playerId: 'p2' }] as GameState['voterMarks'] }),
    );
    expect(info).not.toBeNull();
    expect(info!.tab).toBe('council');
    expect(info!.voterId).toBe('v1');
    expect(info!.actorOwnerId).toBe('p2');
    expect(info!.roomId).toBeNull();
    expect(info!.caption).toBe('◆ Klank marked The Dean');
  });

  it('does not name a still-sealed voter (no info leak)', () => {
    const info = describeOpponentAction(
      offBoard(),
      offBoard({ voterMarks: [{ voterId: 'v2', playerId: 'p2' }] as GameState['voterMarks'] }),
    );
    expect(info!.caption).toBe('◆ Klank marked a sealed voter');
    expect(info!.voterId).toBe('v2');
  });

  it('detects only the freshly-added Mark when marks already exist', () => {
    const before = offBoard({
      voterMarks: [{ voterId: 'v1', playerId: 'p1' }] as GameState['voterMarks'],
    });
    const after = offBoard({
      voterMarks: [
        { voterId: 'v1', playerId: 'p1' },
        { voterId: 'v1', playerId: 'p2' },
      ] as GameState['voterMarks'],
    });
    const info = describeOpponentAction(before, after);
    expect(info!.actorOwnerId).toBe('p2');
    expect(info!.voterId).toBe('v1');
  });

  it('reports a recruited Supporter → Rivals tab', () => {
    const before = offBoard();
    const after = offBoard();
    (after.players[1] as { supporters: string[] }).supporters = ['sup.klank'];
    const info = describeOpponentAction(before, after);
    expect(info!.tab).toBe('rivals');
    expect(info!.actorOwnerId).toBe('p2');
    expect(info!.caption).toBe('✦ Klank recruited a Supporter');
  });

  it('reports a taken Consumable → Rivals tab', () => {
    const before = offBoard();
    const after = offBoard();
    (after.players[1] as unknown as { vaultCards: string[] }).vaultCards = ['vault.x'];
    const info = describeOpponentAction(before, after);
    expect(info!.tab).toBe('rivals');
    expect(info!.caption).toBe('✦ Klank took a Consumable');
  });

  it('returns null for resource-only churn (nothing worth following)', () => {
    expect(describeOpponentAction(offBoard(), offBoard())).toBeNull();
  });
});
