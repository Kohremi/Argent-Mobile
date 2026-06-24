import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { findBoardInconsistency } from './boardInvariant';
import { getBotPersonality } from './ai';
import { getPack } from '../content/registry';
import { botDecisionContext } from '../utils/uiSelectors';
import { createRng } from '../utils/rng';
import type { GameAction, GameConfig, GameState, Player } from './types';

// ============================================================================
// Dimensional Rift scenario — the round-toggle / scenario framework plus the
// six per-scenario mechanics (global empty-room flip + R1..R5 rules).
// ============================================================================

const RIFT_CONFIG = (players: string[]): GameConfig => ({
  activePackIds: ['base'],
  playerNames: players,
  rngSeed: 4242,
  scenarioId: 'dimensional-rift',
  roomLayoutMode: { kind: 'first-time' },
});

/** initGame → one ADVANCE_PHASE lands on errands round 1. */
function startRiftErrands(players: string[]): GameState {
  let s = initGame(RIFT_CONFIG(players));
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
  if (s.phase.kind !== 'errands') throw new Error('expected errands');
  return { ...s, firstPlayerIndex: 0, phase: { ...s.phase, activePlayerIndex: 0 } };
}

/** Forces the errands phase onto a specific round (rule lookup keys off round). */
function forceErrandsRound(s: GameState, round: 1 | 2 | 3 | 4 | 5): GameState {
  return {
    ...s,
    phase: {
      kind: 'errands',
      round,
      activePlayerIndex: 0,
      actionUsed: false,
      fastActionUsed: false,
    },
  };
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

/** Drops a base (and optionally shadow) occupant onto a specific action space. */
function occupy(
  state: GameState,
  spaceId: string,
  base: { mageId: string; ownerId: string } | null,
  shadow?: { mageId: string; ownerId: string },
): GameState {
  return {
    ...state,
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((sp) =>
        sp.id !== spaceId
          ? sp
          : {
              ...sp,
              occupant: base
                ? { mageId: base.mageId, ownerId: base.ownerId, isShadowing: false }
                : null,
              shadowOccupant: shadow
                ? { mageId: shadow.mageId, ownerId: shadow.ownerId, isShadowing: true }
                : null,
            },
      ),
    })),
  };
}

function findRoomBySide(state: GameState, baseId: string): string | undefined {
  // baseId like 'base.room.vault' — return whichever side is in play.
  return state.rooms.find((r) => r.id.startsWith(`${baseId}.`))?.id;
}

// ----------------------------------------------------------------------------
// Framework plumbing
// ----------------------------------------------------------------------------

describe('Scenario framework plumbing', () => {
  it('threads scenarioId onto the game state', () => {
    const s = initGame(RIFT_CONFIG(['Alice', 'Bob']));
    expect(s.scenarioId).toBe('dimensional-rift');
    expect(s.passedForRoundPlayerIds).toEqual([]);
  });

  it('threads an explicit totalRounds override (normal game)', () => {
    const s = initGame({
      activePackIds: ['base'],
      playerNames: ['Alice', 'Bob'],
      rngSeed: 1,
      totalRounds: 6,
    });
    expect(s.totalRoundsOverride).toBe(6);
    expect(s.scenarioId).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Global rule — empty rooms flip at the end of each round's errands
// ----------------------------------------------------------------------------

describe('Dimensional Rift — empty rooms flip', () => {
  it('flips empty rooms to their other side, leaving occupied rooms put', () => {
    // Round 2: errands ends straight into resolution (no R1 bonus pass).
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 2);
    // Occupy a Library slot so it survives the flip; everything else is empty.
    s = occupy(s, 'base.room.library.a.slot-1', { mageId: 'm1', ownerId: 'p1' });
    s = { ...s, bellTower: { available: [], taken: [] } };

    const before = s.rooms.map((r) => r.id);
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution (+ flip)
    expect(s.phase.kind).toBe('resolution');

    // Library stayed on side A (occupied).
    expect(findRoomBySide(s, 'base.room.library')).toBe('base.room.library.a');
    // The Vault was empty → flipped to side B, and the grid id updated.
    expect(findRoomBySide(s, 'base.room.vault')).toBe('base.room.vault.b');
    expect(s.roomLayout.grid.flat()).toContain('base.room.vault.b');
    expect(s.roomLayout.grid.flat()).not.toContain('base.room.vault.a');
    // Something actually changed.
    expect(s.rooms.map((r) => r.id)).not.toEqual(before);
  });

  it('does not flip rooms in a normal (non-scenario) game', () => {
    let s = initGame({
      activePackIds: ['base'],
      playerNames: ['Alice', 'Bob'],
      rngSeed: 4242,
      roomLayoutMode: { kind: 'first-time' },
    });
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → errands
    s = { ...s, bellTower: { available: [], taken: [] } };
    const before = s.rooms.map((r) => r.id);
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // → resolution
    expect(s.rooms.map((r) => r.id)).toEqual(before);
  });
});

// ----------------------------------------------------------------------------
// R2 Time Races — Fast Actions cost +1 Mana
// ----------------------------------------------------------------------------

describe('Dimensional Rift R2 — Fast Action mana surcharge', () => {
  it('charges 1 extra Mana for a Fast Action', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 2);
    s = addSupporter(s, 'p1', 'base.supporter.allys-mehrmus');
    s = setMana(s, 'p1', 5);
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.allys-mehrmus',
    });
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p1.resources.mana).toBe(4);
  });

  it('blocks a Fast Action the player cannot afford', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 2);
    s = addSupporter(s, 'p1', 'base.supporter.allys-mehrmus');
    s = setMana(s, 'p1', 0);
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p1',
        supporterCardId: 'base.supporter.allys-mehrmus',
      }),
    ).toThrow(/extra Mana/);
  });
});

// ----------------------------------------------------------------------------
// R3 Time Stands Still — up to 2 Fast Actions per turn
// ----------------------------------------------------------------------------

describe('Dimensional Rift R3 — two Fast Actions', () => {
  it('allows a second Fast Action in the same turn', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 3);
    s = addSupporter(s, 'p1', 'base.supporter.allys-mehrmus');
    s = addSupporter(s, 'p1', 'base.supporter.kallistar-flarechild');
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.allys-mehrmus',
    });
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.phase.fastActionsUsed).toBe(1);
    expect(s.phase.fastActionUsed).toBe(false); // limit is 2 this round
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.kallistar-flarechild',
    });
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.phase.fastActionsUsed).toBe(2);
    expect(s.phase.fastActionUsed).toBe(true); // now exhausted
    expect(s.phase.actionUsed).toBe(false); // Regular Action still owed
  });

  it('still rejects a Fast Action once the (raised) limit is reached', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 3);
    s = addSupporter(s, 'p1', 'base.supporter.allys-mehrmus');
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    s = { ...s, phase: { ...s.phase, fastActionsUsed: 2 } };
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p1',
        supporterCardId: 'base.supporter.allys-mehrmus',
      }),
    ).toThrow(/already used your Fast Action/);
  });
});

// ----------------------------------------------------------------------------
// Skip Fast Action — decline a forced Fast Action to dodge the surcharge
// ----------------------------------------------------------------------------

describe('Dimensional Rift — skip fast action', () => {
  it('exhausts the Fast Action budget without ending the turn', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 2);
    s = applyAction(s, { type: 'SKIP_FAST_ACTION', playerId: 'p1' });
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.phase.activePlayerIndex).toBe(0); // still p1's turn
    expect(s.phase.actionUsed).toBe(false); // Regular Action still owed
    expect(s.phase.fastActionUsed).toBe(true); // fast budget forfeited
    expect(s.phase.fastActionsUsed).toBe(1);
  });

  it('blocks a Fast Action once it has been skipped (no surcharge taken)', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 2);
    s = setMana(s, 'p1', 5);
    s = addSupporter(s, 'p1', 'base.supporter.allys-mehrmus');
    s = applyAction(s, { type: 'SKIP_FAST_ACTION', playerId: 'p1' });
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p1',
        supporterCardId: 'base.supporter.allys-mehrmus',
      }),
    ).toThrow(/already used your Fast Action/);
    // Mana untouched — no surcharge was ever paid.
    expect(s.players.find((p) => p.id === 'p1')!.resources.mana).toBe(5);
  });

  it('rejects skipping after the Regular Action is spent', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 2);
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    s = { ...s, phase: { ...s.phase, actionUsed: true } };
    expect(() =>
      applyAction(s, { type: 'SKIP_FAST_ACTION', playerId: 'p1' }),
    ).toThrow(/Regular Action is already spent/);
  });
});

// ----------------------------------------------------------------------------
// R4 Reality Inversion — shadow mages resolve before base mages
// ----------------------------------------------------------------------------

describe('Dimensional Rift R4 — shadow resolves first', () => {
  function setupResolution(round: 2 | 4): GameState {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), round);
    // Library A slot-4 carries an effect (forfeit-or-reward prompt). Seat
    // p1 in the base slot and p2 in the shadow slot.
    s = occupy(
      s,
      'base.room.library.a.slot-4',
      { mageId: 'mA', ownerId: 'p1' },
      { mageId: 'mB', ownerId: 'p2' },
    );
    s = { ...s, bellTower: { available: [], taken: [] } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump → first prompt
    return s;
  }

  it('prompts the shadow occupant first under Reality Inversion (R4)', () => {
    const s = setupResolution(4);
    const top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
    expect(top?.responderId).toBe('p2');
  });

  it('prompts the base occupant first in a normal round (R2)', () => {
    const s = setupResolution(2);
    const top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
    expect(top?.responderId).toBe('p1');
  });
});

// ----------------------------------------------------------------------------
// R1 Temporal Breakdown — round-end bonus action in turn order
// ----------------------------------------------------------------------------

describe('Dimensional Rift R1 — round-end bonus action', () => {
  it('grants each player one more Action, last bell-claimer acts last', () => {
    let s = startRiftErrands(['Alice', 'Bob', 'Cara']); // round 1
    // p2 (Bob) took the last bell-tower offering; tower now empty.
    s = {
      ...s,
      bellTower: { available: [], taken: [{ cardId: 'base.bell.gain-ip', takenBy: 'p2' }] },
    };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // enter bonus pass
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.phase.bonusActionRound).toBe(true);
    expect(s.phase.bonusActionsRemaining).toBe(3);
    expect(s.phase.fastActionUsed).toBe(true); // no Fast Action in the bonus pass
    expect(s.phase.activePlayerIndex).toBe(2); // player AFTER p2 (index 1)

    s = applyAction(s, { type: 'PASS_TURN', playerId: 'p3' });
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.phase.activePlayerIndex).toBe(0);
    s = applyAction(s, { type: 'PASS_TURN', playerId: 'p1' });
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.phase.activePlayerIndex).toBe(1); // p2 acts last
    s = applyAction(s, { type: 'PASS_TURN', playerId: 'p2' });
    expect(s.phase.kind).toBe('resolution'); // pass complete → resolution
  });

  it('disallows Fast Actions during the bonus pass', () => {
    let s = startRiftErrands(['Alice', 'Bob']);
    s = {
      ...s,
      bellTower: { available: [], taken: [{ cardId: 'base.bell.gain-ip', takenBy: 'p1' }] },
    };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // enter bonus pass (active p2)
    s = addSupporter(s, 'p2', 'base.supporter.allys-mehrmus');
    expect(() =>
      applyAction(s, {
        type: 'PLAY_SUPPORTER',
        playerId: 'p2',
        supporterCardId: 'base.supporter.allys-mehrmus',
      }),
    ).toThrow(/no Fast Actions/);
  });
});

// ----------------------------------------------------------------------------
// R5 Time Flux — voluntary-pass round
// ----------------------------------------------------------------------------

describe('Dimensional Rift R5 — voluntary-pass round', () => {
  it('round-setup deals no bell-tower cards and resets the pass list', () => {
    let s = startRiftErrands(['Alice', 'Bob']);
    s = { ...s, phase: { kind: 'round-setup', round: 5 } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands r5
    expect(s.phase.kind).toBe('errands');
    expect(s.bellTower.available).toHaveLength(0);
    expect(s.passedForRoundPlayerIds).toEqual([]);
  });

  it('continues until every player passes, then ends the round', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 5);
    s = { ...s, bellTower: { available: [], taken: [] }, passedForRoundPlayerIds: [] };

    // An empty bell tower must NOT end the round on its own.
    s = applyAction(s, { type: 'PASS_FOR_ROUND', playerId: 'p1' });
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.passedForRoundPlayerIds).toContain('p1');
    expect(s.phase.activePlayerIndex).toBe(1); // advanced to the un-passed player

    s = applyAction(s, { type: 'PASS_FOR_ROUND', playerId: 'p2' });
    expect(s.phase.kind).toBe('resolution'); // everyone passed → round ends
  });

  it('treats a plain PASS_TURN as PASS_FOR_ROUND (bot safety net)', () => {
    let s = forceErrandsRound(startRiftErrands(['Alice', 'Bob']), 5);
    s = { ...s, bellTower: { available: [], taken: [] }, passedForRoundPlayerIds: [] };
    s = applyAction(s, { type: 'PASS_TURN', playerId: 'p1' });
    expect(s.passedForRoundPlayerIds).toContain('p1');
  });
});

// ----------------------------------------------------------------------------
// End-to-end — all-bot Dimensional Rift game completes without stalling/desync
// ----------------------------------------------------------------------------

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;

/** Drives one all-bot Dimensional Rift game; returns an error string or null. */
function runRiftGame(seed: number): string | null {
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);
  const candidateIds = getPack('base')!
    .candidates.filter((c) => c.startingMageColor !== 'neutral')
    .map((c) => c.id);
  let s = initGame({
    activePackIds: ['base'],
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    rngSeed: seed,
    controlledByBot: [true, true, true, true],
    botPersonalityIds: PERSONALITIES.map((_, i) => PERSONALITIES[(i + seed) % 4]!),
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' },
    scenarioId: 'dimensional-rift',
  });
  let steps = 0;
  while (s.phase.kind !== 'complete' && steps < 40000) {
    const ctx = botDecisionContext(s);
    let action: GameAction | null = null;
    if (ctx?.kind === 'advance') action = { type: 'ADVANCE_PHASE' };
    else if (ctx?.kind === 'prompt') {
      const bot = getBotPersonality(
        s.players.find((p) => p.id === ctx.pending.responderId)?.botPersonalityId,
      );
      action = {
        type: 'RESOLVE_PENDING',
        resolutionId: ctx.pending.id,
        answer: bot.answerPendingResolution(s, ctx.pending),
      };
    } else if (ctx?.kind === 'errands') {
      const bot = getBotPersonality(
        s.players.find((p) => p.id === ctx.playerId)?.botPersonalityId,
      );
      action = bot.chooseErrandsAction(s, ctx.playerId);
    } else {
      switch (s.phase.kind) {
        case 'candidate-draft': {
          const pid = s.players[s.phase.activePlayerIndex]!.id;
          const taken = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
          const avail = candidateIds.filter((id) => !taken.has(id));
          action = { type: 'CHOOSE_CANDIDATE', playerId: pid, candidateId: avail[rnd(avail.length)]! };
          break;
        }
        case 'mage-draft-first-choice':
          action = {
            type: 'CHOOSE_DRAFT_FIRST',
            playerId: s.players[s.phase.chooserIndex]!.id,
            draftFirst: rng() < 0.5,
          };
          break;
        case 'mage-draft': {
          const player = s.players[s.phase.pickOrder[s.phase.nextPickIndex]!]!;
          const draftable = (c: string) =>
            (s.mageDraftPool[c as keyof typeof s.mageDraftPool] ?? 0) > 0 &&
            player.mages.filter((m) => m.color === c).length < 2;
          const allLegal = Object.keys(s.mageDraftPool).filter(draftable);
          const nonWhite = allLegal.filter((c) => c !== 'off-white');
          const pool = nonWhite.length > 0 ? nonWhite : allLegal;
          action = { type: 'DRAFT_MAGE', playerId: player.id, color: pool[rnd(pool.length)] as never };
          break;
        }
        default:
          return `seed=${seed} unexpected idle phase ${s.phase.kind}`;
      }
    }
    if (!action) return `seed=${seed} no action at phase ${s.phase.kind}`;
    try {
      s = applyAction(s, action);
    } catch (e) {
      return `seed=${seed} threw on ${action.type}: ${(e as Error).message.split('\n')[0]}`;
    }
    const broke = findBoardInconsistency(s);
    if (broke) return `seed=${seed} board desync: ${broke}`;
    steps++;
  }
  if (s.phase.kind !== 'complete') return `seed=${seed} did not complete (stalled at ${s.phase.kind})`;
  return null;
}

describe('Dimensional Rift — full all-bot games', () => {
  it('complete in exactly 5 rounds without stalling or desyncing the board', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const result = runRiftGame(seed);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });
});
