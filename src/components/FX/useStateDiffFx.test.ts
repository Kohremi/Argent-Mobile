// Pure-function tests for the FX state-diff (no DOM needed): drives real
// engine transitions and asserts the implied room effects.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../../game/engine';
import type { GameState, OwnedMage } from '../../game/types';
import { computeRoomFx } from './useStateDiffFx';

function base(): GameState {
  const s = initGame({ activePackIds: ['base'], playerNames: ['Akko', 'Diana'], rngSeed: 7 });
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
}
const mk = (id: string, pid: string): OwnedMage => ({
  id, cardId: 'base.mage.neutral', color: 'off-white',
  location: { kind: 'office', playerId: pid }, isShadowing: false, isWounded: false,
});
/** Seats a mage on the first open slot; returns [state, roomId]. */
function seat(s: GameState, playerIdx: number, mageId: string): [GameState, string] {
  const room = s.rooms.find((r) => !r.cannotBePlacedInDirectly && r.actionSpaces.some((sp) => !sp.occupant))!;
  const slot = room.actionSpaces.find((sp) => !sp.occupant)!;
  const pid = s.players[playerIdx]!.id;
  const next: GameState = {
    ...s,
    players: s.players.map((p, i) =>
      i === playerIdx
        ? { ...p, mages: p.mages.map((m) => (m.id === mageId ? { ...m, location: { kind: 'action-space', spaceId: slot.id } } : m)) }
        : p,
    ),
    rooms: s.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((sp) =>
        sp.id === slot.id ? { ...sp, occupant: { mageId, ownerId: pid, isShadowing: false } } : sp,
      ),
    })),
  };
  return [next, room.id];
}

describe('computeRoomFx', () => {
  it('emits a wound flash in the room where the mage stood', () => {
    let s = base();
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, mages: [mk('v', p.id)] } : { ...p, resources: { ...p.resources, mana: 3 }, ownedSpells: [{ cardId: 'base.spell.burn', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false }] })) };
    const [seated, roomId] = seat(s, 1, 'v');
    // Real engine wound: cast Burn L1 at the victim, pass the reaction.
    let after = applyAction(seated, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: 'base.spell.burn', level: 1 });
    let top = after.pendingResolutionStack[after.pendingResolutionStack.length - 1]!;
    after = applyAction(after, { type: 'RESOLVE_PENDING', resolutionId: top.id, answer: { kind: 'mage-chosen', mageId: 'v' } });
    top = after.pendingResolutionStack[after.pendingResolutionStack.length - 1]!;
    after = applyAction(after, { type: 'RESOLVE_PENDING', resolutionId: top.id, answer: { kind: 'reaction-passed' } });
    expect(computeRoomFx(seated, after)).toContainEqual({ roomId, kind: 'wound' });
  });

  it('emits a flip sweep when a room swaps to its other side', () => {
    const s = base();
    const room = s.rooms.find((r) => r.id.endsWith('.a') && !r.isUniversityCentral)!;
    const oppId = `${room.id.slice(0, -2)}.b`;
    const flipped: GameState = {
      ...s,
      rooms: s.rooms.map((r) => (r.id === room.id ? { ...r, id: oppId, side: 'B' as const } : r)),
    };
    expect(computeRoomFx(s, flipped)).toContainEqual({ roomId: oppId, kind: 'flip' });
  });

  it('emits a banish ring when a placed mage returns to the office unwounded', () => {
    let s = base();
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, mages: [mk('b', p.id)] } : p)) };
    const [seated, roomId] = seat(s, 1, 'b');
    const bounced: GameState = {
      ...seated,
      players: seated.players.map((p, i) =>
        i === 1 ? { ...p, mages: p.mages.map((m) => ({ ...m, location: { kind: 'office', playerId: p.id } })) } : p,
      ),
    };
    expect(computeRoomFx(seated, bounced)).toContainEqual({ roomId, kind: 'banish' });
  });
});
