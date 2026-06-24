import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { getScenario } from '../content/scenarios';
import { computeFinalScoring } from './scoring';
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
  OwnedSpell,
  PackId,
  Player,
  ScoringCriterion,
} from './types';

// ============================================================================
// Key to the University — influence-victory scoring (voters grant IP, most IP
// wins), the removed Influence voters, and the round-end IP recognition awards.
// ============================================================================

const BURN = 'base.spell.burn';

const CONFIG = (
  players: string[],
  extra: Partial<GameConfig> = {},
): GameConfig => ({
  activePackIds: ['base'],
  playerNames: players,
  rngSeed: 7,
  scenarioId: 'key-to-the-university',
  ...extra,
});

function mapPlayer(s: GameState, id: string, fn: (p: Player) => Player): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}
function ip(s: GameState, id: string): number {
  return s.players.find((p) => p.id === id)!.resources.influence;
}
function setRes(s: GameState, id: string, res: Partial<Player['resources']>): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, resources: { ...p.resources, ...res } }));
}
function mkSpell(
  cardId: string,
  research: Partial<Pick<OwnedSpell, 'intPlaced' | 'wisPlacedLevel2' | 'wisPlacedLevel3'>> = {},
): OwnedSpell {
  return {
    cardId,
    intPlaced: research.intPlaced ?? false,
    wisPlacedLevel2: research.wisPlacedLevel2 ?? false,
    wisPlacedLevel3: research.wisPlacedLevel3 ?? false,
    exhausted: false,
  };
}
function setSpells(s: GameState, id: string, spells: OwnedSpell[]): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, ownedSpells: spells }));
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
  let s = initGame(CONFIG(['A', 'B']));
  return { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round } };
}

// ---------------------------------------------------------------------------
// Scenario data
// ---------------------------------------------------------------------------

describe('Key to the University — scenario data', () => {
  it('is registered as a 5-round influence-victory game', () => {
    const sc = getScenario('key-to-the-university');
    expect(sc).toBeTruthy();
    expect(sc?.influenceVictory).toEqual({ soleVoterIp: 7, tiedVoterIp: 4 });
    expect(sc?.excludedVoterCriteria).toEqual([
      'most-influence',
      'second-most-influence',
    ]);
    expect(sc?.rounds).toHaveLength(5);
    // Round 5 is a no-op award ceremony (no round-end effect).
    expect(sc?.rounds[4]?.roundEndEffectId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Voter setup — the Influence voters are pulled and replaced by a face-down draw
// ---------------------------------------------------------------------------

describe('Key to the University — voter setup', () => {
  it('removes both Influence voters but keeps the total count', () => {
    const cfg = { activePackIds: ['base'] as PackId[], playerNames: ['A', 'B', 'C'], rngSeed: 5 };
    const base = initGame(cfg);
    const key = initGame({ ...cfg, scenarioId: 'key-to-the-university' });

    // Sanity: a normal game always seats the (face-up) Most Influence voter.
    expect(base.voters.some((v) => v.criterion === 'most-influence')).toBe(true);
    // The scenario seats neither Influence voter...
    expect(
      key.voters.some(
        (v) =>
          v.criterion === 'most-influence' ||
          v.criterion === 'second-most-influence',
      ),
    ).toBe(false);
    // ...and the total voter count is preserved (extra face-down draw).
    expect(key.voters.length).toBe(base.voters.length);
  });
});

// ---------------------------------------------------------------------------
// Influence-victory final scoring
// ---------------------------------------------------------------------------

describe('Key to the University — influence-victory final scoring', () => {
  it('grants 7 IP to a sole voter-winner and 4 IP to each of several tied', () => {
    let s = initGame(CONFIG(['A', 'B', 'C']));
    s = { ...s, voters: [voter('gold', 'most-gold'), voter('mana', 'most-mana')] };
    s = setRes(s, 'p1', { influence: 0, gold: 10, mana: 5 });
    s = setRes(s, 'p2', { influence: 0, gold: 3, mana: 5 });
    s = setRes(s, 'p3', { influence: 0, gold: 1, mana: 1 });

    const r = computeFinalScoring(s);
    expect(r.influenceVictory).toBe(true);

    const gold = r.voterAwards.find((a) => a.voterId === 'gold')!;
    expect(gold.influenceWinners).toEqual(['p1']); // sole most-gold
    expect(gold.influenceEach).toBe(7);

    const mana = r.voterAwards.find((a) => a.voterId === 'mana')!;
    expect(new Set(mana.influenceWinners)).toEqual(new Set(['p1', 'p2'])); // tie at 5
    expect(mana.influenceEach).toBe(4);

    expect(r.influencePerPlayer['p1']).toBe(11); // 0 + 7 + 4
    expect(r.influencePerPlayer['p2']).toBe(4); // 0 + 4
    expect(r.influencePerPlayer['p3']).toBe(0);
    expect(r.archmage).toBe('p1');
    expect(r.tiebreaker).toBe('influence');
  });

  it('the winner is the most-Influence player (base IP + voter awards), not most votes', () => {
    let s = initGame(CONFIG(['A', 'B']));
    s = { ...s, voters: [voter('gold', 'most-gold')] };
    // p1 wins the only voter (+7) but p2 leads on earned Influence.
    s = setRes(s, 'p1', { influence: 0, gold: 10 });
    s = setRes(s, 'p2', { influence: 20, gold: 1 });

    const r = computeFinalScoring(s);
    expect(r.influencePerPlayer['p1']).toBe(7);
    expect(r.influencePerPlayer['p2']).toBe(20);
    expect(r.archmage).toBe('p2');
  });

  it('a voter whose criterion nobody scores grants no IP', () => {
    let s = initGame(CONFIG(['A', 'B']));
    s = { ...s, voters: [voter('gold', 'most-gold')] };
    s = setRes(s, 'p1', { influence: 0, gold: 0 });
    s = setRes(s, 'p2', { influence: 0, gold: 0 });
    const r = computeFinalScoring(s);
    const gold = r.voterAwards.find((a) => a.voterId === 'gold')!;
    expect(gold.influenceWinners).toEqual([]);
    expect(r.archmage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round-end recognition awards
// ---------------------------------------------------------------------------

describe('Key to the University — round-end recognition', () => {
  it('R1 Recognition for Merit: gain 1 IP per unused Merit Badge', () => {
    let s = endOfRound(1);
    s = setRes(s, 'p1', { meritBadges: 3 });
    s = setRes(s, 'p2', { meritBadges: 0 });
    const b1 = ip(s, 'p1');
    const b2 = ip(s, 'p2');
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(ip(s, 'p1')).toBe(b1 + 3);
    expect(ip(s, 'p2')).toBe(b2);
    expect(s.phase.kind).toBe('round-setup');
  });

  it('R2 Recognition for Merit fires the same reward', () => {
    let s = endOfRound(2);
    s = setRes(s, 'p1', { meritBadges: 2 });
    const b1 = ip(s, 'p1');
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(ip(s, 'p1')).toBe(b1 + 2);
  });

  it('R3 Recognition for Research: the sole top researcher gains 3 IP', () => {
    let s = endOfRound(3);
    s = setSpells(s, 'p1', [mkSpell(BURN, { intPlaced: true, wisPlacedLevel2: true })]); // 2
    s = setSpells(s, 'p2', [mkSpell(BURN, { intPlaced: true })]); // 1
    const b1 = ip(s, 'p1');
    const b2 = ip(s, 'p2');
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(ip(s, 'p1')).toBe(b1 + 3);
    expect(ip(s, 'p2')).toBe(b2);
  });

  it('R3 Recognition for Research: ties pay every top researcher', () => {
    let s = endOfRound(3);
    s = setSpells(s, 'p1', [mkSpell(BURN, { intPlaced: true })]); // 1
    s = setSpells(s, 'p2', [mkSpell(BURN, { intPlaced: true })]); // 1
    const b1 = ip(s, 'p1');
    const b2 = ip(s, 'p2');
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(ip(s, 'p1')).toBe(b1 + 3);
    expect(ip(s, 'p2')).toBe(b2 + 3);
  });

  it('R4 Recognition for Involvement: the sole most-Marks player gains 3 IP', () => {
    let s = endOfRound(4);
    s = setRes(s, 'p1', { marks: 2 });
    s = setRes(s, 'p2', { marks: 1 });
    const b1 = ip(s, 'p1');
    const b2 = ip(s, 'p2');
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(ip(s, 'p1')).toBe(b1 + 3);
    expect(ip(s, 'p2')).toBe(b2);
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
    scenarioId: 'key-to-the-university',
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

describe('Key to the University — full all-bot games', () => {
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

// ---------------------------------------------------------------------------
// Scenario + Summer Break — round-end effects STACK (both fire each round).
// ---------------------------------------------------------------------------

describe('Key to the University + Summer Break — stacked round-end effects', () => {
  it('R1 fires BOTH the merit-recognition IP and the Summer Break mage draft', () => {
    let s = initGame(CONFIG(['A', 'B'], { activePackIds: ['base', 'summerbreak'] }));
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round: 1 } };
    s = setRes(s, 'p1', { meritBadges: 2 });
    s = setRes(s, 'p2', { meritBadges: 1 });
    const b1 = ip(s, 'p1');
    const b2 = ip(s, 'p2');
    s = applyAction(s, { type: 'ADVANCE_PHASE' });

    // Merit recognition ran for every player...
    expect(ip(s, 'p1')).toBe(b1 + 2);
    expect(ip(s, 'p2')).toBe(b2 + 1);

    // ...AND the Summer Break "Students Return" mage draft is now in progress.
    expect(s.phase.kind).toBe('round-end-scenario');
    const top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    const labels = (top.prompt as { options: { label: string }[] }).options.map(
      (o) => o.label,
    );
    expect(labels.some((l) => l.includes('Draft a'))).toBe(true);
  });
});
