// Tests for Thickhide, the random-but-instinctive bot. Decisions are pure and
// seeded from the state, so we sample across several seeds (by varying
// nextSequenceId) to exercise her randomness while keeping each call legal.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import { baseGamePack } from '../../content/packs/base';
import type { ActionSpace, GameState, OwnedMage, PendingResolution, Room } from '../types';
import { botDecisionContext } from '../../utils/uiSelectors';
import { thickhide } from './thickhide';

function errandsGame(bots: boolean): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['Akko', 'Diana'],
    rngSeed: 21,
    controlledByBot: bots ? [true, true] : [false, false],
    botPersonalityIds: bots ? ['thickhide', 'thickhide'] : [undefined, undefined],
  });
  return {
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
}

const mage = (id: string, pid: string): OwnedMage => ({
  id,
  cardId: 'base.mage.neutral',
  color: 'off-white',
  location: { kind: 'office', playerId: pid },
  isShadowing: false,
  isWounded: false,
});

function seatMages(s: GameState, playerIdx: number, ids: string[], extra?: Partial<GameState['players'][number]['resources']>): GameState {
  const pid = s.players[playerIdx]!.id;
  return {
    ...s,
    players: s.players.map((p, i) =>
      i !== playerIdx
        ? p
        : {
            ...p,
            resources: { ...p.resources, mana: 5, gold: 5, ...extra },
            mages: ids.map((id) => mage(id, pid)),
          },
    ),
  };
}

/** Swap a Merit-slot room (Guilds B has a 1-Merit-Badge slot) into the board. */
function withMeritRoom(s: GameState): { state: GameState; meritIds: Set<string> } {
  const guildsB = JSON.parse(
    JSON.stringify(baseGamePack.rooms.find((r) => r.name === 'Guilds' && r.side === 'B')!),
  ) as Room;
  const idx = s.rooms.findIndex(
    (r) => !r.isUniversityCentral && !r.cannotBePlacedInDirectly,
  );
  const rooms = s.rooms.map((r, i) => (i === idx ? guildsB : r));
  const meritIds = new Set<string>();
  for (const r of rooms) {
    for (const sp of r.actionSpaces) {
      if (sp.slotType === 'merit' || sp.slotType === 'shadow-merit') meritIds.add(sp.id);
    }
  }
  return { state: { ...s, rooms }, meritIds };
}

/** Vary the RNG seed by bumping nextSequenceId, sampling Thickhide's choices. */
function sampleActions(s: GameState, n: number) {
  const pid = s.players[0]!.id;
  const actions = [];
  for (let seq = 1; seq <= n; seq++) {
    const sv: GameState = { ...s, nextSequenceId: seq };
    const action = thickhide.chooseErrandsAction(sv, pid);
    expect(() => applyAction(sv, action)).not.toThrow(); // every choice is legal
    actions.push(action);
  }
  return actions;
}

describe('Thickhide — merit instinct', () => {
  it('avoids Merit slots when she has no Merit Badges', () => {
    let { state, meritIds } = withMeritRoom(errandsGame(true));
    state = seatMages(state, 0, ['a1'], { meritBadges: 0 });
    const actions = sampleActions(state, 30);
    for (const a of actions) {
      if (a.type === 'PLACE_WORKER') {
        expect(meritIds.has(a.actionSpaceId)).toBe(false);
      }
    }
  });

  it('seeks Merit slots when she holds Merit Badges (and can afford them)', () => {
    let { state, meritIds } = withMeritRoom(errandsGame(true));
    // Badges to spend, no spells/items → 'place' is the only category, so with
    // Badges in hand she always reaches for a Merit slot.
    state = seatMages(state, 0, ['a1'], { meritBadges: 2 });
    const actions = sampleActions(state, 30);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.type).toBe('PLACE_WORKER');
      if (a.type === 'PLACE_WORKER') {
        expect(meritIds.has(a.actionSpaceId)).toBe(true);
      }
    }
  });
});

describe('Thickhide — affordability filter', () => {
  it('never places where she cannot meet the activation cost', () => {
    let s = errandsGame(true);
    // Make every base slot cost more Mana than she has, so all placements are
    // "not useful" → she should never place (falls back to bell / pass).
    const rooms: Room[] = s.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map(
        (sp): ActionSpace => ({ ...sp, costToActivate: { ...sp.costToActivate, mana: 99 } }),
      ),
    }));
    s = seatMages({ ...s, rooms }, 0, ['a1'], { mana: 1, gold: 0 });
    for (const a of sampleActions(s, 20)) {
      expect(a.type).not.toBe('PLACE_WORKER');
    }
  });
});

describe('Thickhide — prompt answers', () => {
  const baseState = errandsGame(true);
  const mk = (prompt: PendingResolution['prompt']): PendingResolution => ({
    id: 'r-test',
    responderId: baseState.players[0]!.id,
    prompt,
    resume: { effectId: 'base.system.noop', context: {} },
    source: { kind: 'system', id: 't', triggeringPlayerId: baseState.players[0]!.id, description: 't' },
  });

  it('always takes the reward over forfeiting', () => {
    const ans = thickhide.answerPendingResolution(
      baseState,
      mk({
        kind: 'choose-from-options',
        options: [
          { id: 'forfeit', label: 'Forfeit for 1 IP', payload: {} },
          { id: 'reward', label: 'Take reward', payload: {} },
        ],
      }),
    );
    expect(ans).toEqual({ kind: 'option-chosen', optionId: 'reward', payload: {} });
  });

  it('forfeits only when no reward option is available', () => {
    const ans = thickhide.answerPendingResolution(
      baseState,
      mk({
        kind: 'choose-from-options',
        options: [{ id: 'forfeit', label: 'Forfeit', payload: {} }],
      }),
    );
    expect(ans).toEqual({ kind: 'option-chosen', optionId: 'forfeit', payload: {} });
  });

  it('reaction windows are passed; confirms are confirmed', () => {
    expect(
      thickhide.answerPendingResolution(
        baseState,
        mk({ kind: 'reaction-window', triggerEvents: [], reactionOptions: [], canPass: true }),
      ),
    ).toEqual({ kind: 'reaction-passed' });
    expect(
      thickhide.answerPendingResolution(baseState, mk({ kind: 'confirm', message: 'ok' })),
    ).toEqual({ kind: 'confirmed' });
  });
});

describe('Thickhide — headless all-bot game', () => {
  it('runs a Thickhide-vs-Thickhide game to completion without stalling', () => {
    let s = errandsGame(true);
    s = seatMages(s, 0, ['a1', 'a2']);
    s = seatMages(s, 1, ['b1', 'b2']);

    const BUDGET = 6000;
    let steps = 0;
    while (s.phase.kind !== 'complete' && steps < BUDGET) {
      const ctx = botDecisionContext(s);
      if (!ctx) break;
      const action =
        ctx.kind === 'advance'
          ? ({ type: 'ADVANCE_PHASE' } as const)
          : ctx.kind === 'prompt'
            ? ({
                type: 'RESOLVE_PENDING',
                resolutionId: ctx.pending.id,
                answer: thickhide.answerPendingResolution(s, ctx.pending),
              } as const)
            : thickhide.chooseErrandsAction(s, ctx.playerId);
      s = applyAction(s, action);
      steps++;
    }

    expect(s.phase.kind).toBe('complete');
    expect(steps).toBeLessThan(BUDGET);
  });
});
