import { describe, expect, it, beforeEach } from 'vitest';
import { applyAction, initGame } from './engine';
import { getScenario } from '../content/scenarios';
import { getPack } from '../content/registry';
import { getBotPersonality } from './ai';
import { botDecisionContext } from '../utils/uiSelectors';
import { findBoardInconsistency } from './boardInvariant';
import { createRng } from '../utils/rng';
import { useSetupStore } from '../store/setupStore';
import type { GameAction, GameConfig, GameState, OwnedMage, Player } from './types';

// ============================================================================
// Talismans of Magic — starting Synthesis items, room ban/guarantee, and the
// five per-round rules (R1/R2/R4 round-end rewards, R3/R5 vault-use IP).
// ============================================================================

const SACRED_SHIELD = 'mancers.vault.sacred-shield'; // divinity
const SWORD_OF_FLAME = 'mancers.vault.sword-of-flame'; // sorcery
const VANISHING_STAFF = 'mancers.vault.vanishing-staff'; // mysticism
const LIGHTNING_TOTEM = 'mancers.vault.lightning-totem'; // natural-magick
const HOURGLASS = 'mancers.vault.hourglass-of-fate'; // planar-studies
const ENDLESS_WELL = 'mancers.vault.endless-well-of-mana'; // technomancy

const CONFIG = (
  players: string[],
  extra: Partial<GameConfig> = {},
): GameConfig => ({
  activePackIds: ['base', 'mancers'],
  playerNames: players,
  rngSeed: 7,
  scenarioId: 'talismans-of-magic',
  ...extra,
});

function mapPlayer(
  s: GameState,
  id: string,
  fn: (p: Player) => Player,
): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}
function setCandidate(s: GameState, id: string, candidateId: string): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, candidateId }));
}
function topPending(s: GameState) {
  return s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
}
function resolveTop(s: GameState, optionId: string): GameState {
  const top = topPending(s)!;
  return applyAction(s, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'option-chosen', optionId, payload: {} },
  });
}
function vaultIds(p: Player): string[] {
  return p.vaultCards.map((v) => v.cardId);
}
/** initGame → set candidates → ADVANCE_PHASE lands on errands round 1. */
function startErrandsRound1(
  players: string[],
  candidates: Record<string, string>,
): GameState {
  let s = initGame(CONFIG(players));
  for (const [pid, cid] of Object.entries(candidates)) {
    s = setCandidate(s, pid, cid);
  }
  return applyAction(s, { type: 'ADVANCE_PHASE' });
}

// ---------------------------------------------------------------------------
// Scenario data + setup wiring
// ---------------------------------------------------------------------------

describe('Talismans — scenario data & setup', () => {
  it('requires the Mancers pack', () => {
    const sc = getScenario('talismans-of-magic');
    expect(sc?.requiresPackIds).toContain('mancers');
  });

  it('is a 5-round game (no round-end effect on the final round)', () => {
    let s = initGame(CONFIG(['A', 'B']));
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round: 5 } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(['final-scoring', 'complete']).toContain(s.phase.kind);
  });

  describe('setup store auto-enables Mancers', () => {
    beforeEach(() => {
      useSetupStore.setState({ selectedPackIds: ['base'], scenarioId: null });
    });
    it('selecting Talismans turns on Mancers', () => {
      useSetupStore.getState().setScenario('talismans-of-magic');
      expect(useSetupStore.getState().selectedPackIds).toContain('mancers');
    });
    it('Mancers is locked on while Talismans is active', () => {
      useSetupStore.getState().setScenario('talismans-of-magic');
      useSetupStore.getState().togglePack('mancers');
      expect(useSetupStore.getState().selectedPackIds).toContain('mancers');
    });
  });
});

// ---------------------------------------------------------------------------
// Rule alteration — room ban / guarantee
// ---------------------------------------------------------------------------

describe('Talismans — room ban / guarantee', () => {
  it('never seats the Synthesis Workshop and always seats Student Stores', () => {
    for (const rngSeed of [1, 2, 3, 7, 99, 1234]) {
      const s = initGame(CONFIG(['A', 'B', 'C', 'D'], { rngSeed }));
      const names = s.rooms.map((r) => r.name);
      expect(names).not.toContain('Synthesis Workshop');
      expect(names).toContain('Student Stores');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule alteration — starting Synthesis items
// ---------------------------------------------------------------------------

describe('Talismans — starting Synthesis items', () => {
  it('grants each school its matching Synthesis Treasure', () => {
    const s = startErrandsRound1(['A', 'B', 'C', 'D', 'E'], {
      p1: 'base.candidate.rheye-cal', // divinity
      p2: 'base.candidate.larimore-burman', // sorcery
      p3: 'base.candidate.byron-krane', // mysticism
      p4: 'base.candidate.exhufern-le-marigras', // natural-magick
      p5: 'base.candidate.xal-ezra', // planar-studies
    });
    expect(vaultIds(s.players[0]!)).toContain(SACRED_SHIELD);
    expect(vaultIds(s.players[1]!)).toContain(SWORD_OF_FLAME);
    expect(vaultIds(s.players[2]!)).toContain(VANISHING_STAFF);
    expect(vaultIds(s.players[3]!)).toContain(LIGHTNING_TOTEM);
    expect(vaultIds(s.players[4]!)).toContain(HOURGLASS);
  });

  it('two players of the same school each get their own copy', () => {
    const s = startErrandsRound1(['A', 'B'], {
      p1: 'base.candidate.rheye-cal', // divinity
      p2: 'base.candidate.monad-riverime', // divinity (alt)
    });
    expect(vaultIds(s.players[0]!)).toEqual([SACRED_SHIELD]);
    expect(vaultIds(s.players[1]!)).toEqual([SACRED_SHIELD]);
  });

  it('a neutral (Students) leader is prompted to pick an unused item', () => {
    let s = startErrandsRound1(['A', 'B', 'C'], {
      p1: 'base.candidate.rheye-cal', // divinity → Sacred Shield
      p2: 'base.candidate.larimore-burman', // sorcery → Sword of Flame
      p3: 'base.candidate.trias-blackwind', // Students / neutral
    });
    const top = topPending(s)!;
    expect(top.responderId).toBe('p3');
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      const offered = top.prompt.options.map((o) => o.id);
      // The two schools already in play are not offered.
      expect(offered).not.toContain(SACRED_SHIELD);
      expect(offered).not.toContain(SWORD_OF_FLAME);
      expect(offered).toContain(VANISHING_STAFF);
    }
    s = resolveTop(s, VANISHING_STAFF);
    expect(vaultIds(s.players[2]!)).toContain(VANISHING_STAFF);
  });
});

// ---------------------------------------------------------------------------
// Per-round rewards (R1 / R2 / R4)
// ---------------------------------------------------------------------------

/** Seats a game at the end of `round` (mid-game-scoring), first player p1. */
function endOfRound(round: 1 | 2 | 3 | 4 | 5, patch?: (s: GameState) => GameState): GameState {
  let s = initGame(CONFIG(['A', 'B']));
  s = { ...s, firstPlayerIndex: 0 };
  if (patch) s = patch(s);
  return { ...s, phase: { kind: 'mid-game-scoring', round } };
}

describe('Talismans — round-end rewards', () => {
  it('R1 Research Grants: every player gains 5 Gold', () => {
    let s = endOfRound(1);
    const before = s.players.map((p) => p.resources.gold);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    s.players.forEach((p, i) => expect(p.resources.gold).toBe(before[i]! + 5));
    expect(s.phase.kind).toBe('round-setup');
    if (s.phase.kind === 'round-setup') expect(s.phase.round).toBe(2);
  });

  it('R2 Opening the Vaults: each player keeps 1 of 2 drawn (deck shrinks by player count)', () => {
    let s = endOfRound(2);
    const deckBefore = s.vaultDeck.length;
    const vaultBefore = s.players.map((p) => p.vaultCards.length);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    // p1, then p2 each pick one of two.
    expect(topPending(s)!.responderId).toBe('p1');
    s = resolveTop(s, topPending(s)!.prompt.kind === 'choose-from-options'
      ? (topPending(s)!.prompt as { options: { id: string }[] }).options[0]!.id
      : '');
    expect(topPending(s)!.responderId).toBe('p2');
    s = resolveTop(s, (topPending(s)!.prompt as { options: { id: string }[] }).options[0]!.id);
    s.players.forEach((p, i) => expect(p.vaultCards.length).toBe(vaultBefore[i]! + 1));
    // Drew 2 each, returned 1 each → net -1 per player.
    expect(s.vaultDeck.length).toBe(deckBefore - s.players.length);
    expect(s.phase.kind).toBe('round-setup');
  });

  it('R4 Student Testing Incentives: retrieve a Consumable from discard (may skip)', () => {
    let s = endOfRound(4, (st) =>
      mapPlayer(
        mapPlayer(st, 'p1', (p) => ({
          ...p,
          personalDiscard: [{ kind: 'consumable', cardId: ENDLESS_WELL }],
        })),
        'p2',
        (p) => ({
          ...p,
          personalDiscard: [{ kind: 'consumable', cardId: LIGHTNING_TOTEM }],
        }),
      ),
    );
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    // p1 retrieves their consumable.
    expect(topPending(s)!.responderId).toBe('p1');
    s = resolveTop(s, 'idx-0');
    expect(vaultIds(s.players[0]!)).toContain(ENDLESS_WELL);
    expect(s.players[0]!.personalDiscard).toHaveLength(0);
    // p2 skips.
    expect(topPending(s)!.responderId).toBe('p2');
    s = resolveTop(s, 'skip');
    expect(s.players[1]!.personalDiscard).toHaveLength(1);
    expect(vaultIds(s.players[1]!)).not.toContain(LIGHTNING_TOTEM);
  });

  it('R4 with an empty discard prompts nothing', () => {
    let s = endOfRound(4);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(s.phase.kind).toBe('round-setup');
    if (s.phase.kind === 'round-setup') expect(s.phase.round).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Vault-use IP (R3 / R5)
// ---------------------------------------------------------------------------

function errandsRound(
  round: 1 | 2 | 3 | 4 | 5,
  vaultCardId: string,
): GameState {
  let s = initGame(CONFIG(['A', 'B']));
  s = mapPlayer(s, 'p1', (p) => ({
    ...p,
    vaultCards: [{ cardId: vaultCardId, exhausted: false }],
    resources: { ...p.resources, mana: 3 },
  }));
  return {
    ...s,
    firstPlayerIndex: 0,
    phase: { kind: 'errands', round, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
    bellTower: { ...s.bellTower, available: [] },
  };
}

describe('Talismans — Vault-use grants IP (R3 / R5)', () => {
  it('R3: playing a Vault card grants its owner 1 IP', () => {
    let s = errandsRound(3, ENDLESS_WELL);
    const before = s.players[0]!.resources.influence;
    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: ENDLESS_WELL });
    expect(s.players[0]!.resources.influence).toBe(before + 1);
  });

  it('R5: playing a Vault card grants its owner 1 IP', () => {
    let s = errandsRound(5, ENDLESS_WELL);
    const before = s.players[0]!.resources.influence;
    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: ENDLESS_WELL });
    expect(s.players[0]!.resources.influence).toBe(before + 1);
  });

  it('R1: playing a Vault card grants no IP', () => {
    let s = errandsRound(1, ENDLESS_WELL);
    const before = s.players[0]!.resources.influence;
    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: ENDLESS_WELL });
    expect(s.players[0]!.resources.influence).toBe(before);
  });

  it('R5: a Sacred Shield reaction also grants 1 IP', () => {
    // p1 wounds p2's mage with Lightning Totem; p2 reacts with Sacred Shield.
    let s = initGame(CONFIG(['A', 'B']));
    s = mapPlayer(s, 'p1', (p) => ({
      ...p,
      vaultCards: [{ cardId: LIGHTNING_TOTEM, exhausted: false }],
      resources: { ...p.resources, mana: 3 },
    }));
    // Seat p2's mage on the first open slot, with Sacred Shield + 1 Mana.
    const open: string[] = [];
    for (const r of s.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      for (const sp of r.actionSpaces) {
        if (!sp.occupant && !sp.shadowOccupant) open.push(sp.id);
        if (open.length >= 2) break;
      }
      if (open.length >= 2) break;
    }
    const [slotA, slotB] = open;
    const bobMage: Pick<OwnedMage, 'id' | 'cardId' | 'color'> = {
      id: 'bob-1',
      cardId: 'base.mage.neutral',
      color: 'off-white',
    };
    s = mapPlayer(s, 'p2', (p) => ({
      ...p,
      mages: [
        ...p.mages,
        { ...bobMage, location: { kind: 'action-space', spaceId: slotA! }, isShadowing: false, isWounded: false },
      ],
      vaultCards: [{ cardId: SACRED_SHIELD, exhausted: false }],
      resources: { ...p.resources, mana: 2 },
    }));
    s = {
      ...s,
      rooms: s.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((sp) =>
          sp.id !== slotA ? sp : { ...sp, occupant: { mageId: 'bob-1', ownerId: 'p2', isShadowing: false } },
        ),
      })),
      firstPlayerIndex: 0,
      phase: { kind: 'errands', round: 5, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
      bellTower: { ...s.bellTower, available: [] },
    };
    const before = s.players[1]!.resources.influence;
    s = applyAction(s, { type: 'PLAY_VAULT_CARD', playerId: 'p1', vaultCardId: LIGHTNING_TOTEM });
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: topPending(s)!.id,
      answer: { kind: 'mage-chosen', mageId: 'bob-1' },
    });
    // Reaction window for p2 — react with Sacred Shield.
    const rp = topPending(s)!;
    expect(rp.prompt.kind).toBe('reaction-window');
    s = applyAction(s, {
      type: 'RESOLVE_PENDING',
      resolutionId: rp.id,
      answer: {
        kind: 'reaction-played',
        effectId: 'mancers.vault.sacred-shield.react',
        reactionContext: { destinationSpaceId: slotB! },
      },
    });
    expect(s.players[1]!.resources.influence).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end — all-bot Talismans game completes without stalling / desync.
// Exercises starting-item grants/prompts and the R1/R2/R4 round-end rewards.
// ---------------------------------------------------------------------------

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;

function runTalismansGame(seed: number): string | null {
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);
  const candidateIds = [
    ...getPack('base')!.candidates,
    ...getPack('mancers')!.candidates,
  ].map((c) => c.id);
  let s = initGame({
    activePackIds: ['base', 'mancers'],
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    rngSeed: seed,
    controlledByBot: [true, true, true, true],
    botPersonalityIds: PERSONALITIES.map((_, i) => PERSONALITIES[(i + seed) % 4]!),
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' },
    scenarioId: 'talismans-of-magic',
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
          const taken = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
          const avail = candidateIds.filter((id) => !taken.has(id));
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

describe('Talismans — full all-bot games', () => {
  it('complete without stalling or desyncing the board', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const result = runTalismansGame(seed);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });
});
