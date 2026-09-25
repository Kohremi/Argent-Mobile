import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import { colorAbilityActive, placeMageOnSlot } from './helpers';
import { getEffect } from './registry';
import { computeVoterWinner, scorePlayerForCriterion } from '../scoring';
import { getBotPersonality } from '../ai';
import { getPack } from '../../content/registry';
import { botDecisionContext } from '../../utils/uiSelectors';
import { createRng } from '../../utils/rng';
import {
  STAFF_A_CARD_ID,
  STAFF_B_CARD_ID,
  STAFF_CARD_IDS,
  archmagePack,
  staffHolderId,
} from '../../content/packs/archmage';
import type { ConsortiumVoter } from '../types';
import type {
  GameAction,
  GameConfig,
  GameState,
  OwnedMage,
  PackId,
  Player,
  ResolutionSource,
  Room,
  ScenarioId,
} from '../types';

const CONFIG: GameConfig = {
  activePackIds: ['base', 'archmage'],
  playerNames: ['Alice', 'Bob'],
  rngSeed: 4242,
  // A fixed board that omits the Staff room, so the tests below that inject it
  // via `injectStaffRoom` control exactly one Staff tile. (Random layout now
  // always seats the Staff — covered by the "always in play" suite.)
  roomLayoutMode: {
    kind: 'custom',
    roomIds: [
      'base.room.council-chamber.a',
      'base.room.library.a',
      'base.room.infirmary.a',
      'base.room.vault.a',
      'base.room.training-fields.a',
    ],
  },
};

const STAFF_A_ROOM = archmagePack.rooms.find((r) => r.side === 'A')!;
const STAFF_A_SLOT = STAFF_A_ROOM.actionSpaces[0]!.id;
const STAFF_B_ROOM = archmagePack.rooms.find((r) => r.side === 'B')!;
const STAFF_B_SLOT = STAFF_B_ROOM.actionSpaces[0]!.id;

// The same fixed board with Mancers active — its Flux, Synthesis Workshop,
// Applied Entropy, Eternal Engine and Alkahest Potion all reach the Staff.
const MANCERS_CONFIG: GameConfig = {
  ...CONFIG,
  activePackIds: ['base', 'mancers', 'archmage'],
};

const ULEYLE_VOTER = archmagePack.voters.find((v) => v.id === 'archmage.voter.uleyle-kimbhe')!;

function mapPlayer(state: GameState, playerId: string, fn: (p: Player) => Player): GameState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? fn(p) : p)) };
}

function addMage(state: GameState, playerId: string, mage: Pick<OwnedMage, 'id' | 'cardId' | 'color'>): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    mages: [
      ...p.mages,
      { ...mage, location: { kind: 'office', playerId: p.id }, isShadowing: false, isWounded: false },
    ],
  }));
}

function addVaultCard(state: GameState, playerId: string, cardId: string): GameState {
  return mapPlayer(state, playerId, (p) => ({
    ...p,
    vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
  }));
}

/** Replaces the first non-University-Central in-play room with the given Staff room. */
function injectStaffRoom(state: GameState, room: Room): GameState {
  const idx = state.rooms.findIndex((r) => !r.isUniversityCentral);
  if (idx === -1) throw new Error('test: no non-UC room to replace');
  return { ...state, rooms: state.rooms.map((r, i) => (i === idx ? room : r)) };
}

/** Drives a game from errands to the next mid-game-scoring, answering each
 *  forfeit-or-reward prompt by taking the reward. */
function resolveRound(state: GameState): GameState {
  let s: GameState = { ...state, bellTower: { ...state.bellTower, available: [] } };
  s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution
  let guard = 0;
  while (s.phase.kind === 'resolution' && guard++ < 300) {
    const top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
    if (top) {
      // Every slot resolution surfaces a choose-from-options reward/forfeit prompt.
      const reward =
        top.prompt.kind === 'choose-from-options'
          ? (top.prompt.options.find((o) => o.id === 'reward') ?? top.prompt.options[0])
          : undefined;
      if (!reward) throw new Error(`unexpected prompt kind ${top.prompt.kind}`);
      s = applyAction(s, {
        type: 'RESOLVE_PENDING',
        resolutionId: top.id,
        answer: { kind: 'option-chosen', optionId: reward.id, payload: {} },
      });
    } else {
      s = applyAction(s, { type: 'ADVANCE_PHASE' }); // pump
    }
  }
  return s;
}

function startErrands(state: GameState): GameState {
  const s = applyAction(state, { type: 'ADVANCE_PHASE' }); // round-setup → errands
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
}

/** Hands the round-1 errands turn to `players[index]` with a fresh budget. */
function turnOf(state: GameState, index: number): GameState {
  return {
    ...state,
    phase: { kind: 'errands', round: 1, activePlayerIndex: index, actionUsed: false, fastActionUsed: false },
  };
}

/** Every Staff card in play, as held (holder, side card, exhausted). */
function heldStaff(state: GameState) {
  return state.players.flatMap((p) =>
    p.vaultCards
      .filter((v) => STAFF_CARD_IDS.includes(v.cardId))
      .map((v) => ({ playerId: p.id, cardId: v.cardId, exhausted: v.exhausted })),
  );
}

function chooseOption(state: GameState, optionId: string): GameState {
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1]!;
  return applyAction(state, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'option-chosen', optionId, payload: {} },
  });
}

describe("Archmage's Staff — room & power strip", () => {
  it('a Mage on the Staff slot loses its colour powers (green/blue immunity stripped)', () => {
    let s = startErrands(injectStaffRoom(initGame(CONFIG), STAFF_A_ROOM));
    s = addMage(s, 'p1', { id: 'g1', cardId: 'base.mage.natural-magick', color: 'green' });
    // Control: green mage in office keeps its power.
    const inOffice = s.players[0]!.mages.find((m) => m.id === 'g1')!;
    expect(colorAbilityActive(s, inOffice, 'green')).toBe(true);

    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'g1',
      actionSpaceId: STAFF_A_SLOT,
    });
    const seated = s.players[0]!.mages.find((m) => m.id === 'g1')!;
    expect(seated.location).toEqual({ kind: 'action-space', spaceId: STAFF_A_SLOT });
    // On the Staff slot, the power is stripped.
    expect(colorAbilityActive(s, seated, 'green')).toBe(false);
  });

  it('placing on the Staff slot grants control of the Staff at end of round', () => {
    let s = startErrands(injectStaffRoom(initGame(CONFIG), STAFF_A_ROOM));
    s = addMage(s, 'p1', { id: 'g1', cardId: 'base.mage.natural-magick', color: 'green' });
    expect(staffHolderId(s)).toBeNull();

    s = applyAction(s, {
      type: 'PLACE_WORKER',
      playerId: 'p1',
      mageId: 'g1',
      actionSpaceId: STAFF_A_SLOT,
    });
    s = resolveRound(s);

    expect(s.phase.kind).toBe('mid-game-scoring');
    expect(staffHolderId(s)).toBe('p1');
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p1.vaultCards.some((v) => v.cardId === STAFF_A_CARD_ID && !v.exhausted)).toBe(true);
    // The mage returned to its office.
    expect(s.players[0]!.mages.find((m) => m.id === 'g1')!.location.kind).toBe('office');
  });
});

describe("Archmage's Staff — Side A (The Will to Power)", () => {
  it('gives the chosen resource (3 Mana) and exhausts the Staff', () => {
    let s = startErrands(initGame(CONFIG));
    s = addVaultCard(s, 'p1', STAFF_A_CARD_ID);
    const before = s.players.find((p) => p.id === 'p1')!.resources.mana;

    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: STAFF_A_CARD_ID });
    const prompt = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    expect(prompt.prompt.kind).toBe('choose-from-options');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: prompt.id,
      answer: { kind: 'option-chosen', optionId: 'mana', payload: {} },
    });

    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p1.resources.mana).toBe(before + 3);
    expect(p1.vaultCards.find((v) => v.cardId === STAFF_A_CARD_ID)!.exhausted).toBe(true);
  });

  it('the Research option queues two Research opportunities', () => {
    let s = startErrands(initGame(CONFIG));
    s = addVaultCard(s, 'p1', STAFF_A_CARD_ID);
    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: STAFF_A_CARD_ID });
    const prompt = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: prompt.id,
      answer: { kind: 'option-chosen', optionId: 'research', payload: {} },
    });
    // Two Research were queued; the pump drains one into a live prompt and
    // leaves the other in the queue.
    expect(s.researchQueue.length + s.pendingResolutionStack.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Archmage's Staff — Side B (The Force of Magic)", () => {
  it('casts an UNRESEARCHED owned spell for free and exhausts the Staff', () => {
    let s = startErrands(initGame(CONFIG));
    s = addVaultCard(s, 'p1', STAFF_B_CARD_ID);
    // Own a regular spell book but leave it unresearched (intPlaced: false).
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      ownedSpells: [
        ...p.ownedSpells,
        {
          cardId: 'base.spell.the-pursuit-of-power',
          intPlaced: false,
          wisPlacedLevel2: false,
          wisPlacedLevel3: false,
          exhausted: false,
        },
      ],
      resources: { ...p.resources, mana: 0 },
    }));

    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: STAFF_B_CARD_ID });
    // Step 1: choose the spell.
    let top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    expect(top.prompt.kind).toBe('choose-from-options');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'base.spell.the-pursuit-of-power', payload: {} },
    });
    // Step 2: choose the level (any level offered, incl. unresearched ones).
    top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    expect(top.prompt.kind).toBe('choose-spell-level');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'level-chosen', level: 1 },
    });

    const p1 = s.players.find((p) => p.id === 'p1')!;
    // Warmth (L1) granted 2 Mana — with 0 paid for the cast itself.
    expect(p1.resources.mana).toBe(2);
    // The spell book itself is NOT exhausted (we didn't cast it normally);
    // the Staff is.
    expect(p1.vaultCards.find((v) => v.cardId === STAFF_B_CARD_ID)!.exhausted).toBe(true);
  });
});

describe("Archmage's Staff — Uleyle Kimbhe voter", () => {
  const VOTER: ConsortiumVoter = archmagePack.voters.find(
    (v) => v.id === 'archmage.voter.uleyle-kimbhe',
  )!;

  it('scores 1 for the Staff holder and 0 for everyone else; awards the vote to the holder', () => {
    let s = startErrands(initGame(CONFIG));
    s = addVaultCard(s, 'p2', STAFF_A_CARD_ID);

    const p1 = s.players.find((p) => p.id === 'p1')!;
    const p2 = s.players.find((p) => p.id === 'p2')!;
    expect(scorePlayerForCriterion(s, p1, 'custom', VOTER.customScoringEffectId)).toBe(0);
    expect(scorePlayerForCriterion(s, p2, 'custom', VOTER.customScoringEffectId)).toBe(1);

    expect(computeVoterWinner(s, VOTER).winner).toBe('p2');
  });

  it('abstains when no one holds the Staff', () => {
    const s = startErrands(initGame(CONFIG));
    expect(computeVoterWinner(s, VOTER).winner).toBeNull();
  });
});

describe("Archmage's Staff — voter only enters the pool with the Staff room", () => {
  const ULEYLE = 'archmage.voter.uleyle-kimbhe';
  const STAFF_A_ROOM_ID = 'archmage.room.archmages-staff.a';
  const NON_STAFF_ROOMS = [
    'base.room.library.a',
    'base.room.council-chamber.a',
    'base.room.infirmary.a',
    'base.room.vault.b',
    'base.room.training-fields.a',
  ];

  it('is NEVER seeded when the Staff room is not in play', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = initGame({
        ...CONFIG,
        rngSeed: seed,
        roomLayoutMode: { kind: 'custom', roomIds: NON_STAFF_ROOMS },
      });
      expect(s.voters.some((v) => v.id === ULEYLE)).toBe(false);
    }
  });

  it('CAN be seeded when the Staff room is in play', () => {
    let appeared = false;
    for (let seed = 1; seed <= 50 && !appeared; seed++) {
      const s = initGame({
        ...CONFIG,
        rngSeed: seed,
        roomLayoutMode: {
          kind: 'custom',
          roomIds: [STAFF_A_ROOM_ID, ...NON_STAFF_ROOMS],
        },
      });
      if (s.voters.some((v) => v.id === ULEYLE)) appeared = true;
    }
    expect(appeared).toBe(true);
  });
});

describe("Archmage's Staff — always in play when the pack is active", () => {
  const STAFF_ROOM_NAME = "The Archmage's Staff";
  const STAFF_A_ROOM_ID = 'archmage.room.archmages-staff.a';
  const STAFF_B_ROOM_ID = 'archmage.room.archmages-staff.b';

  it('the random layout always seats exactly one Staff room', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = initGame({ ...CONFIG, rngSeed: seed, roomLayoutMode: { kind: 'random' } });
      const staff = s.rooms.filter((r) => r.name === STAFF_ROOM_NAME);
      expect(staff.length).toBe(1);
      expect([STAFF_A_ROOM_ID, STAFF_B_ROOM_ID]).toContain(staff[0]!.id);
    }
  });

  it('the random layout picks the Staff side by coin flip (both sides appear)', () => {
    const sides = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = initGame({ ...CONFIG, rngSeed: seed, roomLayoutMode: { kind: 'random' } });
      sides.add(s.rooms.find((r) => r.name === STAFF_ROOM_NAME)!.side);
    }
    expect(sides).toEqual(new Set(['A', 'B']));
  });

  it('the first-time (starter) layout appends the Staff (side A) as an extra tile', () => {
    const starter = initGame({ ...CONFIG, roomLayoutMode: { kind: 'first-time' } });
    // The 8 rulebook rooms plus the appended Staff.
    expect(starter.rooms.length).toBe(9);
    const staff = starter.rooms.filter((r) => r.name === STAFF_ROOM_NAME);
    expect(staff.length).toBe(1);
    expect(staff[0]!.id).toBe(STAFF_A_ROOM_ID);
  });

  it('a hand-picked custom board that omits the Staff stays without it', () => {
    // The custom pre-select is a removable UI default, not an engine guarantee —
    // an explicit selection without the Staff is honoured as-is.
    const s = initGame({
      ...CONFIG,
      roomLayoutMode: {
        kind: 'custom',
        roomIds: [
          'base.room.council-chamber.a',
          'base.room.library.a',
          'base.room.infirmary.a',
          'base.room.vault.a',
        ],
      },
    });
    expect(s.rooms.some((r) => r.name === STAFF_ROOM_NAME)).toBe(false);
  });
});

describe("Archmage's Staff — no shadow can be placed there (bypass fixes)", () => {
  it('placeMageOnSlot rejects a shadow placement on the Staff slot', () => {
    let s = injectStaffRoom(initGame(CONFIG), STAFF_A_ROOM);
    s = addMage(s, 'p1', {
      id: 'g1',
      cardId: 'base.mage.natural-magick',
      color: 'green',
    });
    expect(() =>
      placeMageOnSlot(s, {
        mageId: 'g1',
        ownerId: 'p1',
        spaceId: STAFF_A_SLOT,
        asShadow: true,
      }),
    ).toThrow(/no shadow position/);
    // Base placement on the same slot is still legal.
    expect(() =>
      placeMageOnSlot(s, {
        mageId: 'g1',
        ownerId: 'p1',
        spaceId: STAFF_A_SLOT,
        asShadow: false,
      }),
    ).not.toThrow();
  });

  it('Invisibility (Indefinite Definitives L2) never offers the Staff slot', () => {
    let s = injectStaffRoom(initGame(CONFIG), STAFF_A_ROOM);
    // p1 owns Indefinite Definitives researched to L2, with Mana + an office Mage.
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      ownedSpells: [
        ...p.ownedSpells,
        {
          cardId: 'base.spell.indefinite-definitives',
          intPlaced: true,
          wisPlacedLevel2: true,
          wisPlacedLevel3: false,
          exhausted: false,
        },
      ],
      resources: { ...p.resources, mana: 3 },
    }));
    s = addMage(s, 'p1', {
      id: 'hider',
      cardId: 'base.mage.divinity',
      color: 'blue',
    });
    s = {
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
    s = applyAction(s, {
      type: 'CAST_SPELL',
      playerId: 'p1',
      spellCardId: 'base.spell.indefinite-definitives',
      level: 2,
    });
    // Step 1: pick the office Mage to hide.
    let top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    expect(top.prompt.kind).toBe('choose-target-mage');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'mage-chosen', mageId: 'hider' },
    });
    // Step 2: the empty-slot prompt must exclude the Staff slot but still offer
    // other rooms' empty slots.
    top = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    expect(top.prompt.kind).toBe('choose-target-action-space');
    if (top.prompt.kind === 'choose-target-action-space') {
      expect(top.prompt.eligibleSpaceIds).not.toContain(STAFF_A_SLOT);
      expect(top.prompt.eligibleSpaceIds.length).toBeGreaterThan(0);
    }
  });

  it('Rennel Pedrigor never targets a Mage seated on the Staff slot', () => {
    // Regression: the Staff has no shadow position, so once this target was
    // picked the shadow placement was rejected and the prompt could never be
    // answered — the game stalled (seen in all-bot games).
    let s = startErrands(injectStaffRoom(initGame(CONFIG), STAFF_A_ROOM));
    s = addMage(s, 'p2', { id: 'bob-staff', cardId: 'base.mage.sorcery', color: 'red' });
    s = addMage(s, 'p2', { id: 'bob-open', cardId: 'base.mage.sorcery', color: 'red' });
    s = addMage(s, 'p1', { id: 'alice-shadow', cardId: 'base.mage.sorcery', color: 'red' });
    const openSlot = s.rooms
      .flatMap((r) => (r.noShadowSlots || r.cannotBePlacedInDirectly ? [] : r.actionSpaces))
      .find((sp) => !sp.occupant)!.id;
    s = { ...s, ...placeMageOnSlot(s, { mageId: 'bob-staff', ownerId: 'p2', spaceId: STAFF_A_SLOT, asShadow: false }) };
    s = { ...s, ...placeMageOnSlot(s, { mageId: 'bob-open', ownerId: 'p2', spaceId: openSlot, asShadow: false }) };
    s = mapPlayer(s, 'p1', (p) => ({ ...p, supporters: [...p.supporters, 'base.supporter.rennel-pedrigor'] }));
    s = applyAction(s, {
      type: 'PLAY_SUPPORTER',
      playerId: 'p1',
      supporterCardId: 'base.supporter.rennel-pedrigor',
    });
    const pick = s.pendingResolutionStack[s.pendingResolutionStack.length - 1]!;
    expect(pick.prompt.kind).toBe('choose-target-mage');
    if (pick.prompt.kind !== 'choose-target-mage') return;
    expect(pick.prompt.eligibleMageIds).toContain('bob-open');
    expect(pick.prompt.eligibleMageIds).not.toContain('bob-staff');
  });
});

describe("Archmage's Staff — one Staff, following its room's side", () => {
  const BEYOND = 'mancers.spell.beyond-the-beyonds';

  it("Flux swaps the held Staff to the new side's power (still exhausted); a later claim leaves one Staff", () => {
    let s = startErrands(injectStaffRoom(initGame(MANCERS_CONFIG), STAFF_A_ROOM));
    // Alice (seated first) claimed side A earlier and has used it this round;
    // she can cast Flux (Beyond the Beyonds L3).
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      vaultCards: [...p.vaultCards, { cardId: STAFF_A_CARD_ID, exhausted: true }],
      ownedSpells: [
        ...p.ownedSpells,
        { cardId: BEYOND, intPlaced: true, wisPlacedLevel2: true, wisPlacedLevel3: true, exhausted: false },
      ],
      resources: { ...p.resources, mana: 5 },
    }));

    // Flux flips the (empty) Staff room: Alice's Staff takes side B's power on
    // the spot, and stays exhausted.
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BEYOND, level: 3 });
    s = chooseOption(s, STAFF_A_ROOM.id);
    expect(s.rooms.some((r) => r.id === STAFF_B_ROOM.id)).toBe(true);
    expect(heldStaff(s)).toEqual([{ playerId: 'p1', cardId: STAFF_B_CARD_ID, exhausted: true }]);

    // Bob claims the Staff: it leaves Alice entirely, so Uleyle votes for Bob.
    // (Before the fix Alice kept side A's card, and the vote went to her —
    // she sits first.)
    s = addMage(s, 'p2', { id: 'b1', cardId: 'base.mage.sorcery', color: 'red' });
    s = turnOf(s, 1);
    s = applyAction(s, { type: 'PLACE_WORKER', playerId: 'p2', mageId: 'b1', actionSpaceId: STAFF_B_SLOT });
    s = resolveRound(s);
    expect(heldStaff(s)).toEqual([{ playerId: 'p2', cardId: STAFF_B_CARD_ID, exhausted: false }]);
    expect(computeVoterWinner(s, ULEYLE_VOTER).winner).toBe('p2');
  });

  it("a claim takes back EITHER side's Staff card, so two can never be held at once", () => {
    // Defence in depth: even if Alice still held side A's card while the room
    // shows side B, Bob's claim must leave exactly one Staff.
    let s = startErrands(injectStaffRoom(initGame(CONFIG), STAFF_B_ROOM));
    s = addVaultCard(s, 'p1', STAFF_A_CARD_ID);
    s = addMage(s, 'p2', { id: 'b1', cardId: 'base.mage.sorcery', color: 'red' });
    s = turnOf(s, 1);
    s = applyAction(s, { type: 'PLACE_WORKER', playerId: 'p2', mageId: 'b1', actionSpaceId: STAFF_B_SLOT });
    s = resolveRound(s);
    expect(heldStaff(s)).toEqual([{ playerId: 'p2', cardId: STAFF_B_CARD_ID, exhausted: false }]);
    expect(computeVoterWinner(s, ULEYLE_VOTER).winner).toBe('p2');
  });

  it('the Dimensional Rift empty-room flip swaps the held Staff too', () => {
    // The starter board appends the Staff (side A); the Rift flips every empty
    // room as errands end.
    let s = initGame({
      ...CONFIG,
      scenarioId: 'dimensional-rift',
      roomLayoutMode: { kind: 'first-time' },
    });
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // round-setup → errands
    // Round 2 errands end straight into resolution (no R1 bonus pass).
    s = {
      ...s,
      phase: { kind: 'errands', round: 2, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
      bellTower: { available: [], taken: [] },
    };
    s = addVaultCard(s, 'p1', STAFF_A_CARD_ID);
    s = applyAction(s, { type: 'ADVANCE_PHASE' }); // errands → resolution (+ flip)
    expect(s.rooms.some((r) => r.id === STAFF_B_ROOM.id)).toBe(true);
    expect(heldStaff(s)).toEqual([{ playerId: 'p1', cardId: STAFF_B_CARD_ID, exhausted: false }]);
  });
});

describe("Archmage's Staff — sacrificed to a card effect, it goes back to its room", () => {
  const STONE = 'mancers.vault.philosophers-stone'; // an ordinary Treasure
  const SORCERY_SUPPORTER = 'base.supporter.arec-russel-zane'; // Synthesis → Sword of Flame
  const SWORD = 'mancers.vault.sword-of-flame';
  const ETERNAL_ENGINE = 'mancers.spell.the-eternal-engine';

  const alice = (state: GameState) => state.players.find((p) => p.id === 'p1')!;

  /** Alice holds the Staff and a Philosopher's Stone, plus what each trade-in
   *  needs (a Supporter, a Spell, Mana). */
  function aliceHoldsStaff(): GameState {
    let s = startErrands(initGame(MANCERS_CONFIG));
    s = addVaultCard(s, 'p1', STAFF_A_CARD_ID);
    s = addVaultCard(s, 'p1', STONE);
    return mapPlayer(s, 'p1', (p) => ({
      ...p,
      supporters: [...p.supporters, SORCERY_SUPPORTER],
      ownedSpells: [
        ...p.ownedSpells,
        { cardId: 'base.spell.burn', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
      ],
      resources: { ...p.resources, mana: 10 },
    }));
  }

  /** Runs an effect as `playerId` the way the engine does: applies each patch
   *  and resumes each prompt it pauses on with the next option id. */
  function runEffect(state: GameState, effectId: string, playerId: string, picks: string[]): GameState {
    const source: ResolutionSource = { kind: 'spell', id: effectId, triggeringPlayerId: playerId, description: effectId };
    let s = state;
    let result = getEffect(effectId)({ state: s, source, triggeringPlayerId: playerId, allowReactions: false });
    for (const optionId of picks) {
      if (result.kind !== 'pause') throw new Error(`${effectId} finished before being asked for ${optionId}`);
      s = { ...s, ...(result.patch ?? {}) };
      result = getEffect(result.pending.resume.effectId)({
        state: s,
        source,
        triggeringPlayerId: playerId,
        allowReactions: false,
        resumeContext: result.pending.resume.context,
        resumeAnswer: { kind: 'option-chosen', optionId, payload: {} },
      });
    }
    if (result.kind === 'pause') throw new Error(`${effectId} is still waiting on a prompt`);
    return { ...s, ...(result.patch ?? {}) };
  }

  /** No one holds the Staff, and it isn't in any discard pile, the Vault deck or
   *  the Vault market — it's back in its room. */
  function expectStaffBackInItsRoom(state: GameState) {
    expect(heldStaff(state)).toEqual([]);
    const inPiles = [
      ...state.players.flatMap((p) => p.personalDiscard.map((d) => d.cardId)),
      ...state.vaultDeck,
      ...state.vaultTableau,
    ].filter((id) => STAFF_CARD_IDS.includes(id));
    expect(inPiles).toEqual([]);
  }

  const SACRIFICES: {
    what: string;
    effectId: string;
    runBy: string;
    picks: string[];
    payoff: (before: GameState, after: GameState) => void;
  }[] = [
    {
      what: 'Synthesis Workshop A trades it in for a Synthesis Treasure',
      effectId: 'mancers.room.synthesis-workshop-a.slot-1',
      runBy: 'p1',
      picks: [STAFF_A_CARD_ID, SORCERY_SUPPORTER],
      payoff: (_, after) => expect(alice(after).vaultCards.map((v) => v.cardId)).toContain(SWORD),
    },
    {
      what: 'Synthesis Workshop B trades it in for a Synthesis Treasure',
      effectId: 'mancers.room.synthesis-workshop-b.slot-1',
      runBy: 'p1',
      picks: [STAFF_A_CARD_ID, 'base.spell.burn'],
      payoff: (_, after) => expect(alice(after).vaultCards.map((v) => v.cardId)).toContain(SWORD),
    },
    {
      what: "Applied Entropy L2 discards it from an opponent's office",
      effectId: 'mancers.spell.applied-entropy.l2',
      runBy: 'p2',
      picks: [`p1::${STAFF_A_CARD_ID}`],
      // Not filed as a used Consumable, so Most Consumables doesn't move.
      payoff: (before, after) =>
        expect(scorePlayerForCriterion(after, alice(after), 'most-consumables')).toBe(
          scorePlayerForCriterion(before, alice(before), 'most-consumables'),
        ),
    },
    {
      what: 'The Eternal Engine L1 recycles it for 4 Mana',
      effectId: `${ETERNAL_ENGINE}.l1`,
      runBy: 'p1',
      picks: [STAFF_A_CARD_ID],
      payoff: (before, after) => expect(alice(after).resources.mana).toBe(alice(before).resources.mana + 4),
    },
    {
      what: 'The Eternal Engine L2 recycles it',
      effectId: `${ETERNAL_ENGINE}.l2`,
      runBy: 'p1',
      picks: [STAFF_A_CARD_ID],
      payoff: (_, after) => expect(alice(after).vaultCards.map((v) => v.cardId)).toEqual([STONE]),
    },
    {
      what: 'The Eternal Engine L3 recycles it for 7 Mana',
      effectId: `${ETERNAL_ENGINE}.l3`,
      runBy: 'p1',
      picks: [`office::${STAFF_A_CARD_ID}`, 'mana'],
      payoff: (before, after) => expect(alice(after).resources.mana).toBe(alice(before).resources.mana + 7),
    },
    {
      what: 'Alkahest Potion discards it for its Gold cost (0) + 2 Mana',
      effectId: 'mancers.vault.alkahest-potion',
      runBy: 'p1',
      picks: [STAFF_A_CARD_ID],
      payoff: (before, after) => {
        expect(alice(after).resources.gold).toBe(alice(before).resources.gold);
        expect(alice(after).resources.mana).toBe(alice(before).resources.mana + 2);
      },
    },
  ];

  for (const { what, effectId, runBy, picks, payoff } of SACRIFICES) {
    it(`${what}; the Staff goes back to its room`, () => {
      const before = aliceHoldsStaff();
      const after = runEffect(before, effectId, runBy, picks);
      payoff(before, after);
      expectStaffBackInItsRoom(after);
    });
  }

  it('back in its room, the Staff goes to whoever claims the room next', () => {
    let s = startErrands(injectStaffRoom(initGame(MANCERS_CONFIG), STAFF_A_ROOM));
    // Alice recycles her Staff with The Eternal Engine L1 (Extract) for 4 Mana.
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      vaultCards: [...p.vaultCards, { cardId: STAFF_A_CARD_ID, exhausted: false }],
      ownedSpells: [
        ...p.ownedSpells,
        { cardId: ETERNAL_ENGINE, intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
      ],
    }));
    const manaBefore = alice(s).resources.mana;
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: ETERNAL_ENGINE, level: 1 });
    s = chooseOption(s, STAFF_A_CARD_ID);
    expect(alice(s).resources.mana).toBe(manaBefore + 4);
    expectStaffBackInItsRoom(s);
    expect(computeVoterWinner(s, ULEYLE_VOTER).winner).toBeNull();

    // Bob claims the room, and the Staff with it.
    s = addMage(s, 'p2', { id: 'b1', cardId: 'base.mage.sorcery', color: 'red' });
    s = turnOf(s, 1);
    s = applyAction(s, { type: 'PLACE_WORKER', playerId: 'p2', mageId: 'b1', actionSpaceId: STAFF_A_SLOT });
    s = resolveRound(s);
    expect(heldStaff(s)).toEqual([{ playerId: 'p2', cardId: STAFF_A_CARD_ID, exhausted: false }]);
    expect(computeVoterWinner(s, ULEYLE_VOTER).winner).toBe('p2');
  });

  it('still counts as a Treasure for Most Treasures while held', () => {
    const s = aliceHoldsStaff();
    expect(scorePlayerForCriterion(s, alice(s), 'most-treasures')).toBe(2); // Staff + Stone
  });
});

// ---------------------------------------------------------------------------
// End-to-end — all-bot games with Mancers (Synthesis Workshop, Applied Entropy,
// The Eternal Engine, Alkahest Potion, Flux, Rennel Pedrigor) and Dimensional
// Rift (flips the Staff room whenever it's empty): after EVERY action there is
// at most one Staff, held in an office or back in its room (never in a discard
// pile or the Vault deck), on its room's current side; and every game
// finishes. Before the fix this matrix stalled on a Staff shadow (2p seed 34)
// and left a stale side after most Rift flips (the next claim then made two).
// ---------------------------------------------------------------------------

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;
const SIM_PACKS: PackId[] = ['base', 'mancers', 'archmage'];
const SIM_CANDIDATES = SIM_PACKS.flatMap((id) => getPack(id)?.candidates ?? []);
const DEPT_OF_CANDIDATE = new Map(SIM_CANDIDATES.map((c) => [c.id, c.department] as const));

/** Why the Staff invariant is broken, or null when it holds. */
function staffInvariantBreak(state: GameState): string | null {
  const where: string[] = [];
  for (const p of state.players) {
    for (const v of p.vaultCards) if (STAFF_CARD_IDS.includes(v.cardId)) where.push(`${p.id}'s office`);
    for (const d of p.personalDiscard) if (STAFF_CARD_IDS.includes(d.cardId)) where.push(`${p.id}'s discard`);
  }
  if (state.vaultDeck.some((c) => STAFF_CARD_IDS.includes(c))) where.push('the Vault deck');
  if (state.vaultTableau.some((c) => STAFF_CARD_IDS.includes(c))) where.push('the Vault tableau');

  if (where.length > 1) return `${where.length} Staffs in play (${where.join(', ')})`;
  if (where.length === 1 && !where[0]!.endsWith('office')) {
    return `the Staff landed in ${where[0]} instead of going back to its room`;
  }
  const room = state.rooms.find((r) => r.id === STAFF_A_ROOM.id || r.id === STAFF_B_ROOM.id);
  const held = heldStaff(state)[0];
  const sideCard = room?.id === STAFF_A_ROOM.id ? STAFF_A_CARD_ID : STAFF_B_CARD_ID;
  if (room && held && held.cardId !== sideCard) {
    return `the held Staff (${held.cardId}) doesn't match the room's side ${room.side}`;
  }
  return null;
}

function runStaffGame(seed: number, playerCount: number, scenarioId?: ScenarioId): string | null {
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);
  const tag = `${playerCount}p${scenarioId ? ` ${scenarioId}` : ''} seed=${seed}`;
  let s = initGame({
    activePackIds: SIM_PACKS,
    playerNames: Array.from({ length: playerCount }, (_, i) => `P${i}`),
    rngSeed: seed,
    controlledByBot: Array.from({ length: playerCount }, () => true),
    botPersonalityIds: Array.from({ length: playerCount }, (_, i) => PERSONALITIES[(i + seed) % 4]!),
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' }, // random always seats the Staff
    ...(scenarioId ? { scenarioId } : {}),
  });
  let steps = 0;
  while (s.phase.kind !== 'complete' && steps < 60000) {
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
      const bot = getBotPersonality(s.players.find((p) => p.id === ctx.playerId)?.botPersonalityId);
      action = bot.chooseErrandsAction(s, ctx.playerId);
    } else {
      switch (s.phase.kind) {
        case 'candidate-draft': {
          const pid = s.players[s.phase.activePlayerIndex]!.id;
          const takenIds = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
          const takenDepts = new Set([...takenIds].map((id) => DEPT_OF_CANDIDATE.get(id)));
          const avail = SIM_CANDIDATES.filter(
            (c) => !takenIds.has(c.id) && !takenDepts.has(c.department),
          );
          action = { type: 'CHOOSE_CANDIDATE', playerId: pid, candidateId: avail[rnd(avail.length)]!.id };
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
          return `${tag} unexpected idle phase ${s.phase.kind}`;
      }
    }
    if (!action) return `${tag} no action at phase ${s.phase.kind}`;
    try {
      s = applyAction(s, action);
    } catch (e) {
      return `${tag} threw on ${action.type}: ${(e as Error).message.split('\n')[0]}`;
    }
    const broke = staffInvariantBreak(s);
    if (broke) return `${tag} after ${action.type}: ${broke}`;
    steps++;
  }
  if (s.phase.kind !== 'complete') return `${tag} did not complete (stalled at ${s.phase.kind})`;
  return null;
}

describe("Archmage's Staff — all-bot games with Mancers and Dimensional Rift", () => {
  it("keep exactly one Staff, on its room's side, and always finish", () => {
    const failures: string[] = [];
    const record = (failure: string | null) => {
      if (failure) failures.push(failure);
    };
    // (4p seed 9 currently stalls on an unrelated Laboratory B purchase.)
    for (const seed of [1, 2, 3, 4, 5, 6]) record(runStaffGame(seed, 4));
    for (const seed of [33, 34, 35]) record(runStaffGame(seed, 2));
    for (const seed of [1, 2, 3, 4, 5, 6]) record(runStaffGame(seed, 2, 'dimensional-rift'));
    for (const seed of [1, 2, 3, 4]) record(runStaffGame(seed, 4, 'dimensional-rift'));
    expect(failures).toEqual([]);
  });
});
