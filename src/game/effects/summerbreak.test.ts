import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import type { GameConfig, GameState, OwnedMage, Player } from '../types';

const TWO: GameConfig = {
  activePackIds: ['base', 'summerbreak'],
  playerNames: ['Alice', 'Bob'],
  rngSeed: 42,
};

function advance(s: GameState): GameState {
  return applyAction(s, { type: 'ADVANCE_PHASE' });
}
function mapPlayer(s: GameState, id: string, fn: (p: Player) => Player): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}
function topPending(s: GameState) {
  return s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
}
function addMage(s: GameState, id: string, mage: Pick<OwnedMage, 'id' | 'cardId' | 'color'>): GameState {
  return mapPlayer(s, id, (p) => ({
    ...p,
    mages: [
      ...p.mages,
      { ...mage, location: { kind: 'office', playerId: p.id }, isShadowing: false, isWounded: false },
    ],
  }));
}
/** Seats a 2-player summerbreak game at the end of `round` (mid-game-scoring). */
function endOfRound(round: 1 | 2 | 3 | 4 | 5 | 6, patch?: (s: GameState) => GameState): GameState {
  let s = initGame(TWO);
  s = { ...s, firstPlayerIndex: 0 };
  if (patch) s = patch(s);
  return { ...s, phase: { kind: 'mid-game-scoring', round } };
}
function chosenOptionId(s: GameState): string {
  const top = topPending(s);
  if (!top || top.prompt.kind !== 'choose-from-options') {
    throw new Error('expected a choose-from-options prompt');
  }
  return top.prompt.options[0]!.id;
}
function resolveTop(s: GameState, optionId: string): GameState {
  const top = topPending(s)!;
  return applyAction(s, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'option-chosen', optionId, payload: {} },
  });
}

describe('Summer Break — round length (6th round)', () => {
  it('runs 6 rounds: end of round 5 advances toward round 6, not game over', () => {
    // Round 5 carries the Opening Ceremony scenario, so we land in it first.
    let s = endOfRound(5);
    s = advance(s);
    expect(s.phase.kind).toBe('round-end-scenario');
    // Drive both players through the reward draft, then we should reach round 6.
    s = resolveTop(s, chosenOptionId(s)); // Alice
    s = resolveTop(s, chosenOptionId(s)); // Bob
    expect(s.phase.kind).toBe('round-setup');
    if (s.phase.kind === 'round-setup') expect(s.phase.round).toBe(6);
  });

  it('ends the game at the end of round 6', () => {
    const s = advance(endOfRound(6));
    // No scenario for round 6, and 6 is the final round → game wraps up.
    expect(['final-scoring', 'complete']).toContain(s.phase.kind);
  });

  it('without Summer Break the game still ends at round 5', () => {
    let s = initGame({ activePackIds: ['base'], playerNames: ['A', 'B'], rngSeed: 1 });
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round: 5 } };
    s = advance(s);
    expect(['final-scoring', 'complete']).toContain(s.phase.kind);
  });
});

describe('Summer Break — Students Return draft (rounds 1-3)', () => {
  it('drafts a Mage for each player in turn order, then advances to next round-setup', () => {
    let s = advance(endOfRound(1));
    expect(s.phase.kind).toBe('round-end-scenario');
    if (s.phase.kind === 'round-end-scenario') expect(s.phase.name).toBe('Students Return');

    // Alice is prompted first.
    let top = topPending(s)!;
    expect(top.responderId).toBe('p1');
    expect(top.prompt.kind).toBe('choose-from-options');
    const aliceColor = chosenOptionId(s);
    s = resolveTop(s, aliceColor);
    expect(s.players[0]!.mages.filter((m) => m.color === aliceColor)).toHaveLength(1);

    // Bob is prompted next.
    top = topPending(s)!;
    expect(top.responderId).toBe('p2');
    const bobColor = chosenOptionId(s);
    s = resolveTop(s, bobColor);
    expect(s.players[1]!.mages.filter((m) => m.color === bobColor)).toHaveLength(1);

    // Everyone drafted → next round-setup.
    expect(s.phase.kind).toBe('round-setup');
    if (s.phase.kind === 'round-setup') expect(s.phase.round).toBe(2);
    expect(s.pendingRoundEndScenario).toBeNull();
  });

  it('decrements the mage supply pool for the drafted colour', () => {
    let s = advance(endOfRound(1));
    const color = chosenOptionId(s);
    const before = s.mageDraftPool[color as keyof typeof s.mageDraftPool] ?? 0;
    s = resolveTop(s, color);
    expect(s.mageDraftPool[color as keyof typeof s.mageDraftPool]).toBe(before - 1);
  });
});

describe('Summer Break — Summer Study Credits swap (round 4)', () => {
  it('lets a player keep their Mages (Skip)', () => {
    let s = endOfRound(4, (st) => addMage(st, 'p1', { id: 'p1-m', cardId: 'base.mage.sorcery', color: 'red' }));
    s = advance(s);
    expect(s.phase.kind).toBe('round-end-scenario');
    const top = topPending(s)!;
    expect(top.responderId).toBe('p1');
    // Options include a Skip ("Keep your Mages").
    if (top.prompt.kind !== 'choose-from-options') throw new Error('expected options');
    expect(top.prompt.options.some((o) => o.id === 'skip')).toBe(true);
    const magesBefore = s.players[0]!.mages.length;
    s = resolveTop(s, 'skip');
    expect(s.players[0]!.mages).toHaveLength(magesBefore);
  });

  it('swaps an owned Mage for a supply Mage of a chosen colour', () => {
    let s = endOfRound(4, (st) => addMage(st, 'p1', { id: 'p1-m', cardId: 'base.mage.sorcery', color: 'red' }));
    s = advance(s);
    // Pick the red Mage to swap (its option id is the mage id).
    s = resolveTop(s, 'p1-m');
    // Now choose a colour to take.
    const newColor = chosenOptionId(s);
    s = resolveTop(s, newColor);
    expect(s.players[0]!.mages.some((m) => m.id === 'p1-m')).toBe(false);
    expect(s.players[0]!.mages.some((m) => m.color === newColor)).toBe(true);
  });
});

describe('Summer Break — Opening Ceremony reward draft (round 5)', () => {
  it('drafts without replacement: a reward Alice takes is unavailable to Bob', () => {
    let s = advance(endOfRound(5));
    expect(s.phase.kind).toBe('round-end-scenario');
    if (s.phase.kind === 'round-end-scenario') expect(s.phase.name).toBe('Opening Ceremony');

    // Alice takes "2 Mana".
    const aliceMana = s.players[0]!.resources.mana;
    s = resolveTop(s, 'mana');
    expect(s.players[0]!.resources.mana).toBe(aliceMana + 2);

    // Bob's pool excludes 'mana'.
    const bobTop = topPending(s)!;
    if (bobTop.prompt.kind !== 'choose-from-options') throw new Error('expected options');
    expect(bobTop.prompt.options.some((o) => o.id === 'mana')).toBe(false);
    const bobGold = s.players[1]!.resources.gold;
    s = resolveTop(s, 'gold');
    expect(s.players[1]!.resources.gold).toBe(bobGold + 3);

    expect(s.phase.kind).toBe('round-setup');
  });
});

describe('Summer Break — setup changes', () => {
  it('skips the extra mage draft: players keep only their two candidate Mages', () => {
    let s = initGame({
      activePackIds: ['base', 'summerbreak'],
      playerNames: ['Alice', 'Bob', 'Cara', 'Dan'],
      rngSeed: 5,
      useCandidateDraft: true,
    });
    // Assign distinct candidates to each player in the phase's turn order.
    const candidates = [
      'base.candidate.larimore-burman',
      'base.candidate.byron-krane',
      'base.candidate.rheye-cal',
      'base.candidate.exhufern-le-marigras',
    ];
    for (let i = 0; i < 4; i++) {
      if (s.phase.kind !== 'candidate-draft') break;
      const activeId = s.players[s.phase.activePlayerIndex]!.id;
      s = applyAction(s, { type: 'CHOOSE_CANDIDATE', playerId: activeId, candidateId: candidates[i]! });
    }
    // No mage-draft phase — straight to initial mark placement.
    expect(s.phase.kind).toBe('initial-mark-placement');
    expect(s.players.every((p) => p.mages.length === 2)).toBe(true);
  });

  it('guarantees the Dormitory under random layout across seeds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = initGame({
        activePackIds: ['base', 'summerbreak'],
        playerNames: ['A', 'B'],
        rngSeed: seed,
      });
      expect(s.rooms.some((r) => r.name === 'Dormitory')).toBe(true);
    }
  });
});
