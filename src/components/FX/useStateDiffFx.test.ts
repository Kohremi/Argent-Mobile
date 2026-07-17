// Pure-function tests for the FX state-diff (no DOM needed): drives real
// engine transitions and asserts the implied room effects.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../../game/engine';
import { getBotPersonality } from '../../game/ai';
import { getPack } from '../../content/registry';
import { botDecisionContext } from '../../utils/uiSelectors';
import { createRng } from '../../utils/rng';
import type { GameAction, GameState, OwnedMage } from '../../game/types';
import {
  computeRewardFx,
  computeRoomFx,
  createRewardTracker,
  type RoomFx,
} from './useStateDiffFx';

function base(): GameState {
  const s = initGame({ activePackIds: ['base'], playerNames: ['Akko', 'Diana'], rngSeed: 7 });
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
}
const mk = (id: string, pid: string): OwnedMage => ({
  id, cardId: 'base.mage.neutral', color: 'off-white',
  location: { kind: 'office', playerId: pid }, isShadowing: false, isWounded: false,
});
/** Seats a mage on the first open slot; returns [state, roomId]. */
function seat(s: GameState, playerIdx: number, mageId: string): [GameState, string] {
  const room = s.rooms.find((r) => !r.cannotBePlacedInDirectly && r.actionSpaces.some((sp) => !sp.occupant))!;
  const slot = room.actionSpaces.find((sp) => !sp.occupant)!;
  const pid = s.players[playerIdx]!.id;
  const next: GameState = {
    ...s,
    players: s.players.map((p, i) =>
      i === playerIdx
        ? { ...p, mages: p.mages.map((m) => (m.id === mageId ? { ...m, location: { kind: 'action-space', spaceId: slot.id } } : m)) }
        : p,
    ),
    rooms: s.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((sp) =>
        sp.id === slot.id ? { ...sp, occupant: { mageId, ownerId: pid, isShadowing: false } } : sp,
      ),
    })),
  };
  return [next, room.id];
}

describe('computeRoomFx', () => {
  it('emits a wound flash in the room where the mage stood', () => {
    let s = base();
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, mages: [mk('v', p.id)] } : { ...p, resources: { ...p.resources, mana: 3 }, ownedSpells: [{ cardId: 'base.spell.burn', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false }] })) };
    const [seated, roomId] = seat(s, 1, 'v');
    // Real engine wound: cast Burn L1 at the victim, pass the reaction.
    let after = applyAction(seated, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: 'base.spell.burn', level: 1 });
    let top = after.pendingResolutionStack[after.pendingResolutionStack.length - 1]!;
    after = applyAction(after, { type: 'RESOLVE_PENDING', resolutionId: top.id, answer: { kind: 'mage-chosen', mageId: 'v' } });
    top = after.pendingResolutionStack[after.pendingResolutionStack.length - 1]!;
    after = applyAction(after, { type: 'RESOLVE_PENDING', resolutionId: top.id, answer: { kind: 'reaction-passed' } });
    expect(computeRoomFx(seated, after)).toContainEqual({ roomId, kind: 'wound' });
  });

  it('emits a flip sweep when a room swaps to its other side', () => {
    const s = base();
    const room = s.rooms.find((r) => r.id.endsWith('.a') && !r.isUniversityCentral)!;
    const oppId = `${room.id.slice(0, -2)}.b`;
    const flipped: GameState = {
      ...s,
      rooms: s.rooms.map((r) => (r.id === room.id ? { ...r, id: oppId, side: 'B' as const } : r)),
    };
    expect(computeRoomFx(s, flipped)).toContainEqual({ roomId: oppId, kind: 'flip' });
  });

  it('emits a mana-gain flourish when a Sorcery Side B mage is placed into an occupied room', () => {
    let s = base();
    s = { ...s, mageAbilitySides: { ...s.mageAbilitySides, sorcery: 'B' } };
    const room = s.rooms.find(
      (r) => !r.cannotBePlacedInDirectly && r.actionSpaces.length >= 2,
    )!;
    const [slotA, slotB] = room.actionSpaces;
    const p1id = s.players[0]!.id;
    const p2id = s.players[1]!.id;
    // prev: opponent already seated in the room; p1's red Mage in the office.
    const prev: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? { ...p, mages: [{ ...mk('r', p.id), cardId: 'base.mage.sorcery', color: 'red' }] }
          : { ...p, mages: [mk('o', p.id)] },
      ),
      rooms: s.rooms.map((r) =>
        r.id !== room.id
          ? r
          : {
              ...r,
              actionSpaces: r.actionSpaces.map((sp) =>
                sp.id === slotA!.id
                  ? { ...sp, occupant: { mageId: 'o', ownerId: p2id, isShadowing: false } }
                  : sp,
              ),
            },
      ),
    };
    // next: the red Mage lands in the same room — gains 1 Mana (one other mage).
    const next: GameState = {
      ...prev,
      players: prev.players.map((p, i) =>
        i === 0
          ? { ...p, mages: p.mages.map((m) => (m.id === 'r' ? { ...m, location: { kind: 'action-space', spaceId: slotB!.id } } : m)) }
          : p,
      ),
      rooms: prev.rooms.map((r) =>
        r.id !== room.id
          ? r
          : {
              ...r,
              actionSpaces: r.actionSpaces.map((sp) =>
                sp.id === slotB!.id
                  ? { ...sp, occupant: { mageId: 'r', ownerId: p1id, isShadowing: false } }
                  : sp,
              ),
            },
      ),
    };
    expect(computeRoomFx(prev, next)).toContainEqual({ roomId: room.id, kind: 'mana-gain', value: 1 });
  });

  it('no mana-gain flourish when Sorcery is on Side A', () => {
    let s = base();
    // sorcery defaults to Side A.
    const room = s.rooms.find(
      (r) => !r.cannotBePlacedInDirectly && r.actionSpaces.length >= 2,
    )!;
    const [slotA, slotB] = room.actionSpaces;
    const p1id = s.players[0]!.id;
    const p2id = s.players[1]!.id;
    const prev: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? { ...p, mages: [{ ...mk('r', p.id), cardId: 'base.mage.sorcery', color: 'red' }] }
          : { ...p, mages: [mk('o', p.id)] },
      ),
      rooms: s.rooms.map((r) =>
        r.id !== room.id
          ? r
          : { ...r, actionSpaces: r.actionSpaces.map((sp) => (sp.id === slotA!.id ? { ...sp, occupant: { mageId: 'o', ownerId: p2id, isShadowing: false } } : sp)) },
      ),
    };
    const next: GameState = {
      ...prev,
      players: prev.players.map((p, i) =>
        i === 0 ? { ...p, mages: p.mages.map((m) => (m.id === 'r' ? { ...m, location: { kind: 'action-space', spaceId: slotB!.id } } : m)) } : p,
      ),
      rooms: prev.rooms.map((r) =>
        r.id !== room.id ? r : { ...r, actionSpaces: r.actionSpaces.map((sp) => (sp.id === slotB!.id ? { ...sp, occupant: { mageId: 'r', ownerId: p1id, isShadowing: false } } : sp)) },
      ),
    };
    expect(computeRoomFx(prev, next).some((f) => f.kind === 'mana-gain')).toBe(false);
  });

  it('emits a buff-activate flourish when a Mysticism Side B mage is placed', () => {
    let s = base();
    s = { ...s, mageAbilitySides: { ...s.mageAbilitySides, mysticism: 'B' } };
    const room = s.rooms.find((r) => !r.cannotBePlacedInDirectly && r.actionSpaces.length >= 1)!;
    const slot = room.actionSpaces[0]!;
    const p1id = s.players[0]!.id;
    const prev: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, mages: [{ ...mk('g', p.id), cardId: 'base.mage.mysticism', color: 'grey' }] } : p,
      ),
    };
    const next: GameState = {
      ...prev,
      players: prev.players.map((p, i) =>
        i === 0 ? { ...p, mages: p.mages.map((m) => (m.id === 'g' ? { ...m, location: { kind: 'action-space', spaceId: slot.id } } : m)) } : p,
      ),
      rooms: prev.rooms.map((r) =>
        r.id !== room.id ? r : { ...r, actionSpaces: r.actionSpaces.map((sp) => (sp.id === slot.id ? { ...sp, occupant: { mageId: 'g', ownerId: p1id, isShadowing: false } } : sp)) },
      ),
    };
    expect(computeRoomFx(prev, next)).toContainEqual({ roomId: room.id, kind: 'buff-activate' });
  });

  it('emits a banish ring when a placed mage returns to the office unwounded', () => {
    let s = base();
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, mages: [mk('b', p.id)] } : p)) };
    const [seated, roomId] = seat(s, 1, 'b');
    const bounced: GameState = {
      ...seated,
      players: seated.players.map((p, i) =>
        i === 1 ? { ...p, mages: p.mages.map((m) => ({ ...m, location: { kind: 'office', playerId: p.id } })) } : p,
      ),
    };
    expect(computeRoomFx(seated, bounced)).toContainEqual({ roomId, kind: 'banish' });
  });
});

describe('computeRewardFx', () => {
  /** Seated resolution-phase anchor + a "mage came home" successor to mutate. */
  function resolutionPair(): { anchor: GameState; home: GameState; roomId: string } {
    let s = base();
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, mages: [mk('w', p.id)] } : p)) };
    const [seated, roomId] = seat(s, 0, 'w');
    const anchor: GameState = {
      ...seated,
      phase: { kind: 'resolution', round: 1, pendingRoomIndex: 0, pendingSpaceIndex: 0, slotInProgress: true },
    };
    const home: GameState = {
      ...anchor,
      players: anchor.players.map((p, i) =>
        i === 0 ? { ...p, mages: p.mages.map((m) => ({ ...m, location: { kind: 'office', playerId: p.id } })) } : p,
      ),
    };
    return { anchor, home, roomId };
  }

  it('bubbles the owner resource gains over the room the mage left', () => {
    const { anchor, home, roomId } = resolutionPair();
    const next: GameState = {
      ...home,
      players: home.players.map((p, i) =>
        i === 0 ? { ...p, resources: { ...p.resources, gold: p.resources.gold + 2, mana: p.resources.mana + 1 } } : p,
      ),
    };
    const fx = computeRewardFx(anchor, next);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({
      roomId,
      kind: 'reward',
      gains: [
        { icon: 'gold', amount: 2 },
        { icon: 'mana', amount: 1 },
      ],
    });
    expect(fx[0]!.aura).toBeTruthy();
  });

  it('bubbles drafted cards as card icons', () => {
    const { anchor, home, roomId } = resolutionPair();
    const next: GameState = {
      ...home,
      players: home.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              ownedSpells: [
                ...p.ownedSpells,
                { cardId: 'base.spell.burn', intPlaced: false, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
              ],
            }
          : p,
      ),
    };
    expect(computeRewardFx(anchor, next)).toContainEqual(
      expect.objectContaining({ roomId, kind: 'reward', gains: [{ icon: 'spell', amount: 1 }] }),
    );
  });

  it('stays silent when the mage comes home empty-handed', () => {
    const { anchor, home } = resolutionPair();
    expect(computeRewardFx(anchor, home)).toEqual([]);
  });

  it('stays silent outside the resolution phase (mid-round bounces)', () => {
    const { anchor, home } = resolutionPair();
    const errandsAnchor: GameState = {
      ...anchor,
      phase: { kind: 'errands', round: 1, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
    };
    const next: GameState = {
      ...home,
      phase: errandsAnchor.phase,
      players: home.players.map((p, i) =>
        i === 0 ? { ...p, resources: { ...p.resources, gold: p.resources.gold + 2 } } : p,
      ),
    };
    expect(computeRewardFx(errandsAnchor, next)).toEqual([]);
  });

  it('ignores gains by players whose mage did not leave', () => {
    const { anchor, home } = resolutionPair();
    const next: GameState = {
      ...home,
      players: home.players.map((p, i) =>
        i === 1 ? { ...p, resources: { ...p.resources, gold: p.resources.gold + 3 } } : p,
      ),
    };
    expect(computeRewardFx(anchor, next)).toEqual([]);
  });
});

describe('createRewardTracker — full all-bot game', () => {
  it('bubbles well-formed rewards over a real game, and plenty of them', () => {
    const seed = 3;
    const rng = createRng((seed * 2654435761) | 0);
    const rnd = (n: number) => Math.floor(rng() * n);
    const candidateIds = getPack('base')!
      .candidates.filter((c) => c.startingMageColor !== 'neutral')
      .map((c) => c.id);
    let s = initGame({
      activePackIds: ['base'],
      playerNames: ['P0', 'P1'],
      rngSeed: seed,
      controlledByBot: [true, true],
      botPersonalityIds: ['klank', 'malfoy'],
      useCandidateDraft: true,
    });

    const track = createRewardTracker();
    const seen: RoomFx[] = [];
    let steps = 0;
    while (s.phase.kind !== 'complete' && steps < 40000) {
      const ctx = botDecisionContext(s);
      let action: GameAction | null = null;
      if (ctx?.kind === 'advance') action = { type: 'ADVANCE_PHASE' };
      else if (ctx?.kind === 'prompt') {
        const bot = getBotPersonality(s.players.find((p) => p.id === ctx.pending.responderId)?.botPersonalityId);
        action = { type: 'RESOLVE_PENDING', resolutionId: ctx.pending.id, answer: bot.answerPendingResolution(s, ctx.pending) };
      } else if (ctx?.kind === 'errands') {
        const bot = getBotPersonality(s.players.find((p) => p.id === ctx.playerId)?.botPersonalityId);
        action = bot.chooseErrandsAction(s, ctx.playerId);
      } else if (s.phase.kind === 'candidate-draft') {
        const pid = s.players[s.phase.activePlayerIndex]!.id;
        const taken = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
        const avail = candidateIds.filter((id) => !taken.has(id));
        action = { type: 'CHOOSE_CANDIDATE', playerId: pid, candidateId: avail[rnd(avail.length)]! };
      } else if (s.phase.kind === 'mage-draft-first-choice') {
        action = { type: 'CHOOSE_DRAFT_FIRST', playerId: s.players[s.phase.chooserIndex]!.id, draftFirst: rng() < 0.5 };
      } else if (s.phase.kind === 'mage-draft') {
        const player = s.players[s.phase.pickOrder[s.phase.nextPickIndex]!]!;
        const legal = Object.keys(s.mageDraftPool).filter(
          (c) =>
            (s.mageDraftPool[c as keyof typeof s.mageDraftPool] ?? 0) > 0 &&
            player.mages.filter((m) => m.color === c).length < 2,
        );
        action = { type: 'DRAFT_MAGE', playerId: player.id, color: legal[rnd(legal.length)] as never };
      }
      expect(action, `no action at phase ${s.phase.kind}`).toBeTruthy();
      const next = applyAction(s, action!);
      seen.push(...track(s, next));
      s = next;
      steps++;
    }
    expect(s.phase.kind).toBe('complete');

    // A 5-round game resolves dozens of occupied slots — the bubbles must
    // actually fire, and every one must be render-ready.
    expect(seen.length).toBeGreaterThan(10);
    const knownIcons = new Set([
      'gold', 'mana', 'influence', 'intelligence', 'wisdom', 'marks', 'merit-badge',
      'spell', 'vault', 'supporter', 'mage',
    ]);
    for (const f of seen) {
      expect(f.kind).toBe('reward');
      expect(f.roomId).toBeTruthy();
      expect(f.aura).toBeTruthy();
      expect(f.gains!.length).toBeGreaterThan(0);
      for (const g of f.gains!) {
        expect(knownIcons.has(g.icon)).toBe(true);
        expect(g.amount).toBeGreaterThan(0);
      }
    }
  });
});
