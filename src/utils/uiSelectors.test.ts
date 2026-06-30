// visibleRoomSpaces: pool rooms (Great Hall's 10 identical slots) collapse
// to occupied seats + one open spot; normal rooms render every slot.
import { describe, expect, it } from 'vitest';
import { baseGamePack } from '../content/packs/base';
import type { GameState, PendingPrompt, Room } from '../game/types';
import {
  localOwnsCurrentDecision,
  smartCameraFocusTab,
  visibleRoomSpaces,
} from './uiSelectors';

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

// smartCameraFocusTab: which mobile tab the Smart Camera should jump to for the
// decision currently on top. Only `pendingResolutionStack` + `phase.kind` matter.
describe('smartCameraFocusTab', () => {
  const withPrompt = (prompt: PendingPrompt): GameState =>
    ({
      phase: { kind: 'errands', round: 1, activePlayerIndex: 0 },
      pendingResolutionStack: [{ id: 'r1', responderId: 'p1', prompt }],
    }) as unknown as GameState;

  it('routes a voter prompt (place a Mark) to the Council tab', () => {
    expect(
      smartCameraFocusTab(withPrompt({ kind: 'choose-voter', eligibleVoterIds: [] })),
    ).toBe('council');
  });

  it('routes Supporter and Vault drafts to the Offer/Tableau tab', () => {
    expect(
      smartCameraFocusTab(withPrompt({ kind: 'choose-supporter-card', eligibleCardIds: [] })),
    ).toBe('tableau');
    expect(
      smartCameraFocusTab(withPrompt({ kind: 'choose-vault-card', eligibleCardIds: [] })),
    ).toBe('tableau');
  });

  it('routes mage / action-space targeting to the Campus tab', () => {
    expect(
      smartCameraFocusTab(withPrompt({ kind: 'choose-target-mage', eligibleMageIds: [] })),
    ).toBe('campus');
    expect(
      smartCameraFocusTab(
        withPrompt({ kind: 'choose-target-action-space', eligibleSpaceIds: [] }),
      ),
    ).toBe('campus');
  });

  it('stays put (null) for self-contained option/confirm sheets', () => {
    expect(smartCameraFocusTab(withPrompt({ kind: 'choose-from-options', options: [] }))).toBeNull();
    expect(smartCameraFocusTab(withPrompt({ kind: 'confirm', message: 'x' }))).toBeNull();
  });

  it('with no prompt, an Errands turn points at the Campus board', () => {
    const s = {
      phase: { kind: 'errands', round: 1, activePlayerIndex: 0 },
      pendingResolutionStack: [],
    } as unknown as GameState;
    expect(smartCameraFocusTab(s)).toBe('campus');
  });

  it('with no prompt outside Errands, does not move (null)', () => {
    const s = {
      phase: { kind: 'round-setup', round: 1 },
      pendingResolutionStack: [],
    } as unknown as GameState;
    expect(smartCameraFocusTab(s)).toBeNull();
  });
});

// localOwnsCurrentDecision: whether the LOCAL seat is the one who must act now.
// The Smart Camera force-closes a drilled-in room only when this is FALSE, so
// the board (and the bot's move) is visible during someone else's turn.
describe('localOwnsCurrentDecision', () => {
  const players = [
    { id: 'p1', controlledByBot: false },
    { id: 'p2', controlledByBot: true },
  ];
  const errands = (activePlayerIndex: number): GameState =>
    ({
      phase: { kind: 'errands', round: 1, activePlayerIndex },
      players,
      pendingResolutionStack: [],
    }) as unknown as GameState;

  // Build a prompt-bearing state where the top prompt is owed by `responderId`.
  const owedTo = (responderId: string): GameState =>
    ({
      phase: { kind: 'errands', round: 1, activePlayerIndex: 1 },
      players,
      pendingResolutionStack: [
        { id: 'r1', responderId, prompt: { kind: 'confirm', message: 'x' } },
      ],
    }) as unknown as GameState;

  it("is true on the local seat's own Errands turn", () => {
    expect(localOwnsCurrentDecision(errands(0), 'p1')).toBe(true);
  });

  it("is false during a bot's Errands turn", () => {
    expect(localOwnsCurrentDecision(errands(1), 'p1')).toBe(false);
  });

  it('follows the top prompt: true when owed to the local seat', () => {
    expect(localOwnsCurrentDecision(owedTo('p1'), 'p1')).toBe(true);
  });

  it('follows the top prompt: false when owed to a bot, even on no errands turn', () => {
    expect(localOwnsCurrentDecision(owedTo('p2'), 'p1')).toBe(false);
  });

  it('is false in a between-turns phase (nothing for the human to decide)', () => {
    const s = {
      phase: { kind: 'resolution', round: 1 },
      players,
      pendingResolutionStack: [],
    } as unknown as GameState;
    expect(localOwnsCurrentDecision(s, 'p1')).toBe(false);
  });

  it('hot-seat (no bound seat) never force-closes: any active turn is "ours"', () => {
    expect(localOwnsCurrentDecision(errands(0), null)).toBe(true);
    expect(localOwnsCurrentDecision(errands(1), null)).toBe(true);
    const between = {
      phase: { kind: 'resolution', round: 1 },
      players,
      pendingResolutionStack: [],
    } as unknown as GameState;
    expect(localOwnsCurrentDecision(between, null)).toBe(false);
  });
});
