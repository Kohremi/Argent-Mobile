// Permanent guard for the board invariant: a Mage's `location` and the slot
// `occupant` / `shadowOccupant` references must always agree. Runs seeded
// 4-player all-bot games (one of each personality, random leaders + random
// non-off-white mages) and calls assertBoardConsistent after EVERY action, so
// any hand-rolled board mutation that desyncs location vs. occupancy fails here
// with the exact action that broke it. Two matrices run: base-only (30 seeds)
// and every pack active with unrestricted random leaders (12 seeds), so
// cross-module desyncs are caught alongside base-game ones.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { findBoardInconsistency } from './boardInvariant';
import { getPack, listPacks } from '../content/registry';
import { getBotPersonality } from './ai';
import { botDecisionContext } from '../utils/uiSelectors';
import { createRng } from '../utils/rng';
import type { GameAction, GameState, PackId } from './types';

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;

/** candidate id → department, for enforcing one-school-per-player in the draft. */
const DEPT_OF_CANDIDATE = new Map(
  listPacks().flatMap((p) => p.candidates.map((c) => [c.id, c.department] as const)),
);

/** A simulation matrix: which packs are active + which leaders may be drafted. */
interface SimConfig {
  packIds: PackId[];
  candidateIds: string[];
}

// Base-only: the original matrix — base pack, non-neutral leaders.
const BASE_ONLY: SimConfig = {
  packIds: ['base'],
  candidateIds: getPack('base')!
    .candidates.filter((c) => c.startingMageColor !== 'neutral')
    .map((c) => c.id),
};

// Every registered pack active, leaders drafted from ALL packs' candidates with
// no restriction (neutral-starting leaders included) — exercises module
// interactions the base-only matrix can't reach.
const ALL_PACKS: SimConfig = {
  packIds: listPacks().map((p) => p.id),
  candidateIds: listPacks().flatMap((p) => p.candidates).map((c) => c.id),
};

function describeAction(s: GameState, a: GameAction): string {
  if (a.type === 'RESOLVE_PENDING') {
    const top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
    return `RESOLVE_PENDING resume=${top?.resume.effectId} src=${top?.source.id} prompt=${top?.prompt.kind}`;
  }
  return a.type;
}

/** Runs one all-bot game; returns the first invariant break (or null). */
function runGameCheckingInvariant(
  seed: number,
  seatIds: string[],
  cfg: SimConfig,
): string | null {
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);
  let s = initGame({
    activePackIds: cfg.packIds,
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    rngSeed: seed,
    controlledByBot: [true, true, true, true],
    botPersonalityIds: seatIds,
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' },
  });
  let steps = 0;
  while (s.phase.kind !== 'complete' && steps < 40000) {
    const ctx = botDecisionContext(s);
    let action: GameAction | null = null;
    if (ctx?.kind === 'advance') action = { type: 'ADVANCE_PHASE' };
    else if (ctx?.kind === 'prompt') {
      const bot = getBotPersonality(s.players.find((p) => p.id === ctx.pending.responderId)?.botPersonalityId);
      action = { type: 'RESOLVE_PENDING', resolutionId: ctx.pending.id, answer: bot.answerPendingResolution(s, ctx.pending) };
    } else if (ctx?.kind === 'errands') {
      const bot = getBotPersonality(s.players.find((p) => p.id === ctx.playerId)?.botPersonalityId);
      action = bot.chooseErrandsAction(s, ctx.playerId);
    } else {
      switch (s.phase.kind) {
        case 'candidate-draft': {
          const pid = s.players[s.phase.activePlayerIndex]!.id;
          const takenIds = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
          const takenDepts = new Set(
            [...takenIds].map((id) => DEPT_OF_CANDIDATE.get(id)),
          );
          const avail = cfg.candidateIds.filter(
            (id) => !takenIds.has(id) && !takenDepts.has(DEPT_OF_CANDIDATE.get(id)),
          );
          action = { type: 'CHOOSE_CANDIDATE', playerId: pid, candidateId: avail[rnd(avail.length)]! };
          break;
        }
        case 'mage-draft-first-choice':
          action = { type: 'CHOOSE_DRAFT_FIRST', playerId: s.players[s.phase.chooserIndex]!.id, draftFirst: rng() < 0.5 };
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
          return `unexpected idle phase ${s.phase.kind}`;
      }
    }
    if (!action) break;
    const desc = describeAction(s, action);
    let next: GameState;
    try {
      next = applyAction(s, action);
    } catch (e) {
      // Illegal-move throws are a separate concern (covered elsewhere); stop here.
      return `seed=${seed} threw on ${desc}: ${(e as Error).message.split('\n')[0]}`;
    }
    const broke = findBoardInconsistency(next);
    if (broke && !findBoardInconsistency(s)) {
      return `seed=${seed} :: ${broke} :: caused by ${desc}`;
    }
    s = next;
    steps++;
  }
  return null;
}

describe('board invariant — location ↔ slot occupancy never desyncs', () => {
  it('holds across seeded 4-player all-bot games', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const rot = seed % 4;
      const order = PERSONALITIES.map((_, i) => PERSONALITIES[(i + rot) % 4]!);
      const result = runGameCheckingInvariant(seed, order, BASE_ONLY);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });

  it('holds with every pack active, random layout + unrestricted leaders', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const rot = seed % 4;
      const order = PERSONALITIES.map((_, i) => PERSONALITIES[(i + rot) % 4]!);
      const result = runGameCheckingInvariant(seed, order, ALL_PACKS);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });
});
