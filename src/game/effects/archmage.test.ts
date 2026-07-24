import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import { colorAbilityActive, placeMageOnSlot } from './helpers';
import { computeVoterWinner, scorePlayerForCriterion } from '../scoring';
import {
  STAFF_A_CARD_ID,
  STAFF_B_CARD_ID,
  archmagePack,
  staffHolderId,
} from '../../content/packs/archmage';
import type { ConsortiumVoter } from '../types';
import type { GameConfig, GameState, OwnedMage, Player, Room } from '../types';

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
});
