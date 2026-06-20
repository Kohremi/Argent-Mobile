import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import { buildResolutionChoiceOptions } from './helpers';
import { getEffect } from './registry';
import type { ActionSpace, GameConfig, GameState, OwnedMage, Player } from '../types';

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

// ---- Vault cards ----------------------------------------------------------

function errands2P(patch?: (s: GameState) => GameState): GameState {
  let s = initGame(TWO);
  s = {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
  if (patch) s = patch(s);
  return s;
}
function addVault(s: GameState, id: string, vaultCardId: string): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, vaultCards: [...p.vaultCards, { cardId: vaultCardId, exhausted: false }] }));
}
function setMana(s: GameState, id: string, mana: number): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, resources: { ...p.resources, mana } }));
}
function playVault(s: GameState, vaultCardId: string): GameState {
  return applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId });
}

describe("Summer Break — Chancellor's Yacht Keys", () => {
  it('gains a secret Supporter and exhausts the treasure', () => {
    let s = errands2P((st) => addVault(st, 'p1', 'summerbreak.vault.yacht-keys'));
    const deckBefore = s.supporterDeck.length;
    s = playVault(s, 'summerbreak.vault.yacht-keys');
    expect(s.supporterDeck.length).toBe(deckBefore - 1);
    expect(s.players[0]!.vaultCards).toEqual([
      { cardId: 'summerbreak.vault.yacht-keys', exhausted: true },
    ]);
  });
});

describe('Summer Break — wound-immunity vault cards', () => {
  it('Magic Sunblock grants a round-long wound-immunity buff (consumable)', () => {
    let s = errands2P((st) => addVault(st, 'p1', 'summerbreak.vault.magic-sunblock'));
    s = playVault(s, 'summerbreak.vault.magic-sunblock');
    const buff = s.activeBuffs.find((b) => b.kind === 'mage-immunity' && b.ownerId === 'p1');
    expect(buff).toBeDefined();
    if (buff && buff.kind === 'mage-immunity') {
      expect(buff.immuneTo).toContain('wound');
      expect(buff.expiresAt.kind).toBe('round-end');
    }
    // Consumable → discarded.
    expect(s.players[0]!.vaultCards).toEqual([]);
  });

  it("Sorcerer's Beach Towel spends 2 Mana for the buff", () => {
    let s = errands2P((st) => setMana(addVault(st, 'p1', 'summerbreak.vault.beach-towel'), 'p1', 3));
    s = playVault(s, 'summerbreak.vault.beach-towel');
    expect(s.players[0]!.resources.mana).toBe(1);
    expect(s.activeBuffs.some((b) => b.kind === 'mage-immunity' && b.ownerId === 'p1')).toBe(true);
  });

  it("Beach Towel no-ops (but still exhausts) without 2 Mana", () => {
    let s = errands2P((st) => setMana(addVault(st, 'p1', 'summerbreak.vault.beach-towel'), 'p1', 1));
    s = playVault(s, 'summerbreak.vault.beach-towel');
    expect(s.players[0]!.resources.mana).toBe(1);
    expect(s.activeBuffs.some((b) => b.kind === 'mage-immunity')).toBe(false);
    expect(s.players[0]!.vaultCards).toEqual([
      { cardId: 'summerbreak.vault.beach-towel', exhausted: true },
    ]);
  });
});

describe('Summer Break — Divine Beach Hat', () => {
  it('grants 1 Mana and no prompt when no Spell can be cast', () => {
    let s = errands2P((st) => setMana(addVault(st, 'p1', 'summerbreak.vault.divine-beach-hat'), 'p1', 0));
    s = playVault(s, 'summerbreak.vault.divine-beach-hat');
    expect(s.players[0]!.resources.mana).toBe(1);
    expect(topPending(s)).toBeUndefined();
  });

  it('gains 1 Mana then casts an owned researched Spell (exhausting it)', () => {
    let s = errands2P((st) => {
      st = setMana(addVault(st, 'p1', 'summerbreak.vault.divine-beach-hat'), 'p1', 0);
      return mapPlayer(st, 'p1', (p) => ({
        ...p,
        ownedSpells: [
          { cardId: 'base.spell.trance', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
        ],
      }));
    });
    s = playVault(s, 'summerbreak.vault.divine-beach-hat');
    // +1 Mana granted up front, and Trance L1 (cost 0) offered.
    expect(s.players[0]!.resources.mana).toBe(1);
    const top = topPending(s)!;
    expect(top.prompt.kind).toBe('choose-from-options');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'option-chosen', optionId: 'base.spell.trance::1', payload: {} },
    });
    // Trance grants +2 Mana and is now exhausted: 0 +1 (hat) +2 (trance) = 3.
    expect(s.players[0]!.resources.mana).toBe(3);
    expect(s.players[0]!.ownedSpells[0]!.exhausted).toBe(true);
  });
});

describe('Summer Break — Planar Ice Cream', () => {
  it('inserts a not-in-play A-side room onto the board', () => {
    let s = errands2P((st) => addVault(st, 'p1', 'summerbreak.vault.planar-ice-cream'));
    const beforeCount = s.rooms.length;
    const beforeNames = new Set(s.rooms.map((r) => r.name));
    const beforeRng = s.rng.counter;
    s = playVault(s, 'summerbreak.vault.planar-ice-cream');
    expect(s.rooms.length).toBe(beforeCount + 1);
    const added = s.rooms[s.rooms.length - 1]!;
    expect(added.side).toBe('A');
    expect(beforeNames.has(added.name)).toBe(false);
    // The new room is on the board layout, and the RNG advanced (random draw).
    expect(s.roomLayout.grid.some((row) => row.includes(added.id))).toBe(true);
    expect(s.rng.counter).not.toBe(beforeRng);
    // Consumable consumed.
    expect(s.players[0]!.vaultCards).toEqual([]);
  });
});

// ---- Department-discard supporters ----------------------------------------

const NM_SPELL = 'base.spell.strength-of-earth'; // Natural Magick, L1 costs 1 Mana
const IRION = 'summerbreak.supporter.irion-juiz'; // Natural Magick waiver
const IRINI = 'summerbreak.supporter.irini-grenhart'; // Divinity waiver

function withSpellAndSupporters(s: GameState, supporters: string[]): GameState {
  return mapPlayer(s, 'p1', (p) => ({
    ...p,
    ownedSpells: [
      { cardId: NM_SPELL, intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
    ],
    supporters: [...p.supporters, ...supporters],
  }));
}
function cast(s: GameState): GameState {
  return applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: NM_SPELL, level: 1 });
}

describe('Summer Break — department-discard supporters', () => {
  it('auto-discards the matching supporter to cast when Mana is short', () => {
    let s = errands2P((st) => setMana(withSpellAndSupporters(st, [IRION]), 'p1', 0));
    s = cast(s);
    // No payment prompt — the only way to pay was the supporter, so it auto-fires.
    expect(topPending(s)).toBeUndefined();
    expect(s.players[0]!.resources.mana).toBe(0);
    expect(s.players[0]!.supporters).not.toContain(IRION);
    expect(s.players[0]!.personalDiscard).toContainEqual({ kind: 'supporter', cardId: IRION });
    expect(s.players[0]!.ownedSpells[0]!.exhausted).toBe(true);
  });

  it('prompts Mana-vs-supporter when both are possible; paying Mana keeps the card', () => {
    let s = errands2P((st) => setMana(withSpellAndSupporters(st, [IRION]), 'p1', 5));
    s = cast(s);
    const top = topPending(s)!;
    if (top.prompt.kind !== 'choose-from-options') throw new Error('expected payment prompt');
    expect(top.prompt.options.map((o) => o.id)).toEqual(['mana', `supporter::${IRION}`]);
    s = resolveTop(s, 'mana');
    expect(s.players[0]!.resources.mana).toBe(4);
    expect(s.players[0]!.supporters).toContain(IRION);
    expect(s.players[0]!.ownedSpells[0]!.exhausted).toBe(true);
  });

  it('prompts; discarding the supporter keeps the Mana', () => {
    let s = errands2P((st) => setMana(withSpellAndSupporters(st, [IRION]), 'p1', 5));
    s = cast(s);
    s = resolveTop(s, `supporter::${IRION}`);
    expect(s.players[0]!.resources.mana).toBe(5);
    expect(s.players[0]!.supporters).not.toContain(IRION);
    expect(s.players[0]!.personalDiscard).toContainEqual({ kind: 'supporter', cardId: IRION });
  });

  it('a mismatched-department supporter does not enable an unaffordable cast', () => {
    const s = errands2P((st) => setMana(withSpellAndSupporters(st, [IRINI]), 'p1', 0));
    expect(() => cast(s)).toThrow(/insufficient mana/);
  });
});

describe('Summer Break — Beach Brew (Merit-slot waiver)', () => {
  const BREW = 'summerbreak.vault.beach-brew';
  const meritSlot: ActionSpace = {
    id: 'test.merit',
    roomId: 'test.room',
    index: 0,
    slotType: 'merit',
    occupant: null,
    effectId: 'base.system.noop',
    costToActivate: { meritBadges: 1 },
  };

  it('adds a "discard Beach Brew" option to a Merit slot prompt', () => {
    let s = initGame(TWO);
    s = mapPlayer(s, 'p1', (p) => ({ ...p, vaultCards: [{ cardId: BREW, exhausted: false }] }));
    const { options } = buildResolutionChoiceOptions(s, meritSlot, 'p1', 'base');
    expect(options.some((o) => o.id === `reward-waiver::${BREW}`)).toBe(true);
  });

  it('omits the option when no Beach Brew is held', () => {
    const s = initGame(TWO);
    const { options } = buildResolutionChoiceOptions(s, meritSlot, 'p1', 'base');
    expect(options.some((o) => o.id.startsWith('reward-waiver'))).toBe(false);
  });

  it('discards Beach Brew to take the reward, spending no Merit Badge', () => {
    let s = initGame(TWO);
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      resources: { ...p.resources, meritBadges: 2 },
      vaultCards: [{ cardId: BREW, exhausted: false }],
    }));
    const result = getEffect('base.system.resolution-choice')({
      state: s,
      source: { kind: 'room-action', id: 'test.merit', triggeringPlayerId: 'p1', description: 'merit slot' },
      triggeringPlayerId: 'p1',
      resumeAnswer: { kind: 'option-chosen', optionId: `reward-waiver::${BREW}`, payload: {} },
      resumeContext: { innerEffectId: 'base.system.noop', meritCost: 1, goldCost: 0 },
      allowReactions: true,
    });
    if (result.kind !== 'done') throw new Error('expected done');
    const p1 = result.patch.players!.find((p) => p.id === 'p1')!;
    expect(p1.resources.meritBadges).toBe(2); // no Badge spent
    expect(p1.vaultCards).toEqual([]); // Beach Brew consumed
    expect(p1.personalDiscard).toContainEqual({ kind: 'consumable', cardId: BREW });
  });
});

describe('Summer Break — supporter deck gating', () => {
  it('excludes Eloi Claus without the Mancers expansion', () => {
    const s = initGame(TWO);
    const all = [...s.supporterDeck, ...s.supporterTableau];
    expect(all).not.toContain('summerbreak.supporter.eloi-claus');
    expect(all).toContain('summerbreak.supporter.sami-rekar');
  });

  it('includes Eloi Claus when Mancers is active', () => {
    const s = initGame({ activePackIds: ['base', 'mancers', 'summerbreak'], playerNames: ['A', 'B'], rngSeed: 3 });
    const all = [...s.supporterDeck, ...s.supporterTableau];
    expect(all).toContain('summerbreak.supporter.eloi-claus');
  });
});
