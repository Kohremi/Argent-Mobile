import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import { renovationPack } from '../../content/packs/renovation';
import type {
  BellTowerCard,
  GameConfig,
  GameState,
  OwnedMage,
  Player,
} from '../types';

const THREE: GameConfig = {
  activePackIds: ['base', 'renovation'],
  playerNames: ['Alice', 'Bob', 'Cara'],
  rngSeed: 99,
};
const TWO: GameConfig = {
  activePackIds: ['base', 'renovation'],
  playerNames: ['Alice', 'Bob'],
  rngSeed: 99,
};

function advance(s: GameState): GameState {
  return applyAction(s, { type: 'ADVANCE_PHASE' });
}
function mapPlayer(s: GameState, id: string, fn: (p: Player) => Player): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}
function bellCard(id: string): BellTowerCard {
  const c = renovationPack.bellTowerCards.find((b) => b.id === id);
  if (!c) throw new Error(`no renovation card ${id}`);
  return c;
}
/** Seats the game in round-1 errands with `available` as the bell tower and
 *  player 0 active. */
function errandsWith(
  config: GameConfig,
  available: BellTowerCard[],
): GameState {
  let s = initGame(config);
  s = advance(s); // round-setup → errands
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
    bellTower: { available, taken: [] },
  };
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
function topPending(s: GameState) {
  return s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
}

describe('Bell Tower Renovation — per-round random deal', () => {
  it('deals exactly player-count cards from the combined pool at round 1', () => {
    const s = initGame(THREE);
    expect(s.bellTowerDealPerRound).toBe(3);
    expect(s.bellTower.available).toHaveLength(3);
    // Pool combines base + renovation; the deal can include renovation cards.
    expect(s.bellTowerPool.length).toBeGreaterThan(3);
    expect(s.bellTowerPool.some((id) => id.startsWith('renovation.bell.'))).toBe(true);
  });

  it('re-deals a fresh player-count hand at each round-setup', () => {
    let s = initGame(THREE);
    // Pretend a round was played: empty the tower, then drive a round-setup.
    s = { ...s, bellTower: { available: [], taken: s.bellTower.available.map((c) => ({ cardId: c.id, takenBy: 'p1' })) } };
    s = { ...s, phase: { kind: 'round-setup', round: 2 } };
    s = advance(s); // processRoundSetup re-deals
    if (s.phase.kind !== 'errands') throw new Error('expected errands');
    expect(s.bellTower.available).toHaveLength(3);
    expect(s.bellTower.taken).toHaveLength(0);
  });

  it('leaves the bell tower fixed (no per-round deal) without the module', () => {
    const s = initGame({ activePackIds: ['base'], playerNames: ['A', 'B', 'C'], rngSeed: 1 });
    expect(s.bellTowerDealPerRound).toBeNull();
    // 3-player base eligibility = Initiative / Popularity / Resourcefulness.
    expect(s.bellTower.available).toHaveLength(3);
    expect(s.bellTower.available.every((c) => c.sourcePackId === 'base')).toBe(true);
  });
});

describe('Bell Tower Renovation — card effects', () => {
  it('Wisdom grants 1 WIS', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.wisdom'), bellCard('renovation.bell.intelligence')]);
    const before = s.players[0]!.resources.wisdom;
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.wisdom' });
    expect(s.players[0]!.resources.wisdom).toBe(before + 1);
  });

  it('Greed takes 2 Gold from a chosen player', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.greed'), bellCard('renovation.bell.wisdom')]);
    s = mapPlayer(s, 'p2', (p) => ({ ...p, resources: { ...p.resources, gold: 5 } }));
    const p1Gold = s.players[0]!.resources.gold;
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.greed' });
    const prompt = topPending(s)!;
    expect(prompt.prompt.kind).toBe('choose-from-options');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: prompt.id,
      answer: { kind: 'option-chosen', optionId: 'p2', payload: {} },
    });
    expect(s.players[0]!.resources.gold).toBe(p1Gold + 2);
    expect(s.players[1]!.resources.gold).toBe(3);
  });

  it('Pride grants a temporary Merit Badge', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.pride'), bellCard('renovation.bell.wisdom')]);
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.pride' });
    expect(s.players[0]!.temporaryMeritBadges).toBe(1);
  });
});

describe('Bell Tower Renovation — discard recovery (Connections / Gluttony)', () => {
  it('Connections offers each discarded Supporter as a card face plus a Gold fallback', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.connections'), bellCard('renovation.bell.wisdom')]);
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      personalDiscard: [
        { kind: 'supporter', cardId: 'base.supporter.adelaide-chivers' },
        { kind: 'supporter', cardId: 'base.supporter.arec-russel-zane' },
      ],
    }));
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.connections' });
    const prompt = topPending(s)!;
    if (prompt.prompt.kind !== 'choose-from-options') throw new Error('expected choose-from-options');
    const opts = prompt.prompt.options;
    // Each eligible card renders as a face (carries `cardId`), and every one is
    // named — not a raw id — so the visual selector can label it.
    const cardOpts = opts.filter((o) => o.cardId);
    expect(cardOpts).toHaveLength(2);
    expect(cardOpts.map((o) => o.cardId)).toEqual([
      'base.supporter.adelaide-chivers',
      'base.supporter.arec-russel-zane',
    ]);
    expect(cardOpts.every((o) => o.label.length > 0 && o.label !== o.cardId)).toBe(true);
    // The Gold alternative is a non-card (footer) option.
    expect(opts.some((o) => o.id === 'gold' && !o.cardId)).toBe(true);
  });

  it('Connections returns the chosen Supporter (by index) to hand, leaving the rest', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.connections'), bellCard('renovation.bell.wisdom')]);
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      supporters: [],
      personalDiscard: [
        { kind: 'supporter', cardId: 'base.supporter.adelaide-chivers' },
        { kind: 'supporter', cardId: 'base.supporter.arec-russel-zane' },
      ],
    }));
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.connections' });
    const prompt = topPending(s)!;
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: prompt.id,
      answer: { kind: 'option-chosen', optionId: 'card:1', payload: {} },
    });
    const p1 = s.players[0]!;
    expect(p1.supporters).toEqual(['base.supporter.arec-russel-zane']);
    expect(p1.personalDiscard).toEqual([
      { kind: 'supporter', cardId: 'base.supporter.adelaide-chivers' },
    ]);
  });

  it('Gluttony returns the chosen Consumable to the office as a readied Vault card', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.gluttony'), bellCard('renovation.bell.wisdom')]);
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      vaultCards: [],
      personalDiscard: [{ kind: 'consumable', cardId: 'base.vault.bottled-memories' }],
    }));
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.gluttony' });
    const prompt = topPending(s)!;
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: prompt.id,
      answer: { kind: 'option-chosen', optionId: 'card:0', payload: {} },
    });
    const p1 = s.players[0]!;
    expect(p1.vaultCards).toEqual([{ cardId: 'base.vault.bottled-memories', exhausted: false }]);
    expect(p1.personalDiscard).toEqual([]);
  });

  it('picking the Gold fallback grants 1 Gold and keeps the discard intact', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.connections'), bellCard('renovation.bell.wisdom')]);
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      personalDiscard: [{ kind: 'supporter', cardId: 'base.supporter.adelaide-chivers' }],
    }));
    const gold = s.players[0]!.resources.gold;
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.connections' });
    const prompt = topPending(s)!;
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: prompt.id,
      answer: { kind: 'option-chosen', optionId: 'gold', payload: {} },
    });
    expect(s.players[0]!.resources.gold).toBe(gold + 1);
    expect(s.players[0]!.personalDiscard).toHaveLength(1);
  });

  it('with no eligible discard card, Connections grants Gold without prompting', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.connections'), bellCard('renovation.bell.wisdom')]);
    s = mapPlayer(s, 'p1', (p) => ({ ...p, personalDiscard: [] }));
    const gold = s.players[0]!.resources.gold;
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.connections' });
    expect(topPending(s)).toBeUndefined();
    expect(s.players[0]!.resources.gold).toBe(gold + 1);
  });
});

describe('Bell Tower Renovation — Adaptability', () => {
  it('grants the holder a placement when they take the final card', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.adaptability')]);
    s = addMage(s, 'p1', { id: 'p1-m1', cardId: 'base.mage.divinity', color: 'blue' });
    // Claiming the only card empties the tower → holder (p1) gets to place.
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p1', bellTowerCardId: 'renovation.bell.adaptability' });
    const prompt = topPending(s);
    expect(prompt?.responderId).toBe('p1');
    expect(prompt?.prompt.kind).toBe('choose-from-options'); // allowStop → mages + "Stop here"
  });

  it('grants the holder a placement even when an opponent takes the final card', () => {
    let s = errandsWith(TWO, [bellCard('renovation.bell.wisdom')]);
    // p1 already holds Adaptability (claimed earlier this round) and has a Mage.
    s = mapPlayer(s, 'p1', (p) => ({ ...p, bellTowerCards: ['renovation.bell.adaptability'] }));
    s = addMage(s, 'p1', { id: 'p1-m1', cardId: 'base.mage.divinity', color: 'blue' });
    // p2 is active and takes the final card.
    s = { ...s, phase: { kind: 'errands', round: 1, activePlayerIndex: 1, actionUsed: false, fastActionUsed: false } };
    s = applyAction(s, { type: 'CLAIM_BELL_TOWER', playerId: 'p2', bellTowerCardId: 'renovation.bell.wisdom' });
    const prompt = topPending(s);
    expect(prompt?.responderId).toBe('p1');
  });
});
