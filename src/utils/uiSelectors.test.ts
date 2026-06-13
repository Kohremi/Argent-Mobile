// visibleRoomSpaces: pool rooms (Great Hall's 10 identical slots) collapse
// to occupied seats + one open spot; normal rooms render every slot.
import { describe, expect, it } from 'vitest';
import { baseGamePack } from '../content/packs/base';
import type { Room } from '../game/types';
import { visibleRoomSpaces } from './uiSelectors';

const greatHall = (): Room =>
  JSON.parse(
    JSON.stringify(baseGamePack.rooms.find((r) => r.id === 'base.room.great-hall.a')!),
  ) as Room;

describe('visibleRoomSpaces', () => {
  it('empty Great Hall shows exactly one open seat', () => {
    const spaces = visibleRoomSpaces(greatHall());
    expect(spaces.length).toBe(1);
    expect(spaces[0]!.occupant).toBeNull();
  });

  it('a filling Great Hall shows its occupants plus the next open seat', () => {
    const room = greatHall();
    room.actionSpaces[0]!.occupant = { mageId: 'a', ownerId: 'p1', isShadowing: false };
    room.actionSpaces[1]!.occupant = { mageId: 'b', ownerId: 'p2', isShadowing: false };
    const spaces = visibleRoomSpaces(room);
    expect(spaces.length).toBe(3);
    expect(spaces[0]!.occupant?.mageId).toBe('a');
    expect(spaces[1]!.occupant?.mageId).toBe('b');
    expect(spaces[2]!.occupant).toBeNull();
  });

  it('a prompt-targeted open slot is the one open seat shown', () => {
    const room = greatHall();
    const deepSlot = room.actionSpaces[7]!;
    const spaces = visibleRoomSpaces(room, new Set([deepSlot.id]));
    // Exactly one open seat, and it's the targeted one (so it's clickable).
    expect(spaces.length).toBe(1);
    expect(spaces[0]!.id).toBe(deepSlot.id);
  });

  it('when many open slots are targeted, still shows only one open seat', () => {
    // The bug: an effect offering every open Great Hall slot as a target
    // used to expand the room to all of them. The pool slots are
    // interchangeable, so only one open seat should ever be visible.
    const room = greatHall();
    const allOpenIds = room.actionSpaces.map((s) => s.id);
    const spaces = visibleRoomSpaces(room, new Set(allOpenIds));
    expect(spaces.length).toBe(1);
    expect(spaces[0]!.occupant).toBeNull();
  });

  it('targeted open slots collapse to one even as the hall fills', () => {
    const room = greatHall();
    room.actionSpaces[0]!.occupant = { mageId: 'a', ownerId: 'p1', isShadowing: false };
    room.actionSpaces[1]!.occupant = { mageId: 'b', ownerId: 'p2', isShadowing: false };
    // Every remaining open slot is offered as a target.
    const openIds = room.actionSpaces.filter((s) => !s.occupant).map((s) => s.id);
    const spaces = visibleRoomSpaces(room, new Set(openIds));
    // Two occupants + exactly one open seat.
    expect(spaces.length).toBe(3);
    expect(spaces.filter((s) => !s.occupant).length).toBe(1);
  });

  it('non-uniform rooms render every slot (Council Chamber keeps its 5)', () => {
    const council = baseGamePack.rooms.find((r) => r.id === 'base.room.council-chamber.a')!;
    expect(visibleRoomSpaces(council).length).toBe(council.actionSpaces.length);
  });

  it('small rooms are never collapsed (Library keeps its 4)', () => {
    const library = baseGamePack.rooms.find((r) => r.id === 'base.room.library.a')!;
    expect(visibleRoomSpaces(library).length).toBe(library.actionSpaces.length);
  });
});
