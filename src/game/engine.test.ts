import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import type { GameConfig, GamePhase, GameState } from './types';

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

  it('different seeds produce different room layouts', () => {
    const a = initGame({ ...FOUR_PLAYER_CONFIG, rngSeed: 1 });
    const b = initGame({ ...FOUR_PLAYER_CONFIG, rngSeed: 2 });
    // With distinct seeds the variable room draw should differ in either id
    // or side selection. (Not strictly guaranteed by every two seeds, but
    // exceptionally unlikely to coincide for these.)
    const aIds = a.rooms.map((r) => r.id).join(',');
    const bIds = b.rooms.map((r) => r.id).join(',');
    expect(aIds).not.toEqual(bIds);
  });
});
