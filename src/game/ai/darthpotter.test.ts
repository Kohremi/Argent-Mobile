// Tests for DarthPotter — Klank's safe baseline made voter-aware. Decisions are
// pure and seeded from state, so crafted GameStates exercise (a) legality, (b) a
// shape-valid answer for every prompt kind, and (c) the voter-optimizing layer:
// it steers value plays + reward picks toward revealed-voter criteria, prizes
// Influence, and marks the voter where a mark buys the most votes. A headless
// all-bot game guards against stalls / illegal moves.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import type {
  ConsortiumVoter,
  GameState,
  OwnedMage,
  PendingResolution,
  ScoringCriterion,
} from '../types';
import {
  botDecisionContext,
  claimableBellCards,
  eligiblePlacementSlots,
} from '../../utils/uiSelectors';
import { darthPotter } from './darthpotter';

/** Two-player base game seated straight into Errands round 1 (player 0 active). */
function errandsGame(): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['Vader', 'Potter'],
    rngSeed: 9,
    controlledByBot: [true, true],
  });
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
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

function seatMages(s: GameState, idx: number, ids: string[]): GameState {
  const pid = s.players[idx]!.id;
  return {
    ...s,
    players: s.players.map((p, i) =>
      i !== idx
        ? p
        : { ...p, resources: { ...p.resources, mana: 5, gold: 5 }, mages: ids.map((id) => mage(id, pid)) },
    ),
  };
}

function setResources(
  s: GameState,
  idx: number,
  patch: Partial<GameState['players'][number]['resources']>,
): GameState {
  return {
    ...s,
    players: s.players.map((p, i) => (i === idx ? { ...p, resources: { ...p.resources, ...patch } } : p)),
  };
}

/** Strip every slot's reward summary so only the seats we tag are classified. */
function clearDescriptions(s: GameState): GameState {
  return {
    ...s,
    rooms: s.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((sp) => {
        const copy = { ...sp };
        delete copy.description;
        return copy;
      }),
    })),
  };
}

function setDesc(s: GameState, spaceId: string, description: string): GameState {
  return {
    ...s,
    rooms: s.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((sp) => (sp.id === spaceId ? { ...sp, description } : sp)),
    })),
  };
}

function descOf(s: GameState, spaceId: string): string {
  for (const r of s.rooms) {
    const sp = r.actionSpaces.find((x) => x.id === spaceId);
    if (sp) return sp.description ?? '';
  }
  return '';
}

function isMeritSlotId(s: GameState, id: string): boolean {
  for (const r of s.rooms) {
    const sp = r.actionSpaces.find((x) => x.id === id);
    if (sp) return sp.slotType === 'merit' || sp.slotType === 'shadow-merit';
  }
  return false;
}

/** Replace the Consortium with a crafted, fully-revealed voter set. */
function withVoters(
  s: GameState,
  voters: { id: string; criterion: ScoringCriterion; votes: number }[],
): GameState {
  const full: ConsortiumVoter[] = voters.map((v) => ({
    id: v.id,
    name: v.id,
    sourcePackId: 'base',
    criterion: v.criterion,
    votes: v.votes,
    isAlwaysFaceUp: true,
    revealed: true,
  }));
  return { ...s, voters: full };
}

describe('DarthPotter — Errands action choice (Klank baseline)', () => {
  it('returns a legal action for a seat with office mages', () => {
    let s = seatMages(errandsGame(), 0, ['a1', 'a2']);
    const action = darthPotter.chooseErrandsAction(s, s.players[0]!.id);
    expect(() => applyAction(s, action)).not.toThrow();
  });

  it('prefers placing a mage over claiming a bell tower card', () => {
    const s = seatMages(errandsGame(), 0, ['a1']);
    expect(claimableBellCards(s, s.players[0]!.id).size).toBeGreaterThan(0);
    expect(darthPotter.chooseErrandsAction(s, s.players[0]!.id).type).toBe('PLACE_WORKER');
  });

  it('claims a bell tower card only when out of better actions', () => {
    const s = errandsGame();
    expect(claimableBellCards(s, s.players[0]!.id).size).toBeGreaterThan(0);
    const action = darthPotter.chooseErrandsAction(s, s.players[0]!.id);
    expect(action.type).toBe('CLAIM_BELL_TOWER');
    expect(() => applyAction(s, action)).not.toThrow();
  });

  it('passes when there is nothing to do (no mages, drained tower)', () => {
    let s = errandsGame();
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    const action = darthPotter.chooseErrandsAction(s, s.players[0]!.id);
    expect(action).toEqual({ type: 'PASS_TURN', playerId: s.players[0]!.id });
  });
});

describe('DarthPotter — voter-aware value plays', () => {
  it('prefers the seat that advances a revealed voter, all else equal', () => {
    // Two seats of equal base value (Gain 2 Gold / Gain 2 Mana). With a revealed
    // "Most Gold" voter and the bot contesting Gold, the Gold seat wins.
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { intelligence: 0, wisdom: 0 }); // skip Research tier
    const pid = s.players[0]!.id;
    const [goldSeat, manaSeat] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(setDesc(s, goldSeat!, 'Gain 2 Gold'), manaSeat!, 'Gain 2 Mana');
    s = withVoters(s, [{ id: 'v.gold', criterion: 'most-gold', votes: 1 }]);

    const a = darthPotter.chooseErrandsAction(s, pid);
    expect(a).toMatchObject({ type: 'PLACE_WORKER', actionSpaceId: goldSeat });
    expect(descOf(s, a.type === 'PLACE_WORKER' ? a.actionSpaceId : '')).toMatch(/gold/i);
  });

  it('without any revealed voter, falls back to base value (the two seats tie)', () => {
    // Same board, no voters: Gold(2) and Mana(2) tie on base value, so the
    // choice is value-driven, not voter-driven — both are legal value picks.
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { intelligence: 0, wisdom: 0 });
    const pid = s.players[0]!.id;
    const [goldSeat, manaSeat] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(setDesc(s, goldSeat!, 'Gain 2 Gold'), manaSeat!, 'Gain 2 Mana');
    s = withVoters(s, []);

    const a = darthPotter.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') {
      expect([goldSeat, manaSeat]).toContain(a.actionSpaceId);
    }
  });
});

describe('DarthPotter — prompt answers', () => {
  const baseState = errandsGame();
  const responder = baseState.players[0]!.id;
  const mk = (prompt: PendingResolution['prompt'], state = baseState): {
    state: GameState;
    pending: PendingResolution;
  } => ({
    state,
    pending: {
      id: 'r-test',
      responderId: responder,
      prompt,
      resume: { effectId: 'base.system.noop', context: {} },
      source: { kind: 'system', id: 't', triggeringPlayerId: responder, description: 't' },
    },
  });

  it('choose-from-options → takes the reward, never forfeits', () => {
    const { state, pending } = mk({
      kind: 'choose-from-options',
      options: [
        { id: 'forfeit', label: 'Forfeit', payload: {} },
        { id: 'reward', label: 'Reward', payload: {} },
      ],
    });
    expect(darthPotter.answerPendingResolution(state, pending)).toEqual({
      kind: 'option-chosen',
      optionId: 'reward',
      payload: {},
    });
  });

  it('choose-from-options → picks the resource advancing a live voter (Gold)', () => {
    const s = withVoters(errandsGame(), [{ id: 'v.gold', criterion: 'most-gold', votes: 2 }]);
    const { state, pending } = mk(
      {
        kind: 'choose-from-options',
        options: [
          { id: 'mana', label: 'Gain 3 Mana', payload: {} },
          { id: 'gold', label: 'Gain 3 Gold', payload: {} },
        ],
      },
      s,
    );
    expect(darthPotter.answerPendingResolution(state, pending)).toEqual({
      kind: 'option-chosen',
      optionId: 'gold',
      payload: {},
    });
  });

  it('choose-from-options → prefers Influence (universal tiebreaker) absent voters', () => {
    const { state, pending } = mk({
      kind: 'choose-from-options',
      options: [
        { id: 'gold', label: 'Gain 2 Gold', payload: {} },
        { id: 'influence', label: 'Gain 2 Influence', payload: {} },
      ],
    });
    expect(darthPotter.answerPendingResolution(state, pending)).toEqual({
      kind: 'option-chosen',
      optionId: 'influence',
      payload: {},
    });
  });

  it('never rearranges Research → picks "Done moving Research"', () => {
    const { state, pending } = mk({
      kind: 'choose-from-options',
      options: [
        { id: 'move-wis', label: 'Move a WIS token to another Spell', payload: {} },
        { id: 'discard', label: 'Done moving Research', payload: {} },
      ],
    });
    expect(darthPotter.answerPendingResolution(state, pending)).toEqual({
      kind: 'option-chosen',
      optionId: 'discard',
      payload: {},
    });
  });

  it('choose-voter → marks the contested voter where a mark wins the tie', () => {
    // Bot ties the field on Gold (mark wins it) but scores 0 on Mana (wasted).
    let s = errandsGame();
    s = withVoters(s, [
      { id: 'v.gold', criterion: 'most-gold', votes: 1 },
      { id: 'v.mana', criterion: 'most-mana', votes: 1 },
    ]);
    // Equal Gold for both players (a tie at the top); bot has 0 Mana, rival has Mana.
    s = setResources(s, 0, { gold: 4, mana: 0 });
    s = setResources(s, 1, { gold: 4, mana: 4 });
    const { state, pending } = mk(
      { kind: 'choose-voter', eligibleVoterIds: ['v.gold', 'v.mana'] },
      s,
    );
    expect(darthPotter.answerPendingResolution(state, pending)).toEqual({
      kind: 'voter-chosen',
      voterId: 'v.gold',
    });
  });

  it('choose-target-mage → prefers an opponent; declines a wound when only own mages remain', () => {
    let s = errandsGame();
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, mages: [mage('own-1', p.id)] } : p)) };
    const withOpp = mk({ kind: 'choose-target-mage', eligibleMageIds: ['own-1', 'enemy-1'], canPass: true }, s);
    expect(darthPotter.answerPendingResolution(withOpp.state, withOpp.pending)).toEqual({
      kind: 'mage-chosen',
      mageId: 'enemy-1',
    });
    const selfOnly = mk(
      { kind: 'choose-target-mage', eligibleMageIds: ['own-1'], canPass: true, label: 'Choose a Mage to wound' },
      s,
    );
    expect(darthPotter.answerPendingResolution(selfOnly.state, selfOnly.pending)).toEqual({ kind: 'pass' });
  });

  it('reaction-window (pass-only) → reaction-passed', () => {
    const { state, pending } = mk({
      kind: 'reaction-window',
      triggerEvents: [],
      reactionOptions: [],
      canPass: true,
    });
    expect(darthPotter.answerPendingResolution(state, pending)).toEqual({ kind: 'reaction-passed' });
    // Real reaction-window play behavior is covered for all personalities by the
    // engine-driven "AI bots play a legal reaction" test in engine.test.ts.
  });

  it('answers the remaining prompt kinds with a shape-valid choice', () => {
    const spell = mk({ kind: 'choose-spell-level', spellId: 'x', availableLevels: [1, 3, 2] });
    expect(darthPotter.answerPendingResolution(spell.state, spell.pending)).toEqual({ kind: 'level-chosen', level: 3 });
    const deck = mk({ kind: 'choose-deck', eligibleDecks: ['vault', 'spell'] });
    expect(darthPotter.answerPendingResolution(deck.state, deck.pending)).toEqual({ kind: 'deck-chosen', deck: 'vault' });
    const card = mk({ kind: 'choose-vault-card', eligibleCardIds: ['c-1', 'c-2'] });
    expect(darthPotter.answerPendingResolution(card.state, card.pending)).toEqual({ kind: 'card-chosen', cardId: 'c-1' });
    const space = mk({ kind: 'choose-target-action-space', eligibleSpaceIds: ['s-1'] });
    expect(darthPotter.answerPendingResolution(space.state, space.pending)).toEqual({ kind: 'space-chosen', spaceId: 's-1' });
    const confirm = mk({ kind: 'confirm', message: 'ok?' });
    expect(darthPotter.answerPendingResolution(confirm.state, confirm.pending)).toEqual({ kind: 'confirmed' });
  });
});

describe('DarthPotter — headless all-bot game', () => {
  it('runs a DarthPotter-vs-DarthPotter game to completion without stalling', () => {
    let s = seatMages(errandsGame(), 0, ['a1', 'a2']);
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
            ? ({ type: 'RESOLVE_PENDING', resolutionId: ctx.pending.id, answer: darthPotter.answerPendingResolution(s, ctx.pending) } as const)
            : darthPotter.chooseErrandsAction(s, ctx.playerId);
      s = applyAction(s, action);
      steps++;
    }

    expect(s.phase.kind).toBe('complete');
    expect(steps).toBeLessThan(BUDGET);
  });
});
