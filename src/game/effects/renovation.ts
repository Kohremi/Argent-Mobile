// Bell Tower Renovation effect implementations (the 16 Renovation offerings).
// The per-round random deal of these cards lives in the engine/setup; here we
// only wire each card's reward. Names ↔ effects follow
// docs/argent_data/bell-tower-offerings.tsv.

import { registerEffect } from './registry';
import {
  applyGainMark,
  applySecretSupporterDraw,
  banishMage,
  buildGainMarkChooseVoterPrompt,
  buildHarmfulMageTargets,
  buildReactionQueue,
  findPlayer,
  gainResourcePatch,
  lookupSupporterCardDef,
  lookupVaultCardDef,
  moveMageToSpace,
  placeMageOnSlot,
  removeMageFromSlot,
  woundMage,
  MAGE_CARD_BY_COLOR,
} from './helpers';
import { getOrthogonallyAdjacentRoomIds } from '../setup';
import { MAGE_COLORS } from '../types';
import type {
  ChoiceOption,
  EffectContext,
  EffectResult,
  GameState,
  MageColor,
  OwnedMageId,
  ResolutionSource,
  SerializableContext,
} from '../types';

// ============================================================================
// Simple resource grants
// ============================================================================

/** Wisdom — Gain 1 WIS. */
registerEffect('renovation.bell.wisdom', (ctx): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'wisdom', 1),
}));

/** Intelligence — Gain 1 INT. */
registerEffect('renovation.bell.intelligence', (ctx): EffectResult => ({
  kind: 'done',
  patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'intelligence', 1),
}));

/** Ambition — Gain 1 Mana and 1 Research. */
registerEffect('renovation.bell.ambition', (ctx): EffectResult => {
  const manaPatch = gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'mana', 1);
  const source: ResolutionSource = {
    kind: 'bell-tower',
    id: 'renovation.bell.ambition',
    triggeringPlayerId: ctx.triggeringPlayerId,
    description: 'Ambition',
  };
  return {
    kind: 'done',
    patch: {
      ...manaPatch,
      researchQueue: [
        ...ctx.state.researchQueue,
        { playerId: ctx.triggeringPlayerId, source },
      ],
    },
  };
});

// ============================================================================
// Pride — temporary Merit Badge (spent after normal badges, −1 IP on use,
// discarded at round-setup). The spend logic lives in resolution-choice.
// ============================================================================

registerEffect('renovation.bell.pride', (ctx): EffectResult => ({
  kind: 'done',
  patch: {
    players: ctx.state.players.map((p) =>
      p.id !== ctx.triggeringPlayerId
        ? p
        : { ...p, temporaryMeritBadges: (p.temporaryMeritBadges ?? 0) + 1 },
    ),
  },
}));

// ============================================================================
// Secrecy — Gain 1 Mark (pick a Voter you haven't marked).
// ============================================================================

registerEffect('renovation.bell.secrecy', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const prompt = buildGainMarkChooseVoterPrompt(
      ctx.state,
      ctx.triggeringPlayerId,
    );
    if (!prompt) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt,
        resume: { effectId: 'renovation.bell.secrecy', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'voter-chosen') {
    throw new Error('renovation.bell.secrecy expected voter-chosen');
  }
  return {
    kind: 'done',
    patch: applyGainMark(ctx.state, ctx.triggeringPlayerId, ctx.resumeAnswer.voterId),
  };
});

// ============================================================================
// Lust — Draw a Secret Supporter.
// ============================================================================

registerEffect('renovation.bell.lust', (ctx): EffectResult => ({
  kind: 'done',
  patch: applySecretSupporterDraw(ctx.state, ctx.triggeringPlayerId),
}));

// ============================================================================
// Preparation — Draw a Vault Card (top of the Vault Deck, readied in office).
// ============================================================================

registerEffect('renovation.bell.preparation', (ctx): EffectResult => {
  const top = ctx.state.vaultDeck[0];
  if (top === undefined) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: {
      vaultDeck: ctx.state.vaultDeck.slice(1),
      players: ctx.state.players.map((p) =>
        p.id !== ctx.triggeringPlayerId
          ? p
          : { ...p, vaultCards: [...p.vaultCards, { cardId: top, exhausted: false }] },
      ),
    },
  };
});

// ============================================================================
// Greed — Take 2 Gold from a player of your choice.
// ============================================================================

registerEffect('renovation.bell.greed', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const options: ChoiceOption[] = ctx.state.players
      .filter((p) => p.id !== ctx.triggeringPlayerId && p.resources.gold > 0)
      .map((p) => ({ id: p.id, label: `Take from ${p.name}`, payload: {} }));
    if (options.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: 'renovation.bell.greed', context: {} },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error('renovation.bell.greed expected option-chosen');
  }
  const targetId = ctx.resumeAnswer.optionId;
  const target = findPlayer(ctx.state, targetId);
  if (!target) return { kind: 'done', patch: {} };
  const amount = Math.min(2, target.resources.gold);
  if (amount <= 0) return { kind: 'done', patch: {} };
  return {
    kind: 'done',
    patch: {
      players: ctx.state.players.map((p) => {
        if (p.id === targetId) {
          return { ...p, resources: { ...p.resources, gold: p.resources.gold - amount } };
        }
        if (p.id === ctx.triggeringPlayerId) {
          return { ...p, resources: { ...p.resources, gold: p.resources.gold + amount } };
        }
        return p;
      }),
    },
  };
});

// ============================================================================
// Gluttony / Connections — return a card from your discard to office, OR +1 Gold.
//   Gluttony   → Consumable (back to your office as a readied Vault card)
//   Connections→ Supporter (back to your office as an unused Supporter)
// ============================================================================

function returnFromDiscardOrGold(
  ctx: EffectContext,
  self: string,
  kind: 'consumable' | 'supporter',
): EffectResult {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  const matches = (entry: GameState['players'][number]['personalDiscard'][number]): boolean =>
    kind === 'consumable'
      ? entry.kind === 'consumable'
      : entry.kind === 'supporter' || entry.kind === 'secret-supporter';
  const eligible = player?.personalDiscard.filter(matches) ?? [];
  const nameOf = (cardId: string): string =>
    (kind === 'consumable'
      ? lookupVaultCardDef(ctx.state, cardId)?.name
      : lookupSupporterCardDef(ctx.state, cardId)?.name) ?? cardId;

  // One prompt: every eligible discard card is offered as a real card face
  // (each option carries `cardId`, so the client renders the art + rules via
  // its CardPickerSheet), with "Gain 1 Gold instead" as the footer fallback.
  // When nothing is eligible, gold is the only outcome — apply it directly.
  if (!ctx.resumeAnswer) {
    if (eligible.length === 0) {
      return { kind: 'done', patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 1) };
    }
    const options: ChoiceOption[] = [
      ...eligible.map((e, i) => ({
        id: `card:${i}`,
        label: nameOf(e.cardId),
        cardId: e.cardId,
        payload: {},
      })),
      { id: 'gold', label: 'Gain 1 Gold instead', payload: {} },
    ];
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-from-options', options },
        resume: { effectId: self, context: {} },
        source: ctx.source,
      },
    };
  }

  if (ctx.resumeAnswer.kind !== 'option-chosen') {
    throw new Error(`${self} expected option-chosen`);
  }
  const optionId = ctx.resumeAnswer.optionId;
  if (optionId === 'gold') {
    return { kind: 'done', patch: gainResourcePatch(ctx.state, ctx.triggeringPlayerId, 'gold', 1) };
  }
  // `card:<index>` addresses the recomputed eligible list — the player's
  // discard is unchanged between the pause and this resume. Same-id copies are
  // identical, so removing the first matching entry from the full discard pile
  // returns the chosen card faithfully.
  const chosen = eligible[Number(optionId.slice('card:'.length))];
  if (!chosen) return { kind: 'done', patch: {} };
  const cardId = chosen.cardId;
  return {
    kind: 'done',
    patch: {
      players: ctx.state.players.map((p) => {
        if (p.id !== ctx.triggeringPlayerId) return p;
        let removed = false;
        const personalDiscard = p.personalDiscard.filter((e) => {
          if (!removed && e.cardId === cardId && matches(e)) {
            removed = true;
            return false;
          }
          return true;
        });
        if (!removed) return p;
        return kind === 'consumable'
          ? {
              ...p,
              personalDiscard,
              vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
            }
          : { ...p, personalDiscard, supporters: [...p.supporters, cardId] };
      }),
    },
  };
}

registerEffect('renovation.bell.gluttony', (ctx): EffectResult =>
  returnFromDiscardOrGold(ctx, 'renovation.bell.gluttony', 'consumable'),
);
registerEffect('renovation.bell.connections', (ctx): EffectResult =>
  returnFromDiscardOrGold(ctx, 'renovation.bell.connections', 'supporter'),
);

// ============================================================================
// Wrath — Wound a Mage. Distraction — Banish a Mage. Both are non-spell
// sources (so blue's spell-immunity does not protect; green's wound-immunity
// still does), then open a reaction window for the affected owner.
// ============================================================================

registerEffect('renovation.bell.wrath', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildHarmfulMageTargets(ctx.state, ctx.triggeringPlayerId, {
      source: 'non-spell',
      effect: 'wound',
    });
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: 'renovation.bell.wrath', context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error('renovation.bell.wrath expected mage-chosen');
  }
  const wounded = woundMage(ctx.state, ctx.resumeAnswer.mageId, ctx.triggeringPlayerId);
  return {
    kind: 'open-reaction',
    patch: wounded.patch,
    window: {
      triggerEvents: [wounded.triggerEvent],
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      // Standard post-wound infirmary bonus for the wounded owner.
      afterResume: {
        effectId: 'base.system.post-wound-bonus',
        context: { triggerEvent: wounded.triggerEvent as unknown as SerializableContext },
      },
      source: ctx.source,
    },
  };
});

registerEffect('renovation.bell.distraction', (ctx): EffectResult => {
  if (!ctx.resumeAnswer) {
    const targets = buildHarmfulMageTargets(ctx.state, ctx.triggeringPlayerId, {
      source: 'non-spell',
      effect: 'banish',
    });
    if (targets.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-mage', eligibleMageIds: targets },
        resume: { effectId: 'renovation.bell.distraction', context: { step: 'apply' } },
        source: ctx.source,
      },
    };
  }
  if (ctx.resumeAnswer.kind !== 'mage-chosen') {
    throw new Error('renovation.bell.distraction expected mage-chosen');
  }
  const banished = banishMage(ctx.state, ctx.resumeAnswer.mageId, ctx.triggeringPlayerId);
  return {
    kind: 'open-reaction',
    patch: banished.patch,
    window: {
      triggerEvents: [banished.triggerEvent],
      pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
      reactedPlayerIds: [],
      afterResume: { effectId: 'base.system.noop', context: {} },
      source: ctx.source,
    },
  };
});

// ============================================================================
// Training — Swap a Mage you control (in your office) for one from the supply,
// of a colour you choose. Mirrors the Mancers department-swap supporters, but
// the player picks the target colour.
// ============================================================================

registerEffect('renovation.bell.training', (ctx): EffectResult => {
  const player = findPlayer(ctx.state, ctx.triggeringPlayerId);
  if (!player) return { kind: 'done', patch: {} };
  const eligible = player.mages.filter(
    (m) => m.location.kind === 'office' && m.color !== 'rainbow' && !m.isTemporary,
  );
  const availableColors = MAGE_COLORS.filter(
    (c) => c !== 'rainbow' && (ctx.state.mageDraftPool[c] ?? 0) > 0,
  );
  if (eligible.length === 0 || availableColors.length === 0) {
    return { kind: 'done', patch: {} };
  }

  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: eligible.map((m) => m.id),
          label: 'Swap which of your Mages?',
        },
        resume: { effectId: 'renovation.bell.training', context: { step: 'pick-color' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-color') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('renovation.bell.training pick-color expected mage-chosen');
    }
    const mageId = ctx.resumeAnswer.mageId;
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-from-options',
          options: availableColors.map((c) => ({ id: c, label: `Take a ${c} Mage`, payload: {} })),
        },
        resume: { effectId: 'renovation.bell.training', context: { step: 'apply', mageId } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error('renovation.bell.training apply expected option-chosen');
    }
    const targetColor = ctx.resumeAnswer.optionId as MageColor;
    const mageId = String(ctx.resumeContext?.['mageId'] ?? '');
    const source = player.mages.find((m) => m.id === mageId);
    if (!source || source.location.kind !== 'office' || (ctx.state.mageDraftPool[targetColor] ?? 0) <= 0) {
      return { kind: 'done', patch: {} };
    }
    const seq = ctx.state.nextSequenceId;
    const pool = { ...ctx.state.mageDraftPool };
    pool[source.color] = (pool[source.color] ?? 0) + 1;
    pool[targetColor] = (pool[targetColor] ?? 0) - 1;
    return {
      kind: 'done',
      patch: {
        nextSequenceId: seq + 1,
        mageDraftPool: pool,
        players: ctx.state.players.map((p) =>
          p.id !== ctx.triggeringPlayerId
            ? p
            : {
                ...p,
                mages: [
                  ...p.mages.filter((m) => m.id !== mageId),
                  {
                    id: `m-${seq}`,
                    cardId: MAGE_CARD_BY_COLOR[targetColor],
                    color: targetColor,
                    location: { kind: 'office' as const, playerId: ctx.triggeringPlayerId },
                    isShadowing: false,
                    isWounded: false,
                  },
                ],
              },
        ),
      },
    };
  }
  throw new Error('renovation.bell.training: unexpected state');
});

// ============================================================================
// Sloth — Move a Mage (any) to an open slot in an orthogonally-adjacent room.
// ============================================================================

/** Placed (base-occupant) mages on the board, with their slot + room. */
function placedMages(
  state: GameState,
): { mageId: OwnedMageId; spaceId: string; roomId: string }[] {
  const out: { mageId: OwnedMageId; spaceId: string; roomId: string }[] = [];
  for (const room of state.rooms) {
    for (const space of room.actionSpaces) {
      if (space.occupant) {
        out.push({ mageId: space.occupant.mageId, spaceId: space.id, roomId: room.id });
      }
    }
  }
  return out;
}

/** Open base slots (empty, not shadow/wound, room unlocked) in the given rooms. */
function openBaseSlotsInRooms(state: GameState, roomIds: string[]): string[] {
  const ids = new Set(roomIds);
  const locked = new Set(state.roomLocks.map((l) => l.roomId));
  const out: string[] = [];
  for (const room of state.rooms) {
    if (!ids.has(room.id) || locked.has(room.id)) continue;
    for (const space of room.actionSpaces) {
      if (
        !space.occupant &&
        space.slotType !== 'shadow' &&
        space.slotType !== 'shadow-merit' &&
        space.slotType !== 'wound'
      ) {
        out.push(space.id);
      }
    }
  }
  return out;
}

registerEffect('renovation.bell.sloth', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    // A Mage is only moveable if its room has at least one adjacent open slot.
    const moveable = placedMages(ctx.state).filter((m) => {
      const adj = getOrthogonallyAdjacentRoomIds(ctx.state.roomLayout, m.roomId);
      return openBaseSlotsInRooms(ctx.state, adj).length > 0;
    });
    if (moveable.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: moveable.map((m) => m.mageId),
          label: 'Move which Mage?',
        },
        resume: { effectId: 'renovation.bell.sloth', context: { step: 'pick-slot' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'pick-slot') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('renovation.bell.sloth pick-slot expected mage-chosen');
    }
    const mageId = ctx.resumeAnswer.mageId;
    const placed = placedMages(ctx.state).find((m) => m.mageId === mageId);
    if (!placed) return { kind: 'done', patch: {} };
    const adj = getOrthogonallyAdjacentRoomIds(ctx.state.roomLayout, placed.roomId);
    const slots = openBaseSlotsInRooms(ctx.state, adj);
    if (slots.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: { kind: 'choose-target-action-space', eligibleSpaceIds: slots },
        resume: { effectId: 'renovation.bell.sloth', context: { step: 'apply', mageId } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'space-chosen') {
      throw new Error('renovation.bell.sloth apply expected space-chosen');
    }
    const mageId = String(ctx.resumeContext?.['mageId'] ?? '');
    if (!mageId) return { kind: 'done', patch: {} };
    const moved = moveMageToSpace(ctx.state, mageId, ctx.resumeAnswer.spaceId, ctx.triggeringPlayerId);
    return {
      kind: 'open-reaction',
      patch: moved.patch,
      window: {
        triggerEvents: [moved.triggerEvent],
        pendingResponderIds: buildReactionQueue(ctx.state, ctx.triggeringPlayerId),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source: ctx.source,
      },
    };
  }
  throw new Error('renovation.bell.sloth: unexpected state');
});

// ============================================================================
// Envy — Swap two Mages in the same room (exchange their slots).
// ============================================================================

registerEffect('renovation.bell.envy', (ctx): EffectResult => {
  const step = ctx.resumeContext?.['step'];
  if (!ctx.resumeAnswer) {
    // First Mage: must share its room with at least one other placed Mage.
    const placed = placedMages(ctx.state);
    const first = placed.filter((m) =>
      placed.some((o) => o.mageId !== m.mageId && o.roomId === m.roomId),
    );
    if (first.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: first.map((m) => m.mageId),
          label: 'Swap which Mage?',
        },
        resume: { effectId: 'renovation.bell.envy', context: { step: 'second' } },
        source: ctx.source,
      },
    };
  }
  if (step === 'second') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('renovation.bell.envy second expected mage-chosen');
    }
    const firstId = ctx.resumeAnswer.mageId;
    const placed = placedMages(ctx.state);
    const firstRoom = placed.find((m) => m.mageId === firstId)?.roomId;
    const second = placed.filter((m) => m.mageId !== firstId && m.roomId === firstRoom);
    if (second.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: ctx.triggeringPlayerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: second.map((m) => m.mageId),
          label: 'Swap with which Mage (same room)?',
        },
        resume: { effectId: 'renovation.bell.envy', context: { step: 'apply', firstId } },
        source: ctx.source,
      },
    };
  }
  if (step === 'apply') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error('renovation.bell.envy apply expected mage-chosen');
    }
    const firstId = String(ctx.resumeContext?.['firstId'] ?? '');
    const secondId = ctx.resumeAnswer.mageId;
    const placed = placedMages(ctx.state);
    const a = placed.find((m) => m.mageId === firstId);
    const b = placed.find((m) => m.mageId === secondId);
    if (!a || !b) return { kind: 'done', patch: {} };
    const aOwner = ownerOfMage(ctx.state, firstId);
    const bOwner = ownerOfMage(ctx.state, secondId);
    if (!aOwner || !bOwner) return { kind: 'done', patch: {} };
    // Lift both, then re-seat each into the other's slot. Threaded through the
    // board primitives so occupancy and mage.location stay consistent.
    let s: GameState = ctx.state;
    const rem1 = removeMageFromSlot(s, firstId);
    s = { ...s, rooms: rem1.rooms ?? s.rooms, players: rem1.players ?? s.players };
    const rem2 = removeMageFromSlot(s, secondId);
    s = { ...s, rooms: rem2.rooms ?? s.rooms, players: rem2.players ?? s.players };
    const pl1 = placeMageOnSlot(s, { mageId: firstId, ownerId: aOwner, spaceId: b.spaceId, asShadow: false });
    s = { ...s, rooms: pl1.rooms ?? s.rooms, players: pl1.players ?? s.players };
    const pl2 = placeMageOnSlot(s, { mageId: secondId, ownerId: bOwner, spaceId: a.spaceId, asShadow: false });
    s = { ...s, rooms: pl2.rooms ?? s.rooms, players: pl2.players ?? s.players };
    return { kind: 'done', patch: { rooms: s.rooms, players: s.players } };
  }
  throw new Error('renovation.bell.envy: unexpected state');
});

/** Owner id of a placed Mage (from its slot occupant). */
function ownerOfMage(state: GameState, mageId: OwnedMageId): string | null {
  for (const room of state.rooms) {
    for (const space of room.actionSpaces) {
      if (space.occupant?.mageId === mageId) return space.occupant.ownerId;
    }
  }
  return null;
}

// ============================================================================
// Adaptability — bonus "place a Mage" when the tower empties. The placement is
// granted by the engine (handleClaimBellTower's last-card path); the card's own
// claim effect is a no-op.
// ============================================================================

registerEffect('renovation.bell.adaptability', (): EffectResult => ({
  kind: 'done',
  patch: {},
}));
