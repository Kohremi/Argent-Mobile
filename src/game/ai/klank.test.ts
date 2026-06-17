// Tests for Klank, the bot policy. The decision functions are pure, so we feed
// crafted GameStates and assert (a) chosen Errands actions are legal — i.e.
// applyAction does not throw — and (b) every prompt kind yields a shape-valid
// answer. A headless all-bot game then runs to completion, exercising the full
// action/prompt surface and guarding against stalls or illegal moves.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import type { GameState, OwnedMage, PendingResolution } from '../types';
import {
  botDecisionContext,
  claimableBellCards,
  eligiblePlacementSlots,
} from '../../utils/uiSelectors';
import { klank } from './klank';

/** Two-player base game seated straight into Errands round 1 (player 0 active). */
function errandsGame(opts: { bots: boolean }): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['Akko', 'Diana'],
    rngSeed: 11,
    controlledByBot: opts.bots ? [true, true] : [false, false],
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

/** Give a player some office mages + Mana so they have moves to make. */
function seatMages(s: GameState, playerIdx: number, ids: string[]): GameState {
  const pid = s.players[playerIdx]!.id;
  return {
    ...s,
    players: s.players.map((p, i) =>
      i !== playerIdx
        ? p
        : {
            ...p,
            resources: { ...p.resources, mana: 5, gold: 5 },
            mages: ids.map((id) => mage(id, pid)),
          },
    ),
  };
}

describe('Klank — Errands action choice', () => {
  it('returns a legal action for a seat with office mages', () => {
    let s = errandsGame({ bots: true });
    s = seatMages(s, 0, ['a1', 'a2']);
    const action = klank.chooseErrandsAction(s, s.players[0]!.id);
    // The engine is the arbiter of legality — applying it must not throw.
    expect(() => applyAction(s, action)).not.toThrow();
  });

  it('prefers placing a mage over claiming a bell tower card', () => {
    let s = errandsGame({ bots: true });
    s = seatMages(s, 0, ['a1']);
    // The tower has claimable cards available — but a placement must win.
    expect(claimableBellCards(s, s.players[0]!.id).size).toBeGreaterThan(0);
    const action = klank.chooseErrandsAction(s, s.players[0]!.id);
    expect(action.type).toBe('PLACE_WORKER');
  });

  it('claims a bell tower card only when out of better actions (keeps the round progressing)', () => {
    // A fresh seat has no office mages / spells / items — only bell claims —
    // so Klank claims one (rather than passing forever, which would never end
    // the round since the round ends only when the tower empties).
    const s = errandsGame({ bots: true });
    expect(claimableBellCards(s, s.players[0]!.id).size).toBeGreaterThan(0);
    const action = klank.chooseErrandsAction(s, s.players[0]!.id);
    expect(action.type).toBe('CLAIM_BELL_TOWER');
    expect(() => applyAction(s, action)).not.toThrow();
  });

  it('passes the turn when there is nothing to do (no mages, drained tower)', () => {
    let s = errandsGame({ bots: true });
    s = { ...s, bellTower: { ...s.bellTower, available: [] } };
    const action = klank.chooseErrandsAction(s, s.players[0]!.id);
    expect(action).toEqual({ type: 'PASS_TURN', playerId: s.players[0]!.id });
    expect(() => applyAction(s, action)).not.toThrow();
  });
});

describe('Klank — prompt answers (shape-valid for every kind)', () => {
  // A minimal state is enough; only choose-target-mage reads players.
  const baseState = errandsGame({ bots: true });
  const responder = baseState.players[0]!.id;
  const mk = (prompt: PendingResolution['prompt']): PendingResolution => ({
    id: 'r-test',
    responderId: responder,
    prompt,
    resume: { effectId: 'base.system.noop', context: {} },
    source: {
      kind: 'system',
      id: 'test',
      triggeringPlayerId: responder,
      description: 'test',
    },
  });

  it('choose-from-options → option-chosen (prefers a sensible id)', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({
        kind: 'choose-from-options',
        options: [
          { id: 'forfeit', label: 'Forfeit', payload: {} },
          { id: 'reward', label: 'Reward', payload: {} },
        ],
      }),
    );
    expect(ans).toEqual({ kind: 'option-chosen', optionId: 'reward', payload: {} });
  });

  it('never rearranges Research → picks "Done moving Research" on the move-only menu', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({
        kind: 'choose-from-options',
        options: [
          { id: 'move-wis', label: 'Move a WIS token to another Spell', payload: {} },
          { id: 'discard', label: 'Done moving Research', payload: {} },
        ],
      }),
    );
    expect(ans).toEqual({ kind: 'option-chosen', optionId: 'discard', payload: {} });
  });

  it('choose-from-options → skips unavailable options', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({
        kind: 'choose-from-options',
        options: [
          { id: 'reward', label: 'Reward', payload: {}, available: false },
          { id: 'forfeit', label: 'Forfeit', payload: {} },
        ],
      }),
    );
    expect(ans).toEqual({ kind: 'option-chosen', optionId: 'forfeit', payload: {} });
  });

  it('choose-target-mage → prefers an opponent, else passes when empty', () => {
    // Opponent mage id present → pick it over own.
    const withTargets = mk({
      kind: 'choose-target-mage',
      eligibleMageIds: ['own-1', 'enemy-1'],
      canPass: true,
    });
    const stateWithOwn: GameState = {
      ...baseState,
      players: baseState.players.map((p, i) =>
        i === 0 ? { ...p, mages: [mage('own-1', p.id)] } : p,
      ),
    };
    const ans = klank.answerPendingResolution(stateWithOwn, withTargets);
    expect(ans).toEqual({ kind: 'mage-chosen', mageId: 'enemy-1' });

    const empty = klank.answerPendingResolution(
      baseState,
      mk({ kind: 'choose-target-mage', eligibleMageIds: [], canPass: true }),
    );
    expect(empty).toEqual({ kind: 'pass' });
  });

  it('choose-target-action-space → first eligible', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({ kind: 'choose-target-action-space', eligibleSpaceIds: ['s-1', 's-2'] }),
    );
    expect(ans).toEqual({ kind: 'space-chosen', spaceId: 's-1' });
  });

  it('card prompts → first eligible card', () => {
    for (const kind of [
      'choose-vault-card',
      'choose-supporter-card',
      'choose-peeked-supporter',
    ] as const) {
      const ans = klank.answerPendingResolution(
        baseState,
        mk({ kind, eligibleCardIds: ['c-1', 'c-2'] }),
      );
      expect(ans).toEqual({ kind: 'card-chosen', cardId: 'c-1' });
    }
  });

  it('choose-spell-level → highest offered level', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({ kind: 'choose-spell-level', spellId: 'x', availableLevels: [1, 3, 2] }),
    );
    expect(ans).toEqual({ kind: 'level-chosen', level: 3 });
  });

  it('choose-deck / choose-voter / reaction-window / confirm', () => {
    expect(
      klank.answerPendingResolution(
        baseState,
        mk({ kind: 'choose-deck', eligibleDecks: ['vault', 'spell'] }),
      ),
    ).toEqual({ kind: 'deck-chosen', deck: 'vault' });
    expect(
      klank.answerPendingResolution(
        baseState,
        mk({ kind: 'choose-voter', eligibleVoterIds: ['v-1'] }),
      ),
    ).toEqual({ kind: 'voter-chosen', voterId: 'v-1' });
    expect(
      klank.answerPendingResolution(
        baseState,
        mk({
          kind: 'reaction-window',
          triggerEvents: [],
          reactionOptions: [],
          canPass: true,
        }),
      ),
    ).toEqual({ kind: 'reaction-passed' });
    expect(
      klank.answerPendingResolution(
        baseState,
        mk({ kind: 'confirm', message: 'ok?' }),
      ),
    ).toEqual({ kind: 'confirmed' });
  });

  it('reaction-window → plays an offered reaction (never passes when it can react)', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({
        kind: 'reaction-window',
        triggerEvents: [],
        reactionOptions: [
          { sourceKind: 'vault-card', sourceId: 'base.vault.shield-potion', effectId: 'base.vault.shield-potion.react', label: 'Play Shield Potion', requiresSlotPick: true },
        ],
        canPass: true,
      }),
    );
    expect(ans).toEqual({
      kind: 'reaction-played',
      effectId: 'base.vault.shield-potion.react',
      reactionContext: {},
    });
  });

  it('reaction-window → prefers a repeatable reaction and threads forMageId', () => {
    const ans = klank.answerPendingResolution(
      baseState,
      mk({
        kind: 'reaction-window',
        triggerEvents: [],
        reactionOptions: [
          { sourceKind: 'vault-card', sourceId: 'base.vault.shield-potion', effectId: 'base.vault.shield-potion.react', label: 'Shield Potion', requiresSlotPick: true, forMageId: 'a1' },
          { sourceKind: 'vault-card', sourceId: 'mancers.vault.sacred-shield', effectId: 'mancers.vault.sacred-shield.react', label: 'Sacred Shield', repeatable: true, forMageId: 'a2' },
        ],
        canPass: true,
      }),
    );
    expect(ans).toEqual({
      kind: 'reaction-played',
      effectId: 'mancers.vault.sacred-shield.react',
      reactionContext: {},
      forMageId: 'a2',
    });
  });
});

describe('Klank — priority cascade', () => {
  // --- local state-shaping helpers -----------------------------------------
  function setResources(
    s: GameState,
    idx: number,
    patch: Partial<GameState['players'][number]['resources']>,
  ): GameState {
    return {
      ...s,
      players: s.players.map((p, i) =>
        i === idx ? { ...p, resources: { ...p.resources, ...patch } } : p,
      ),
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
        actionSpaces: r.actionSpaces.map((sp) =>
          sp.id === spaceId ? { ...sp, description } : sp,
        ),
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
  function addOwnedSpell(s: GameState, idx: number, cardId: string): GameState {
    return {
      ...s,
      players: s.players.map((p, i) =>
        i === idx
          ? {
              ...p,
              ownedSpells: [
                ...p.ownedSpells,
                { cardId, intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
              ],
            }
          : p,
      ),
    };
  }
  function placeEnemyMage(s: GameState, idx: number, mageId: string, spaceId: string): GameState {
    const pid = s.players[idx]!.id;
    const withMage: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === idx
          ? {
              ...p,
              mages: [
                ...p.mages,
                { id: mageId, cardId: 'base.mage.neutral', color: 'off-white', location: { kind: 'action-space', spaceId }, isShadowing: false, isWounded: false },
              ],
            }
          : p,
      ),
    };
    return {
      ...withMage,
      rooms: withMage.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((sp) =>
          sp.id === spaceId ? { ...sp, occupant: { mageId, ownerId: pid, isShadowing: false } } : sp,
        ),
      })),
    };
  }

  function isMeritSlotId(s: GameState, id: string): boolean {
    for (const r of s.rooms) {
      const sp = r.actionSpaces.find((x) => x.id === id);
      if (sp) return sp.slotType === 'merit' || sp.slotType === 'shadow-merit';
    }
    return false;
  }
  function meritSlotIds(s: GameState): string[] {
    const out: string[] = [];
    for (const r of s.rooms) {
      for (const sp of r.actionSpaces) {
        if (sp.slotType === 'merit' || sp.slotType === 'shadow-merit') out.push(sp.id);
      }
    }
    return out;
  }

  it('seeks a Research seat when holding ≥2 unspent INT+WIS', () => {
    let s = clearDescriptions(seatMages(errandsGame({ bots: true }), 0, ['a1']));
    const pid = s.players[0]!.id;
    const [research, value] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(setDesc(s, research!, 'Gain 3 Research'), value!, 'Gain 4 Mana');

    s = setResources(s, 0, { intelligence: 2, wisdom: 0 });
    const a = klank.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') expect(descOf(s, a.actionSpaceId)).toMatch(/research/i);
  });

  it('ignores Research seats when short on INT+WIS (takes value instead)', () => {
    let s = clearDescriptions(seatMages(errandsGame({ bots: true }), 0, ['a1']));
    const pid = s.players[0]!.id;
    const [research, value] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(setDesc(s, research!, 'Gain 3 Research'), value!, 'Gain 4 Mana');

    s = setResources(s, 0, { intelligence: 1, wisdom: 0 });
    const a = klank.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') {
      expect(a.actionSpaceId).not.toBe(research);
      expect(descOf(s, a.actionSpaceId)).toMatch(/mana/i);
    }
  });

  it('prefers the larger-value seat (big Mana over a lone WIS)', () => {
    let s = clearDescriptions(seatMages(errandsGame({ bots: true }), 0, ['a1']));
    s = setResources(s, 0, { intelligence: 0, wisdom: 0 });
    const pid = s.players[0]!.id;
    const [big, small] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(setDesc(s, big!, 'Gain 4 Mana'), small!, 'Gain 1 WIS');

    const a = klank.chooseErrandsAction(s, pid);
    expect(a).toMatchObject({ type: 'PLACE_WORKER', actionSpaceId: big });
  });

  it('disrupts an opponent (casts Burn) over taking a value seat', () => {
    let s = seatMages(errandsGame({ bots: true }), 0, ['a1']);
    s = setResources(s, 0, { intelligence: 0, wisdom: 0, mana: 5 });
    s = addOwnedSpell(s, 0, 'base.spell.burn'); // L1 "Wound a Mage"
    // Seat an opponent mage on a real slot so Burn has a target.
    const room = s.rooms.find((r) => !r.isUniversityCentral && r.actionSpaces.length > 0)!;
    s = placeEnemyMage(s, 1, 'enemy', room.actionSpaces[0]!.id);

    const a = klank.chooseErrandsAction(s, s.players[0]!.id);
    expect(a.type).toBe('CAST_SPELL');
  });

  it('never takes a Merit seat with no Merit Badges (even the best one)', () => {
    let s = clearDescriptions(seatMages(errandsGame({ bots: true }), 0, ['a1']));
    s = setResources(s, 0, { meritBadges: 0, intelligence: 0, wisdom: 0 });
    const pid = s.players[0]!.id;
    const eligible = [...eligiblePlacementSlots(s, pid, 'a1')];
    const meritId = eligible.find((id) => isMeritSlotId(s, id))!;
    const plainId = eligible.find((id) => !isMeritSlotId(s, id))!;
    expect(meritId && plainId).toBeTruthy();
    // The Merit seat is the juiciest value seat — but he can't pay the Badge.
    s = setDesc(setDesc(s, meritId, 'Gain 4 Mana'), plainId, 'Gain 2 Mana');

    const a = klank.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') expect(a.actionSpaceId).not.toBe(meritId);
  });

  it('counts Merit seats it already holds against its Badge budget', () => {
    let s = clearDescriptions(seatMages(errandsGame({ bots: true }), 0, ['a1']));
    s = setResources(s, 0, { meritBadges: 1, intelligence: 0, wisdom: 0 });
    const pid = s.players[0]!.id;
    const eligible = [...eligiblePlacementSlots(s, pid, 'a1')];
    const meritId = eligible.find((id) => isMeritSlotId(s, id))!;
    const plainId = eligible.find((id) => !isMeritSlotId(s, id))!;
    s = setDesc(setDesc(s, meritId, 'Gain 4 Mana'), plainId, 'Gain 2 Mana');
    // His one Badge is already spoken for: he sits on another Merit seat.
    const otherMerit = meritSlotIds(s).find((id) => id !== meritId)!;
    s = placeEnemyMage(s, 0, 'held', otherMerit);

    const a = klank.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') expect(a.actionSpaceId).not.toBe(meritId);
  });
});

describe('Klank — headless all-bot game', () => {
  it('runs an all-bot game to completion without stalling or an illegal move', () => {
    let s = errandsGame({ bots: true });
    s = seatMages(s, 0, ['a1', 'a2']);
    s = seatMages(s, 1, ['b1', 'b2']);

    const BUDGET = 5000;
    let steps = 0;
    while (s.phase.kind !== 'complete' && steps < BUDGET) {
      const ctx = botDecisionContext(s);
      // All seats are bots, so the driver should always have something to do
      // until the game completes; a null here would be a stall bug.
      if (!ctx) break;
      const action =
        ctx.kind === 'advance'
          ? ({ type: 'ADVANCE_PHASE' } as const)
          : ctx.kind === 'prompt'
            ? ({
                type: 'RESOLVE_PENDING',
                resolutionId: ctx.pending.id,
                answer: klank.answerPendingResolution(s, ctx.pending),
              } as const)
            : klank.chooseErrandsAction(s, ctx.playerId);
      // Each step must be legal (engine throws otherwise → test fails).
      s = applyAction(s, action);
      steps++;
    }

    expect(s.phase.kind).toBe('complete');
    expect(steps).toBeLessThan(BUDGET);
  });
});
