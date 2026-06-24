import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { getScenario } from '../content/scenarios';
import { computeFinalScoring } from './scoring';
import { applyGainMark, buildGainMarkChooseVoterPrompt } from './effects/helpers';
import { getPack } from '../content/registry';
import { getBotPersonality } from './ai';
import { botDecisionContext } from '../utils/uiSelectors';
import { findBoardInconsistency } from './boardInvariant';
import { createRng } from '../utils/rng';
import type {
  ConsortiumVoter,
  GameAction,
  GameConfig,
  GameState,
  PackId,
  Player,
  ScoringCriterion,
} from './types';

// ============================================================================
// Political Struggle — two voter factions, Support Markers placed instead of a
// Mark, and the winning faction's voters counting double at the election.
// ============================================================================

const CONFIG = (
  players: string[],
  extra: Partial<GameConfig> = {},
): GameConfig => ({
  activePackIds: ['base'],
  playerNames: players,
  rngSeed: 7,
  scenarioId: 'political-struggle',
  ...extra,
});

function mapPlayer(s: GameState, id: string, fn: (p: Player) => Player): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}
function setRes(s: GameState, id: string, res: Partial<Player['resources']>): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, resources: { ...p.resources, ...res } }));
}
function topPending(s: GameState) {
  return s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
}
function voter(id: string, criterion: ScoringCriterion, votes = 1): ConsortiumVoter {
  return {
    id,
    name: id,
    sourcePackId: 'base',
    criterion,
    votes,
    isAlwaysFaceUp: false,
    revealed: true,
  };
}
/** A game seated at mid-game-scoring of `round`, p1 first in turn order. */
function endOfRound(round: 1 | 2 | 3 | 4): GameState {
  const s = initGame(CONFIG(['A', 'B']));
  return { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round } };
}

// ---------------------------------------------------------------------------
// Scenario data + setup
// ---------------------------------------------------------------------------

describe('Political Struggle — scenario data & setup', () => {
  it('is a registered 5-round faction game', () => {
    const sc = getScenario('political-struggle');
    expect(sc).toBeTruthy();
    expect(sc?.supportGroups?.winningVoteMultiplier).toBe(2);
    expect(sc?.supportGroups?.groups.map((g) => g.id)).toEqual(['green', 'purple']);
    expect(sc?.rounds).toHaveLength(5);
    expect(sc?.rounds[4]?.roundEndEffectId).toBeUndefined();
  });

  it('splits voters into two factions led by the Influence / Supporters voters', () => {
    const s = initGame({
      activePackIds: ['base'],
      playerNames: ['A', 'B', 'C'],
      rngSeed: 5,
      scenarioId: 'political-struggle',
    });
    expect(s.supportMarkers).toEqual({ green: 0, purple: 0 });
    expect(Object.keys(s.voterGroups ?? {})).toHaveLength(s.voters.length);

    const infl = s.voters.find((v) => v.criterion === 'most-influence')!;
    const supp = s.voters.find((v) => v.criterion === 'most-supporters')!;
    expect(s.voterGroups![infl.id]).toBe('green');
    expect(s.voterGroups![supp.id]).toBe('purple');

    const green = Object.values(s.voterGroups!).filter((g) => g === 'green').length;
    const purple = Object.values(s.voterGroups!).filter((g) => g === 'purple').length;
    expect(green).toBe(6);
    expect(purple).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Support Markers — placed instead of a voter Mark
// ---------------------------------------------------------------------------

describe('Political Struggle — Support Markers', () => {
  it('gain-mark prompts carry faction Support options in this scenario only', () => {
    const s = initGame(CONFIG(['A', 'B']));
    const prompt = buildGainMarkChooseVoterPrompt(s, 'p1');
    expect(prompt?.supportOptions?.map((o) => o.id)).toEqual([
      'support:green',
      'support:purple',
    ]);

    const normal = initGame({
      activePackIds: ['base'],
      playerNames: ['A', 'B'],
      rngSeed: 7,
    });
    expect(buildGainMarkChooseVoterPrompt(normal, 'p1')?.supportOptions).toBeUndefined();
  });

  it('applyGainMark routes a support target to the faction tally, not a voter', () => {
    const s = initGame(CONFIG(['A', 'B']));
    const patch = applyGainMark(s, 'p1', 'support:green');
    expect(patch.supportMarkers).toEqual({ green: 1, purple: 0 });
    expect(patch.voterMarks).toBeUndefined();
    expect(patch.players).toBeUndefined();

    // A real voter id still places a normal Mark + bumps the marks resource.
    const realId = s.voters[0]!.id;
    const realPatch = applyGainMark(s, 'p1', realId);
    expect(
      realPatch.voterMarks?.some((m) => m.voterId === realId && m.playerId === 'p1'),
    ).toBe(true);
    expect(realPatch.supportMarkers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Round-end "Tensions Escalate" — gain a Mark (or convert to Support)
// ---------------------------------------------------------------------------

describe('Political Struggle — Tensions Escalate round-end', () => {
  it('hands each player a Mark in turn order; either a voter Mark or Support', () => {
    let s = endOfRound(1);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(s.phase.kind).toBe('round-end-scenario');

    // p1 places a real Mark.
    let top = topPending(s)!;
    expect(top.responderId).toBe('p1');
    expect(top.prompt.kind).toBe('choose-voter');
    const voterId =
      top.prompt.kind === 'choose-voter' ? top.prompt.eligibleVoterIds[0]! : '';
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId },
    });

    // p2 converts their Mark into Support for Green.
    top = topPending(s)!;
    expect(top.responderId).toBe('p2');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId: 'support:green' },
    });

    expect(s.phase.kind).toBe('round-setup');
    expect(s.supportMarkers).toEqual({ green: 1, purple: 0 });
    expect(s.voterMarks.some((m) => m.playerId === 'p1' && m.voterId === voterId)).toBe(true);
    expect(s.voterMarks.some((m) => m.playerId === 'p2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Final scoring — the dominant faction's voters count double
// ---------------------------------------------------------------------------

function scoringState(support: Record<string, number>): GameState {
  let s = initGame(CONFIG(['A', 'B']));
  const voters: ConsortiumVoter[] = [
    voter('g.gold', 'most-gold'),
    voter('g.mana', 'most-mana'),
    voter('p.wis', 'most-wisdom'),
    voter('p.int', 'most-intelligence'),
  ];
  s = {
    ...s,
    voters,
    voterGroups: {
      'g.gold': 'green',
      'g.mana': 'green',
      'p.wis': 'purple',
      'p.int': 'purple',
    },
    supportMarkers: support,
  };
  // p1 sweeps the green criteria; p2 sweeps the purple ones.
  s = setRes(s, 'p1', { gold: 10, mana: 10, wisdom: 0, intelligence: 0 });
  s = setRes(s, 'p2', { gold: 0, mana: 0, wisdom: 10, intelligence: 10 });
  return s;
}

describe('Political Struggle — final scoring', () => {
  it("doubles the winning faction's voters (Green ahead on support)", () => {
    const r = computeFinalScoring(scoringState({ green: 3, purple: 1 }));
    expect(r.voterAwards.find((a) => a.voterId === 'g.gold')!.votes).toBe(2);
    expect(r.voterAwards.find((a) => a.voterId === 'p.wis')!.votes).toBe(1);
    // p1: gold(2)+mana(2)=4 ; p2: wis(1)+int(1)=2.
    expect(r.votesPerPlayer['p1']).toBe(4);
    expect(r.votesPerPlayer['p2']).toBe(2);
    expect(r.archmage).toBe('p1');
  });

  it('resolves normally when support is tied', () => {
    const r = computeFinalScoring(scoringState({ green: 2, purple: 2 }));
    expect(r.voterAwards.find((a) => a.voterId === 'g.gold')!.votes).toBe(1);
    expect(r.votesPerPlayer['p1']).toBe(2);
    expect(r.votesPerPlayer['p2']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// End-to-end — all-bot game completes without stalling / desync.
// ---------------------------------------------------------------------------

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;

function runGame(seed: number, extraPacks: PackId[] = []): string | null {
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);
  const draftCandidates = getPack('base')!.candidates.filter(
    (c) => c.startingMageColor !== 'neutral',
  );
  const candidateIds = draftCandidates.map((c) => c.id);
  const deptOf = new Map(draftCandidates.map((c) => [c.id, c.department]));
  let s = initGame({
    activePackIds: ['base', ...extraPacks],
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    rngSeed: seed,
    controlledByBot: [true, true, true, true],
    botPersonalityIds: PERSONALITIES.map((_, i) => PERSONALITIES[(i + seed) % 4]!),
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' },
    scenarioId: 'political-struggle',
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
          const takenIds = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
          const takenDepts = new Set([...takenIds].map((id) => deptOf.get(id)));
          const avail = candidateIds.filter(
            (id) => !takenIds.has(id) && !takenDepts.has(deptOf.get(id)),
          );
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

describe('Political Struggle — full all-bot games', () => {
  it('complete without stalling or desyncing the board', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const result = runGame(seed);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });

  it('stacked with Summer Break, complete without stalling or desyncing', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const result = runGame(seed, ['summerbreak']);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });
});
