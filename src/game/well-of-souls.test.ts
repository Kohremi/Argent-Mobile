import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from './engine';
import { getScenario } from '../content/scenarios';
import { castableSpellLevels } from '../utils/uiSelectors';
import { getPack } from '../content/registry';
import { getBotPersonality } from './ai';
import { botDecisionContext } from '../utils/uiSelectors';
import { findBoardInconsistency } from './boardInvariant';
import { createRng } from '../utils/rng';
import type {
  GameAction,
  GameConfig,
  GameState,
  OwnedMage,
  OwnedSpell,
  PackId,
  Player,
} from './types';

// ============================================================================
// The Well of Souls — sacrifice-to-cast, R5 cost −1, R4/R5 cast-any-level, and
// the R1/R2/R3 round-end research / INT-or-WIS rewards.
// ============================================================================

const BURN = 'base.spell.burn'; // L1 cost 1, L2 cost 2, L3 cost 4 (Sorcery)

const CONFIG = (
  players: string[],
  extra: Partial<GameConfig> = {},
): GameConfig => ({
  activePackIds: ['base'],
  playerNames: players,
  rngSeed: 7,
  scenarioId: 'well-of-souls',
  ...extra,
});

function mapPlayer(s: GameState, id: string, fn: (p: Player) => Player): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}
function topPending(s: GameState) {
  return s.pendingResolutionStack[s.pendingResolutionStack.length - 1];
}
function resolveOption(s: GameState, optionId: string): GameState {
  const top = topPending(s)!;
  return applyAction(s, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'option-chosen', optionId, payload: {} },
  });
}
function resolveMage(s: GameState, mageId: string): GameState {
  const top = topPending(s)!;
  return applyAction(s, {
    type: 'RESOLVE_PENDING',
    resolutionId: top.id,
    answer: { kind: 'mage-chosen', mageId },
  });
}
function setMana(s: GameState, id: string, mana: number): GameState {
  return mapPlayer(s, id, (p) => ({ ...p, resources: { ...p.resources, mana } }));
}
function addSpell(
  s: GameState,
  id: string,
  cardId: string,
  research: Partial<Pick<OwnedSpell, 'intPlaced' | 'wisPlacedLevel2' | 'wisPlacedLevel3'>> = {},
): GameState {
  return mapPlayer(s, id, (p) => ({
    ...p,
    ownedSpells: [
      ...p.ownedSpells,
      {
        cardId,
        intPlaced: research.intPlaced ?? false,
        wisPlacedLevel2: research.wisPlacedLevel2 ?? false,
        wisPlacedLevel3: research.wisPlacedLevel3 ?? false,
        exhausted: false,
      },
    ],
  }));
}
function addOfficeMage(s: GameState, id: string, mageId: string): GameState {
  return mapPlayer(s, id, (p) => ({
    ...p,
    mages: [
      ...p.mages,
      {
        id: mageId,
        cardId: 'base.mage.neutral',
        color: 'off-white',
        location: { kind: 'office', playerId: p.id },
        isShadowing: false,
        isWounded: false,
      } as OwnedMage,
    ],
  }));
}
/** A Well of Souls game seated at errands of `round`, p1 active. */
function errands(round: 1 | 2 | 3 | 4 | 5, patch: (s: GameState) => GameState): GameState {
  let s = initGame(CONFIG(['A', 'B']));
  s = { ...s, firstPlayerIndex: 0 };
  s = patch(s);
  return {
    ...s,
    phase: { kind: 'errands', round, activePlayerIndex: 0, actionUsed: false, fastActionUsed: false },
  };
}
function ownedSpell(s: GameState, id: string, cardId: string): OwnedSpell {
  return s.players.find((p) => p.id === id)!.ownedSpells.find((o) => o.cardId === cardId)!;
}
function mageById(s: GameState, mageId: string): OwnedMage | undefined {
  return s.players.flatMap((p) => p.mages).find((m) => m.id === mageId);
}

// ---------------------------------------------------------------------------
// Scenario data
// ---------------------------------------------------------------------------

describe('Well of Souls — scenario data', () => {
  it('needs no pack and is a 5-round game', () => {
    const sc = getScenario('well-of-souls');
    expect(sc?.requiresPackIds ?? []).toEqual([]);
    let s = initGame(CONFIG(['A', 'B']));
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round: 5 } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(['final-scoring', 'complete']).toContain(s.phase.kind);
  });
});

// ---------------------------------------------------------------------------
// Sacrifice a Mage to reduce a Spell's cost
// ---------------------------------------------------------------------------

describe('Well of Souls — sacrifice to cast', () => {
  it('offers Cast normally / Sacrifice / Cancel when casting an affordable Spell', () => {
    let s = errands(1, (st) =>
      addOfficeMage(setMana(addSpell(st, 'p1', BURN, { intPlaced: true }), 'p1', 3), 'p1', 'sac-1'),
    );
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 1 });
    const top = topPending(s)!;
    expect(top.prompt.kind).toBe('choose-from-options');
    if (top.prompt.kind === 'choose-from-options') {
      expect(top.prompt.options.map((o) => o.id)).toEqual(['cast-normal', 'sacrifice', 'cancel']);
    }
  });

  it('Cast normally pays full Mana and keeps the Mage', () => {
    let s = errands(1, (st) =>
      addOfficeMage(setMana(addSpell(st, 'p1', BURN, { intPlaced: true }), 'p1', 3), 'p1', 'sac-1'),
    );
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 1 });
    s = resolveOption(s, 'cast-normal');
    expect(s.players[0]!.resources.mana).toBe(2); // 3 − 1
    expect(mageById(s, 'sac-1')!.location.kind).toBe('office');
    expect(ownedSpell(s, 'p1', BURN).exhausted).toBe(true);
  });

  it('Sacrifice sends the chosen Mage to the Infirmary and cuts cost by up to 3', () => {
    let s = errands(1, (st) =>
      addOfficeMage(setMana(addSpell(st, 'p1', BURN, { intPlaced: true }), 'p1', 3), 'p1', 'sac-1'),
    );
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 1 });
    s = resolveOption(s, 'sacrifice');
    expect(topPending(s)!.prompt.kind).toBe('choose-target-mage');
    s = resolveMage(s, 'sac-1');
    const mage = mageById(s, 'sac-1')!;
    expect(mage.location.kind).toBe('infirmary');
    expect(mage.isWounded).toBe(true);
    expect(s.players[0]!.resources.mana).toBe(3); // cost 1 → max(0, 1−3) = 0 spent
    expect(ownedSpell(s, 'p1', BURN).exhausted).toBe(true);
  });

  it('Cancel aborts the cast — no Mana, no budget, Spell un-exhausted', () => {
    let s = errands(1, (st) =>
      addOfficeMage(setMana(addSpell(st, 'p1', BURN, { intPlaced: true }), 'p1', 3), 'p1', 'sac-1'),
    );
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 1 });
    s = resolveOption(s, 'cancel');
    expect(s.players[0]!.resources.mana).toBe(3);
    expect(ownedSpell(s, 'p1', BURN).exhausted).toBe(false);
    expect(s.phase.kind === 'errands' && s.phase.actionUsed).toBe(false);
  });

  it('lets a Spell up to 3 Mana over budget be cast (only with a Mage to sacrifice)', () => {
    // Burn L3 costs 4; with 1 Mana the player is 3 short.
    const withMage = errands(3, (st) =>
      addOfficeMage(
        setMana(addSpell(st, 'p1', BURN, { intPlaced: true, wisPlacedLevel2: true, wisPlacedLevel3: true }), 'p1', 1),
        'p1',
        'sac-1',
      ),
    );
    expect(castableSpellLevels(withMage, 'p1').get(BURN)).toEqual(new Set([1, 2, 3]));

    // No office Mage → can't sacrifice, so only the affordable L1 lights up.
    const noMage = errands(3, (st) =>
      setMana(addSpell(st, 'p1', BURN, { intPlaced: true, wisPlacedLevel2: true, wisPlacedLevel3: true }), 'p1', 1),
    );
    expect(castableSpellLevels(noMage, 'p1').get(BURN)).toEqual(new Set([1]));
  });
});

// ---------------------------------------------------------------------------
// R5 cost reduction + R4/R5 cast any level
// ---------------------------------------------------------------------------

describe('Well of Souls — R5 cost reduction & R4/R5 cast any level', () => {
  it('R5 reduces Spell cost by 1 (min 0)', () => {
    // Burn L2 costs 2 → 1 in R5. No office Mage, so no sacrifice prompt.
    let s = errands(5, (st) => setMana(addSpell(st, 'p1', BURN, { intPlaced: true }), 'p1', 5));
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 2 });
    expect(s.players[0]!.resources.mana).toBe(4); // 5 − (2−1)
  });

  it('R5 can take a 1-cost Spell to free (no sacrifice prompt at cost 0)', () => {
    let s = errands(5, (st) =>
      addOfficeMage(setMana(addSpell(st, 'p1', BURN, { intPlaced: true }), 'p1', 5), 'p1', 'sac-1'),
    );
    s = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 1 });
    // Cost 1 − 1 = 0 → casts immediately, no prompt, no Mana spent, Mage kept.
    expect(s.players[0]!.resources.mana).toBe(5);
    expect(mageById(s, 'sac-1')!.location.kind).toBe('office');
  });

  it('R4 lets un-researched levels be cast; R1 does not', () => {
    const r4 = errands(4, (st) => setMana(addSpell(st, 'p1', BURN), 'p1', 5)); // nothing researched
    expect(castableSpellLevels(r4, 'p1').get(BURN)).toEqual(new Set([1, 2, 3]));

    const r1 = errands(1, (st) => setMana(addSpell(st, 'p1', BURN), 'p1', 5));
    expect(castableSpellLevels(r1, 'p1').get(BURN) ?? new Set()).toEqual(new Set());

    // A real cast of an un-researched level succeeds in R4.
    let cast = applyAction(r4, { type: 'CAST_SPELL', playerId: 'p1', spellCardId: BURN, level: 2 });
    expect(ownedSpell(cast, 'p1', BURN).exhausted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round-end rewards (R1 / R2 / R3)
// ---------------------------------------------------------------------------

function endOfRound(round: 1 | 2 | 3): GameState {
  let s = initGame(CONFIG(['A', 'B']));
  s = { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round } };
  return s;
}

describe('Well of Souls — round-end rewards', () => {
  it('R1 Rumours of Hauntings: each player gains 2 Research', () => {
    let s = endOfRound(1);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(s.researchQueue.filter((e) => e.playerId === 'p1')).toHaveLength(2);
    expect(s.researchQueue.filter((e) => e.playerId === 'p2')).toHaveLength(2);
    expect(s.phase.kind).toBe('round-setup');
  });

  it('R3 Whispers in the Shadows: each player gains 1 Research', () => {
    let s = endOfRound(3);
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(s.researchQueue.filter((e) => e.playerId === 'p1')).toHaveLength(1);
    expect(s.researchQueue.filter((e) => e.playerId === 'p2')).toHaveLength(1);
  });

  it('R2 Visions in the Night: each player chooses 1 INT or 1 WIS', () => {
    let s = endOfRound(2);
    const intBefore = s.players[0]!.resources.intelligence;
    const wisBefore = s.players[1]!.resources.wisdom;
    s = applyAction(s, { type: 'ADVANCE_PHASE' });
    expect(topPending(s)!.responderId).toBe('p1');
    s = resolveOption(s, 'int');
    expect(s.players[0]!.resources.intelligence).toBe(intBefore + 1);
    expect(topPending(s)!.responderId).toBe('p2');
    s = resolveOption(s, 'wis');
    expect(s.players[1]!.resources.wisdom).toBe(wisBefore + 1);
    expect(s.phase.kind).toBe('round-setup');
  });
});

// ---------------------------------------------------------------------------
// End-to-end — all-bot game completes without stalling / desync.
// ---------------------------------------------------------------------------

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;

function runGame(seed: number, extraPacks: PackId[] = []): string | null {
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);
  const draftCandidates = getPack('base')!.candidates.filter(
    (c) => c.startingMageColor !== 'neutral',
  );
  const candidateIds = draftCandidates.map((c) => c.id);
  const deptOf = new Map(draftCandidates.map((c) => [c.id, c.department]));
  let s = initGame({
    activePackIds: ['base', ...extraPacks],
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    rngSeed: seed,
    controlledByBot: [true, true, true, true],
    botPersonalityIds: PERSONALITIES.map((_, i) => PERSONALITIES[(i + seed) % 4]!),
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' },
    scenarioId: 'well-of-souls',
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
          const takenIds = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
          const takenDepts = new Set([...takenIds].map((id) => deptOf.get(id)));
          const avail = candidateIds.filter(
            (id) => !takenIds.has(id) && !takenDepts.has(deptOf.get(id)),
          );
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

describe('Well of Souls — full all-bot games', () => {
  it('complete without stalling or desyncing the board', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const result = runGame(seed);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scenario + Summer Break — round-end effects STACK (both fire each round).
// Selecting a Scenario doesn't remove an already-enabled Summer Break pack, so
// a round can carry two round-end effects: the Scenario's reward AND Summer
// Break's. They must run in sequence, once per player, not shadow each other.
// ---------------------------------------------------------------------------

describe('Well of Souls + Summer Break — stacked round-end effects', () => {
  it('R1 fires BOTH the scenario research and the Summer Break mage draft', () => {
    let s = initGame(CONFIG(['A', 'B'], { activePackIds: ['base', 'summerbreak'] }));
    s = { ...s, firstPlayerIndex: 0, phase: { kind: 'mid-game-scoring', round: 1 } };
    s = applyAction(s, { type: 'ADVANCE_PHASE' });

    // Well of Souls R1 reward (research-2) ran for every player...
    expect(s.researchQueue.filter((e) => e.playerId === 'p1')).toHaveLength(2);
    expect(s.researchQueue.filter((e) => e.playerId === 'p2')).toHaveLength(2);

    // ...AND the Summer Break "Students Return" mage draft is now in progress
    // (a queued second effect — before the fix this never surfaced).
    expect(s.phase.kind).toBe('round-end-scenario');
    const top = topPending(s)!;
    expect(top.responderId).toBe('p1');
    const labels = (top.prompt as { options: { label: string }[] }).options.map(
      (o) => o.label,
    );
    expect(labels.some((l) => l.includes('Draft a'))).toBe(true);
  });

  it('combined all-bot games complete without stalling or desyncing', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const result = runGame(seed, ['summerbreak']);
      if (result) failures.push(result);
    }
    expect(failures).toEqual([]);
  });
});
