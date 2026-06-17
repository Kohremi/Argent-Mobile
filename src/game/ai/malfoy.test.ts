// Tests for Malfoy — the Mana-then-big-spells bot cloned from Klank. Decisions
// are pure and seeded from state, so crafted GameStates exercise each tier of
// his priority cascade; a headless all-bot game guards against stalls / illegal
// moves.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import type { GameState, OwnedMage, PendingResolution } from '../types';
import { botDecisionContext, eligiblePlacementSlots } from '../../utils/uiSelectors';
import { malfoy } from './malfoy';

/** Two-player base game seated straight into Errands round 1 (player 0 active). */
function errandsGame(): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['Draco', 'Harry'],
    rngSeed: 7,
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

/** Drop `mageId` (owned by player `idx`) onto `spaceId` as its occupant. */
function occupy(s: GameState, idx: number, mageId: string, spaceId: string): GameState {
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

describe('Malfoy — Errands priority cascade', () => {
  it('grabs the best 2+ Mana seat (Mana ranked by amount, ignoring Gold)', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { mana: 0 });
    const pid = s.players[0]!.id;
    const [big, small, goldy] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(s, big!, 'Gain 4 Mana');
    s = setDesc(s, small!, 'Gain 2 Mana');
    s = setDesc(s, goldy!, 'Gain 7 Gold');

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a).toMatchObject({ type: 'PLACE_WORKER', actionSpaceId: big });
  });

  it('only grabs Mana once per round — afterwards he pivots to Research', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { mana: 0 });
    const pid = s.players[0]!.id;
    const slots = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    const manaSeat = slots[0]!;
    const researchSeat = slots[1]!;
    s = setDesc(s, manaSeat, 'Gain 3 Mana');
    s = setDesc(s, researchSeat, 'Gain 2 Research');
    // His one Mana grab this round is already spent: a Malfoy mage sits on a
    // 4-Mana seat. Even with another Mana seat open, he now goes for Research.
    s = occupy(s, 0, 'grabbed', slots[2]!);
    s = setDesc(s, slots[2]!, 'Gain 4 Mana');

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') expect(descOf(s, a.actionSpaceId)).toMatch(/research/i);
  });

  it('pivots to Research when flush with Mana (≥6) even if Mana seats remain', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { mana: 6 });
    const pid = s.players[0]!.id;
    const [mana, research] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(s, mana!, 'Gain 3 Mana');
    s = setDesc(s, research!, 'Gain 2 Research');

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') expect(descOf(s, a.actionSpaceId)).toMatch(/research/i);
  });

  it('pivots to Research when no 2+ Mana seats remain', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { mana: 1 });
    const pid = s.players[0]!.id;
    const [oneMana, research] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(s, oneMana!, 'Gain 1 Mana'); // <2, not a grab seat
    s = setDesc(s, research!, 'Gain 2 Research');

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a.type).toBe('PLACE_WORKER');
    if (a.type === 'PLACE_WORKER') expect(descOf(s, a.actionSpaceId)).toMatch(/research/i);
  });

  it('settles for INT/WIS when he wants Research but none is available', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { mana: 6 }); // flush → wants research, but none tagged
    const pid = s.players[0]!.id;
    const [intSeat] = [...eligiblePlacementSlots(s, pid, 'a1')].filter(
      (id) => !isMeritSlotId(s, id),
    );
    s = setDesc(s, intSeat!, 'Gain 1 INT');

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a).toMatchObject({ type: 'PLACE_WORKER', actionSpaceId: intSeat });
  });

  it('disrupting an opponent with a Spell trumps grabbing Mana', () => {
    let s = seatMages(errandsGame(), 0, ['a1']); // real board → Mana seats exist
    s = setResources(s, 0, { mana: 5 });
    s = addOwnedSpell(s, 0, 'base.spell.burn'); // L1 "Wound a Mage"
    const room = s.rooms.find((r) => !r.isUniversityCentral && r.actionSpaces.length > 0)!;
    s = occupy(s, 1, 'enemy', room.actionSpaces[0]!.id); // a rival mage to wound

    const a = malfoy.chooseErrandsAction(s, s.players[0]!.id);
    expect(a.type).toBe('CAST_SPELL');
  });

  it('never grabs a Merit seat with no Merit Badges (even a big-Mana one)', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { meritBadges: 0, mana: 0 });
    const pid = s.players[0]!.id;
    const eligible = [...eligiblePlacementSlots(s, pid, 'a1')];
    const meritId = eligible.find((id) => isMeritSlotId(s, id))!;
    const plainId = eligible.find((id) => !isMeritSlotId(s, id))!;
    expect(meritId && plainId).toBeTruthy();
    // The Merit seat is the bigger Mana seat — but he can't pay the Badge.
    s = setDesc(setDesc(s, meritId, 'Gain 4 Mana'), plainId, 'Gain 2 Mana');

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a).toMatchObject({ type: 'PLACE_WORKER', actionSpaceId: plainId });
  });

  it('counts Merit seats it already holds against its Badge budget', () => {
    let s = clearDescriptions(seatMages(errandsGame(), 0, ['a1']));
    s = setResources(s, 0, { meritBadges: 1, mana: 0 });
    const pid = s.players[0]!.id;
    const eligible = [...eligiblePlacementSlots(s, pid, 'a1')];
    const meritId = eligible.find((id) => isMeritSlotId(s, id))!;
    const plainId = eligible.find((id) => !isMeritSlotId(s, id))!;
    s = setDesc(setDesc(s, meritId, 'Gain 4 Mana'), plainId, 'Gain 2 Mana');
    // His one Badge is already spoken for: he sits on another Merit seat.
    const otherMerit = meritSlotIds(s).find((id) => id !== meritId)!;
    s = occupy(s, 0, 'held', otherMerit);

    const a = malfoy.chooseErrandsAction(s, pid);
    expect(a).toMatchObject({ type: 'PLACE_WORKER', actionSpaceId: plainId });
  });
});

describe('Malfoy — prompt answers', () => {
  const baseState = errandsGame();
  const mk = (prompt: PendingResolution['prompt']): PendingResolution => ({
    id: 'r-test',
    responderId: baseState.players[0]!.id,
    prompt,
    resume: { effectId: 'base.system.noop', context: {} },
    source: { kind: 'system', id: 't', triggeringPlayerId: baseState.players[0]!.id, description: 't' },
  });

  it('takes Mana over Gold on a choice menu', () => {
    const ans = malfoy.answerPendingResolution(
      baseState,
      mk({
        kind: 'choose-from-options',
        options: [
          { id: 'gold', label: 'Gain 7 Gold', payload: {} },
          { id: 'mana', label: 'Gain 3 Mana', payload: {} },
        ],
      }),
    );
    expect(ans).toEqual({ kind: 'option-chosen', optionId: 'mana', payload: {} });
  });

  it('takes the biggest Spell level offered', () => {
    const ans = malfoy.answerPendingResolution(
      baseState,
      mk({ kind: 'choose-spell-level', spellId: 'x', availableLevels: [1, 3, 2] }),
    );
    expect(ans).toEqual({ kind: 'level-chosen', level: 3 });
  });

  it('passes a pass-only reaction window but always plays an offered reaction', () => {
    expect(
      malfoy.answerPendingResolution(
        baseState,
        mk({ kind: 'reaction-window', triggerEvents: [], reactionOptions: [], canPass: true }),
      ),
    ).toEqual({ kind: 'reaction-passed' });

    const ans = malfoy.answerPendingResolution(
      baseState,
      mk({
        kind: 'reaction-window',
        triggerEvents: [],
        reactionOptions: [
          { sourceKind: 'vault-card', sourceId: 'base.vault.shield-potion', effectId: 'base.vault.shield-potion.react', label: 'Shield Potion', requiresSlotPick: true },
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
});

describe('Malfoy — headless all-bot game', () => {
  it('runs a Malfoy-vs-Malfoy game to completion without stalling', () => {
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
            ? ({ type: 'RESOLVE_PENDING', resolutionId: ctx.pending.id, answer: malfoy.answerPendingResolution(s, ctx.pending) } as const)
            : malfoy.chooseErrandsAction(s, ctx.playerId);
      s = applyAction(s, action);
      steps++;
    }

    expect(s.phase.kind).toBe('complete');
    expect(steps).toBeLessThan(BUDGET);
  });
});
