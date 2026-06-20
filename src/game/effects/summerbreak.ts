// Summer Break round-end scenario effects. Each is invoked once per player in
// turn order by the engine's round-end scenario pump
// (`drainRoundEndScenarioIfIdle`): first with no `resumeAnswer` to push that
// player's prompt, then again with the answer to apply it. Returning `done`
// with an empty patch is a clean "nothing to do" skip for that player.
//
// Rounds 1-3 "Students Return"     → draft a Mage from the supply
// Round 4   "Summer Study Credits" → may swap one owned Mage for a supply Mage
// Round 5   "Opening Ceremony"     → draft one reward from a shared pool

import { getEffect, hasEffect, registerEffect } from './registry';
import {
  applySecretSupporterDraw,
  bumpInfluencePatch,
  findPlayer,
  gainResourcePatch,
  lookupSpellCardDef,
  MAGE_CARD_BY_COLOR,
} from './helpers';
import { getPack } from '../../content/registry';
import { shuffleWithState } from '../../utils/rng';
import { MAGE_COLORS } from '../types';
import type {
  ChoiceOption,
  EffectContext,
  EffectResult,
  GameState,
  GameStatePatch,
  MageColor,
  MageImmunityBuff,
  Player,
  Room,
  SpellCardId,
} from '../types';

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Mage colours the player can draw from the supply right now: stock remains in
 * the draft pool, the colour isn't the special 'rainbow', and the rulebook
 * 2-per-colour cap isn't already met (neutral / off-white is uncapped).
 */
function draftableColors(state: GameState, player: Player): MageColor[] {
  return MAGE_COLORS.filter((c) => {
    if (c === 'rainbow') return false;
    if ((state.mageDraftPool[c] ?? 0) <= 0) return false;
    if (c === 'off-white') return true;
    return player.mages.filter((m) => m.color === c).length < 2;
  });
}

/** Adds a freshly-minted supply Mage of `color` to the player's office. */
function addMagePatch(
  state: GameState,
  playerId: string,
  color: MageColor,
): GameStatePatch {
  const seq = state.nextSequenceId;
  return {
    nextSequenceId: seq + 1,
    mageDraftPool: {
      ...state.mageDraftPool,
      [color]: (state.mageDraftPool[color] ?? 0) - 1,
    },
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: [
              ...p.mages,
              {
                id: `m-${seq}`,
                cardId: MAGE_CARD_BY_COLOR[color],
                color,
                location: { kind: 'office' as const, playerId },
                isShadowing: false,
                isWounded: false,
              },
            ],
          },
    ),
  };
}

// ============================================================================
// Students Return (rounds 1-3) — draft a Mage from the supply
// ============================================================================

registerEffect('summerbreak.scenario.draft-mage', (ctx): EffectResult => {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  const colors = draftableColors(ctx.state, player);
  if (colors.length === 0) return { kind: 'done', patch: {} };

  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: colors.map((c) => ({
            id: c,
            label: `Draft a ${c} Mage`,
            payload: {},
          })),
        },
        resume: { effectId: 'summerbreak.scenario.draft-mage', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('summerbreak.scenario.draft-mage expected option-chosen');
  }
  const color = ctx.resumeAnswer.optionId as MageColor;
  if (!colors.includes(color)) return { kind: 'done', patch: {} };
  return { kind: 'done', patch: addMagePatch(ctx.state, ctx.triggeringPlayerId, color) };
});

// ============================================================================
// Summer Study Credits (round 4) — MAY swap an owned Mage for a supply Mage
// ============================================================================

registerEffect('summerbreak.scenario.swap-mage', (ctx): EffectResult => {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  const swappable = player.mages.filter(
    (m) => m.location.kind === 'office' && m.color !== 'rainbow' && !m.isTemporary,
  );
  const step = ctx.resumeContext?.['step'];

  // Step 1 — pick which owned Mage to swap, or skip (the swap is optional).
  if (!ctx.resumeAnswer) {
    if (swappable.length === 0) return { kind: 'done', patch: {} };
    const options: ChoiceOption[] = [
      ...swappable.map((m) => ({
        id: m.id,
        label: `Swap your ${m.color} Mage`,
        payload: {},
      })),
      { id: 'skip', label: 'Keep your Mages', payload: {} },
    ];
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: 'summerbreak.scenario.swap-mage', context: { step: 'pick-color' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'pick-color') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('summerbreak.scenario.swap-mage pick-color expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'skip') return { kind: 'done', patch: {} };
    const mageId = ctx.resumeAnswer.optionId;
    const source = player.mages.find((m) => m.id === mageId);
    if (!source || source.location.kind !== 'office') return { kind: 'done', patch: {} };
    // The swapped-out Mage returns to the supply, so its colour is available
    // again for the incoming pick.
    const returned: GameState = {
      ...ctx.state,
      mageDraftPool: {
        ...ctx.state.mageDraftPool,
        [source.color]: (ctx.state.mageDraftPool[source.color] ?? 0) + 1,
      },
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, mages: p.mages.filter((m) => m.id !== mageId) },
      ),
    };
    const incoming = findPlayer(returned, ctx.triggeringPlayerId);
    const colors = incoming ? draftableColors(returned, incoming) : [];
    if (colors.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      patch: {
        mageDraftPool: returned.mageDraftPool,
        players: returned.players,
      },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: colors.map((c) => ({ id: c, label: `Take a ${c} Mage`, payload: {} })),
        },
        resume: { effectId: 'summerbreak.scenario.swap-mage', context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('summerbreak.scenario.swap-mage apply expected option-chosen');
    }
    const color = ctx.resumeAnswer.optionId as MageColor;
    if ((ctx.state.mageDraftPool[color] ?? 0) <= 0) return { kind: 'done', patch: {} };
    return { kind: 'done', patch: addMagePatch(ctx.state, ctx.triggeringPlayerId, color) };
  }

  throw new Error('summerbreak.scenario.swap-mage: unexpected state');
});

// ============================================================================
// Opening Ceremony (round 5) — draft one reward from a shared pool. The pool
// is drafted WITHOUT replacement: each pick is recorded in the scenario's
// `consumedOptionIds` so later players in turn order can't take it again.
// ============================================================================

interface RewardDef {
  id: string;
  label: string;
}

const REWARD_POOL: RewardDef[] = [
  { id: 'neutral-mage', label: '+1 Neutral Mage' },
  { id: 'ip', label: '1 IP' },
  { id: 'mana', label: '2 Mana' },
  { id: 'gold', label: '3 Gold' },
  { id: 'research', label: '1 Research' },
  { id: 'vault', label: 'Draw a Vault Card' },
  { id: 'supporter', label: 'Draw a Supporter' },
];

/** The reward grant (without the consumed-pool bookkeeping). */
function applyReward(ctx: EffectContext, rewardId: string): GameStatePatch {
  const self = ctx.triggeringPlayerId;
  switch (rewardId) {
    case 'neutral-mage':
      // Neutral / off-white is uncapped; mint one even if the pool ran dry.
      return addNeutralMagePatch(ctx.state, self);
    case 'ip':
      return bumpInfluencePatch(ctx.state, self, 1);
    case 'mana':
      return gainResourcePatch(ctx.state, self, 'mana', 2);
    case 'gold':
      return gainResourcePatch(ctx.state, self, 'gold', 3);
    case 'research':
      return {
        researchQueue: [
          ...ctx.state.researchQueue,
          { playerId: self, source: ctx.source },
        ],
      };
    case 'vault': {
      const top = ctx.state.vaultDeck[0];
      if (top === undefined) return {};
      return {
        vaultDeck: ctx.state.vaultDeck.slice(1),
        players: ctx.state.players.map((p) =>
          p.id !== self
            ? p
            : { ...p, vaultCards: [...p.vaultCards, { cardId: top, exhausted: false }] },
        ),
      };
    }
    case 'supporter':
      return applySecretSupporterDraw(ctx.state, self);
    default:
      return {};
  }
}

/** Adds a neutral (off-white) Mage; decrements the supply only if stock exists. */
function addNeutralMagePatch(state: GameState, playerId: string): GameStatePatch {
  const seq = state.nextSequenceId;
  const poolNow = state.mageDraftPool['off-white'] ?? 0;
  return {
    nextSequenceId: seq + 1,
    mageDraftPool: {
      ...state.mageDraftPool,
      'off-white': Math.max(0, poolNow - 1),
    },
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: [
              ...p.mages,
              {
                id: `m-${seq}`,
                cardId: MAGE_CARD_BY_COLOR['off-white'],
                color: 'off-white' as const,
                location: { kind: 'office' as const, playerId },
                isShadowing: false,
                isWounded: false,
              },
            ],
          },
    ),
  };
}

registerEffect('summerbreak.scenario.reward-draft', (ctx): EffectResult => {
  const consumed = ctx.state.pendingRoundEndScenario?.consumedOptionIds ?? [];
  const available = REWARD_POOL.filter((r) => !consumed.includes(r.id));

  if (!ctx.resumeAnswer) {
    if (available.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: available.map((r) => ({ id: r.id, label: r.label, payload: {} })),
        },
        resume: { effectId: 'summerbreak.scenario.reward-draft', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('summerbreak.scenario.reward-draft expected option-chosen');
  }
  const rewardId = ctx.resumeAnswer.optionId;
  if (consumed.includes(rewardId) || !REWARD_POOL.some((r) => r.id === rewardId)) {
    return { kind: 'done', patch: {} };
  }
  const rewardPatch = applyReward(ctx, rewardId);
  // Record the pick so later players in this chain can't draft it again. The
  // scenario object is still live (it clears only once every player is done).
  const sc = ctx.state.pendingRoundEndScenario;
  return {
    kind: 'done',
    patch: {
      ...rewardPatch,
      ...(sc
        ? {
            pendingRoundEndScenario: {
              ...sc,
              consumedOptionIds: [...consumed, rewardId],
            },
          }
        : {}),
    },
  };
});

// ============================================================================
// Vault cards (subset). Deferred to a later pass: Planar Ice Cream (insert a
// random room mid-game) and Beach Brew (a Merit-slot payment reaction) — both
// need new engine mechanics. Card disposal (treasure exhaust / consumable
// discard) and the action budget are handled by handlePlayVaultCard, so these
// effects only apply the reward.
// ============================================================================

/** Chancellor's Yacht Keys (Treasure, Action) — Gain a secret Supporter. */
registerEffect('summerbreak.vault.yacht-keys', (ctx): EffectResult => ({
  kind: 'done',
  patch: applySecretSupporterDraw(ctx.state, ctx.triggeringPlayerId),
}));

/**
 * Builds a round-scoped "your Mages are immune to wounding" buff for the
 * triggering player. Mirrors the base immunity-buff spells (Moste Holie
 * Litanies etc.): a `mage-immunity` buff blocking `wound` from any source,
 * expiring at round end (and unconditionally at the next Resolution start).
 */
function wardAgainstWoundingPatch(
  state: GameState,
  playerId: string,
  cardId: string,
  label: string,
): GameStatePatch {
  const buff: MageImmunityBuff = {
    kind: 'mage-immunity',
    ownerId: playerId,
    spellCardId: cardId,
    label,
    immuneTo: ['wound'],
    source: 'any',
    expiresAt: { kind: 'round-end' },
  };
  return { activeBuffs: [...state.activeBuffs, buff] };
}

/**
 * Magic Sunblock (Consumable, Fast Action) — Your Mages are immune to wounding
 * for the rest of the round.
 */
registerEffect('summerbreak.vault.magic-sunblock', (ctx): EffectResult => ({
  kind: 'done',
  patch: wardAgainstWoundingPatch(
    ctx.state,
    ctx.triggeringPlayerId,
    'summerbreak.vault.magic-sunblock',
    'Magic Sunblock',
  ),
}));

/**
 * Sorcerer's Beach Towel (Treasure, Action) — Spend 2 Mana to make your Mages
 * immune to wounding for the rest of the round. No-op (the card still exhausts)
 * if the player can't afford the 2 Mana.
 */
registerEffect('summerbreak.vault.beach-towel', (ctx): EffectResult => {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  if (!player || player.resources.mana < 2) return { kind: 'done', patch: {} };
  const manaPatch = gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', -2);
  const wardPatch = wardAgainstWoundingPatch(
    ctx.state,
    ctx.triggeringPlayerId,
    'summerbreak.vault.beach-towel',
    "Sorcerer's Beach Towel",
  );
  return { kind: 'done', patch: { ...manaPatch, ...wardPatch } };
});

// ----------------------------------------------------------------------------
// Divine Beach Hat (Treasure, Action) — Gain 1 Mana and then cast a Spell.
// Mirrors Memoirs of the Future-Past ("cast a Spell you own"): list the
// player's researched, affordable, action/fast-timed Spells; on pick, deduct
// the level's printed Mana, exhaust it, and delegate to its effect. The +1 Mana
// is granted up front so it can help pay for the cast.
// ----------------------------------------------------------------------------

type CastableSpell = {
  spellCardId: SpellCardId;
  level: 1 | 2 | 3;
  manaCost: number;
  effectId: string;
  oncePerGame: boolean;
  label: string;
};

function listCastableSpells(state: GameState, casterId: string): CastableSpell[] {
  const player = state.players.find((p) => p.id === casterId);
  if (!player) return [];
  const out: CastableSpell[] = [];
  for (const owned of player.ownedSpells) {
    if (owned.exhausted) continue;
    const def = lookupSpellCardDef(state, owned.cardId);
    if (!def) continue;
    const researchedLevels: (1 | 2 | 3)[] = [];
    if (owned.intPlaced) researchedLevels.push(1);
    if (owned.wisPlacedLevel2) researchedLevels.push(2);
    if (owned.wisPlacedLevel3) researchedLevels.push(3);
    for (const lvl of researchedLevels) {
      const lvlDef = def.levels.find((l) => l.level === lvl);
      if (!lvlDef) continue;
      if (lvlDef.timing === 'reaction') continue;
      if (!hasEffect(lvlDef.effectId)) continue;
      if (lvlDef.oncePerGame && state.oncePerGameSpellsCast.includes(owned.cardId)) {
        continue;
      }
      if (player.resources.mana < lvlDef.manaCost) continue;
      out.push({
        spellCardId: owned.cardId,
        level: lvl,
        manaCost: lvlDef.manaCost,
        effectId: lvlDef.effectId,
        oncePerGame: lvlDef.oncePerGame === true,
        label: `${def.name} L${lvl} "${lvlDef.title}" (${lvlDef.manaCost} Mana)`,
      });
    }
  }
  return out;
}

/** Local copy of base's delegate-composition helper (not exported). */
function composeWithDelegate(
  delegate: EffectResult,
  baseUpdate: GameStatePatch,
): EffectResult {
  switch (delegate.kind) {
    case 'done':
      return { kind: 'done', patch: { ...baseUpdate, ...delegate.patch } };
    case 'pause':
      return { kind: 'pause', patch: { ...baseUpdate, ...(delegate.patch ?? {}) }, pending: delegate.pending };
    case 'open-reaction':
      return { kind: 'open-reaction', patch: { ...baseUpdate, ...(delegate.patch ?? {}) }, window: delegate.window };
  }
}

registerEffect('summerbreak.vault.divine-beach-hat', (ctx): EffectResult => {
  const self = 'summerbreak.vault.divine-beach-hat';

  if (!ctx.resumeAnswer) {
    // Grant the +1 Mana now (so it can fund the cast), then offer the spells.
    const withMana = gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 1);
    const grantedState: GameState = { ...ctx.state, players: withMana.players ?? ctx.state.players };
    const castable = listCastableSpells(grantedState, ctx.triggeringPlayerId);
    if (castable.length === 0) {
      // No spell to cast — the card just grants the Mana.
      return { kind: 'done', patch: withMana };
    }
    return {
      kind: 'pause',
      patch: withMana,
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: castable.map((c) => ({
            id: `${c.spellCardId}::${c.level}`,
            label: c.label,
            payload: {},
          })),
        },
        resume: { effectId: self, context: { step: 'cast' } },
        source: ctx.source,
      },
    };
  }

  if (ctx.resumeContext?.['step'] === 'cast') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${self} cast expected option-chosen`);
    }
    const [spellId, levelStr] = ctx.resumeAnswer.optionId.split('::');
    const level = Number(levelStr) as 1 | 2 | 3;
    const candidate = listCastableSpells(ctx.state, ctx.triggeringPlayerId).find(
      (c) => c.spellCardId === spellId && c.level === level,
    );
    if (!candidate) return { kind: 'done', patch: {} };
    // Deduct the cast's Mana and exhaust the borrowed Spell, then delegate to
    // the level's effect built on that post-payment state.
    const paidState: GameState = {
      ...ctx.state,
      // Record once-per-game casts so the borrowed Spell can't be repeated.
      oncePerGameSpellsCast: candidate.oncePerGame
        ? [...ctx.state.oncePerGameSpellsCast, candidate.spellCardId]
        : ctx.state.oncePerGameSpellsCast,
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : {
              ...p,
              resources: { ...p.resources, mana: p.resources.mana - candidate.manaCost },
              ownedSpells: p.ownedSpells.map((s) =>
                s.cardId === candidate.spellCardId ? { ...s, exhausted: true } : s,
              ),
            },
      ),
    };
    const delegate = getEffect(candidate.effectId)({
      state: paidState,
      source: ctx.source,
      triggeringPlayerId: ctx.triggeringPlayerId,
      allowReactions: ctx.allowReactions,
    });
    // Carry the payment + exhaust + once-per-game bookkeeping as the fallback
    // patch; the delegate (built on paidState) overrides `players` if it also
    // touches them, so the deduction survives either way.
    return composeWithDelegate(delegate, {
      players: paidState.players,
      oncePerGameSpellsCast: paidState.oncePerGameSpellsCast,
    });
  }

  throw new Error(`${self} unexpected state`);
});

// ----------------------------------------------------------------------------
// Planar Ice Cream (Consumable, Fast Action) — Take a random room from the box
// and add it to the bottom-left of the University Board on the A side.
//
// "The box" = wired A-side rooms from the active packs whose name is not
// already in play. One is drawn with the game RNG and inserted at the
// bottom-left grid cell (a new bottom row is grown if that cell is occupied),
// so it joins the board for the rest of the game.
// ----------------------------------------------------------------------------

/** All wired A-side rooms from the active packs that aren't already in play. */
function boxRooms(state: GameState): Room[] {
  const inPlayNames = new Set(state.rooms.map((r) => r.name));
  const out: Room[] = [];
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    for (const r of pack.rooms) {
      if (r.side !== 'A') continue;
      if (inPlayNames.has(r.name)) continue;
      const wired = r.actionSpaces.length > 0 || r.cannotBePlacedInDirectly;
      if (wired) out.push(r);
    }
  }
  return out;
}

registerEffect('summerbreak.vault.planar-ice-cream', (ctx): EffectResult => {
  const box = boxRooms(ctx.state);
  if (box.length === 0) return { kind: 'done', patch: {} };

  const draw = shuffleWithState(box, ctx.state.rng);
  const room = draw.value[0]!;

  // Insert at the bottom-left cell; grow a new bottom row if it's taken.
  const layout = ctx.state.roomLayout;
  const grid = layout.grid.map((row) => [...row]);
  let rows = layout.rows;
  if (grid[rows - 1]?.[0] == null) {
    grid[rows - 1]![0] = room.id;
  } else {
    const newRow: (string | null)[] = new Array(layout.cols).fill(null);
    newRow[0] = room.id;
    grid.push(newRow);
    rows += 1;
  }

  return {
    kind: 'done',
    patch: {
      rng: draw.state,
      rooms: [...ctx.state.rooms, room],
      roomLayout: { cols: layout.cols, rows, grid },
    },
  };
});
