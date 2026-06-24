import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { getScenario } from '../content/scenarios';
import {
  applyGainMark,
  buildGainMarkChooseVoterPrompt,
  hitTargetId,
} from './effects/helpers';
import { getPack } from '../content/registry';
import { getBotPersonality } from './ai';
import { botDecisionContext } from '../utils/uiSelectors';
import { findBoardInconsistency } from './boardInvariant';
import { createRng } from '../utils/rng';
import type {
  GameAction,
  GameConfig,
  GameState,
  OwnedMage,
  PackId,
  Player,
} from './types';

// ============================================================================
// Assassins — place Hits instead of Marks on face-down voters, voters discarded
// at 3 hits, the R1/R2 mark modes, the R3 infirmary action, and the R4 IP cost.
// ============================================================================

const CONFIG = (
  players: string[],
  extra: Partial<GameConfig> = {},
): GameConfig => ({
  activePackIds: ['base'],
  playerNames: players,
  rngSeed: 7,
  scenarioId: 'assassins',
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
function firstFaceDownId(s: GameState): string {
  return s.voters.find((v) => !v.isAlwaysFaceUp && !v.revealed)!.id;
}
function addOfficeMage(s: GameState, id: string, mageId: string): GameState {
  return mapPlayer(s, id, (p) => ({
    ...p,
    mages: [
      ...p.mages,
      {
        id: mageId,
        cardId: 'base.mage.neutral',
        color: 'off-white',
        location: { kind: 'office', playerId: p.id },
        isShadowing: false,
        isWounded: false,
      } as OwnedMage,
    ],
  }));
}
function mageById(s: GameState, mageId: string): OwnedMage | undefined {
  return s.players.flatMap((p) => p.mages).find((m) => m.id === mageId);
}
function errands(round: 1 | 2 | 3 | 4 | 5): GameState {
  const s = initGame(CONFIG(['A', 'B']));
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
}
function endOfRound(round: 1 | 2): GameState {
  const s = initGame(CONFIG(['A', 'B']));
  return { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round } };
}

// ---------------------------------------------------------------------------
// Scenario data + setup
// ---------------------------------------------------------------------------

describe('Assassins — scenario data & setup', () => {
  it('is a registered 5-round hit scenario', () => {
    const sc = getScenario('assassins');
    expect(sc?.hitMechanic).toEqual({ discardThreshold: 3 });
    expect(sc?.rounds).toHaveLength(5);
    expect(sc?.rounds[2]?.infirmaryStrikeAction).toBe(true);
    expect(sc?.rounds[3]?.loseIpPerHit).toBe(1);
    expect(sc?.rounds[4]?.roundEndEffectId).toBeUndefined();
  });

  it('seeds an empty hit tally and a replacement deck', () => {
    const s = initGame(CONFIG(['A', 'B', 'C']));
    expect(s.voterHits).toEqual({});
    expect((s.voterDeck ?? []).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Placing Hits via the gain-mark prompt
// ---------------------------------------------------------------------------

describe('Assassins — placing Hits', () => {
  it('offers Hit options on face-down voters in rounds 1–4, not round 5', () => {
    const s = errands(1);
    const prompt = buildGainMarkChooseVoterPrompt(s, 'p1');
    const hitIds = prompt?.hitOptions?.map((o) => o.voterId) ?? [];
    expect(hitIds.length).toBeGreaterThan(0);
    expect(
      hitIds.every((id) => {
        const v = s.voters.find((x) => x.id === id);
        return v && !v.isAlwaysFaceUp && !v.revealed;
      }),
    ).toBe(true);
    // No face-up leader is ever a hit target.
    const faceUp = s.voters.find((v) => v.isAlwaysFaceUp)!;
    expect(hitIds).not.toContain(faceUp.id);

    expect(buildGainMarkChooseVoterPrompt(errands(5), 'p1')?.hitOptions).toBeUndefined();
  });

  it('mark-only suppresses Hits; hit-only suppresses normal marks', () => {
    const s = errands(2);
    expect(
      buildGainMarkChooseVoterPrompt(s, 'p1', { markMode: 'mark-only' })?.hitOptions,
    ).toBeUndefined();
    const hitOnly = buildGainMarkChooseVoterPrompt(s, 'p1', { markMode: 'hit-only' });
    expect(hitOnly?.eligibleVoterIds).toEqual([]);
    expect((hitOnly?.hitOptions ?? []).length).toBeGreaterThan(0);
  });

  it('applyGainMark routes a hit target to the voter tally, not a mark', () => {
    const s = errands(1);
    const target = firstFaceDownId(s);
    const patch = applyGainMark(s, 'p1', hitTargetId(target));
    expect(patch.voterHits).toEqual({ [target]: 1 });
    expect(patch.voterMarks).toBeUndefined();
    expect(patch.players).toBeUndefined();
  });

  it('R4 (Disposing of Evidence) costs 1 IP per Hit', () => {
    const s = setRes(errands(4), 'p1', { influence: 5 });
    const target = firstFaceDownId(s);
    const patch = applyGainMark(s, 'p1', hitTargetId(target));
    expect(patch.voterHits).toEqual({ [target]: 1 });
    expect(patch.players?.find((p) => p.id === 'p1')?.resources.influence).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Round-end mark modes (R1 mark-only, R2 hit-only)
// ---------------------------------------------------------------------------

describe('Assassins — round-end mark modes', () => {
  it('R1 Preparations Made gives a Mark that cannot be a Hit', () => {
    let s = endOfRound(1);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    const top = topPending(s)!;
    expect(top.prompt.kind).toBe('choose-voter');
    if (top.prompt.kind === 'choose-voter') {
      expect(top.prompt.hitOptions).toBeUndefined();
      expect(top.prompt.eligibleVoterIds.length).toBeGreaterThan(0);
    }
  });

  it('R2 Choosing Targets gives a Mark that can only be a Hit', () => {
    let s = endOfRound(2);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    const top = topPending(s)!;
    if (top.prompt.kind === 'choose-voter') {
      expect(top.prompt.eligibleVoterIds).toEqual([]);
      expect((top.prompt.hitOptions ?? []).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// End-of-round assassination (3 hits → discarded + replaced)
// ---------------------------------------------------------------------------

describe('Assassins — end-of-round discard', () => {
  it('discards a 3-hit voter, clears its marks, and replaces it from the deck', () => {
    let s = initGame(CONFIG(['A', 'B']));
    const victim = firstFaceDownId(s);
    const before = s.voters.length;
    const deckBefore = (s.voterDeck ?? []).length;
    s = {
      ...s,
      firstPlayerIndex: 0,
      voterHits: { [victim]: 3 },
      voterMarks: [{ voterId: victim, playerId: 'p1' }],
      phase: { kind: 'round-setup', round: 2 },
    };
    s = setRes(s, 'p1', { marks: 1 });
    s = applyAction(s, { type: 'ADVANCE_PHASE' });

    expect(s.voters.some((v) => v.id === victim)).toBe(false);
    expect(s.voters.length).toBe(before); // replaced from deck
    expect((s.voterDeck ?? []).length).toBe(deckBefore - 1);
    expect(s.voterHits?.[victim]).toBeUndefined();
    expect(s.voterMarks.some((m) => m.voterId === victim)).toBe(false);
    expect(s.players.find((p) => p.id === 'p1')!.resources.marks).toBe(0);
    expect(s.phase.kind).toBe('errands');
  });

  it('shrinks the lineup when the deck is empty (no replacement)', () => {
    let s = initGame(CONFIG(['A', 'B']));
    const victim = firstFaceDownId(s);
    const before = s.voters.length;
    s = {
      ...s,
      firstPlayerIndex: 0,
      voterHits: { [victim]: 3 },
      voterDeck: [],
      phase: { kind: 'round-setup', round: 2 },
    };
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(s.voters.some((v) => v.id === victim)).toBe(false);
    expect(s.voters.length).toBe(before - 1);
  });
});

// ---------------------------------------------------------------------------
// R3 — Carrying out the Deed (infirmary strike action)
// ---------------------------------------------------------------------------

describe('Assassins — R3 infirmary strike', () => {
  it('sends a Mage to the Infirmary and places up to two Hits on different voters', () => {
    let s = addOfficeMage(errands(3), 'p1', 'strike-mage');
    s = applyAction(s, {
      type: 'USE_ABILITY',
      playerId: 'p1',
      abilityId: 'assassins.scenario.infirmary-strike',
    });
    // 1) pick the mage to send
    let top = topPending(s)!;
    expect(top.prompt.kind).toBe('choose-target-mage');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'mage-chosen', mageId: 'strike-mage' },
    });
    expect(mageById(s, 'strike-mage')!.location.kind).toBe('infirmary');
    expect(mageById(s, 'strike-mage')!.isWounded).toBe(true);

    // 2) first hit
    top = topPending(s)!;
    expect(top.prompt.kind).toBe('choose-voter');
    const v1 =
      top.prompt.kind === 'choose-voter' ? top.prompt.hitOptions![0]!.voterId : '';
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId: hitTargetId(v1) },
    });
    expect(s.voterHits?.[v1]).toBe(1);

    // 3) opt to place a second
    top = topPending(s)!;
    expect(top.prompt.kind).toBe('choose-from-options');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'continue', payload: {} },
    });

    // 4) second hit must be a different voter
    top = topPending(s)!;
    const opts =
      top.prompt.kind === 'choose-voter' ? top.prompt.hitOptions ?? [] : [];
    expect(opts.some((o) => o.voterId === v1)).toBe(false);
    const v2 = opts[0]!.voterId;
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId: hitTargetId(v2) },
    });
    expect(s.voterHits?.[v2]).toBe(1);
    expect(s.pendingResolutionStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end — all-bot games complete (bots convert R2's hit-only mark).
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
    scenarioId: 'assassins',
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

describe('Assassins — full all-bot games', () => {
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
