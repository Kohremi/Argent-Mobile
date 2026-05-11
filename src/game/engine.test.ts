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

  it('seats the 3-card bell tower offering set', () => {
    const s = initGame(FOUR_PLAYER_CONFIG);
    expect(s.bellTower.available).toHaveLength(3);
    expect(s.bellTower.available.every((c) => c.minPlayers <= 4)).toBe(true);
    const ids = s.bellTower.available.map((c) => c.id).sort();
    expect(ids).toEqual([
      'base.bell.first-player',
      'base.bell.gain-ip',
      'base.bell.gold-or-mana',
    ]);
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
// Bell Tower offerings — claim flow
// ============================================================================

describe('Bell Tower offerings', () => {
  function startErrands(): GameState {
    let s = initGame(FOUR_PLAYER_CONFIG);
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
    return s;
  }

  it('CLAIM_BELL_TOWER moves card to taken and records on player', () => {
    let s = startErrands();
    const activeId = s.players[s.firstPlayerIndex]?.id;
    if (!activeId) throw new Error('no active player');
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId,
      bellTowerCardId: 'base.bell.gain-ip',
    });
    expect(s.bellTower.available.find((c) => c.id === 'base.bell.gain-ip')).toBeUndefined();
    expect(s.bellTower.taken).toEqual([
      { cardId: 'base.bell.gain-ip', takenBy: activeId },
    ]);
    const player = s.players.find((p) => p.id === activeId);
    expect(player?.bellTowerCards).toEqual(['base.bell.gain-ip']);
    expect(player?.resources.influence).toBe(1);
  });

  it('Gold-or-Mana card pauses for player choice and grants the picked resource', () => {
    let s = startErrands();
    const activeId = s.players[s.firstPlayerIndex]?.id;
    if (!activeId) throw new Error('no active player');
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId,
      bellTowerCardId: 'base.bell.gold-or-mana',
    });
    expect(s.pendingResolutionStack).toHaveLength(1);
    const top = topPending(s);
    expect(top.responderId).toBe(activeId);
    expect(top.prompt.kind).toBe('choose-from-options');

    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    expect(s.pendingResolutionStack).toHaveLength(0);
    const player = s.players.find((p) => p.id === activeId);
    expect(player?.resources.gold).toBe(2);
    expect(player?.resources.mana).toBe(0);
  });

  it('First-Player Token sets firstPlayerIndex to the claimer', () => {
    let s = startErrands();
    // Pick a non-first-player to make the change observable.
    const claimerIdx = (s.firstPlayerIndex + 1) % s.players.length;
    const claimerId = s.players[claimerIdx]?.id;
    if (!claimerId) throw new Error('no claimer');
    // Walk turn order until the claimer is active.
    while (
      s.phase.kind === 'errands' &&
      s.players[s.phase.activePlayerIndex]?.id !== claimerId
    ) {
      // Other players forfeit their action so we can reach the claimer cleanly.
      s = applyAction(s, {
        type: 'PASS_TURN',
        playerId: s.players[s.phase.activePlayerIndex]!.id,
      });
    }
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: claimerId,
      bellTowerCardId: 'base.bell.first-player',
    });
    expect(s.firstPlayerIndex).toBe(claimerIdx);
  });

  it('claiming the last bell tower card drains the tower and ends the round', () => {
    let s = startErrands();
    const activeId = () => {
      if (s.phase.kind !== 'errands') throw new Error('not errands');
      const id = s.players[s.phase.activePlayerIndex]?.id;
      if (!id) throw new Error('no active player');
      return id;
    };
    // Each claim auto-ends the player's turn once it fully resolves.
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId(),
      bellTowerCardId: 'base.bell.gain-ip',
    });
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId(),
      bellTowerCardId: 'base.bell.first-player',
    });
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId(),
      bellTowerCardId: 'base.bell.gold-or-mana',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'mana', payload: {} },
    });
    // Tower drained + last action resolved → auto-advance promoted us to resolution.
    expect(s.bellTower.available).toHaveLength(0);
    expect(s.phase.kind).toBe('resolution');
  });

  it('rejects claiming a card that is not in the tower', () => {
    const s = startErrands();
    const activeId = s.players[s.firstPlayerIndex]?.id;
    if (!activeId) throw new Error('no active player');
    expect(() =>
      applyAction(s, {
        type: 'CLAIM_BELL_TOWER',
        playerId: activeId,
        bellTowerCardId: 'base.bell.does-not-exist',
      }),
    ).toThrow(/not in bell tower/);
  });

  it('rejects claiming when not your turn', () => {
    const s = startErrands();
    const activeId = s.players[s.firstPlayerIndex]?.id;
    const otherId = s.players[(s.firstPlayerIndex + 1) % s.players.length]?.id;
    if (!activeId || !otherId) throw new Error('missing player');
    expect(() =>
      applyAction(s, {
        type: 'CLAIM_BELL_TOWER',
        playerId: otherId,
        bellTowerCardId: 'base.bell.gain-ip',
      }),
    ).toThrow(/not your turn/);
  });

  it('round-setup of round 2 restores the bell tower offerings claimed in round 1', () => {
    let s = startErrands();
    const activeId = () => {
      if (s.phase.kind !== 'errands') throw new Error('not errands');
      const id = s.players[s.phase.activePlayerIndex]?.id;
      if (!id) throw new Error('no active player');
      return id;
    };
    const firstClaimerId = activeId();
    // Each claim auto-ends the player's turn; the last claim drains the
    // tower and auto-advances us into the resolution phase.
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId(),
      bellTowerCardId: 'base.bell.gain-ip',
    });
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId(),
      bellTowerCardId: 'base.bell.first-player',
    });
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: activeId(),
      bellTowerCardId: 'base.bell.gold-or-mana',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'mana', payload: {} },
    });
    expect(s.phase.kind).toBe('resolution');
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → mid-game-scoring
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → round-setup round 2
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → errands round 2
    expect(s.bellTower.available).toHaveLength(3);
    expect(s.bellTower.taken).toHaveLength(0);
    // Per-round bell tower record reset on every player.
    expect(s.players.every((p) => p.bellTowerCards.length === 0)).toBe(true);
    // Sanity: previously claimed cards are back in the pool.
    const ids = s.bellTower.available.map((c) => c.id).sort();
    expect(ids).toEqual([
      'base.bell.first-player',
      'base.bell.gain-ip',
      'base.bell.gold-or-mana',
    ]);
    // First-Player Token claimer becomes first player in round 2.
    const claimer2Idx = (s.players.findIndex((p) => p.id === firstClaimerId) + 1) % s.players.length;
    expect(s.firstPlayerIndex).toBe(claimer2Idx);
    if (s.phase.kind === 'errands') {
      expect(s.phase.activePlayerIndex).toBe(claimer2Idx);
    }
  });
});

// ============================================================================
// Action / Fast Action budget per turn
// ============================================================================

describe('Per-turn Action / Fast Action budget', () => {
  function startErrandsAt(playerIdx: number): GameState {
    let s = initGame(FOUR_PLAYER_CONFIG);
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    return {
      ...s,
      firstPlayerIndex: playerIdx,
      phase: { ...s.phase, activePlayerIndex: playerIdx },
    };
  }

  it('starts a turn with both Action and Fast Action available', () => {
    const s = startErrandsAt(0);
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.actionUsed).toBe(false);
    expect(s.phase.fastActionUsed).toBe(false);
  });

  it('a fully-resolved Regular Action auto-ends the turn (no explicit end)', () => {
    let s = startErrandsAt(0);
    // Bell tower IP card has no follow-up prompts — claim resolves immediately.
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: 'p1',
      bellTowerCardId: 'base.bell.gain-ip',
    });
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    // Auto-advance moved active player forward and reset both budgets.
    expect(s.phase.activePlayerIndex).toBe(1);
    expect(s.phase.actionUsed).toBe(false);
    expect(s.phase.fastActionUsed).toBe(false);
  });

  it('Action that pauses on a prompt only auto-ends the turn once the prompt resolves', () => {
    let s = startErrandsAt(0);
    s = applyAction(s, {
      type: 'CLAIM_BELL_TOWER',
      playerId: 'p1',
      bellTowerCardId: 'base.bell.gold-or-mana',
    });
    // Mid-action: still p1's turn, action used, awaiting prompt.
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.activePlayerIndex).toBe(0);
    expect(s.phase.actionUsed).toBe(true);
    expect(s.pendingResolutionStack).toHaveLength(1);
    // Resolve the OR prompt → auto-advance fires.
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.activePlayerIndex).toBe(1);
    expect(s.phase.actionUsed).toBe(false);
  });

  it('Fast Action keeps the turn open; the player still owes their Regular Action', () => {
    let s = startErrandsAt(0);
    // Set Alice up to wound an enemy mage, then drive Ars Magna to completion.
    s = addMage(s, 'p2', {
      id: 'bob-red',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = placeMageOnSpace(s, 'p2', 'bob-red', 'base.room.library.a.slot-3');
    s = addMage(s, 'p1', {
      id: 'alice-red',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = setMana(s, 'p1', 2);
    s = applyAction(s, {
      type: 'USE_ABILITY',
      playerId: 'p1',
      abilityId: 'base.mage.sorcery.ars-magna',
      sourceCardId: 'alice-red',
    });
    while (s.pendingResolutionStack.length > 0) {
      const top = topPending(s);
      if (top.prompt.kind === 'choose-target-mage') {
        s = applyAction(s, {
          type: 'RESOLVE_PENDING',
          resolutionId: top.id,
          answer: { kind: 'mage-chosen', mageId: 'bob-red' },
        });
      } else if (top.prompt.kind === 'reaction-window') {
        s = applyAction(s, {
          type: 'RESOLVE_PENDING',
          resolutionId: top.id,
          answer: { kind: 'reaction-passed' },
        });
      } else if (top.prompt.kind === 'choose-from-options') {
        s = applyAction(s, {
          type: 'RESOLVE_PENDING',
          resolutionId: top.id,
          answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
        });
      } else {
        throw new Error(`unexpected prompt kind ${top.prompt.kind}`);
      }
    }
    // Fast Action consumed; Regular Action still owed → still Alice's turn.
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.activePlayerIndex).toBe(0);
    expect(s.phase.actionUsed).toBe(false);
    expect(s.phase.fastActionUsed).toBe(true);
  });

  it('rejects a second Fast Action in the same turn', () => {
    let s = startErrandsAt(0);
    s = addMage(s, 'p1', {
      id: 'alice-red',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = addMage(s, 'p2', {
      id: 'bob-red',
      cardId: 'base.mage.sorcery',
      color: 'red',
    });
    s = placeMageOnSpace(s, 'p2', 'bob-red', 'base.room.library.a.slot-3');
    s = setMana(s, 'p1', 4);
    s = applyAction(s, {
      type: 'USE_ABILITY',
      playerId: 'p1',
      abilityId: 'base.mage.sorcery.ars-magna',
      sourceCardId: 'alice-red',
    });
    while (s.pendingResolutionStack.length > 0) {
      const top = topPending(s);
      if (top.prompt.kind === 'choose-target-mage') {
        s = applyAction(s, {
          type: 'RESOLVE_PENDING',
          resolutionId: top.id,
          answer: { kind: 'mage-chosen', mageId: 'bob-red' },
        });
      } else if (top.prompt.kind === 'reaction-window') {
        s = applyAction(s, {
          type: 'RESOLVE_PENDING',
          resolutionId: top.id,
          answer: { kind: 'reaction-passed' },
        });
      } else if (top.prompt.kind === 'choose-from-options') {
        s = applyAction(s, {
          type: 'RESOLVE_PENDING',
          resolutionId: top.id,
          answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
        });
      } else {
        throw new Error(`unexpected prompt kind ${top.prompt.kind}`);
      }
    }
    // Fast Action 1 done; Action still owed.
    expect(() =>
      applyAction(s, {
        type: 'USE_ABILITY',
        playerId: 'p1',
        abilityId: 'base.mage.sorcery.ars-magna',
        sourceCardId: 'alice-red',
      }),
    ).toThrow(/already used your Fast Action this turn/);
  });

  it('PASS_TURN forfeits the Action and advances to the next player', () => {
    let s = startErrandsAt(0);
    s = applyAction(s, { type: 'PASS_TURN', playerId: 'p1' });
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.activePlayerIndex).toBe(1);
    expect(s.phase.actionUsed).toBe(false);
    expect(s.phase.fastActionUsed).toBe(false);
  });

  it('CAST_SPELL action timing consumes the Action and auto-advances', () => {
    let s = startErrandsAt(0);
    s = addOwnedSpell(s, 'p1', 'base.spell.burn', { intPlaced: true });
    s = setMana(s, 'p1', 5);
    // No legal Burn targets → effect resolves with no patch and auto-advances.
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.burn',
      level: 1,
    });
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.activePlayerIndex).toBe(1);
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

  it('CHOOSE_CANDIDATE grants 2 leader-color mages + starter spell, decrements the pool', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    expect(s.mageDraftPool.red).toBe(4);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.larimore-burman',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.candidateId).toBe('base.candidate.larimore-burman');
    expect(alice?.candidateStartingSpellId).toBe('base.spell.flash-of-light');
    expect(alice?.mages).toHaveLength(2);
    expect(alice?.mages.every((m) => m.color === 'red')).toBe(true);
    expect(s.mageDraftPool.red).toBe(2);
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

  it('Trias Blackwind starts with 2 off-white mages and +1 MB', () => {
    let s = initGame(DRAFT_CONFIG_4P);
    s = withFirstPlayer(s, 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.trias-blackwind',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.mages.every((m) => m.color === 'off-white')).toBe(true);
    expect(alice?.mages).toHaveLength(2);
    expect(alice?.resources.meritBadges).toBe(1);
    expect(alice?.candidateStartingSpellId).toBe('base.spell.living-image');
    expect(s.mageDraftPool['off-white']).toBe(2);
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

  it('transitions to mage-draft (4p) once every player has picked their leader', () => {
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
    expect(s.phase.kind).toBe('mage-draft');
    if (s.phase.kind === 'mage-draft') {
      // Snake from firstPlayerIndex (0): [0,1,2,3, 3,2,1,0, 0,1,2,3]
      expect(s.phase.pickOrder).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
      expect(s.phase.nextPickIndex).toBe(0);
    }
    expect(s.players.every((p) => p.candidateId !== '')).toBe(true);
    // 2 leader mages each, draft picks pending.
    expect(s.players.every((p) => p.mages.length === 2)).toBe(true);
  });

  it('2-player games transition to mage-draft-first-choice after both leaders are picked', () => {
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
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p2',
      candidateId: 'base.candidate.byron-krane',
    });
    expect(s.phase.kind).toBe('mage-draft-first-choice');
    if (s.phase.kind === 'mage-draft-first-choice') {
      // 2nd leader-picker (Bob, index 1) gets the choice.
      expect(s.phase.chooserIndex).toBe(1);
    }
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
// Mage draft (post-leader, pre-game-start)
// ============================================================================

describe('Mage draft', () => {
  const DRAFT_CONFIG_2P = {
    activePackIds: ['base'],
    playerNames: ['Alice', 'Bob'],
    rngSeed: 7,
    useCandidateDraft: true,
  } satisfies GameConfig;

  const DRAFT_CONFIG_4P = {
    activePackIds: ['base'],
    playerNames: ['Alice', 'Bob', 'Cara', 'Dan'],
    rngSeed: 42,
    useCandidateDraft: true,
  } satisfies GameConfig;

  function withFirstPlayer(state: GameState, idx: number): GameState {
    if (state.phase.kind !== 'candidate-draft') return state;
    return {
      ...state,
      firstPlayerIndex: idx,
      phase: { kind: 'candidate-draft', activePlayerIndex: idx },
    };
  }

  /** Drives a 2-player setup through both leader picks; lands in mage-draft-first-choice. */
  function pickBothLeaders2P(): GameState {
    let s = withFirstPlayer(initGame(DRAFT_CONFIG_2P), 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.larimore-burman', // red
    });
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p2',
      candidateId: 'base.candidate.byron-krane', // grey
    });
    return s;
  }

  it('seeds the initial mage draft pool with 4 of each color', () => {
    const s = initGame(DRAFT_CONFIG_2P);
    expect(s.mageDraftPool).toEqual({
      red: 4,
      grey: 4,
      green: 4,
      blue: 4,
      purple: 4,
      'off-white': 4,
    });
  });

  it('CHOOSE_DRAFT_FIRST=true: chooser drafts first; pickOrder is [chooser,other,other,chooser,chooser,other]', () => {
    let s = pickBothLeaders2P();
    s = applyAction(s, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: true,
    });
    expect(s.phase.kind).toBe('mage-draft');
    if (s.phase.kind === 'mage-draft') {
      // p2 = index 1, p1 = index 0.
      expect(s.phase.pickOrder).toEqual([1, 0, 0, 1, 1, 0]);
      expect(s.phase.nextPickIndex).toBe(0);
    }
  });

  it('CHOOSE_DRAFT_FIRST=false: chooser passes; pickOrder is [other,chooser,chooser,other,other,chooser]', () => {
    let s = pickBothLeaders2P();
    s = applyAction(s, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: false,
    });
    expect(s.phase.kind).toBe('mage-draft');
    if (s.phase.kind === 'mage-draft') {
      // First drafter = p1 (index 0).
      expect(s.phase.pickOrder).toEqual([0, 1, 1, 0, 0, 1]);
    }
  });

  it('rejects CHOOSE_DRAFT_FIRST when not the chooser', () => {
    const s = pickBothLeaders2P();
    expect(() =>
      applyAction(s, {
        type: 'CHOOSE_DRAFT_FIRST',
        playerId: 'p1',
        draftFirst: true,
      }),
    ).toThrow(/only p2 may make this choice/);
  });

  it('DRAFT_MAGE: full 2-player draft (each player gets 2 leader + 3 drafted = 5)', () => {
    let s = pickBothLeaders2P();
    s = applyAction(s, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: false,
    });
    // pickOrder: [0,1,1,0,0,1]
    s = applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p1', color: 'green' });
    s = applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p2', color: 'green' });
    s = applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p2', color: 'blue' });
    s = applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p1', color: 'blue' });
    s = applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p1', color: 'purple' });
    s = applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p2', color: 'purple' });

    expect(s.phase).toEqual({ kind: 'round-setup', round: 1 });
    const alice = s.players.find((p) => p.id === 'p1');
    const bob = s.players.find((p) => p.id === 'p2');
    expect(alice?.mages).toHaveLength(5); // 2 red + 1 green + 1 blue + 1 purple
    expect(bob?.mages).toHaveLength(5); // 2 grey + 1 green + 1 blue + 1 purple

    // Pool decremented as expected: leader colors red/grey lose 2 each
    // from candidate allocation; blue/green/purple each lose 2 from drafts;
    // off-white untouched.
    expect(s.mageDraftPool).toEqual({
      red: 2,
      grey: 2,
      green: 2,
      blue: 2,
      purple: 2,
      'off-white': 4,
    });
  });

  it('rejects drafting a 3rd mage of a color the player already has 2 of (incl. leader color)', () => {
    let s = pickBothLeaders2P();
    s = applyAction(s, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: false,
    });
    // p1 (Larimore Burman) already has 2 red leader mages — cannot draft red.
    expect(() =>
      applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p1', color: 'red' }),
    ).toThrow(/cannot have more than 2 red mages/);
  });

  it('rejects drafting a color the pool has run out of', () => {
    let s = pickBothLeaders2P();
    s = applyAction(s, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: false,
    });
    // Artificially zero the blue pool — the 2-of-a-color cap would normally
    // stop a player from draining it on their own.
    s = { ...s, mageDraftPool: { ...s.mageDraftPool, blue: 0 } };
    expect(() =>
      applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p1', color: 'blue' }),
    ).toThrow(/no blue mages left/);
  });

  it('rejects drafting out of turn order', () => {
    let s = pickBothLeaders2P();
    s = applyAction(s, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: false,
    });
    expect(() =>
      applyAction(s, { type: 'DRAFT_MAGE', playerId: 'p2', color: 'green' }),
    ).toThrow(/not your pick/);
  });

  it('4-player draft uses snake order from firstPlayerIndex', () => {
    let s = withFirstPlayer(initGame(DRAFT_CONFIG_4P), 0);
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p1',
      candidateId: 'base.candidate.larimore-burman',
    });
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p2',
      candidateId: 'base.candidate.byron-krane',
    });
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p3',
      candidateId: 'base.candidate.rheye-cal',
    });
    s = applyAction(s, {
      type: 'CHOOSE_CANDIDATE',
      playerId: 'p4',
      candidateId: 'base.candidate.exhufern-le-marigras',
    });
    if (s.phase.kind !== 'mage-draft') throw new Error('expected mage-draft');
    expect(s.phase.pickOrder).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
  });

  it('rejects ADVANCE_PHASE during mage-draft phases', () => {
    const sFirstChoice = pickBothLeaders2P();
    expect(() => applyAction(sFirstChoice, { type: 'ADVANCE_PHASE' })).toThrow(
      /mage-draft-first-choice must end via CHOOSE_DRAFT_FIRST/,
    );
    const sDraft = applyAction(sFirstChoice, {
      type: 'CHOOSE_DRAFT_FIRST',
      playerId: 'p2',
      draftFirst: false,
    });
    expect(() => applyAction(sDraft, { type: 'ADVANCE_PHASE' })).toThrow(
      /mage-draft must end via DRAFT_MAGE/,
    );
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

function addSupporter(state: GameState, playerId: string, cardId: string): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    supporters: [...p.supporters, cardId],
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
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → forfeit-or-reward prompt
    s = takeRewardAtResolution(s); // → Library slot's OR prompt
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    expect(() =>
      applyAction(s, {
        type: 'PLACE_WORKER',
        playerId: 'p1',
        mageId: 'alice-mage-1',
        actionSpaceId: 'base.room.library.a.slot-1',
      }),
    ).toThrow(/not in office/);
  });

  it('allows placement on a merit slot even without enough Merit Badges (cost is deferred)', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 0);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.vault.a.slot-1',
    });
    // Mage seated, MB unchanged. Cost is checked at resolution time.
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.meritBadges).toBe(0);
    expect(alice?.resources.meritBadgesSpent).toBe(0);
    const vault = findRoom(s, (r) => r.name === 'Vault');
    expect(vault.actionSpaces[0]?.occupant?.mageId).toBe('alice-mage-1');
  });

  it('places on a merit slot without paying the cost up front (deduction happens at resolution)', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 2);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.vault.a.slot-1',
    });
    // Mage seated; merit cost not yet deducted (still 2/0).
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.meritBadges).toBe(2);
    expect(alice?.resources.meritBadgesSpent).toBe(0);
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
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
    'base.vault.mana-elixir',
    'base.vault.gilded-chalice',
    'base.vault.phase-steppers',
  ]);
  // Grant enough MB to take any merit-cost reward by default.
  s = setMeritBadges(s, 'p1', 5);
  s = { ...s, bellTower: { ...s.bellTower, available: [] } };
  return s;
}

function driveToVaultPrompt(state: GameState): GameState {
  let s = state;
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → forfeit-or-reward prompt
  // Take the reward to land on the slot's actual prompt (or done state).
  return takeRewardAtResolution(s);
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
      answer: { kind: 'card-chosen', cardId: 'base.vault.gilded-chalice' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(1); // unchanged — drafts don't cost gold
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.gilded-chalice', exhausted: false },
    ]);
    expect(s.vaultTableau).not.toContain('base.vault.gilded-chalice');
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
      answer: { kind: 'card-chosen', cardId: 'base.vault.mana-elixir' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(4);
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.mana-elixir', exhausted: false },
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
// PLAY_SUPPORTER action
// ============================================================================

describe('PLAY_SUPPORTER', () => {
  function setupSupporterTest(supporterId: string): GameState {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = addSupporter(s, 'p1', supporterId);
    s = {
      ...s,
      firstPlayerIndex: 0,
      phase: {
        kind: 'errands',
        round: 1,
        activePlayerIndex: 0,
        actionUsed: false,
        fastActionUsed: false,
      },
    };
    return s;
  }

  it('plays a fast-action supporter, consumes the Fast budget, moves card to discard', () => {
    let s = setupSupporterTest('base.supporter.kallistar-flarechild');
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.kallistar-flarechild',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.influence).toBe(1); // Kallistar grants 1 IP
    expect(alice?.supporters).toEqual([]);
    expect(alice?.personalDiscard).toEqual([
      { kind: 'supporter', cardId: 'base.supporter.kallistar-flarechild' },
    ]);
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.fastActionUsed).toBe(true);
    expect(s.phase.actionUsed).toBe(false);
  });

  it('plays an action-timing supporter and the turn auto-ends', () => {
    let s = setupSupporterTest('base.supporter.jasper-haekel');
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.jasper-haekel',
    });
    // Jasper Haekel pauses for a Mark prompt; resolve it.
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-voter');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId: s.voters[0]!.id },
    });
    // Resolution drained → action auto-advances to next player.
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.activePlayerIndex).toBe(1);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.marks).toBe(1);
  });

  it('rejects playing a passive (familiar) supporter', () => {
    const s = setupSupporterTest('base.supporter.salamander');
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p1',
        supporterCardId: 'base.supporter.salamander',
      }),
    ).toThrow(/cannot be played as an action/);
  });

  it("rejects playing a supporter the player doesn't own", () => {
    const s = setupSupporterTest('base.supporter.allys-mehrmus');
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p1',
        supporterCardId: 'base.supporter.salem-silver',
      }),
    ).toThrow(/not in your office/);
  });

  it('rejects playing a Fast Action supporter after Action is used', () => {
    let s = setupSupporterTest('base.supporter.allys-mehrmus');
    // Burn the Action via PASS_TURN's sibling? Cheaper: set actionUsed=true.
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    s = { ...s, phase: { ...s.phase, actionUsed: true } };
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p1',
        supporterCardId: 'base.supporter.allys-mehrmus',
      }),
    ).toThrow(/Fast Action must be taken BEFORE/);
  });

  it('grants 4 Mana for St. Mikhail Isen (Fast Action)', () => {
    let s = setupSupporterTest('base.supporter.st-mikhail-isen');
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.st-mikhail-isen',
    });
    expect(s.players.find((p) => p.id === 'p1')?.resources.mana).toBe(4);
  });

  it('the base pack ships all 36 supporter cards', () => {
    expect(baseGamePack.supporters).toHaveLength(36);
  });
});

// ============================================================================
// PLAY_VAULT_CARD action
// ============================================================================

describe('PLAY_VAULT_CARD', () => {
  function setupVaultPlay(vaultCardId: string): GameState {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = addVaultCard(s, 'p1', vaultCardId);
    s = {
      ...s,
      firstPlayerIndex: 0,
      phase: {
        kind: 'errands',
        round: 1,
        activePlayerIndex: 0,
        actionUsed: false,
        fastActionUsed: false,
      },
    };
    return s;
  }

  it('Mana Crystal (treasure, action): grants 2 Mana, exhausts in place', () => {
    let s = setupVaultPlay('base.vault.mana-crystal');
    s = applyAction(s, {
      type: 'PLAY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.mana-crystal',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.mana).toBe(2);
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.mana-crystal', exhausted: true },
    ]);
    expect(alice?.personalDiscard).toEqual([]);
  });

  it('Spirits (consumable, fast-action): pauses for Mark, moves to discard', () => {
    let s = setupVaultPlay('base.vault.spirits');
    s = applyAction(s, {
      type: 'PLAY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.spirits',
    });
    const aliceMid = s.players.find((p) => p.id === 'p1');
    // Card removed from vault, queued in discard.
    expect(aliceMid?.vaultCards).toEqual([]);
    expect(aliceMid?.personalDiscard).toEqual([
      { kind: 'consumable', cardId: 'base.vault.spirits' },
    ]);
    // Mark prompt now on the stack.
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-voter');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId: s.voters[0]!.id },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.marks).toBe(1);
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.phase.fastActionUsed).toBe(true);
    expect(s.phase.actionUsed).toBe(false);
  });

  it('Runestone (fast-action): OR prompt grants INT or WIS', () => {
    let s = setupVaultPlay('base.vault.runestone');
    s = applyAction(s, {
      type: 'PLAY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.runestone',
    });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: { kind: 'option-chosen', optionId: 'int', payload: {} },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.intelligence).toBe(1);
    expect(alice?.resources.wisdom).toBe(0);
  });

  it('rejects playing a reaction-timing card via PLAY_VAULT_CARD', () => {
    const s = setupVaultPlay('base.vault.phase-steppers');
    expect(() =>
      applyAction(s, {
        type: 'PLAY_VAULT_CARD',
        playerId: 'p1',
        vaultCardId: 'base.vault.phase-steppers',
      }),
    ).toThrow(/fire from a reaction window/);
  });

  it('rejects playing a card the player does not own', () => {
    const s = setupVaultPlay('base.vault.mana-crystal');
    expect(() =>
      applyAction(s, {
        type: 'PLAY_VAULT_CARD',
        playerId: 'p1',
        vaultCardId: 'base.vault.gilded-chalice',
      }),
    ).toThrow(/not in your vault/);
  });

  it('rejects playing an exhausted treasure (until refresh)', () => {
    let s = setupVaultPlay('base.vault.mana-crystal');
    s = applyAction(s, {
      type: 'PLAY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.mana-crystal',
    });
    // Action consumed → turn auto-advanced. Reset back to alice's turn with
    // a fresh budget to isolate the "exhausted treasure" guard.
    s = {
      ...s,
      phase: {
        kind: 'errands',
        round: 1,
        activePlayerIndex: 0,
        actionUsed: false,
        fastActionUsed: false,
      },
    };
    expect(() =>
      applyAction(s, {
        type: 'PLAY_VAULT_CARD',
        playerId: 'p1',
        vaultCardId: 'base.vault.mana-crystal',
      }),
    ).toThrow(/not in your vault|exhausted/);
  });

  it('exhausted treasures refresh at round-setup of next round', () => {
    let s = setupVaultPlay('base.vault.mana-crystal');
    s = applyAction(s, {
      type: 'PLAY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.mana-crystal',
    });
    // Drain bell tower, run resolution, mid-game, round 2 setup → errands.
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → resolution
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → mid-game-scoring
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → round-setup round 2
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → errands round 2
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.mana-crystal', exhausted: false },
    ]);
  });

  it('the base pack ships all 26 vault cards', () => {
    expect(baseGamePack.vaultCards).toHaveLength(26);
  });

  it('the base pack ships 26 spell books (25 from the sheet + the Burn vertical-slice card)', () => {
    // 25 regular base game spell books + Burn (used by the engine tests).
    expect(baseGamePack.spells).toHaveLength(26);
    // Each book has three levels with names + costs + timings + effect ids.
    for (const book of baseGamePack.spells) {
      expect(book.levels).toHaveLength(3);
      for (const lvl of book.levels) {
        expect(lvl.title).toBeTruthy();
        expect(lvl.effectId).toBeTruthy();
        expect(typeof lvl.manaCost).toBe('number');
      }
    }
  });

  it('the base pack ships 11 legendary spell books (6 candidate starters + 5 from the sheet)', () => {
    expect(baseGamePack.legendarySpells).toHaveLength(11);
    // Each candidate's starter must appear in the legendary list.
    const ids = new Set(baseGamePack.legendarySpells.map((s) => s.id));
    for (const cand of baseGamePack.candidates) {
      expect(ids.has(cand.starterSpellId)).toBe(true);
    }
  });

  it('initial spell tableau holds 3 cards drawn from the base deck', () => {
    const s = initGame(TWO_PLAYER_CONFIG);
    expect(s.spellTableau).toHaveLength(3);
    expect(s.spellDeck.length + s.spellTableau.length).toBe(
      baseGamePack.spells.length,
    );
    // None of the candidate starter spells (or other legendaries) should be
    // shuffled into the regular deck.
    const legendaryIds = new Set(baseGamePack.legendarySpells.map((s) => s.id));
    for (const cid of [...s.spellTableau, ...s.spellDeck]) {
      expect(legendaryIds.has(cid)).toBe(false);
    }
  });

  it('initial vault deck size reflects all card copies (38 total)', () => {
    const s = initGame(TWO_PLAYER_CONFIG);
    const totalCopies = baseGamePack.vaultCards.reduce(
      (sum, c) => sum + (c.copies ?? 1),
      0,
    );
    expect(s.vaultDeck.length + s.vaultTableau.length).toBe(totalCopies);
  });

  it('buying one copy of a duplicate leaves the other copy in the tableau', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = setGold(s, 'p1', 10);
    // Force two Mana Crystal copies into the tableau.
    s = setVaultTableau(s, [
      'base.vault.mana-crystal',
      'base.vault.mana-crystal',
      'base.vault.spirits',
    ]);
    s = {
      ...s,
      firstPlayerIndex: 0,
      phase: {
        kind: 'errands',
        round: 1,
        activePlayerIndex: 0,
        actionUsed: false,
        fastActionUsed: false,
      },
    };
    s = applyAction(s, {
      type: 'BUY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.mana-crystal',
    });
    expect(s.vaultTableau).toEqual([
      'base.vault.mana-crystal',
      'base.vault.spirits',
    ]);
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
      'base.vault.mana-elixir',
      'base.vault.phase-steppers',
    ]);
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    return s;
  }

  it('moves card to player, deducts gold, removes from tableau', () => {
    let s = setupBuyAction();
    s = applyAction(s, {
      type: 'BUY_VAULT_CARD',
      playerId: 'p1',
      vaultCardId: 'base.vault.mana-elixir',
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(2); // 4 - 2
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.mana-elixir', exhausted: false },
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
        vaultCardId: 'base.vault.mana-elixir', // costs 2
      }),
    ).toThrow(/insufficient gold/);
  });

  it('rejects when card is not in the tableau', () => {
    let s = setupBuyAction();
    expect(() =>
      applyAction(s, {
        type: 'BUY_VAULT_CARD',
        playerId: 'p1',
        vaultCardId: 'base.vault.gilded-chalice', // not in tableau
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

    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };

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
  // Grant enough MB to take any merit-cost reward by default; tests that
  // exercise the "can't afford" path override this to 0.
  s = setMeritBadges(s, 'p1', 5);
  s = { ...s, bellTower: { ...s.bellTower, available: [] } };
  return s;
}

function driveToResolution(state: GameState): GameState {
  let s = state;
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → forfeit-or-reward prompt
  // Resolve the forfeit-or-reward prompt by taking the reward; tests that
  // want to exercise the forfeit path should use `forfeitAtResolution` below.
  return takeRewardAtResolution(s);
}

/** Resolves the top-of-stack forfeit-or-reward prompt by picking 'reward'. */
function takeRewardAtResolution(state: GameState): GameState {
  const top = topPending(state);
  if (top.resume.effectId !== 'base.system.resolution-choice') {
    throw new Error(
      `takeRewardAtResolution: top of stack is ${top.resume.effectId}, not base.system.resolution-choice`,
    );
  }
  return applyAction(state, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'option-chosen', optionId: 'reward', payload: {} },
  });
}

/** Resolves the top-of-stack forfeit-or-reward prompt by picking 'forfeit'. */
function forfeitAtResolution(state: GameState): GameState {
  const top = topPending(state);
  if (top.resume.effectId !== 'base.system.resolution-choice') {
    throw new Error(
      `forfeitAtResolution: top of stack is ${top.resume.effectId}, not base.system.resolution-choice`,
    );
  }
  return applyAction(state, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'option-chosen', optionId: 'forfeit', payload: {} },
  });
}

// ============================================================================
// Resolution-time forfeit-or-reward prompt
// ============================================================================

describe('Resolution forfeit-or-reward', () => {
  it('every occupied space prompts the player to choose reward or forfeit', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-3');
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → forfeit-or-reward prompt
    const top = topPending(s);
    expect(top.resume.effectId).toBe('base.system.resolution-choice');
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      const ids = top.prompt.options.map((o) => o.id).sort();
      expect(ids).toEqual(['forfeit', 'reward']);
    }
  });

  it('forfeit grants the player 1 IP and skips the slot effect', () => {
    let s = setupRoomSlotTest('Vault', 'A', 'base.room.vault.a.slot-3');
    // Slot 3 is "Gain 3 Gold" — taking reward would give 3 gold; forfeit gives 1 IP.
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = forfeitAtResolution(s);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.influence).toBe(1);
    expect(alice?.resources.gold).toBe(0);
    // Mage returned to office, resolution continued past the slot.
    const aliceMage = findMageById(s, 'alice-mage-1');
    expect(aliceMage.location).toEqual({ kind: 'office', playerId: 'p1' });
  });

  it('reward on a non-merit slot runs the effect with no MB cost', () => {
    let s = setupRoomSlotTest('Vault', 'A', 'base.room.vault.a.slot-3');
    s = setMeritBadges(s, 'p1', 0);
    s = driveToResolution(s); // takeReward auto-applied
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.gold).toBe(3);
    expect(alice?.resources.influence).toBe(0);
    expect(alice?.resources.meritBadges).toBe(0);
    expect(alice?.resources.meritBadgesSpent).toBe(0);
  });

  it('merit slot: reward option is unavailable if the player cannot afford it', () => {
    let s = setupRoomSlotTest('Vault', 'A', 'base.room.vault.a.slot-1');
    s = setMeritBadges(s, 'p1', 0); // overrides the helper's default
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      const reward = top.prompt.options.find((o) => o.id === 'reward');
      const forfeit = top.prompt.options.find((o) => o.id === 'forfeit');
      expect(reward?.available).toBe(false);
      expect(reward?.unavailableReason).toMatch(/Merit Badge/);
      expect(forfeit?.available).not.toBe(false); // available or undefined
    }
    // Resolving with forfeit grants the IP fallback.
    s = forfeitAtResolution(s);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.influence).toBe(1);
  });

  it('merit slot: reward deducts the cost and runs the effect', () => {
    let s = setupRoomSlotTest('Vault', 'A', 'base.room.vault.a.slot-1');
    s = setMeritBadges(s, 'p1', 1);
    s = setVaultTableau(s, ['base.vault.mana-elixir']);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = takeRewardAtResolution(s);
    // Vault A slot 1: Draft a Vault card AND gain 4 gold (after MB deducted).
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s).id,
      answer: {
        kind: 'card-chosen',
        cardId: 'base.vault.mana-elixir',
      },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.meritBadges).toBe(0);
    expect(alice?.resources.meritBadgesSpent).toBe(1);
    expect(alice?.resources.gold).toBe(4);
  });

  it('placement on a merit slot without MB succeeds; resolution forfeit grants 1 IP', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceVaultSideA(s);
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 0);
    s = {
      ...s,
      firstPlayerIndex: 0,
      phase: {
        kind: 'errands',
        round: 1,
        activePlayerIndex: 0,
        actionUsed: false,
        fastActionUsed: false,
      },
    };
    // Place without MB — succeeds.
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.vault.a.slot-1',
    });
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    // Reward unavailable → only forfeit is viable.
    s = forfeitAtResolution(s);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.influence).toBe(1);
    expect(alice?.resources.gold).toBe(0);
    expect(alice?.resources.meritBadges).toBe(0);
  });

  it('instant rooms (Guilds): forfeit at placement gains 1 IP and skips the slot effect', () => {
    let s = initGame(TWO_PLAYER_CONFIG);
    s = forceRoomSide(s, 'Guilds', 'A');
    s = addMage(s, 'p1', {
      id: 'alice-mage-1',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = setMeritBadges(s, 'p1', 0);
    s = {
      ...s,
      firstPlayerIndex: 0,
      phase: {
        kind: 'errands',
        round: 1,
        activePlayerIndex: 0,
        actionUsed: false,
        fastActionUsed: false,
      },
    };
    // Slot 1 is merit-cost, but the player can place anyway. They forfeit at
    // the placement-time prompt and take the IP.
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.guilds.a.slot-1',
    });
    s = forfeitAtResolution(s);
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.influence).toBe(1);
    expect(alice?.resources.gold).toBe(0);
    expect(alice?.resources.mana).toBe(0);
    expect(alice?.resources.meritBadges).toBe(0);
  });
});

describe('Library A slot 1 (merit, 1 MB): WIS + Vault Draft', () => {
  it('opens choose-vault-card and grants WIS + drafted card', () => {
    let s = setupRoomSlotTest('Library', 'A', 'base.room.library.a.slot-1');
    s = setVaultTableau(s, ['base.vault.mana-elixir']);
    s = driveToResolution(s);
    const top = topPending(s);
    expect(top.prompt.kind).toBe('choose-vault-card');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'card-chosen', cardId: 'base.vault.mana-elixir' },
    });
    const alice = s.players.find((p) => p.id === 'p1');
    expect(alice?.resources.wisdom).toBe(1);
    expect(alice?.vaultCards).toEqual([
      { cardId: 'base.vault.mana-elixir', exhausted: false },
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
    s = setVaultTableau(s, ['base.vault.mana-elixir']); // 2g
    s = setGold(s, 'p1', 2);
    s = driveToResolution(s);
    const buyPrompt = topPending(s);
    expect(buyPrompt.prompt.kind).toBe('choose-from-options');
    if (buyPrompt.prompt.kind === 'choose-from-options') {
      const optionIds = buyPrompt.prompt.options.map((o) => o.id).sort();
      expect(optionIds).toEqual([
        'base.vault.mana-elixir',
        'skip',
      ]);
    }
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: buyPrompt.id,
      answer: {
        kind: 'option-chosen',
        optionId: 'base.vault.mana-elixir',
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    return s;
  }

  it('slot 2 placement opens forfeit-or-reward; picking reward opens the slot OR prompt', () => {
    let s = setupGuildsPlacement();
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.guilds.a.slot-2',
    });
    expect(s.phase.kind).toBe('errands');
    const top = topPending(s);
    expect(top.resume.effectId).toBe('base.system.resolution-choice');
    s = takeRewardAtResolution(s);
    const after = topPending(s);
    expect(after.prompt.kind).toBe('choose-from-options');
    if (after.prompt.kind === 'choose-from-options') {
      expect(after.prompt.options.map((o) => o.label).sort()).toEqual([
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
    s = takeRewardAtResolution(s);
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
    s = takeRewardAtResolution(s);
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
    s = takeRewardAtResolution(s);
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    // Alice places her first mage — auto-advances to Bob.
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.council-chamber.a.slot-2',
    });
    // Bob passes; Alice's turn comes back around with a fresh action budget.
    s = applyAction(s, { type: 'PASS_TURN', playerId: 'p2' });
    if (s.phase.kind !== 'errands') throw new Error('not errands');
    expect(s.players[s.phase.activePlayerIndex]?.id).toBe('p1');
    // The room limit (1 mage / player / round) now blocks the second placement.
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'alice-mage-1',
      actionSpaceId: 'base.room.council-chamber.a.slot-2',
    });
    expect(s.players[0]?.roundPlacements).toContain('base.room.council-chamber.a');

    // Drain bell tower; drive through resolution → mid-game → round 2 setup.
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    s = setMeritBadges(s, 'p1', 5); // afford the merit-slot reward
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → forfeit-or-reward prompt
    s = takeRewardAtResolution(s); // → Council slot's OR prompt
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };
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
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false } };

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
