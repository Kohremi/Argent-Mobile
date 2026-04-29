// Base game effect implementations. Currently scoped to the Vertical Slice
// targets: Library A slot 1, Burn L1, Phase Steppers reaction.

import { registerEffect } from './registry';
import {
  buildBurnTargets,
  buildReactionQueue,
  gainResourcePatch,
  woundMage,
} from './helpers';
import type {
  EffectContext,
  EffectResult,
  GameState,
  PendingResolutionInput,
  Player,
  ReactionTriggerEvent,
  ResolutionSource,
} from '../types';

const PHASE_STEPPERS_ID = 'base.vault.phase-steppers';

// ============================================================================
// Library A — slot 1: Gain 1 INT OR 1 WIS OR 1 Research
// ============================================================================

registerEffect('base.room.library-a.slot-1', (ctx: EffectContext): EffectResult => {
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
        resume: { effectId: 'base.room.library-a.slot-1', context: {} },
        source: ctx.source,
      },
    };
  }

  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(
      `base.room.library-a.slot-1 expected option-chosen, got ${ctx.resumeAnswer.kind}`,
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
      throw new Error(`Library slot 1 got unknown option: ${ctx.resumeAnswer.optionId}`);
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
      afterResume: { effectId: 'base.spell.burn.l1.complete', context: {} },
      source: ctx.source,
    },
  };
});

/**
 * Post-reaction follow-up for Burn L1. If the caster's Mage is grey
 * (Mysticism), the rulebook grants a free placement here. Stub for now
 * — Mysticism placement bonus is deferred.
 */
registerEffect('base.spell.burn.l1.complete', (_ctx) => {
  // TODO: Mysticism mage placement bonus (rulebook p.11 — fires after
  // reactions resolve).
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
