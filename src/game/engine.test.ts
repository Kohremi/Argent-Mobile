import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { baseGamePack } from '../content/packs/base';
import type {
  GameConfig,
  GamePhase,
  GameState,
  MageColor,
  OwnedMage,
  OwnedSpell,
  Player,
  Room,
} from './types';

const FOUR_PLAYER_CONFIG: GameConfig = {
  activePackIds: ['base'],
  playerNames: ['Alice', 'Bob', 'Cara', 'Dan'],
  rngSeed: 12345,
};

function advance(state: GameState): GameState {
  return applyAction(state, { type: 'ADVANCE_PHASE' });
}

/** Forces the round to end on the next ADVANCE by emptying the bell tower. */
function emptyBellTower(state: GameState): GameState {
  return {
    ...state,
    bellTower: { ...state.bellTower, available: [] },
  };
}

describe('initGame', () => {
  it('produces phase round-setup at round 1', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    expect(s.phase).toEqual({ kind: 'round-setup', round: 1 });
  });

  it('seats 4 players with stable initiative order', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    expect(s.players).toHaveLength(4);
    expect(s.players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Cara', 'Dan']);
    expect(s.players.map((p) => p.initiativeOrder)).toEqual([1, 2, 3, 4]);
  });

  it('places exactly 12 voters: 2 always-face-up + 10 face-down', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    expect(s.voters).toHaveLength(12);
    expect(s.voters.filter((v) => v.isAlwaysFaceUp)).toHaveLength(2);
    expect(s.voters.filter((v) => v.revealed)).toHaveLength(2);
    expect(s.voters.filter((v) => !v.revealed)).toHaveLength(10);
  });

  it('includes all 3 University Central rooms in play', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    const ucRooms = s.rooms.filter((r) => r.isUniversityCentral);
    expect(ucRooms).toHaveLength(3);
    const ucNames = ucRooms.map((r) => r.name).sort();
    expect(ucNames).toEqual(['Council Chamber', 'Infirmary', 'Library']);
  });

  it('filters bell tower cards by player count threshold', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    // 4p means cards with minPlayers <= 4: i.e., 4 of the 5 stub cards.
    expect(s.bellTower.available).toHaveLength(4);
    expect(s.bellTower.available.every((c) => c.minPlayers <= 4)).toBe(true);
  });
});

describe('phase machine', () => {
  it('transitions round-setup → errands on first advance', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    s = advance(s);
    expect(s.phase.kind).toBe('errands');
    if (s.phase.kind === 'errands') {
      expect(s.phase.round).toBe(1);
      expect(s.phase.activePlayerIndex).toBe(s.firstPlayerIndex);
    }
  });

  it('errands → resolution when bell tower is empty', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    s = advance(s); // round-setup → errands
    expect(s.phase.kind).toBe('errands');
    s = emptyBellTower(s);
    s = advance(s);
    expect(s.phase.kind).toBe('resolution');
  });

  it('errands stays in errands when bell tower is non-empty (turn passes)', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    s = advance(s); // → errands
    expect(s.phase.kind).toBe('errands');
    if (s.phase.kind !== 'errands') return;
    const startingTurn = s.phase.activePlayerIndex;
    s = advance(s); // turn pass
    expect(s.phase.kind).toBe('errands');
    if (s.phase.kind !== 'errands') return;
    expect(s.phase.activePlayerIndex).toBe((startingTurn + 1) % 4);
  });

  it('resolution → mid-game-scoring with no occupied spaces', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    s = advance(s); // → errands
    s = emptyBellTower(s);
    s = advance(s); // → resolution
    s = advance(s); // → mid-game-scoring
    expect(s.phase.kind).toBe('mid-game-scoring');
  });

  it('drives 5 rounds end-to-end and lands at complete', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    const phaseSequence: GamePhase['kind'][] = [s.phase.kind];

    for (let r = 1; r <= 5; r++) {
      // round-setup → errands
      s = advance(s);
      expect(s.phase.kind).toBe('errands');
      if (s.phase.kind === 'errands') expect(s.phase.round).toBe(r);
      phaseSequence.push(s.phase.kind);

      // Skip the action phase by emptying the bell tower.
      s = emptyBellTower(s);

      // errands → resolution
      s = advance(s);
      expect(s.phase.kind).toBe('resolution');
      phaseSequence.push(s.phase.kind);

      // resolution → mid-game-scoring (rooms have no occupants → one step)
      s = advance(s);
      expect(s.phase.kind).toBe('mid-game-scoring');
      phaseSequence.push(s.phase.kind);

      // mid-game-scoring → next round-setup OR complete
      s = advance(s);
      if (r < 5) {
        expect(s.phase.kind).toBe('round-setup');
        if (s.phase.kind === 'round-setup') expect(s.phase.round).toBe(r + 1);
      } else {
        expect(s.phase.kind).toBe('complete');
      }
      phaseSequence.push(s.phase.kind);
    }

    expect(s.phase.kind).toBe('complete');
    if (s.phase.kind === 'complete') {
      // No actions ever taken → no scoring criterion has a non-zero leader.
      expect(s.phase.archmage).toBeNull();
    }

    // All voters should be revealed at the end.
    expect(s.voters.every((v) => v.revealed)).toBe(true);
  });

  it('advances on complete are no-ops', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    // Drive to complete.
    for (let r = 1; r <= 5; r++) {
      s = advance(s); // → errands
      s = emptyBellTower(s);
      s = advance(s); // → resolution
      s = advance(s); // → mid-game-scoring
      s = advance(s); // → next round-setup or complete
    }
    expect(s.phase.kind).toBe('complete');
    const before = s;
    s = advance(s);
    expect(s).toBe(before);
  });
});

describe('round-setup refresh logic', () => {
  it('round 2 refreshes player merit badges spent', () => {
    let s = initGame(FOUR_PLAYER_CONFIG);
    // Mutate first player to have spent merit badges.
    const players = s.players.map((p, i) =>
      i === 0
        ? {
            ...p,
            resources: { ...p.resources, meritBadges: 0, meritBadgesSpent: 2 },
          }
        : p,
    );
    s = { ...s, players };

    // Drive through round 1 to round-setup of round 2.
    s = advance(s); // → errands round 1
    s = emptyBellTower(s);
    s = advance(s); // → resolution
    s = advance(s); // → mid-game-scoring
    s = advance(s); // → round-setup round 2
    expect(s.phase).toEqual({ kind: 'round-setup', round: 2 });

    // Now advance into round 2 errands — refresh runs at this transition.
    s = advance(s);
    expect(s.players[0]?.resources.meritBadges).toBe(2);
    expect(s.players[0]?.resources.meritBadgesSpent).toBe(0);
  });
});

describe('determinism', () => {
  it('two games with the same seed produce identical state', () => {
    const a = initGame(FOUR_PLAYER_CONFIG);
    const b = initGame(FOUR_PLAYER_CONFIG);
    expect(b).toEqual(a);
  });

  it('two games with the same seed produce identical phase sequences', () => {
    const drive = (): GamePhase['kind'][] => {
      let s = initGame(FOUR_PLAYER_CONFIG);
      const seq: GamePhase['kind'][] = [s.phase.kind];
      for (let r = 1; r <= 5; r++) {
        s = advance(s);
        seq.push(s.phase.kind);
        s = emptyBellTower(s);
        s = advance(s);
        seq.push(s.phase.kind);
        s = advance(s);
        seq.push(s.phase.kind);
        s = advance(s);
        seq.push(s.phase.kind);
      }
      return seq;
    };
    expect(drive()).toEqual(drive());
  });

  it('different seeds produce different voter draws', () => {
    // Room layout is deterministic now (every room from the pack is always
    // included on side A), but voter draws still pull from the seeded RNG.
    const a = initGame({ ...FOUR_PLAYER_CONFIG, rngSeed: 1 });
    const b = initGame({ ...FOUR_PLAYER_CONFIG, rngSeed: 2 });
    const aIds = a.voters.map((v) => v.id).join(',');
    const bIds = b.voters.map((v) => v.id).join(',');
    expect(aIds).not.toEqual(bIds);
  });
});

describe('Room layout', () => {
  it('seats every side-A room from the room file at game start', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    const expectedSideARoomIds = [
      'base.room.council-chamber.a',
      'base.room.library.a',
      'base.room.infirmary.a',
      'base.room.training-fields.a',
      'base.room.courtyard.a',
      'base.room.catacombs.a',
      'base.room.guilds.a',
      'base.room.vault.a',
    ];
    const actualIds = s.rooms.map((r) => r.id).sort();
    expect(actualIds).toEqual([...expectedSideARoomIds].sort());
    // Every room is on side A (B sides are stubs).
    expect(s.rooms.every((r) => r.side === 'A')).toBe(true);
  });

  it('every actionable slot has a description', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    for (const room of s.rooms) {
      // Infirmary's instant-room behavior lives at the room level; its
      // slot list is intentionally empty.
      if (room.cannotBePlacedInDirectly) continue;
      for (const slot of room.actionSpaces) {
        expect(slot.description, `${slot.id} missing description`).toBeTruthy();
      }
    }
  });

  it('Infirmary carries the on-wound description at the room level', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    const infirmary = s.rooms.find((r) => r.name === 'Infirmary');
    expect(infirmary?.description).toMatch(/wounded mages move here/i);
  });
});

// ============================================================================
// Candidate draft
// ============================================================================

describe('Candidate draft', () => {
  const DRAFT_CONFIG_4P: GameConfig = {
    activePackIds: ['base'],
    playerNames: ['Alice', 'Bob', 'Cara', 'Dan'],
    rngSeed: 42,
    useCandidateDraft: true,
  };

  function withFirstPlayer(state: GameState, idx: number): GameState {
    if (state.phase.kind !== 'candidate-draft') return state;
    return {
      ...state,
      firstPlayerIndex: idx,
      phase: { kind: 'candidate-draft', activePlayerIndex: idx },
    };
  }

  it('useCandidateDraft seats the game in candidate-draft phase', () => {
    const s = initGame(DRAFT_CONFIG_4P);
    expect(s.phase.kind).toBe('candidate-draft');
    if (s.phase.kind === 'candidate-draft') {
      expect(s.phase.activePlayerIndex).toBe(s.firstPlayerIndex);
    }
    // No mages or starter spell yet — those come from CHOOSE_CANDIDATE.
    expect(s.players.every((p) => p.candidateId === '')).toBe(true);
    expect(s.players.every((p) => p.mages.length === 0)).toBe(true);
  });

  it('CHOOSE_CANDIDATE grants 2 leader mages + 3 neutral + starter spell (4p)', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.larimore-burman',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.candidateId).toBe('base.candidate.larimore-burman');
    expect(alice?.candidateStartingSpellId).toBe('base.spell.flash-of-light');
    expect(alice?.mages).toHaveLength(5); // 2 red + 3 neutral
    const reds = alice?.mages.filter((m) => m.color === 'red') ?? [];
    const neutrals = alice?.mages.filter((m) => m.color === 'off-white') ?? [];
    expect(reds).toHaveLength(2);
    expect(neutrals).toHaveLength(3);
    expect(alice?.ownedSpells).toEqual([
      {
        cardId: 'base.spell.flash-of-light',
        intPlaced: true,
        wisPlacedLevel2: false,
        wisPlacedLevel3: false,
        exhausted: false,
      },
    ]);
  });

  it('CHOOSE_CANDIDATE grants 7 mages total in 2-player games', () => {
    let s = initGame({
      activePackIds: ['base'],
      playerNames: ['Alice', 'Bob'],
      rngSeed: 7,
      useCandidateDraft: true,
    });
    s = withFirstPlayer(s, 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.larimore-burman',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.mages).toHaveLength(7); // 2 red + 5 neutral
    expect(alice?.mages.filter((m) => m.color === 'red')).toHaveLength(2);
    expect(alice?.mages.filter((m) => m.color === 'off-white')).toHaveLength(5);
  });

  it('Trias Blackwind starts with all off-white mages and +1 MB', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.trias-blackwind',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.mages.every((m) => m.color === 'off-white')).toBe(true);
    expect(alice?.mages).toHaveLength(5);
    expect(alice?.resources.meritBadges).toBe(1);
    expect(alice?.candidateStartingSpellId).toBe('base.spell.living-image');
  });

  it('rejects picking the same candidate twice', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.larimore-burman',
    });
    expect(() =>
      applyAction(s, {
        type: 'CHOOSE_CANDIDATE',
        playerId: 'p2',
        candidateId: 'base.candidate.larimore-burman',
      }),
    ).toThrow(/already taken/);
  });

  it('rejects picking out of turn', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    expect(() =>
      applyAction(s, {
        type: 'CHOOSE_CANDIDATE',
        playerId: 'p2', // not the active player
        candidateId: 'base.candidate.byron-krane',
      }),
    ).toThrow(/not your turn/);
  });

  it('transitions to round-setup once every player has picked', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    const picks = [
      { p: 'p1', c: 'base.candidate.larimore-burman' },
      { p: 'p2', c: 'base.candidate.byron-krane' },
      { p: 'p3', c: 'base.candidate.rheye-cal' },
      { p: 'p4', c: 'base.candidate.exhufern-le-marigras' },
    ];
    for (const pick of picks) {
      s = applyAction(s, {
        type: 'CHOOSE_CANDIDATE',
        playerId: pick.p,
        candidateId: pick.c,
      });
    }
    expect(s.phase).toEqual({ kind: 'round-setup', round: 1 });
    expect(s.players.every((p) => p.candidateId !== '')).toBe(true);
    expect(s.players.every((p) => p.mages.length === 5)).toBe(true);
  });

  it('rejects ADVANCE_PHASE during candidate-draft', () => {
    const s = initGame(DRAFT_CONFIG_4P);
    expect(() => applyAction(s, { type: 'ADVANCE_PHASE' })).toThrow(
      /candidate-draft must end via CHOOSE_CANDIDATE/,
    );
  });

  it('Xal Ezra is now in base, Lavanina is now in Mancers', () => {
    const s = initGame(DRAFT_CONFIG_4P);
    s; // silence unused
    // Reach into the base pack via lookup helper indirectly: we know the
    // candidate ids should resolve.
    let s1 = withFirstPlayer(initGame(DRAFT_CONFIG_4P), 0);
    s1 = applyAction(s1, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.xal-ezra',
    });
    expect(s1.players[0]?.candidateStartingSpellId).toBe(
      'base.spell.paralocation',
    );
    // Lavanina lives in Mancers now — base alone doesn't expose her.
    expect(() =>
      applyAction(withFirstPlayer(initGame(DRAFT_CONFIG_4P), 0), {
        type: 'CHOOSE_CANDIDATE',
        playerId: 'p1',
        candidateId: 'base.candidate.lavanina',
      }),
    ).toThrow(/not in active packs/);
  });
});

// ============================================================================
// Test helpers for vertical slices
// ============================================================================

const TWO_PLAYER_CONFIG: GameConfig = {
  activePackIds: ['base'],
  playerNames: ['Alice', 'Bob'],
  rngSeed: 7777,
};

/** Replaces the in-play Library room with the canonical Library A from base. */
function forceLibrarySideA(state: GameState): GameState {
  const libraryA = baseGamePack.rooms.find(
    (r) => r.name === 'Library' && r.side === 'A',
  );
  if (!libraryA) throw new Error('test helper: Library A not in base pack');
  return {
    ...state,
    rooms: state.rooms.map((r) => (r.name === 'Library' ? libraryA : r)),
  };
}

/**
 * Ensures Vault side A is in the in-play rooms. If Vault is already there
 * (any side), it's swapped for side A; otherwise the first non-UC room is
 * replaced with Vault A.
 */
function forceVaultSideA(state: GameState): GameState {
  const vaultA = baseGamePack.rooms.find(
    (r) => r.name === 'Vault' && r.side === 'A',
  );
  if (!vaultA) throw new Error('test helper: Vault A not in base pack');
  const existingIdx = state.rooms.findIndex((r) => r.name === 'Vault');
  if (existingIdx !== -1) {
    return {
      ...state,
      rooms: state.rooms.map((r, i) => (i === existingIdx ? vaultA : r)),
    };
  }
  const replaceIdx = state.rooms.findIndex((r) => !r.isUniversityCentral);
  if (replaceIdx === -1) return state;
  return {
    ...state,
    rooms: state.rooms.map((r, i) => (i === replaceIdx ? vaultA : r)),
  };
}

function setVaultTableau(state: GameState, cardIds: string[]): GameState {
  return { ...state, vaultTableau: cardIds };
}

function forceRoomSide(
  state: GameState,
  roomName: string,
  side: 'A' | 'B',
): GameState {
  const target = baseGamePack.rooms.find(
    (r) => r.name === roomName && r.side === side,
  );
  if (!target) {
    throw new Error(`test helper: ${roomName} side ${side} not in base pack`);
  }
  const existingIdx = state.rooms.findIndex((r) => r.name === roomName);
  if (existingIdx !== -1) {
    return {
      ...state,
      rooms: state.rooms.map((r, i) => (i === existingIdx ? target : r)),
    };
  }
  const replaceIdx = state.rooms.findIndex((r) => !r.isUniversityCentral);
  if (replaceIdx === -1) return state;
  return {
    ...state,
    rooms: state.rooms.map((r, i) => (i === replaceIdx ? target : r)),
  };
}

function setMeritBadges(
  state: GameState,
  playerId: string,
  count: number,
): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    resources: { ...p.resources, meritBadges: count },
  }));
}

function setGold(state: GameState, playerId: string, gold: number): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    resources: { ...p.resources, gold },
  }));
}

function findRoom(state: GameState, predicate: (r: Room) => boolean): Room {
  const r = state.rooms.find(predicate);
  if (!r) throw new Error('test helper: room not found');
  return r;
}

function addMage(
  state: GameState,
  playerId: string,
  mage: Pick<OwnedMage, 'id' | 'cardId' | 'color'>,
): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    mages: [
      ...p.mages,
      {
        id: mage.id,
        cardId: mage.cardId,
        color: mage.color,
        location: { kind: 'office', playerId: p.id },
        isShadowing: false,
        isWounded: false,
      },
    ],
  }));
}

function placeMageOnSpace(
  state: GameState,
  playerId: string,
  mageId: string,
  spaceId: string,
): GameState {
  const updated = mapPlayer(state, playerId, (p) => ({
    ...p,
    mages: p.mages.map((m) =>
      m.id !== mageId
        ? m
        : { ...m, location: { kind: 'action-space', spaceId } },
    ),
  }));
  return {
    ...updated,
    rooms: updated.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId
          ? s
          : { ...s, occupant: { mageId, ownerId: playerId, isShadowing: false } },
      ),
    })),
  };
}

function addOwnedSpell(
  state: GameState,
  playerId: string,
  cardId: string,
  partial: Partial<OwnedSpell> = {},
): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    ownedSpells: [
      ...p.ownedSpells,
      {
        cardId,
        intPlaced: true,
        wisPlacedLevel2: false,
        wisPlacedLevel3: false,
        exhausted: false,
        ...partial,
      },
    ],
  }));
}

function addVaultCard(state: GameState, playerId: string, cardId: string): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
  }));
}

function setMana(state: GameState, playerId: string, mana: number): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    resources: { ...p.resources, mana },
  }));
}

function mapPlayer(
  state: GameState,
  playerId: string,
  fn: (p: Player) => Player,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? fn(p) : p)),
  };
}

function topPending(state: GameState) {
  const t = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  if (!t) throw new Error('expected a pending resolution but stack is empty');
  return t;
}

function findMageById(state: GameState, mageId: string): OwnedMage {
  for (const p of state.players) {
    const m = p.mages.find((x) => x.id === mageId);
    if (m) return m;
  }
  throw new Error(`mage ${mageId} not found`);
}

// ============================================================================
// Vertical Slice 1 — Library A slot 4 (OR-choice: INT / WIS / Research)
// ============================================================================

describe('Library A slot 4 vertical slice', () => {
  function setupLibraryTest(): GameState {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceLibrarySideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    // Place Alice's mage on Library A slot 4 directly. Skipping PLACE_WORKER
    // here keeps this test focused on the resolution-phase path; PLACE_WORKER
    // is exercised in its own test below.
    s = placeMageOnSpace(s, 'p1', 'alice-mage-1', 'base.room.library.a.slot-4');
    // Drain the bell tower so errands ends as soon as we advance.
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    return s;
  }

  function driveToLibraryPrompt(state: GameState): GameState {
    let s = state;
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution (bell empty)
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // resolution pump → Library effect → pause
    return s;
  }

  it('initial setup places mage on slot and seats Library A', () => {
    const s = setupLibraryTest();
    const library = findRoom(s, (r) => r.name === 'Library');
    expect(library.side).toBe('A');
    expect(library.actionSpaces).toHaveLength(4);
    expect(library.actionSpaces[3]?.occupant?.ownerId).toBe('p1');
  });

  it('resolution surfaces the 3-way choice prompt', () => {
    const s = driveToLibraryPrompt(setupLibraryTest());
    expect(s.phase.kind).toBe('resolution');
    expect(s.pendingResolutionStack).toHaveLength(1);
    const top = topPending(s);
    expect(top.responderId).toBe('p1');
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.id).sort()).toEqual([
        'int',
        'research',
        'wis',
      ]);
    }
  });

  it('choosing INT grants 1 INT and returns mage to office', () => {
    let s = driveToLibraryPrompt(setupLibraryTest());
    const top = topPending(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'int', payload: { resource: 'intelligence' } },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.intelligence).toBe(1);
    expect(alice?.resources.wisdom).toBe(0);
    expect(s.pendingResolutionStack).toHaveLength(0);
    // Mage returned to office.
    const aliceMage = findMageById(s, 'alice-mage-1');
    expect(aliceMage.location).toEqual({ kind: 'office', playerId: 'p1' });
    // Pointer advanced past the Library slot.
    if (s.phase.kind === 'resolution') {
      const room = findRoom(s, (r) => r.name === 'Library');
      const slot = room.actionSpaces[3];
      expect(slot?.occupant).toBeNull();
    }
  });

  it('choosing WIS grants 1 WIS', () => {
    let s = driveToLibraryPrompt(setupLibraryTest());
    const top = topPending(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'wis', payload: { resource: 'wisdom' } },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.wisdom).toBe(1);
    expect(alice?.resources.intelligence).toBe(0);
  });

  it('choosing Research spawns a follow-up prompt', () => {
    let s = driveToLibraryPrompt(setupLibraryTest());
    const top = topPending(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'research', payload: { resource: 'research' } },
    });
    expect(s.pendingResolutionStack).toHaveLength(1);
    const followup = topPending(s);
    expect(followup.prompt.kind).toBe('choose-from-options');
    if (followup.prompt.kind === 'choose-from-options') {
      expect(followup.prompt.options.map((o) => o.id).sort()).toEqual([
        'discard',
        'spend',
      ]);
    }
  });

  it('serializes mid-resolution and resumes to identical end state', () => {
    const before = driveToLibraryPrompt(setupLibraryTest());
    // Round-trip the paused state through JSON.
    const round: GameState = JSON.parse(JSON.stringify(before)) as GameState;
    expect(round).toEqual(before);

    const top = topPending(round);
    const resumedRound = applyAction(round, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'int', payload: { resource: 'intelligence' } },
    });
    const resumedDirect = applyAction(before, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'int', payload: { resource: 'intelligence' } },
    });
    expect(resumedRound).toEqual(resumedDirect);
  });
});

// ============================================================================
// Vertical Slice 2 — Burn L1 + Phase Steppers reaction
// ============================================================================

describe('Burn L1 + Phase Steppers vertical slice', () => {
  // Bob's mage occupies Library A slot 1 in this setup so we have a target on
  // a real space. Color is configurable so we can exercise filter rules.
  function setupBurnTest(opts: {
    bobColor?: MageColor;
    bobHasPhaseSteppers?: boolean;
  } = {}): GameState {
    const bobColor = opts.bobColor ?? 'red';
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceLibrarySideA(s);

    // Alice's caster mage in office (color irrelevant for L1 cast).
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMana(s, 'p1', 5);
    s = addOwnedSpell(s, 'p1', 'base.spell.burn');

    // Bob's mage placed on a space.
    s = addMage(s, 'p2', {
      id: 'bob-mage-1',
      cardId: `base.mage.${bobColor === 'off-white' ? 'neutral' : bobColor}`,
      color: bobColor,
    });
    s = placeMageOnSpace(s, 'p2', 'bob-mage-1', 'base.room.library.a.slot-1');

    if (opts.bobHasPhaseSteppers) {
      s = addVaultCard(s, 'p2', 'base.vault.phase-steppers');
    }

    // Force errands phase with Alice as the active player. firstPlayerIndex
    // is randomized in setup; lock it down here for determinism.
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    return s;
  }

  it('cast surfaces a target prompt with eligible mages', () => {
    let s = setupBurnTest();
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-target-mage');
    if (top.prompt.kind === 'choose-target-mage') {
      expect(top.prompt.eligibleMageIds).toEqual(['bob-mage-1']);
    }
    // Mana spent, spell exhausted.
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.mana).toBe(4);
    expect(alice?.ownedSpells[0]?.exhausted).toBe(true);
  });

  it('green mages are filtered out of eligible targets', () => {
    let s = setupBurnTest({ bobColor: 'green' });
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    // No legal target → spell fizzles, no prompt produced.
    expect(s.pendingResolutionStack).toHaveLength(0);
  });

  it('opposing blue mages are filtered out (Divinity immune)', () => {
    let s = setupBurnTest({ bobColor: 'blue' });
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    expect(s.pendingResolutionStack).toHaveLength(0);
  });

  it('caster can target their own blue mage (immunity is to RIVAL spells)', () => {
    let s = setupBurnTest({ bobColor: 'red' }); // Bob keeps red here
    // Add a second blue mage owned by Alice on another space.
    const otherSpaceId = 'base.room.library.a.slot-1';
    // Move Bob's mage out so Alice can own this slot.
    s = mapPlayer(s, 'p2', (p) => ({
      ...p,
      mages: p.mages.map((m) =>
        m.id !== 'bob-mage-1' ? m : { ...m, location: { kind: 'office', playerId: 'p2' } },
      ),
    }));
    s = {
      ...s,
      rooms: s.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((sp) =>
          sp.id !== otherSpaceId ? sp : { ...sp, occupant: null },
        ),
      })),
    };
    s = addMage(s, 'p1', {
      id: 'alice-blue',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = placeMageOnSpace(s, 'p1', 'alice-blue', otherSpaceId);
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    const top = topPending(s);
    if (top.prompt.kind === 'choose-target-mage') {
      // Alice's own blue mage IS eligible.
      expect(top.prompt.eligibleMageIds).toContain('alice-blue');
    } else {
      throw new Error('expected choose-target-mage prompt');
    }
  });

  it('picking target wounds mage and opens reaction window for Bob', () => {
    let s = setupBurnTest();
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    const targetPrompt = topPending(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: targetPrompt.id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage-1' },
    });
    // Bob's mage is wounded and in the infirmary.
    const bobMage = findMageById(s, 'bob-mage-1');
    expect(bobMage.isWounded).toBe(true);
    expect(bobMage.location.kind).toBe('infirmary');
    // Reaction window is open with Bob as responder.
    expect(s.activeReactionWindows).toHaveLength(1);
    const reactionPrompt = topPending(s);
    expect(reactionPrompt.prompt.kind).toBe('reaction-window');
    expect(reactionPrompt.responderId).toBe('p2');
  });

  it('passing the reaction leaves the wound and prompts for the Infirmary bonus', () => {
    let s = setupBurnTest();
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage-1' },
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'reaction-passed' },
    });
    // Reaction window closed; Bob now picks the Infirmary bonus.
    expect(s.activeReactionWindows).toHaveLength(0);
    const bonusPrompt = topPending(s);
    expect(bonusPrompt.responderId).toBe('p2');
    expect(bonusPrompt.prompt.kind).toBe('choose-from-options');
    if (bonusPrompt.prompt.kind === 'choose-from-options') {
      expect(bonusPrompt.prompt.options.map((o) => o.id).sort()).toEqual([
        'gold',
        'ip',
        'mana',
      ]);
    }
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: bonusPrompt.id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    expect(s.pendingResolutionStack).toHaveLength(0);
    const bobMage = findMageById(s, 'bob-mage-1');
    expect(bobMage.isWounded).toBe(true);
    expect(bobMage.location.kind).toBe('infirmary');
    // Bonus applied to Bob (the wounded player).
    expect(s.players.find((p) => p.id === 'p2')?.resources.gold).toBe(2);
  });

  it('Phase Steppers reverses the wound and discards the card', () => {
    let s = setupBurnTest({ bobHasPhaseSteppers: true });
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage-1' },
    });
    const reactionPrompt = topPending(s);
    expect(reactionPrompt.prompt.kind).toBe('reaction-window');
    if (reactionPrompt.prompt.kind === 'reaction-window') {
      expect(reactionPrompt.prompt.reactionOptions).toHaveLength(1);
      expect(reactionPrompt.prompt.reactionOptions[0]?.sourceId).toBe(
        'base.vault.phase-steppers',
      );
    }
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: reactionPrompt.id,
      answer: {
        kind: 'reaction-played',
        effectId: 'base.vault.phase-steppers.react',
        reactionContext: {},
      },
    });

    // Mage un-wounded, shadowing the original slot.
    const bobMage = findMageById(s, 'bob-mage-1');
    expect(bobMage.isWounded).toBe(false);
    expect(bobMage.isShadowing).toBe(true);
    expect(bobMage.location).toEqual({
      kind: 'action-space',
      spaceId: 'base.room.library.a.slot-1',
    });

    // Phase Steppers in personal discard.
    const bob = s.players.find((p) => p.id === 'p2');
    expect(bob?.vaultCards).toHaveLength(0);
    expect(bob?.personalDiscard).toEqual([
      { kind: 'consumable', cardId: 'base.vault.phase-steppers' },
    ]);

    // Window closed; no further reaction triggered (reactions can't be reacted to).
    expect(s.activeReactionWindows).toHaveLength(0);
    expect(s.pendingResolutionStack).toHaveLength(0);
  });

  it('serializes mid-reaction-window and resumes to identical end state', () => {
    let s = setupBurnTest({ bobHasPhaseSteppers: true });
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage-1' },
    });
    expect(s.pendingResolutionStack).toHaveLength(1);
    expect(s.activeReactionWindows).toHaveLength(1);

    const before = s;
    const roundtripped: GameState = JSON.parse(JSON.stringify(before)) as GameState;
    expect(roundtripped).toEqual(before);

    const reactionId = topPending(roundtripped).id;
    const fromRound = applyAction(roundtripped, {
      type: 'RESOLVE_PENDING',
      resolutionId: reactionId,
      answer: {
        kind: 'reaction-played',
        effectId: 'base.vault.phase-steppers.react',
        reactionContext: {},
      },
    });
    const fromDirect = applyAction(before, {
      type: 'RESOLVE_PENDING',
      resolutionId: reactionId,
      answer: {
        kind: 'reaction-played',
        effectId: 'base.vault.phase-steppers.react',
        reactionContext: {},
      },
    });
    expect(fromRound).toEqual(fromDirect);
  });
});

// ============================================================================
// PLACE_WORKER smoke test
// ============================================================================

describe('PLACE_WORKER', () => {
  it('moves a mage from office to a regular slot and sets occupant', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceLibrarySideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.library.a.slot-4',
    });
    const aliceMage = findMageById(s, 'alice-mage-1');
    expect(aliceMage.location).toEqual({
      kind: 'action-space',
      spaceId: 'base.room.library.a.slot-4',
    });
    const lib = findRoom(s, (r) => r.name === 'Library');
    expect(lib.actionSpaces[3]?.occupant).toEqual({
      mageId: 'alice-mage-1',
      ownerId: 'p1',
      isShadowing: false,
    });
  });

  it('rejects placement on a Mage not in office', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceLibrarySideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = placeMageOnSpace(s, 'p1', 'alice-mage-1', 'base.room.library.a.slot-1');
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    expect(() =>
      applyAction(s, {
        type: 'PLACE_WORKER',
        playerId: 'p1',
        mageId: 'alice-mage-1',
        actionSpaceId: 'base.room.library.a.slot-1',
      }),
    ).toThrow(/not in office/);
  });

  it('rejects placement on a merit slot without enough Merit Badges', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 0);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    expect(() =>
      applyAction(s, {
        type: 'PLACE_WORKER',
        playerId: 'p1',
        mageId: 'alice-mage-1',
        actionSpaceId: 'base.room.vault.a.slot-1',
      }),
    ).toThrow(/insufficient Merit Badges/);
  });

  it('places on a merit slot when MB available, paying the cost', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 2);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.vault.a.slot-1',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.meritBadges).toBe(1);
    expect(alice?.resources.meritBadgesSpent).toBe(1);
    const vault = findRoom(s, (r) => r.name === 'Vault');
    expect(vault.actionSpaces[0]?.occupant?.mageId).toBe('alice-mage-1');
  });

  it('rejects placement directly into the Infirmary', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    const infirmary = s.rooms.find((r) => r.name === 'Infirmary');
    if (!infirmary) throw new Error('Infirmary missing from setup');
    // Synthesize a slot id (action spaces are stubbed, so fake one to test
    // the cannotBePlacedInDirectly guard via a forced space id on the room).
    const fakeSpaceId = `${infirmary.id}.fake-slot`;
    const synthetic: GameState = {
      ...s,
      rooms: s.rooms.map((r) =>
        r.id !== infirmary.id
          ? r
          : {
              ...r,
              actionSpaces: [
                {
                  id: fakeSpaceId,
                  roomId: r.id,
                  index: 0,
                  slotType: 'regular',
                  occupant: null,
                  effectId: 'noop',
                },
              ],
            },
      ),
    };
    expect(() =>
      applyAction(synthetic, {
        type: 'PLACE_WORKER',
        playerId: 'p1',
        mageId: 'alice-mage-1',
        actionSpaceId: fakeSpaceId,
      }),
    ).toThrow(/cannot be placed in directly/);
  });
});

// ============================================================================
// Vertical Slice 3a — Vault A (per the room file)
// ============================================================================

function setupVaultSlotTest(slotId: string): GameState {
  let s = initGame(TWO_PLAYER_CONFIG);
  s = forceVaultSideA(s);
  s = addMage(s, 'p1', {
    id: 'alice-mage-1',
    cardId: 'base.mage.divinity',
    color: 'blue',
  });
  s = placeMageOnSpace(s, 'p1', 'alice-mage-1', slotId);
  s = setVaultTableau(s, [
    'base.vault.placeholder-treasure-1',
    'base.vault.placeholder-treasure-2',
    'base.vault.phase-steppers',
  ]);
  s = { ...s, bellTower: { ...s.bellTower, available: [] } };
  return s;
}

function driveToVaultPrompt(state: GameState): GameState {
  let s = state;
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → slot effect
  return s;
}

describe('Vault A slot 3 (Gain 3 Gold)', () => {
  it('grants 3 gold with no prompt', () => {
    let s = setupVaultSlotTest('base.room.vault.a.slot-3');
    s = setGold(s, 'p1', 0);
    s = driveToVaultPrompt(s);
    expect(s.pendingResolutionStack).toHaveLength(0);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(3);
    const aliceMage = findMageById(s, 'alice-mage-1');
    expect(aliceMage.location).toEqual({ kind: 'office', playerId: 'p1' });
  });
});

describe('Vault A slot 2 (Draft a Vault Card OR Gain 5 Gold)', () => {
  it('opens an OR prompt with two options', () => {
    let s = setupVaultSlotTest('base.room.vault.a.slot-2');
    s = driveToVaultPrompt(s);
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.id).sort()).toEqual(['draft', 'gold']);
    }
  });

  it('picking gold grants 5 gold and resolves', () => {
    let s = setupVaultSlotTest('base.room.vault.a.slot-2');
    s = setGold(s, 'p1', 0);
    s = driveToVaultPrompt(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    expect(s.pendingResolutionStack).toHaveLength(0);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(5);
    expect(alice?.vaultCards).toHaveLength(0);
  });

  it('picking draft chains to choose-vault-card and grants the card with no gold', () => {
    let s = setupVaultSlotTest('base.room.vault.a.slot-2');
    s = setGold(s, 'p1', 1);
    s = driveToVaultPrompt(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'draft', payload: {} },
    });
    const draftPrompt = topPending(s);
    expect(draftPrompt.prompt.kind).toBe('choose-vault-card');
    if (draftPrompt.prompt.kind === 'choose-vault-card') {
      // Draft has no affordability filter — every tableau card is eligible.
      expect(draftPrompt.prompt.eligibleCardIds).toHaveLength(3);
    }
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: draftPrompt.id,
      answer: { kind: 'card-chosen', cardId: 'base.vault.placeholder-treasure-2' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(1); // unchanged — drafts don't cost gold
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.placeholder-treasure-2', exhausted: false },
    ]);
    expect(s.vaultTableau).not.toContain('base.vault.placeholder-treasure-2');
  });
});

describe('Vault A slot 1 (Draft a Vault Card AND Gain 4 Gold)', () => {
  it('opens choose-vault-card without affordability filter, then grants card + 4 gold', () => {
    let s = setupVaultSlotTest('base.room.vault.a.slot-1');
    s = setGold(s, 'p1', 0);
    s = driveToVaultPrompt(s);
    const draftPrompt = topPending(s);
    expect(draftPrompt.prompt.kind).toBe('choose-vault-card');
    if (draftPrompt.prompt.kind === 'choose-vault-card') {
      expect(draftPrompt.prompt.eligibleCardIds).toHaveLength(3);
    }
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: draftPrompt.id,
      answer: { kind: 'card-chosen', cardId: 'base.vault.placeholder-treasure-1' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(4);
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.placeholder-treasure-1', exhausted: false },
    ]);
  });

  it('still grants 4 gold when the tableau is empty', () => {
    let s = setupVaultSlotTest('base.room.vault.a.slot-1');
    s = setVaultTableau(s, []);
    s = setGold(s, 'p1', 0);
    s = driveToVaultPrompt(s);
    expect(s.pendingResolutionStack).toHaveLength(0);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(4);
  });
});

// ============================================================================
// Vertical Slice 3b — BUY_VAULT_CARD action (player-driven during errands)
// ============================================================================

describe('BUY_VAULT_CARD action', () => {
  function setupBuyAction(): GameState {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = setGold(s, 'p1', 4);
    s = setVaultTableau(s, [
      'base.vault.placeholder-treasure-1',
      'base.vault.phase-steppers',
    ]);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    return s;
  }

  it('moves card to player, deducts gold, removes from tableau', () => {
    let s = setupBuyAction();
    s = applyAction(s, {
      type: 'BUY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.placeholder-treasure-1',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(2); // 4 - 2
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.placeholder-treasure-1', exhausted: false },
    ]);
    expect(s.vaultTableau).toEqual(['base.vault.phase-steppers']);
  });

  it('rejects when player cannot afford', () => {
    let s = setupBuyAction();
    s = setGold(s, 'p1', 1);
    expect(() =>
      applyAction(s, {
        type: 'BUY_VAULT_CARD',
        playerId: 'p1',
        vaultCardId: 'base.vault.placeholder-treasure-1', // costs 2
      }),
    ).toThrow(/insufficient gold/);
  });

  it('rejects when card is not in the tableau', () => {
    let s = setupBuyAction();
    expect(() =>
      applyAction(s, {
        type: 'BUY_VAULT_CARD',
        playerId: 'p1',
        vaultCardId: 'base.vault.placeholder-treasure-2', // not in tableau
      }),
    ).toThrow(/not in vault tableau/);
  });
});

// ============================================================================
// Vertical Slice 3c — Sorcery Mage Ars Magna
// ============================================================================

describe('Ars Magna (Sorcery Mage power)', () => {
  function setupArsMagnaTest(opts: {
    bobColor?: MageColor;
    bobOnSpace?: string;
    bobHasPhaseSteppers?: boolean;
    aliceMana?: number;
  } = {}): GameState {
    const bobColor: MageColor = opts.bobColor ?? 'red';
    const bobSpace = opts.bobOnSpace ?? 'base.room.vault.a.slot-3';
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);

    // Alice — caster.
    s = addMage(s, 'p1', {
      id: 'alice-red',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      resources: { ...p.resources, mana: opts.aliceMana ?? 5 },
    }));

    // Bob — target.
    s = addMage(s, 'p2', {
      id: 'bob-mage',
      cardId: `base.mage.${bobColor === 'off-white' ? 'neutral' : bobColor}`,
      color: bobColor,
    });
    s = placeMageOnSpace(s, 'p2', 'bob-mage', bobSpace);

    if (opts.bobHasPhaseSteppers) {
      s = addVaultCard(s, 'p2', 'base.vault.phase-steppers');
    }

    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    return s;
  }

  it('with no eligible targets, rejects the ability', () => {
    // Bob's only mage is green → no legal targets.
    const s = setupArsMagnaTest({ bobColor: 'green' });
    expect(() =>
      applyAction(s, {
        type: 'USE_ABILITY',
        playerId: 'p1',
        abilityId: 'base.mage.sorcery.ars-magna',
        sourceCardId: 'alice-red',
      }),
    ).toThrow(/no legal targets/);
  });

  it('rejects when caster has < 1 Mana', () => {
    const s = setupArsMagnaTest({ aliceMana: 0 });
    expect(() =>
      applyAction(s, {
        type: 'USE_ABILITY',
        playerId: 'p1',
        abilityId: 'base.mage.sorcery.ars-magna',
        sourceCardId: 'alice-red',
      }),
    ).toThrow(/requires 1 Mana/);
  });

  it('opposing blue mages are filtered out as targets', () => {
    const s = setupArsMagnaTest({ bobColor: 'blue' });
    expect(() =>
      applyAction(s, {
        type: 'USE_ABILITY',
        playerId: 'p1',
        abilityId: 'base.mage.sorcery.ars-magna',
        sourceCardId: 'alice-red',
      }),
    ).toThrow(/no legal targets/);
  });

  it('full happy path: spends 1 mana, wounds target, Infirmary bonus, red mage takes the slot', () => {
    let s = setupArsMagnaTest({ bobColor: 'red', aliceMana: 3 });
    s = applyAction(s, {
      type: 'USE_ABILITY',
      playerId: 'p1',
      abilityId: 'base.mage.sorcery.ars-magna',
      sourceCardId: 'alice-red',
    });
    // After ability: mana spent, target prompt up.
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(2);
    let top = topPending(s);
    expect(top.prompt.kind).toBe('choose-target-mage');

    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage' },
    });
    // Wound applied; reaction window opens (Bob is the only responder).
    expect(s.activeReactionWindows).toHaveLength(1);
    top = topPending(s);
    expect(top.prompt.kind).toBe('reaction-window');
    expect(top.responderId).toBe('p2');

    // Bob has nothing to react with — pass.
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'reaction-passed' },
    });

    // Infirmary bonus prompt now active for Bob (wounded by an opponent).
    const bonusPrompt = topPending(s);
    expect(bonusPrompt.prompt.kind).toBe('choose-from-options');
    expect(bonusPrompt.responderId).toBe('p2');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: bonusPrompt.id,
      answer: { kind: 'option-chosen', optionId: 'mana', payload: {} },
    });
    // Bonus applied; afterResume continues into the slot takeover.
    expect(s.players.find((p) => p.id === 'p2')?.resources.mana).toBe(1);

    const bobMage = findMageById(s, 'bob-mage');
    expect(bobMage.isWounded).toBe(true);
    expect(bobMage.location.kind).toBe('infirmary');
    const aliceRed = findMageById(s, 'alice-red');
    expect(aliceRed.location).toEqual({
      kind: 'action-space',
      spaceId: 'base.room.vault.a.slot-3',
    });
    const vault = findRoom(s, (r) => r.name === 'Vault');
    expect(vault.actionSpaces[2]?.occupant?.mageId).toBe('alice-red');
  });

  it('Phase Steppers reaction prevents the slot takeover', () => {
    let s = setupArsMagnaTest({ bobColor: 'red', bobHasPhaseSteppers: true });
    s = applyAction(s, {
      type: 'USE_ABILITY',
      playerId: 'p1',
      abilityId: 'base.mage.sorcery.ars-magna',
      sourceCardId: 'alice-red',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage' },
    });
    // Reaction window with Phase Steppers offered.
    const reactionPrompt = topPending(s);
    expect(reactionPrompt.prompt.kind).toBe('reaction-window');

    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: reactionPrompt.id,
      answer: {
        kind: 'reaction-played',
        effectId: 'base.vault.phase-steppers.react',
        reactionContext: {},
      },
    });

    // Bob's mage shadowed back to the slot.
    const bobMage = findMageById(s, 'bob-mage');
    expect(bobMage.isWounded).toBe(false);
    expect(bobMage.isShadowing).toBe(true);
    expect(bobMage.location).toEqual({
      kind: 'action-space',
      spaceId: 'base.room.vault.a.slot-3',
    });
    // Red mage stays in office; mana already spent stays gone.
    const aliceRed = findMageById(s, 'alice-red');
    expect(aliceRed.location).toEqual({ kind: 'office', playerId: 'p1' });
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(4);
    // Window closed and stack empty.
    expect(s.activeReactionWindows).toHaveLength(0);
    expect(s.pendingResolutionStack).toHaveLength(0);
  });

  it('Ars Magna can target a merit slot and ignores the merit cost', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-red',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      resources: { ...p.resources, mana: 3, meritBadges: 0 },
    }));
    s = addMage(s, 'p2', {
      id: 'bob-mage',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    // Place Bob's mage on the merit slot directly (bypass placement cost
    // for setup; the engine doesn't validate placements created via
    // placeMageOnSpace test helper).
    s = placeMageOnSpace(s, 'p2', 'bob-mage', 'base.room.vault.a.slot-1');
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };

    s = applyAction(s, {
      type: 'USE_ABILITY',
      playerId: 'p1',
      abilityId: 'base.mage.sorcery.ars-magna',
      sourceCardId: 'alice-red',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage' },
    });
    // Bob has no Phase Steppers; pass.
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'reaction-passed' },
    });
    // Bob picks an Infirmary bonus.
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });

    // Alice's red mage now occupies the merit slot — no MB required.
    const aliceRed = findMageById(s, 'alice-red');
    expect(aliceRed.location).toEqual({
      kind: 'action-space',
      spaceId: 'base.room.vault.a.slot-1',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.meritBadges).toBe(0);
    expect(alice?.resources.meritBadgesSpent).toBe(0);
  });
});

// ============================================================================
// Library A slots 1 / 2 / 3
// ============================================================================

function setupRoomSlotTest(
  roomName: string,
  side: 'A' | 'B',
  spaceId: string,
): GameState {
  let s = initGame(TWO_PLAYER_CONFIG);
  s = forceRoomSide(s, roomName, side);
  s = addMage(s, 'p1', {
    id: 'alice-mage-1',
    cardId: 'base.mage.divinity',
    color: 'blue',
  });
  s = placeMageOnSpace(s, 'p1', 'alice-mage-1', spaceId);
  s = { ...s, bellTower: { ...s.bellTower, available: [] } };
  return s;
}

function driveToResolution(state: GameState): GameState {
  let s = state;
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → effect
  return s;
}

describe('Library A slot 1 (merit, 1 MB): WIS + Vault Draft', () => {
  it('opens choose-vault-card and grants WIS + drafted card', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-1');
    s = setVaultTableau(s, ['base.vault.placeholder-treasure-1']);
    s = driveToResolution(s);
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-vault-card');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'card-chosen', cardId: 'base.vault.placeholder-treasure-1' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.wisdom).toBe(1);
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.placeholder-treasure-1', exhausted: false },
    ]);
  });

  it('still grants WIS when the vault tableau is empty', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-1');
    s = setVaultTableau(s, []);
    s = driveToResolution(s);
    expect(s.pendingResolutionStack).toHaveLength(0);
    expect(s.players.find((p) => p.id === 'p1')?.resources.wisdom).toBe(1);
  });
});

describe('Library A slot 2 (merit, 1 MB): INT + Research', () => {
  it('grants INT immediately and prompts for Research spend', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-2');
    s = driveToResolution(s);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.intelligence).toBe(1);
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.id).sort()).toEqual([
        'discard',
        'spend',
      ]);
    }
  });
});

describe('Library A slot 3 (regular): Buy + Research', () => {
  it('prompts to buy or skip, then spawns Research', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-3');
    s = setVaultTableau(s, ['base.vault.placeholder-treasure-1']); // 2g
    s = setGold(s, 'p1', 2);
    s = driveToResolution(s);
    const buyPrompt = topPending(s);
    expect(buyPrompt.prompt.kind).toBe('choose-from-options');
    if (buyPrompt.prompt.kind === 'choose-from-options') {
      const optionIds = buyPrompt.prompt.options.map((o) => o.id).sort();
      expect(optionIds).toEqual([
        'base.vault.placeholder-treasure-1',
        'skip',
      ]);
    }
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: buyPrompt.id,
      answer: {
        kind: 'option-chosen',
        optionId: 'base.vault.placeholder-treasure-1',
        payload: {},
      },
    });
    // Buy applied; research prompt now on top.
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(0);
    expect(alice?.vaultCards).toHaveLength(1);
    const researchPrompt = topPending(s);
    expect(researchPrompt.prompt.kind).toBe('choose-from-options');
  });

  it('skips straight to Research when nothing is affordable', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-3');
    s = setVaultTableau(s, []);
    s = driveToResolution(s);
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.id).sort()).toEqual([
        'discard',
        'spend',
      ]);
    }
  });
});

// ============================================================================
// Training Fields A
// ============================================================================

describe('Training Fields A', () => {
  it('slot 1 grants 1 INT and 1 WIS with no prompt', () => {
    let s = setupRoomSlotTest(
      'Training Fields',
      'A',
      'base.room.training-fields.a.slot-1',
    );
    s = driveToResolution(s);
    expect(s.pendingResolutionStack).toHaveLength(0);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.intelligence).toBe(1);
    expect(alice?.resources.wisdom).toBe(1);
  });

  it('slot 2 grants 1 INT', () => {
    let s = setupRoomSlotTest(
      'Training Fields',
      'A',
      'base.room.training-fields.a.slot-2',
    );
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.intelligence).toBe(1);
  });

  it('slot 3 grants 1 WIS', () => {
    let s = setupRoomSlotTest(
      'Training Fields',
      'A',
      'base.room.training-fields.a.slot-3',
    );
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.wisdom).toBe(1);
  });
});

// ============================================================================
// Guilds A — instant room. Effects resolve at PLACE_WORKER, not in resolution.
// ============================================================================

describe('Guilds A (instant room)', () => {
  function setupGuildsPlacement(): GameState {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceRoomSide(s, 'Guilds', 'A');
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 1);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    return s;
  }

  it('slot 2 placement opens an OR prompt immediately at PLACE_WORKER', () => {
    let s = setupGuildsPlacement();
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.guilds.a.slot-2',
    });
    expect(s.phase.kind).toBe('errands'); // still in errands
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.label).sort()).toEqual([
        'Gain 2 Mana',
        'Gain 4 Gold',
      ]);
    }
    // Mage seated on the slot.
    const guilds = findRoom(s, (r) => r.name === 'Guilds');
    expect(guilds.actionSpaces[1]?.occupant?.mageId).toBe('alice-mage-1');
  });

  it('picking gold grants the slot amount', () => {
    let s = setupGuildsPlacement();
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.guilds.a.slot-2',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    expect(s.players.find((p) => p.id === 'p1')?.resources.gold).toBe(4);
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(0);
  });

  it('picking mana grants the slot amount', () => {
    let s = setupGuildsPlacement();
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.guilds.a.slot-3',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'mana', payload: {} },
    });
    expect(s.players.find((p) => p.id === 'p1')?.resources.gold).toBe(0);
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(1);
  });

  it('mage stays on the slot until resolution returns it', () => {
    let s = setupGuildsPlacement();
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.guilds.a.slot-3',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    // Mage still on slot through errands.
    let guilds = findRoom(s, (r) => r.name === 'Guilds');
    expect(guilds.actionSpaces[2]?.occupant?.mageId).toBe('alice-mage-1');
    // Drain bell tower and run resolution — pump returns the mage.
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump
    guilds = findRoom(s, (r) => r.name === 'Guilds');
    expect(guilds.actionSpaces[2]?.occupant).toBeNull();
    const aliceMage = findMageById(s, 'alice-mage-1');
    expect(aliceMage.location).toEqual({ kind: 'office', playerId: 'p1' });
  });
});

// ============================================================================
// Courtyard A — Mana scaling with WIS
// ============================================================================

// ============================================================================
// Council Chamber A — Draft a Supporter OR Gain a Mark, capped at 1/round
// ============================================================================

describe('Council Chamber A', () => {
  function setSupporterTableau(state: GameState, ids: string[]): GameState {
    return { ...state, supporterTableau: ids };
  }

  it('opens an OR prompt at resolution', () => {
    let s = setupRoomSlotTest(
      'Council Chamber',
      'A',
      'base.room.council-chamber.a.slot-2',
    );
    s = driveToResolution(s);
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.id).sort()).toEqual(['draft', 'mark']);
    }
  });

  it('picking Gain a Mark chains to choose-voter and records the mark', () => {
    let s = setupRoomSlotTest(
      'Council Chamber',
      'A',
      'base.room.council-chamber.a.slot-2',
    );
    s = driveToResolution(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'mark', payload: {} },
    });
    const voterPrompt = topPending(s);
    expect(voterPrompt.prompt.kind).toBe('choose-voter');
    if (voterPrompt.prompt.kind !== 'choose-voter') return;
    const targetVoter = voterPrompt.prompt.eligibleVoterIds[0]!;
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: voterPrompt.id,
      answer: { kind: 'voter-chosen', voterId: targetVoter },
    });
    expect(s.players.find((p) => p.id === 'p1')?.resources.marks).toBe(1);
    expect(s.voterMarks).toContainEqual({ voterId: targetVoter, playerId: 'p1' });
  });

  it('picking Draft a Supporter chains to choose-supporter-card', () => {
    let s = setupRoomSlotTest(
      'Council Chamber',
      'A',
      'base.room.council-chamber.a.slot-2',
    );
    s = setSupporterTableau(s, ['base.supporter.placeholder.1']);
    s = driveToResolution(s);
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'draft', payload: {} },
    });
    const draftPrompt = topPending(s);
    expect(draftPrompt.prompt.kind).toBe('choose-supporter-card');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: draftPrompt.id,
      answer: { kind: 'card-chosen', cardId: 'base.supporter.placeholder.1' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.supporters).toEqual(['base.supporter.placeholder.1']);
    expect(s.supporterTableau).not.toContain('base.supporter.placeholder.1');
  });

  it('rejects placing a second mage in Council Chamber the same round', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceRoomSide(s, 'Council Chamber', 'A');
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = addMage(s, 'p1', {
      id: 'alice-mage-2',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.council-chamber.a.slot-2',
    });
    expect(() =>
      applyAction(s, {
        type: 'PLACE_WORKER',
        playerId: 'p1',
        mageId: 'alice-mage-2',
        actionSpaceId: 'base.room.council-chamber.a.slot-3',
      }),
    ).toThrow(/already placed.*Council Chamber/);
  });
});

describe('Round-setup clears roundPlacements', () => {
  it('lets a player place again in a once-per-round room next round', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceRoomSide(s, 'Council Chamber', 'A');
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.council-chamber.a.slot-2',
    });
    expect(s.players[0]?.roundPlacements).toContain('base.room.council-chamber.a');

    // Drain bell tower; drive through resolution → mid-game → round 2 setup.
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // resolution pump → Council slot pauses
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'mark', payload: {} },
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'voter-chosen', voterId: s.voters[0]!.id },
    });
    // Engine auto-pumps after the stack drains; we should now be in
    // mid-game-scoring.
    expect(s.phase.kind).toBe('mid-game-scoring');
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // mid-game → round-setup round 2
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands round 2

    expect(s.phase.kind).toBe('errands');
    expect(s.players[0]?.roundPlacements).toEqual([]);
  });
});

// ============================================================================
// Catacombs A
// ============================================================================

describe('Infirmary on-wound bonus', () => {
  function setupBurnTargetTest(opts: { bobHasPhaseSteppers?: boolean } = {}): GameState {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceLibrarySideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      resources: { ...p.resources, mana: 5 },
    }));
    s = addOwnedSpell(s, 'p1', 'base.spell.burn');
    s = addMage(s, 'p2', {
      id: 'bob-mage-1',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = placeMageOnSpace(s, 'p2', 'bob-mage-1', 'base.room.library.a.slot-4');
    if (opts.bobHasPhaseSteppers) {
      s = addVaultCard(s, 'p2', 'base.vault.phase-steppers');
    }
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };
    return s;
  }

  it('does NOT prompt for the bonus when Phase Steppers reverts the wound', () => {
    let s = setupBurnTargetTest({ bobHasPhaseSteppers: true });
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage-1' },
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: {
        kind: 'reaction-played',
        effectId: 'base.vault.phase-steppers.react',
        reactionContext: {},
      },
    });
    expect(s.activeReactionWindows).toHaveLength(0);
    // No bonus prompt — the mage was un-wounded by Phase Steppers.
    expect(s.pendingResolutionStack).toHaveLength(0);
    // Bonus did not fire — Bob's gold/mana/IP unchanged.
    const bob = s.players.find((p) => p.id === 'p2');
    expect(bob?.resources.gold).toBe(0);
    expect(bob?.resources.mana).toBe(0);
    expect(bob?.resources.influence).toBe(0);
  });

  it('does NOT prompt for the bonus on self-inflicted wounds', () => {
    // Alice casts Burn on her own mage. By rule, Burn allows self-targeting
    // (Divinity immunity is to RIVALS only). After the wound resolves, no
    // Infirmary bonus because byPlayerId === ownerId.
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceLibrarySideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-caster',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = addMage(s, 'p1', {
      id: 'alice-target',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = placeMageOnSpace(s, 'p1', 'alice-target', 'base.room.library.a.slot-4');
    s = addOwnedSpell(s, 'p1', 'base.spell.burn');
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      resources: { ...p.resources, mana: 5 },
    }));
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0 } };

    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'alice-target' },
    });
    // Reaction window — Bob gets a prompt even though he's not the owner;
    // any player may react. Pass.
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'reaction-passed' },
    });
    // No bonus — self-inflicted wound.
    expect(s.pendingResolutionStack).toHaveLength(0);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(0);
    expect(alice?.resources.mana).toBe(4); // 5 - 1 from cast
    expect(alice?.resources.influence).toBe(0);
  });

  it('IP bonus path bumps influence and influenceArrivalSeq', () => {
    let s = setupBurnTargetTest();
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'mage-chosen', mageId: 'bob-mage-1' },
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'reaction-passed' },
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'ip', payload: {} },
    });
    const bob = s.players.find((p) => p.id === 'p2');
    expect(bob?.resources.influence).toBe(1);
    expect(bob?.influenceArrivalSeq).toBeGreaterThan(0);
  });
});

describe('Catacombs A', () => {
  it('slot 2 grants 2 IP and bumps influenceArrivalSeq', () => {
    let s = setupRoomSlotTest(
      'Catacombs',
      'A',
      'base.room.catacombs.a.slot-2',
    );
    s = driveToResolution(s);
    expect(s.pendingResolutionStack).toHaveLength(0);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.influence).toBe(2);
    expect(alice?.influenceArrivalSeq).toBeGreaterThan(0);
  });

  it('slot 3 grants 1 IP per player ahead', () => {
    let s = setupRoomSlotTest(
      'Catacombs',
      'A',
      'base.room.catacombs.a.slot-3',
    );
    // Alice has 0 IP; Bob has 3 IP → Alice gains 1 IP.
    s = mapPlayer(s, 'p2', (p) => ({
      ...p,
      resources: { ...p.resources, influence: 3 },
    }));
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.influence).toBe(1);
  });

  it('slot 3 grants 0 IP when no one is ahead', () => {
    let s = setupRoomSlotTest(
      'Catacombs',
      'A',
      'base.room.catacombs.a.slot-3',
    );
    // Both players at 0 IP; no one is strictly ahead.
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.influence).toBe(0);
  });

  it('slot 1 draws a Secret Supporter and prompts for a Mark', () => {
    let s = setupRoomSlotTest(
      'Catacombs',
      'A',
      'base.room.catacombs.a.slot-1',
    );
    // Force a known top of the supporter deck.
    s = {
      ...s,
      supporterDeck: ['base.supporter.placeholder.1'],
      supporterTableau: [],
    };
    s = driveToResolution(s);
    // Secret Supporter went to discard.
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.personalDiscard).toEqual([
      { kind: 'secret-supporter', cardId: 'base.supporter.placeholder.1' },
    ]);
    expect(s.supporterDeck).toHaveLength(0);
    // Mark prompt now active.
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-voter');
  });
});

describe('Courtyard A', () => {
  it('slot 1 grants WIS + 2 Mana (with WIS = 3 → 5 mana)', () => {
    let s = setupRoomSlotTest(
      'Courtyard',
      'A',
      'base.room.courtyard.a.slot-1',
    );
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      resources: { ...p.resources, wisdom: 3 },
    }));
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(5);
  });

  it('slot 2 grants WIS Mana (with WIS = 0 → 0)', () => {
    let s = setupRoomSlotTest(
      'Courtyard',
      'A',
      'base.room.courtyard.a.slot-2',
    );
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(0);
  });

  it('slot 3 grants 3 Mana flat', () => {
    let s = setupRoomSlotTest(
      'Courtyard',
      'A',
      'base.room.courtyard.a.slot-3',
    );
    s = driveToResolution(s);
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(3);
  });
});
