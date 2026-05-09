// Base game effect implementations. Currently scoped to the Vertical Slice
// targets: Library A slot 1, Burn L1, Phase Steppers reaction.

import { registerEffect } from './registry';
import {
  affordableVaultCards,
  applyGainMark,
  applyInfirmaryBonusPatch,
  applySecretSupporterDraw,
  applySupporterDraft,
  applyVaultDraft,
  applyVaultPurchase,
  buildArsMagnaTargets,
  buildBurnTargets,
  buildReactionQueue,
  bumpInfluencePatch,
  checkInfirmaryBonusApplies,
  findActionSpace,
  gainResourcePatch,
  gainResourcesPatch,
  woundMage,
} from './helpers';
import type {
  ActionSpaceId,
  ChoiceOption,
  EffectContext,
  EffectResult,
  GameState,
  GameStatePatch,
  OwnedMageId,
  PendingResolutionInput,
  Player,
  PlayerId,
  ReactionTriggerEvent,
  ResolutionSource,
  ResumeContinuation,
  SerializableContext,
} from '../types';

const PHASE_STEPPERS_ID = 'base.vault.phase-steppers';

// ============================================================================
// Library A — four slots per the room file
// ============================================================================

/** Slot 1 (merit, costs 1 MB): Gain 1 WIS AND Draft a Vault Card. */
registerEffect('base.room.library-a.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    if (ctx.state.vaultTableau.length === 0) {
      // No card to draft; still gain the WIS.
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'wisdom', 1),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...ctx.state.vaultTableau],
        },
        resume: { effectId: 'base.room.library-a.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `library-a.slot-1 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  let working = ctx.state;
  working = {
    ...working,
    ...applyVaultDraft(working, ctx.triggeringPlayerId, ctx.resumeAnswer.cardId),
  };
  working = {
    ...working,
    ...gainResourcePatch(working, ctx.triggeringPlayerId, 'wisdom', 1),
  };
  return {
    kind: 'done',
    patch: { players: working.players, vaultTableau: working.vaultTableau },
  };
});

/** Slot 2 (merit, costs 1 MB): Gain 1 INT AND gain 1 Research. */
registerEffect('base.room.library-a.slot-2', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'intelligence', 1),
      pending: spawnResearchPrompt(ctx.triggeringPlayerId, ctx.source),
    };
  }
  throw new Error('library-a.slot-2 should not be re-invoked (research handles its own resume)');
});

/** Slot 3 (regular): Gain a Buy AND gain 1 Research. */
registerEffect('base.room.library-a.slot-3', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    const affordable = affordableVaultCards(ctx.state, ctx.triggeringPlayerId);
    if (affordable.length === 0) {
      // No buy possible; go straight to research.
      return {
        kind: 'pause',
        pending: spawnResearchPrompt(ctx.triggeringPlayerId, ctx.source),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'skip', label: 'Skip the Buy', payload: {} },
            ...affordable.map((cid) => ({
              id: cid,
              label: `Buy ${cid}`,
              payload: {},
            })),
          ],
        },
        resume: {
          effectId: 'base.room.library-a.slot-3',
          context: { step: 'after-buy' },
        },
        source: ctx.source,
      },
    };
  }
  const step = ctx.resumeContext?.['step'];
  if (step === 'after-buy') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('library-a.slot-3 after-buy expected option-chosen');
    }
    let working = ctx.state;
    if (ctx.resumeAnswer.optionId !== 'skip') {
      working = {
        ...working,
        ...applyVaultPurchase(
          working,
          ctx.triggeringPlayerId,
          ctx.resumeAnswer.optionId,
        ),
      };
    }
    return {
      kind: 'pause',
      patch: { players: working.players, vaultTableau: working.vaultTableau },
      pending: spawnResearchPrompt(ctx.triggeringPlayerId, ctx.source),
    };
  }
  throw new Error(`library-a.slot-3 unexpected step ${String(step)}`);
});

/** Slot 4 (regular): Gain 1 INT OR 1 WIS OR 1 Research. */
registerEffect('base.room.library-a.slot-4', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'int', label: 'Gain 1 INT', payload: { resource: 'intelligence' } },
            { id: 'wis', label: 'Gain 1 WIS', payload: { resource: 'wisdom' } },
            { id: 'research', label: 'Gain 1 Research', payload: { resource: 'research' } },
          ],
        },
        resume: { effectId: 'base.room.library-a.slot-4', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `library-a.slot-4 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  const playerId = ctx.triggeringPlayerId;
  switch (ctx.resumeAnswer.optionId) {
    case 'int':
      return { kind: 'done', patch: gainResourcePatch(ctx.state, playerId, 'intelligence', 1) };
    case 'wis':
      return { kind: 'done', patch: gainResourcePatch(ctx.state, playerId, 'wisdom', 1) };
    case 'research':
      return {
        kind: 'pause',
        pending: spawnResearchPrompt(playerId, ctx.source),
      };
    default:
      throw new Error(`library-a.slot-4 unknown option: ${ctx.resumeAnswer.optionId}`);
  }
});

/**
 * Research is transient — the player must spend it immediately to learn a
 * new spell from the tableau OR upgrade an existing spell. The full prompt
 * (with target spells/levels) is deferred; for now we present a simple
 * confirm/discard so the OR-choice slice can be tested end-to-end.
 *
 * TODO: replace with real "learn from tableau / upgrade owned" branching.
 */
function spawnResearchPrompt(
  playerId: string,
  source: ResolutionSource,
): PendingResolutionInput {
  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        {
          id: 'spend',
          label: 'Spend 1 Research (TODO: choose Spell to learn or upgrade)',
          payload: {},
        },
        { id: 'discard', label: 'Discard 1 Research', payload: {} },
      ],
    },
    resume: { effectId: 'base.system.spend-research', context: {} },
    source,
  };
}

registerEffect('base.system.spend-research', (_ctx) => {
  // TODO: implement learn-from-tableau / upgrade-owned-spell branching.
  return { kind: 'done', patch: {} };
});

// ============================================================================
// Burn — L1 (target a Mage; wound it; open reaction window)
// ============================================================================

registerEffect('base.spell.burn.l1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    const eligibleMageIds = buildBurnTargets(ctx.state, ctx.triggeringPlayerId);
    if (eligibleMageIds.length === 0) {
      // No legal targets — spell fizzles. Caller has already paid and
      // exhausted the spell per CAST_SPELL handler.
      return { kind: 'done', patch: {} };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds },
        resume: { effectId: 'base.spell.burn.l1', context: { step: 'apply-wound' } },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step !== 'apply-wound') {
    throw new Error(`base.spell.burn.l1: unexpected resume step ${String(step)}`);
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `base.spell.burn.l1 apply-wound expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }

  const wounded = woundMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  return {
    kind: 'open-reaction',
    patch: wounded.patch,
    window: {
      triggerEvent: wounded.triggerEvent,
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.spell.burn.l1.complete',
        context: { triggerEvent: triggerEventToContext(wounded.triggerEvent) },
      },
      source: ctx.source,
    },
  };
});

/**
 * Post-reaction follow-up for Burn L1.
 *
 * 1. If the wound stuck and was inflicted by an opponent, the wounded
 *    player picks an Infirmary bonus (2 Gold / 1 Mana / 1 IP). Phase
 *    Steppers reverting the wound suppresses this — `checkInfirmaryBonusApplies`
 *    looks at the post-reaction state.
 * 2. TODO: Mysticism Mage placement bonus when caster is grey.
 */
registerEffect('base.spell.burn.l1.complete', (ctx) => {
  const event = readTriggerEvent(ctx);
  if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
    return {
      kind: 'pause',
      pending: bonusPromptFor(event, ctx.triggeringPlayerId),
    };
  }
  // TODO: Mysticism placement follow-up.
  return { kind: 'done', patch: {} };
});

// ============================================================================
// Phase Steppers — reaction: shadow original slot instead of being affected
// ============================================================================

registerEffect('base.vault.phase-steppers.react', (ctx: EffectContext): EffectResult => {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Phase Steppers: missing triggerEvent in resumeContext');
  }
  const event = raw as unknown as ReactionTriggerEvent;

  if (
    event.kind !== 'mage-wounded' &&
    event.kind !== 'mage-banished' &&
    event.kind !== 'mage-moved'
  ) {
    throw new Error(`Phase Steppers cannot react to ${event.kind}`);
  }

  const ownerId = event.ownerId;
  const reactorId = ctx.triggeringPlayerId;
  if (ownerId !== reactorId) {
    throw new Error('Phase Steppers can only react to your own Mage being affected');
  }

  const mageId = event.mageId;
  const originalSpaceId =
    event.kind === 'mage-moved' ? event.fromSpaceId : event.originalSpaceId;
  if (!originalSpaceId) {
    // Mage wasn't on a space (shouldn't happen given how we filter options),
    // so Phase Steppers has nothing to do.
    return { kind: 'done', patch: {} };
  }

  return {
    kind: 'done',
    patch: applyPhaseSteppers(ctx.state, mageId, ownerId, reactorId, originalSpaceId),
  };
});

function applyPhaseSteppers(
  state: GameState,
  mageId: string,
  ownerId: string,
  reactorId: string,
  originalSpaceId: string,
) {
  const players = state.players.map((p): Player => {
    let updated = p;
    if (p.id === ownerId) {
      updated = {
        ...updated,
        mages: updated.mages.map((m) =>
          m.id !== mageId
            ? m
            : {
                ...m,
                isWounded: false,
                isShadowing: true,
                location: { kind: 'action-space' as const, spaceId: originalSpaceId },
              },
        ),
      };
    }
    if (p.id === reactorId) {
      const idx = updated.vaultCards.findIndex((v) => v.cardId === PHASE_STEPPERS_ID);
      if (idx === -1) {
        throw new Error('Phase Steppers: reactor does not own the card');
      }
      updated = {
        ...updated,
        vaultCards: updated.vaultCards.filter((_, i) => i !== idx),
        personalDiscard: [
          ...updated.personalDiscard,
          { kind: 'consumable' as const, cardId: PHASE_STEPPERS_ID },
        ],
      };
    }
    return updated;
  });

  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) =>
      s.id !== originalSpaceId
        ? s
        : { ...s, occupant: { mageId, ownerId, isShadowing: true } },
    ),
  }));

  return { players, rooms };
}

// ============================================================================
// Vault A — three slots per the room file:
//   Slot 1 (merit, costs 1 MB to place): Draft a Vault Card AND Gain 4 Gold
//   Slot 2 (regular):                    Draft a Vault Card OR Gain 5 Gold
//   Slot 3 (regular):                    Gain 3 Gold
// ============================================================================

/** Vault A slot 1 — merit. Draft + 4 gold. Merit cost paid at placement. */
registerEffect('base.room.vault-a.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    if (ctx.state.vaultTableau.length === 0) {
      // No card to draft — still get the gold.
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 4),
      };
    }
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-vault-card',
          eligibleCardIds: [...ctx.state.vaultTableau],
        },
        resume: { effectId: 'base.room.vault-a.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'card-chosen') {
    throw new Error(
      `vault-a.slot-1 expected card-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }
  let working = ctx.state;
  working = {
    ...working,
    ...applyVaultDraft(working, ctx.triggeringPlayerId, ctx.resumeAnswer.cardId),
  };
  working = {
    ...working,
    ...gainResourcePatch(working, ctx.triggeringPlayerId, 'gold', 4),
  };
  return {
    kind: 'done',
    patch: { players: working.players, vaultTableau: working.vaultTableau },
  };
});

/** Vault A slot 2 — regular. Draft a Vault Card OR Gain 5 Gold. */
registerEffect('base.room.vault-a.slot-2', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'draft', label: 'Draft a Vault Card', payload: {} },
            { id: 'gold', label: 'Gain 5 Gold', payload: {} },
          ],
        },
        resume: { effectId: 'base.room.vault-a.slot-2', context: { step: 'or' } },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step === 'or') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`vault-a.slot-2 OR expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'gold') {
      return {
        kind: 'done',
        patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 5),
      };
    }
    if (ctx.resumeAnswer.optionId === 'draft') {
      if (ctx.state.vaultTableau.length === 0) {
        // No tableau cards — silently no-op. (Player already passed on gold.)
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-vault-card',
            eligibleCardIds: [...ctx.state.vaultTableau],
          },
          resume: {
            effectId: 'base.room.vault-a.slot-2',
            context: { step: 'pick' },
          },
          source: ctx.source,
        },
      };
    }
    throw new Error(`vault-a.slot-2 unknown option: ${ctx.resumeAnswer.optionId}`);
  }
  if (step === 'pick') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error(`vault-a.slot-2 pick expected card-chosen`);
    }
    return {
      kind: 'done',
      patch: applyVaultDraft(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.cardId,
      ),
    };
  }
  throw new Error(`vault-a.slot-2 unexpected step: ${String(step)}`);
});

/** Vault A slot 3 — regular. Gain 3 Gold. */
registerEffect('base.room.vault-a.slot-3', (ctx: EffectContext): EffectResult => {
  return {
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 3),
  };
});

// ============================================================================
// Training Fields A — flat resource gains
// ============================================================================

/** Slot 1 (merit, 1 MB): Gain 1 INT AND Gain 1 WIS. */
registerEffect('base.room.training-fields-a.slot-1', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainResourcesPatch(ctx.state, ctx.triggeringPlayerId, {
    intelligence: 1,
    wisdom: 1,
  }),
}));

/** Slot 2 (regular): Gain 1 INT. */
registerEffect('base.room.training-fields-a.slot-2', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'intelligence', 1),
}));

/** Slot 3 (regular): Gain 1 WIS. */
registerEffect('base.room.training-fields-a.slot-3', (ctx: EffectContext): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'wisdom', 1),
}));

// ============================================================================
// Guilds A — INSTANT room. Pick gold OR mana per slot.
// ============================================================================

function guildsOrPrompt(
  ctx: EffectContext,
  goldAmount: number,
  manaAmount: number,
  effectId: string,
): EffectResult {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'gold', label: `Gain ${goldAmount} Gold`, payload: {} },
            { id: 'mana', label: `Gain ${manaAmount} Mana`, payload: {} },
          ],
        },
        resume: { effectId, context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(`${effectId} expected option-chosen`);
  }
  if (ctx.resumeAnswer.optionId === 'gold') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', goldAmount),
    };
  }
  if (ctx.resumeAnswer.optionId === 'mana') {
    return {
      kind: 'done',
      patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', manaAmount),
    };
  }
  throw new Error(`${effectId} unknown option ${ctx.resumeAnswer.optionId}`);
}

registerEffect('base.room.guilds-a.slot-1', (ctx) =>
  guildsOrPrompt(ctx, 6, 3, 'base.room.guilds-a.slot-1'),
);
registerEffect('base.room.guilds-a.slot-2', (ctx) =>
  guildsOrPrompt(ctx, 4, 2, 'base.room.guilds-a.slot-2'),
);
registerEffect('base.room.guilds-a.slot-3', (ctx) =>
  guildsOrPrompt(ctx, 2, 1, 'base.room.guilds-a.slot-3'),
);

// ============================================================================
// Courtyard A — Mana scaling with WIS
// ============================================================================

function manaForCourtyard(
  ctx: EffectContext,
  bonus: number,
): EffectResult {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) throw new Error('courtyard: player not found');
  const amount = player.resources.wisdom + bonus;
  if (amount <= 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', amount),
  };
}

/** Slot 1 (merit, 1 MB): Gain Mana equal to your WIS + 2. */
registerEffect('base.room.courtyard-a.slot-1', (ctx) => manaForCourtyard(ctx, 2));

/** Slot 2 (regular): Gain Mana equal to your WIS. */
registerEffect('base.room.courtyard-a.slot-2', (ctx) => manaForCourtyard(ctx, 0));

/** Slot 3 (regular): Gain 3 Mana. */
registerEffect('base.room.courtyard-a.slot-3', (ctx) => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 3),
}));

// ============================================================================
// Infirmary on-wound bonus — used by every wound source via afterResume
// ============================================================================
//
// Pattern: each wound source's open-reaction passes the trigger event into
// its afterResume's context. The source's "complete" effect calls
// `checkInfirmaryBonusApplies(state, event)` and, if true, pauses with
// `bonusPromptFor(...)`. Sources with no follow-up steps (Burn L1) use the
// shared system resume; sources that need to chain more work (Ars Magna)
// supply a custom resume that handles the bonus inline.

const INFIRMARY_BONUS_OPTIONS: ChoiceOption[] = [
  { id: 'gold', label: 'Gain 2 Gold', payload: {} },
  { id: 'mana', label: 'Gain 1 Mana', payload: {} },
  { id: 'ip', label: 'Gain 1 IP', payload: {} },
];

function readTriggerEvent(ctx: EffectContext): ReactionTriggerEvent | null {
  const raw = ctx.resumeContext?.['triggerEvent'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as unknown as ReactionTriggerEvent;
}

/** Casts a trigger event to a SerializableContext for storage in resume context. */
function triggerEventToContext(event: ReactionTriggerEvent): SerializableContext {
  return event as unknown as SerializableContext;
}

function bonusPromptFor(
  event: ReactionTriggerEvent,
  casterId: PlayerId,
  customResume?: ResumeContinuation,
): PendingResolutionInput {
  if (event.kind !== 'mage-wounded') {
    throw new Error('bonusPromptFor: only mage-wounded events trigger the bonus');
  }
  return {
    responderId: event.ownerId,
    prompt: {
      kind: 'choose-from-options',
      options: INFIRMARY_BONUS_OPTIONS,
    },
    resume: customResume ?? {
      effectId: 'base.system.infirmary-bonus',
      context: { recipientPlayerId: event.ownerId },
    },
    source: {
      kind: 'system',
      id: 'base.system.infirmary-bonus',
      triggeringPlayerId: casterId,
      description: 'Infirmary bonus (wound by opponent)',
    },
  };
}

registerEffect('base.system.infirmary-bonus', (ctx) => {
  if (ctx.resumeAnswer?.kind !== 'option-chosen') {
    throw new Error(
      `infirmary-bonus expected option-chosen, got ${ctx.resumeAnswer?.kind}`,
    );
  }
  const recipientId = ctx.resumeContext?.['recipientPlayerId'];
  if (typeof recipientId !== 'string') {
    throw new Error('infirmary-bonus: missing recipientPlayerId');
  }
  return {
    kind: 'done',
    patch: applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    ),
  };
});

// ============================================================================
// Marks — system effect used by every "gain a Mark" prompt
// ============================================================================

function spawnGainMarkPrompt(
  state: GameState,
  playerId: string,
  source: ResolutionSource,
): PendingResolutionInput {
  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-voter',
      eligibleVoterIds: state.voters.map((v) => v.id),
    },
    resume: { effectId: 'base.system.gain-mark', context: {} },
    source,
  };
}

registerEffect('base.system.gain-mark', (ctx) => {
  if (ctx.resumeAnswer?.kind !== 'voter-chosen') {
    throw new Error(
      `gain-mark expected voter-chosen, got ${ctx.resumeAnswer?.kind}`,
    );
  }
  return {
    kind: 'done',
    patch: applyGainMark(
      ctx.state,
      ctx.triggeringPlayerId,
      ctx.resumeAnswer.voterId,
    ),
  };
});

// ============================================================================
// Council Chamber A — five slots, each "Draft a supporter OR gain a Mark"
// ============================================================================

registerEffect('base.room.council-chamber-a.slot', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'draft', label: 'Draft a Supporter', payload: {} },
            { id: 'mark', label: 'Gain a Mark', payload: {} },
          ],
        },
        resume: {
          effectId: 'base.room.council-chamber-a.slot',
          context: { step: 'or' },
        },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step === 'or') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('council-chamber-a.slot OR expected option-chosen');
    }
    if (ctx.resumeAnswer.optionId === 'draft') {
      if (ctx.state.supporterTableau.length === 0) {
        return { kind: 'done', patch: {} };
      }
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt: {
            kind: 'choose-supporter-card',
            eligibleCardIds: [...ctx.state.supporterTableau],
          },
          resume: {
            effectId: 'base.room.council-chamber-a.slot',
            context: { step: 'draft-pick' },
          },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.optionId === 'mark') {
      return {
        kind: 'pause',
        pending: spawnGainMarkPrompt(
          ctx.state,
          ctx.triggeringPlayerId,
          ctx.source,
        ),
      };
    }
    throw new Error(
      `council-chamber-a.slot OR unknown option ${ctx.resumeAnswer.optionId}`,
    );
  }
  if (step === 'draft-pick') {
    if (ctx.resumeAnswer.kind !== 'card-chosen') {
      throw new Error('council-chamber-a.slot draft-pick expected card-chosen');
    }
    return {
      kind: 'done',
      patch: applySupporterDraft(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.cardId,
      ),
    };
  }
  throw new Error(`council-chamber-a.slot unexpected step ${String(step)}`);
});

// ============================================================================
// Catacombs A
// ============================================================================

/** Slot 1 (merit, 1 MB): Draw a Secret Supporter, then gain a Mark. */
registerEffect('base.room.catacombs-a.slot-1', (ctx: EffectContext): EffectResult => {
  if (!ctx.resumeAnswer) {
    const drawPatch = applySecretSupporterDraw(ctx.state, ctx.triggeringPlayerId);
    const afterDraw = { ...ctx.state, ...drawPatch };
    return {
      kind: 'pause',
      patch: drawPatch,
      pending: spawnGainMarkPrompt(afterDraw, ctx.triggeringPlayerId, ctx.source),
    };
  }
  throw new Error('catacombs-a.slot-1 should not be re-invoked (mark handles its own resume)');
});

/** Slot 2 (regular): Gain 2 IP. */
registerEffect('base.room.catacombs-a.slot-2', (ctx) => ({
  kind: 'done',
  patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, 2),
}));

/** Slot 3 (regular): Gain 1 IP for each player with more IP than you. */
registerEffect('base.room.catacombs-a.slot-3', (ctx) => {
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) throw new Error('catacombs-a.slot-3: caster not found');
  const myIP = player.resources.influence;
  const ahead = ctx.state.players.filter(
    (p) => p.id !== ctx.triggeringPlayerId && p.resources.influence > myIP,
  ).length;
  if (ahead === 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: bumpInfluencePatch(ctx.state, ctx.triggeringPlayerId, ahead),
  };
});

// ============================================================================
// Sorcery Mage — Ars Magna (fast action: spend 1 Mana, wound a Mage, take its slot)
// ============================================================================

registerEffect('base.mage.sorcery.ars-magna', (ctx: EffectContext): EffectResult => {
  const sourceMageId = ctx.source.id;
  const player = ctx.state.players.find((p) => p.id === ctx.triggeringPlayerId);
  if (!player) throw new Error('Ars Magna: caster not found');

  if (!ctx.resumeAnswer) {
    // First call — validate, spend mana, prompt for target.
    const redMage = player.mages.find((m) => m.id === sourceMageId);
    if (!redMage) {
      throw new Error(`Ars Magna: source mage ${sourceMageId} not owned`);
    }
    if (redMage.color !== 'red') {
      throw new Error('Ars Magna: source mage must be red (Sorcery)');
    }
    if (redMage.location.kind !== 'office') {
      throw new Error(
        `Ars Magna: red mage must be in office (location=${redMage.location.kind})`,
      );
    }
    if (redMage.isWounded) {
      throw new Error('Ars Magna: red mage is wounded; heal first');
    }
    if (player.resources.mana < 1) {
      throw new Error('Ars Magna: requires 1 Mana');
    }

    const eligibleMageIds = buildArsMagnaTargets(ctx.state, ctx.triggeringPlayerId);
    if (eligibleMageIds.length === 0) {
      throw new Error('Ars Magna: no legal targets');
    }

    return {
      kind: 'pause',
      patch: {
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                resources: { ...p.resources, mana: p.resources.mana - 1 },
              },
        ),
      },
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds },
        resume: {
          effectId: 'base.mage.sorcery.ars-magna',
          context: { step: 'wound', sourceMageId },
        },
        source: ctx.source,
      },
    };
  }

  const step = ctx.resumeContext?.['step'];
  if (step !== 'wound') {
    throw new Error(`Ars Magna: unexpected resume step ${String(step)}`);
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error(
      `Ars Magna wound expected mage-chosen, got ${ctx.resumeAnswer.kind}`,
    );
  }

  const sourceMageIdRaw = ctx.resumeContext?.['sourceMageId'];
  if (typeof sourceMageIdRaw !== 'string') {
    throw new Error('Ars Magna: missing sourceMageId in resumeContext');
  }
  const wounded = woundMage(
    ctx.state,
    ctx.resumeAnswer.mageId,
    ctx.triggeringPlayerId,
  );
  const triggerEvent = wounded.triggerEvent;
  if (triggerEvent.kind !== 'mage-wounded') {
    throw new Error('Ars Magna: woundMage produced unexpected event kind');
  }
  const targetSpaceId = triggerEvent.originalSpaceId;
  if (!targetSpaceId) {
    // Target wasn't on a space — shouldn't happen given target filter.
    return { kind: 'done', patch: wounded.patch };
  }

  return {
    kind: 'open-reaction',
    patch: wounded.patch,
    window: {
      triggerEvent,
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.mage.sorcery.ars-magna.complete',
        context: {
          sourceMageId: sourceMageIdRaw,
          targetSpaceId,
          triggerEvent: triggerEventToContext(triggerEvent),
        },
      },
      source: ctx.source,
    },
  };
});

/**
 * After-reaction continuation for Ars Magna.
 *
 * Steps:
 *   1. If the wound stuck and was inflicted by an opponent, prompt the
 *      wounded player for the Infirmary bonus. The custom resume chains
 *      back to this effect with `step: 'after-bonus'`, where the bonus
 *      patch is applied inline and the red Mage move runs against the
 *      post-bonus state.
 *   2. Otherwise (or after the bonus), if the targeted slot is now empty,
 *      the caster's red Mage takes it. If a reaction (Phase Steppers)
 *      re-occupied the slot, the red Mage stays in office and the Mana
 *      paid up front is forfeit.
 */
registerEffect('base.mage.sorcery.ars-magna.complete', (ctx: EffectContext): EffectResult => {
  const sourceMageIdRaw = ctx.resumeContext?.['sourceMageId'];
  const targetSpaceIdRaw = ctx.resumeContext?.['targetSpaceId'];
  if (typeof sourceMageIdRaw !== 'string' || typeof targetSpaceIdRaw !== 'string') {
    throw new Error('Ars Magna complete: missing context fields');
  }
  const sourceMageId = sourceMageIdRaw as OwnedMageId;
  const targetSpaceId = targetSpaceIdRaw as ActionSpaceId;

  // Resume from bonus prompt — apply the chosen bonus, then move the Mage.
  if (ctx.resumeContext?.['step'] === 'after-bonus') {
    if (ctx.resumeAnswer?.kind !== 'option-chosen') {
      throw new Error('ars-magna.complete after-bonus expected option-chosen');
    }
    const recipientId = ctx.resumeContext['recipientPlayerId'];
    const casterId = ctx.resumeContext['casterPlayerId'];
    if (typeof recipientId !== 'string' || typeof casterId !== 'string') {
      throw new Error('ars-magna.complete after-bonus: missing context fields');
    }
    const bonusPatch = applyInfirmaryBonusPatch(
      ctx.state,
      recipientId,
      ctx.resumeAnswer.optionId,
    );
    const afterBonus: GameState = { ...ctx.state, ...bonusPatch };
    return {
      kind: 'done',
      patch: moveRedMagePatch(afterBonus, sourceMageId, targetSpaceId, casterId),
    };
  }

  // First call from afterResume.
  const event = readTriggerEvent(ctx);
  if (event && checkInfirmaryBonusApplies(ctx.state, event)) {
    return {
      kind: 'pause',
      pending: bonusPromptFor(event, ctx.triggeringPlayerId, {
        effectId: 'base.mage.sorcery.ars-magna.complete',
        context: {
          step: 'after-bonus',
          recipientPlayerId: event.ownerId,
          casterPlayerId: ctx.triggeringPlayerId,
          sourceMageId,
          targetSpaceId,
        },
      }),
    };
  }

  return {
    kind: 'done',
    patch: moveRedMagePatch(
      ctx.state,
      sourceMageId,
      targetSpaceId,
      ctx.triggeringPlayerId,
    ),
  };
});

/**
 * Patch that moves the caster's red Mage onto the targeted slot, if the
 * slot is empty. Returns an empty patch if the slot was reclaimed (e.g.,
 * Phase Steppers shadow).
 */
function moveRedMagePatch(
  state: GameState,
  sourceMageId: OwnedMageId,
  targetSpaceId: ActionSpaceId,
  casterId: PlayerId,
): GameStatePatch {
  const lookup = findActionSpace(state, targetSpaceId);
  if (!lookup) return {};
  if (lookup.space.occupant !== null) return {};

  return {
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== targetSpaceId
          ? s
          : {
              ...s,
              occupant: {
                mageId: sourceMageId,
                ownerId: casterId,
                isShadowing: false,
              },
            },
      ),
    })),
    players: state.players.map((p) =>
      p.id !== casterId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== sourceMageId
                ? m
                : {
                    ...m,
                    location: { kind: 'action-space' as const, spaceId: targetSpaceId },
                    isShadowing: false,
                  },
            ),
          },
    ),
  };
}
