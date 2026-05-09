// Pure game engine. No React, no DOM, no I/O.
// Everything here is deterministic given (state, action). All randomness
// lives in state.rng, all id generation in state.nextSequenceId.

import { getPack } from '../content/registry';
import { validateAction } from './actions';
import { computeFinalScoring } from './scoring';
import { buildInitialState } from './setup';
import { getEffect, hasEffect } from './effects/index';
import type { Effect } from './effects/index';
import {
  applyVaultPurchase,
  buildReactionOptionsFor,
  describeSpaceSource,
} from './effects/helpers';
import type {
  BellTowerCard,
  BellTowerCardId,
  BuyVaultCardAction,
  CastSpellAction,
  ConsortiumVoter,
  EffectContext,
  EffectResult,
  EndErrandsTurnAction,
  GameAction,
  GameConfig,
  GameState,
  GameStatePatch,
  PendingResolution,
  PendingResolutionInput,
  PlaceWorkerAction,
  Player,
  ReactionWindow,
  ReactionWindowId,
  ResolutionAnswer,
  ResolutionSource,
  ResolvePendingAction,
  ResumeContinuation,
  Room,
  RoundNumber,
  SerializableContext,
  UseAbilityAction,
} from './types';

// Side-effect import: triggers effect registration.
import './effects';

export function initGame(config: GameConfig): GameState {
  return buildInitialState(config);
}

export function applyAction(state: GameState, action: GameAction): GameState {
  validateAction(state, action);

  switch (action.type) {
    case 'PLACE_WORKER':
      return handlePlaceWorker(state, action);
    case 'CAST_SPELL':
      return handleCastSpell(state, action);
    case 'BUY_VAULT_CARD':
      return handleBuyVaultCard(state, action);
    case 'USE_ABILITY':
      return handleUseAbility(state, action);
    case 'RECRUIT_SUPPORTER':
    case 'PASS_TURN':
      throw new Error(
        `applyAction: action "${action.type}" not yet implemented (phase=${state.phase.kind})`,
      );
    case 'END_ERRANDS_TURN':
      return handleEndErrandsTurn(state, action);
    case 'RESOLVE_PENDING':
      return handleResolvePending(state, action);
    case 'ADVANCE_PHASE':
      return handleAdvancePhase(state);
    default: {
      const exhaustive: never = action;
      throw new Error(`applyAction: unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ============================================================================
// Generic helpers
// ============================================================================

function applyPatch(state: GameState, patch: GameStatePatch | undefined): GameState {
  if (!patch) return state;
  return { ...state, ...patch };
}

function mintId(state: GameState, prefix: string): { id: string; state: GameState } {
  const id = `${prefix}-${state.nextSequenceId}`;
  return { id, state: { ...state, nextSequenceId: state.nextSequenceId + 1 } };
}

function pushPending(state: GameState, input: PendingResolutionInput): GameState {
  const minted = mintId(state, 'r');
  const full: PendingResolution = { ...input, id: minted.id };
  return {
    ...minted.state,
    pendingResolutionStack: [...minted.state.pendingResolutionStack, full],
  };
}

function popPending(state: GameState): GameState {
  return {
    ...state,
    pendingResolutionStack: state.pendingResolutionStack.slice(0, -1),
  };
}

function replaceWindow(
  state: GameState,
  windowId: ReactionWindowId,
  fn: (w: ReactionWindow) => ReactionWindow,
): GameState {
  return {
    ...state,
    activeReactionWindows: state.activeReactionWindows.map((w) =>
      w.id === windowId ? fn(w) : w,
    ),
  };
}

function removeWindow(state: GameState, windowId: ReactionWindowId): GameState {
  return {
    ...state,
    activeReactionWindows: state.activeReactionWindows.filter((w) => w.id !== windowId),
  };
}

// ============================================================================
// Effect result application
// ============================================================================

/**
 * Applies an EffectResult to state. The patch is applied first; if the
 * result also opens a reaction window or pauses, that's added on top.
 *
 * `ctx.allowReactions` controls how `open-reaction` results behave:
 *   - true  → push window + responder prompt
 *   - false → reactions cannot themselves be reacted to; skip the window
 *             and immediately invoke afterResume with reactions re-enabled.
 */
function applyEffectResult(
  state: GameState,
  result: EffectResult,
  ctx: EffectContext,
): GameState {
  switch (result.kind) {
    case 'done':
      return applyPatch(state, result.patch);
    case 'pause': {
      const afterPatch = applyPatch(state, result.patch);
      return pushPending(afterPatch, result.pending);
    }
    case 'open-reaction': {
      const afterPatch = applyPatch(state, result.patch);
      if (!ctx.allowReactions) {
        // Per rulebook: reactions cannot be reacted to. Skip the window and
        // fire afterResume immediately (with reactions re-enabled, since the
        // afterResume runs in the original action's context).
        return invokeContinuation(
          afterPatch,
          result.window.afterResume,
          result.window.source,
          true,
        );
      }
      const minted = mintId(afterPatch, 'rw');
      const fullWindow: ReactionWindow = { ...result.window, id: minted.id };
      const withWindow: GameState = {
        ...minted.state,
        activeReactionWindows: [...minted.state.activeReactionWindows, fullWindow],
      };
      return advanceReactionWindow(withWindow, fullWindow);
    }
  }
}

/**
 * Either pushes the next responder's prompt or, if the queue is empty,
 * pops the window and invokes its afterResume continuation.
 */
function advanceReactionWindow(state: GameState, window: ReactionWindow): GameState {
  if (window.pendingResponderIds.length === 0) {
    const afterRemove = removeWindow(state, window.id);
    return invokeContinuation(afterRemove, window.afterResume, window.source, true);
  }

  const responderId = window.pendingResponderIds[0];
  if (responderId === undefined) {
    throw new Error('advanceReactionWindow: empty pendingResponderIds');
  }
  const reactionOptions = buildReactionOptionsFor(state, responderId, window.triggerEvent);
  const promptInput: PendingResolutionInput = {
    responderId,
    prompt: {
      kind: 'reaction-window',
      triggerEvent: window.triggerEvent,
      reactionOptions,
      canPass: true,
    },
    resume: {
      effectId: '__reaction_window__',
      context: { reactionWindowId: window.id },
    },
    source: window.source,
    reactionWindowId: window.id,
  };
  return pushPending(state, promptInput);
}

function invokeContinuation(
  state: GameState,
  cont: ResumeContinuation,
  source: ResolutionSource,
  allowReactions: boolean,
): GameState {
  const effect = getEffect(cont.effectId);
  const ctx: EffectContext = {
    state,
    source,
    triggeringPlayerId: source.triggeringPlayerId,
    resumeContext: cont.context,
    allowReactions,
  };
  const result = effect(ctx);
  return applyEffectResult(state, result, ctx);
}

// ============================================================================
// Resolution phase pump
// ============================================================================

/**
 * Auto-advances the resolution phase until either:
 *   - a space's effect pauses (stack non-empty) or opens a reaction window,
 *   - all rooms are resolved (transitions to mid-game-scoring), or
 *   - the phase is no longer `resolution`.
 *
 * Empty action spaces, instant rooms, the Infirmary, and rooms with
 * unregistered effect ids are skipped without ceremony.
 */
function pumpResolutionPhase(state: GameState): GameState {
  let curr = state;
  // Hard cap on iterations to avoid runaway loops if a TODO branch misbehaves.
  const HARD_CAP = 5000;
  for (let i = 0; i < HARD_CAP; i++) {
    if (curr.phase.kind !== 'resolution') return curr;
    if (curr.pendingResolutionStack.length > 0) return curr;
    if (curr.activeReactionWindows.length > 0) return curr;

    const phase = curr.phase;
    const room: Room | undefined = curr.rooms[phase.pendingRoomIndex];
    if (!room) {
      curr = {
        ...curr,
        phase: { kind: 'mid-game-scoring', round: phase.round },
      };
      return curr;
    }
    if (room.cannotBePlacedInDirectly) {
      // Infirmary — wounded mages live on `OwnedMage.location.kind = 'infirmary'`,
      // not on action spaces, so the resolution pump has nothing to do here.
      curr = advanceResolutionPointer(curr, true);
      continue;
    }
    if (room.isInstantRoom) {
      // The slot's effect ran at PLACE_WORKER time. The pump's only job for
      // instant rooms is to return the mage to its owner's office.
      if (phase.pendingSpaceIndex >= room.actionSpaces.length) {
        curr = advanceResolutionPointer(curr, true);
        continue;
      }
      const space = room.actionSpaces[phase.pendingSpaceIndex];
      if (!space || !space.occupant) {
        curr = advanceResolutionPointer(curr, false);
        continue;
      }
      curr = completeCurrentSpaceResolution(curr);
      continue;
    }
    if (phase.pendingSpaceIndex >= room.actionSpaces.length) {
      curr = advanceResolutionPointer(curr, true);
      continue;
    }
    const space = room.actionSpaces[phase.pendingSpaceIndex];
    if (!space || !space.occupant) {
      curr = advanceResolutionPointer(curr, false);
      continue;
    }

    // Invoke the space's effect. Unregistered → no-op completion.
    if (!hasEffect(space.effectId)) {
      curr = completeCurrentSpaceResolution(curr);
      continue;
    }

    const effect: Effect = getEffect(space.effectId);
    const source: ResolutionSource = describeSpaceSource(
      space.id,
      room.name,
      room.side,
      space.index,
      space.occupant.ownerId,
    );
    const ctx: EffectContext = {
      state: curr,
      source,
      triggeringPlayerId: space.occupant.ownerId,
      allowReactions: true,
    };
    const result = effect(ctx);
    curr = applyEffectResult(curr, result, ctx);

    if (curr.pendingResolutionStack.length > 0 || curr.activeReactionWindows.length > 0) {
      return curr; // paused or waiting on reactions
    }

    curr = completeCurrentSpaceResolution(curr);
  }
  throw new Error('pumpResolutionPhase: hit iteration cap');
}

/** Advances pointer by one space (`bumpRoom` true skips the rest of the room). */
function advanceResolutionPointer(state: GameState, bumpRoom: boolean): GameState {
  if (state.phase.kind !== 'resolution') return state;
  const phase = state.phase;
  return {
    ...state,
    phase: bumpRoom
      ? { ...phase, pendingRoomIndex: phase.pendingRoomIndex + 1, pendingSpaceIndex: 0 }
      : { ...phase, pendingSpaceIndex: phase.pendingSpaceIndex + 1 },
  };
}

/**
 * Returns the resolution-pointer space's mage to its owner's office, clears
 * occupant, advances the pointer.
 */
function completeCurrentSpaceResolution(state: GameState): GameState {
  if (state.phase.kind !== 'resolution') return state;
  const phase = state.phase;
  const room = state.rooms[phase.pendingRoomIndex];
  if (!room) return state;
  const space = room.actionSpaces[phase.pendingSpaceIndex];
  if (!space || !space.occupant) return advanceResolutionPointer(state, false);

  const occupant = space.occupant;
  const updatedRooms = state.rooms.map((r, ri) =>
    ri !== phase.pendingRoomIndex
      ? r
      : {
          ...r,
          actionSpaces: r.actionSpaces.map((s, si) =>
            si !== phase.pendingSpaceIndex ? s : { ...s, occupant: null },
          ),
        },
  );
  const updatedPlayers = state.players.map((p) =>
    p.id !== occupant.ownerId
      ? p
      : {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== occupant.mageId
              ? m
              : {
                  ...m,
                  location: { kind: 'office' as const, playerId: occupant.ownerId },
                  isShadowing: false,
                },
          ),
        },
  );

  return {
    ...state,
    rooms: updatedRooms,
    players: updatedPlayers,
    phase: { ...phase, pendingSpaceIndex: phase.pendingSpaceIndex + 1 },
  };
}

// ============================================================================
// Action handlers
// ============================================================================

function handlePlaceWorker(state: GameState, action: PlaceWorkerAction): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('PLACE_WORKER: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('PLACE_WORKER: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `PLACE_WORKER: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }

  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error(`PLACE_WORKER: player ${action.playerId} not found`);

  const mage = player.mages.find((m) => m.id === action.mageId);
  if (!mage) throw new Error(`PLACE_WORKER: mage ${action.mageId} not owned by ${action.playerId}`);
  if (mage.location.kind !== 'office') {
    throw new Error(
      `PLACE_WORKER: mage ${action.mageId} not in office (location=${mage.location.kind})`,
    );
  }
  if (mage.isWounded) {
    throw new Error(`PLACE_WORKER: wounded mages must heal first`);
  }

  let foundRoomIdx = -1;
  let foundSpaceIdx = -1;
  for (let ri = 0; ri < state.rooms.length; ri++) {
    const r = state.rooms[ri];
    if (!r) continue;
    const si = r.actionSpaces.findIndex((s) => s.id === action.actionSpaceId);
    if (si !== -1) {
      foundRoomIdx = ri;
      foundSpaceIdx = si;
      break;
    }
  }
  if (foundRoomIdx === -1 || foundSpaceIdx === -1) {
    throw new Error(`PLACE_WORKER: action space ${action.actionSpaceId} not found`);
  }
  const room = state.rooms[foundRoomIdx]!;
  const space = room.actionSpaces[foundSpaceIdx]!;

  if (room.cannotBePlacedInDirectly) {
    throw new Error(
      `PLACE_WORKER: room ${room.id} cannot be placed in directly (Infirmary)`,
    );
  }
  if (state.roomLocks.some((l) => l.roomId === room.id)) {
    throw new Error(`PLACE_WORKER: room ${room.id} is locked`);
  }
  if (space.occupant) {
    throw new Error(`PLACE_WORKER: space ${space.id} already occupied`);
  }
  if (space.slotType === 'shadow' || space.slotType === 'shadow-merit') {
    // TODO: shadow placement requires choosing which occupied slot to copy.
    throw new Error(
      `PLACE_WORKER: slot type "${space.slotType}" not yet supported`,
    );
  }
  if (space.slotType === 'wound') {
    throw new Error(`PLACE_WORKER: slot type "wound" not yet supported`);
  }

  const meritCost =
    space.slotType === 'merit' ? (space.costToActivate?.meritBadges ?? 0) : 0;
  if (meritCost > 0 && player.resources.meritBadges < meritCost) {
    throw new Error(
      `PLACE_WORKER: insufficient Merit Badges (need ${meritCost}, have ${player.resources.meritBadges})`,
    );
  }

  // TODO: Mage Power triggers (Red Ars Magna, Purple fast-action). Not in
  // this slice.

  const updatedRooms = state.rooms.map((r, ri) =>
    ri !== foundRoomIdx
      ? r
      : {
          ...r,
          actionSpaces: r.actionSpaces.map((s, si) =>
            si !== foundSpaceIdx
              ? s
              : {
                  ...s,
                  occupant: {
                    mageId: action.mageId,
                    ownerId: action.playerId,
                    isShadowing: false,
                  },
                },
          ),
        },
  );
  const updatedPlayers = state.players.map((p): Player => {
    if (p.id !== action.playerId) return p;
    const next: Player = {
      ...p,
      mages: p.mages.map((m) =>
        m.id !== action.mageId
          ? m
          : {
              ...m,
              location: { kind: 'action-space' as const, spaceId: space.id },
              isShadowing: false,
            },
      ),
    };
    if (meritCost > 0) {
      return {
        ...next,
        resources: {
          ...next.resources,
          meritBadges: next.resources.meritBadges - meritCost,
          meritBadgesSpent: next.resources.meritBadgesSpent + meritCost,
        },
      };
    }
    return next;
  });

  const placed: GameState = {
    ...state,
    rooms: updatedRooms,
    players: updatedPlayers,
  };

  // Instant rooms (Guilds, etc.) resolve their slot effect at PLACE_WORKER
  // time, not in the resolution phase. The mage stays on the slot through
  // errands and gets returned by the resolution pump (which skips the
  // effect for instant rooms).
  if (room.isInstantRoom && hasEffect(space.effectId)) {
    const source = describeSpaceSource(
      space.id,
      room.name,
      room.side,
      space.index,
      action.playerId,
    );
    const ctx: EffectContext = {
      state: placed,
      source,
      triggeringPlayerId: action.playerId,
      allowReactions: true,
    };
    const result = getEffect(space.effectId)(ctx);
    return applyEffectResult(placed, result, ctx);
  }

  return placed;
}

function handleBuyVaultCard(
  state: GameState,
  action: BuyVaultCardAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('BUY_VAULT_CARD: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('BUY_VAULT_CARD: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `BUY_VAULT_CARD: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const patch = applyVaultPurchase(state, action.playerId, action.vaultCardId);
  return { ...state, ...patch };
}

function handleUseAbility(
  state: GameState,
  action: UseAbilityAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('USE_ABILITY: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('USE_ABILITY: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `USE_ABILITY: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  if (!hasEffect(action.abilityId)) {
    throw new Error(`USE_ABILITY: unknown ability "${action.abilityId}"`);
  }
  const sourceId = action.sourceCardId ?? action.abilityId;
  const source: ResolutionSource = {
    kind: 'mage-power',
    id: sourceId,
    triggeringPlayerId: action.playerId,
    description: `Ability ${action.abilityId}`,
  };
  const ctx: EffectContext = {
    state,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
  };
  const result = getEffect(action.abilityId)(ctx);
  return applyEffectResult(state, result, ctx);
}

function handleCastSpell(state: GameState, action: CastSpellAction): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('CAST_SPELL: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('CAST_SPELL: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `CAST_SPELL: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error(`CAST_SPELL: player not found`);

  const owned = player.ownedSpells.find((s) => s.cardId === action.spellCardId);
  if (!owned) throw new Error(`CAST_SPELL: player does not own ${action.spellCardId}`);
  if (owned.exhausted) throw new Error(`CAST_SPELL: spell is exhausted`);
  if (action.level === 1 && !owned.intPlaced) {
    throw new Error(`CAST_SPELL: spell L1 not researched`);
  }
  if (action.level === 2 && !owned.wisPlacedLevel2) {
    throw new Error(`CAST_SPELL: spell L2 not researched`);
  }
  if (action.level === 3 && !owned.wisPlacedLevel3) {
    throw new Error(`CAST_SPELL: spell L3 not researched`);
  }

  const cardDef = lookupSpellCardDef(state, action.spellCardId);
  if (!cardDef) throw new Error(`CAST_SPELL: spell card ${action.spellCardId} not in active packs`);
  const levelDef = cardDef.levels[action.level - 1];
  if (!levelDef) throw new Error(`CAST_SPELL: invalid level ${action.level}`);

  if (player.resources.mana < levelDef.manaCost) {
    throw new Error(
      `CAST_SPELL: insufficient mana (need ${levelDef.manaCost}, have ${player.resources.mana})`,
    );
  }

  // Spend mana, exhaust spell.
  let next: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.id !== action.playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, mana: p.resources.mana - levelDef.manaCost },
            ownedSpells: p.ownedSpells.map((s) =>
              s.cardId !== action.spellCardId ? s : { ...s, exhausted: true },
            ),
          },
    ),
  };

  // Invoke the spell's effect.
  if (!hasEffect(levelDef.effectId)) {
    return next; // Effect unregistered → just paid the cost, no further behavior.
  }
  const effect = getEffect(levelDef.effectId);
  const source: ResolutionSource = {
    kind: 'spell',
    id: action.spellCardId,
    triggeringPlayerId: action.playerId,
    description: `${cardDef.name} L${action.level}`,
  };
  const ctx: EffectContext = {
    state: next,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
  };
  const result = effect(ctx);
  return applyEffectResult(next, result, ctx);
}

function handleEndErrandsTurn(
  state: GameState,
  action: EndErrandsTurnAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('END_ERRANDS_TURN: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('END_ERRANDS_TURN: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `END_ERRANDS_TURN: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  // Exact same advancement rule as ADVANCE_PHASE while in errands.
  return processErrandsAdvance(state);
}

function handleResolvePending(
  state: GameState,
  action: ResolvePendingAction,
): GameState {
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  if (!top) throw new Error('RESOLVE_PENDING: no pending resolution');
  if (top.id !== action.resolutionId) {
    throw new Error(
      `RESOLVE_PENDING: id mismatch (top=${top.id}, given=${action.resolutionId})`,
    );
  }

  validateAnswerForPrompt(top, action.answer);

  // Pop the prompt before doing anything; effects only see the popped state.
  let curr = popPending(state);

  if (top.reactionWindowId !== undefined) {
    curr = resolveReactionPrompt(curr, top, action.answer);
  } else {
    curr = resolveNormalPending(curr, top, action.answer);
  }

  // If we landed back in resolution with no pending, complete current space
  // and pump forward (the pause was mid-space-resolution).
  if (
    curr.phase.kind === 'resolution' &&
    curr.pendingResolutionStack.length === 0 &&
    curr.activeReactionWindows.length === 0
  ) {
    curr = completeCurrentSpaceResolution(curr);
    curr = pumpResolutionPhase(curr);
  }

  return curr;
}

function resolveNormalPending(
  state: GameState,
  prompt: PendingResolution,
  answer: ResolutionAnswer,
): GameState {
  const effect = getEffect(prompt.resume.effectId);
  const ctx: EffectContext = {
    state,
    source: prompt.source,
    triggeringPlayerId: prompt.source.triggeringPlayerId,
    resumeContext: prompt.resume.context,
    resumeAnswer: answer,
    allowReactions: true,
  };
  const result = effect(ctx);
  return applyEffectResult(state, result, ctx);
}

function resolveReactionPrompt(
  state: GameState,
  prompt: PendingResolution,
  answer: ResolutionAnswer,
): GameState {
  if (prompt.prompt.kind !== 'reaction-window') {
    throw new Error('resolveReactionPrompt: prompt is not a reaction-window');
  }
  const windowId = prompt.reactionWindowId;
  if (windowId === undefined) {
    throw new Error('resolveReactionPrompt: missing reactionWindowId');
  }
  const responderId = prompt.responderId;
  let curr = state;

  if (answer.kind === 'reaction-played') {
    const reactionOption = prompt.prompt.reactionOptions.find(
      (o) => o.effectId === answer.effectId,
    );
    if (!reactionOption) {
      throw new Error(
        `resolveReactionPrompt: reaction effect ${answer.effectId} not in offered options`,
      );
    }
    const window = curr.activeReactionWindows.find((w) => w.id === windowId);
    if (!window) {
      throw new Error(`resolveReactionPrompt: window ${windowId} missing`);
    }
    const reactionSource: ResolutionSource = {
      kind: reactionOption.sourceKind,
      id: reactionOption.sourceId,
      triggeringPlayerId: responderId,
      description: reactionOption.label,
    };
    // The reaction effect needs to know what triggered it. We thread the
    // window's triggerEvent into resumeContext alongside any reactor-supplied
    // context.
    const triggerEventValue = window.triggerEvent as unknown as SerializableContext;
    const reactionCtx: EffectContext = {
      state: curr,
      source: reactionSource,
      triggeringPlayerId: responderId,
      resumeAnswer: answer,
      resumeContext: {
        ...answer.reactionContext,
        triggerEvent: triggerEventValue,
      },
      allowReactions: false,
    };
    const reactionEffect = getEffect(answer.effectId);
    const reactionResult = reactionEffect(reactionCtx);
    curr = applyEffectResult(curr, reactionResult, reactionCtx);

    curr = replaceWindow(curr, windowId, (w) => ({
      ...w,
      reactedPlayerIds: [...w.reactedPlayerIds, responderId],
      pendingResponderIds: w.pendingResponderIds.filter((id) => id !== responderId),
    }));
  } else if (answer.kind === 'reaction-passed') {
    curr = replaceWindow(curr, windowId, (w) => ({
      ...w,
      pendingResponderIds: w.pendingResponderIds.filter((id) => id !== responderId),
    }));
  } else {
    throw new Error(
      `resolveReactionPrompt: unexpected answer kind ${answer.kind}`,
    );
  }

  // Look up the (possibly updated) window and continue.
  const window = curr.activeReactionWindows.find((w) => w.id === windowId);
  if (!window) return curr; // already removed by a reaction effect (should not happen)
  return advanceReactionWindow(curr, window);
}

function validateAnswerForPrompt(
  prompt: PendingResolution,
  answer: ResolutionAnswer,
): void {
  const promptKind = prompt.prompt.kind;
  switch (promptKind) {
    case 'choose-from-options':
      if (answer.kind !== 'option-chosen') {
        throw new Error(
          `validateAnswer: expected option-chosen for choose-from-options, got ${answer.kind}`,
        );
      }
      if (!prompt.prompt.options.some((o) => o.id === answer.optionId)) {
        throw new Error(`validateAnswer: option ${answer.optionId} not in prompt`);
      }
      return;
    case 'choose-target-mage':
      if (answer.kind !== 'mage-chosen') {
        throw new Error(`validateAnswer: expected mage-chosen, got ${answer.kind}`);
      }
      if (!prompt.prompt.eligibleMageIds.includes(answer.mageId)) {
        throw new Error(`validateAnswer: mage ${answer.mageId} not eligible`);
      }
      return;
    case 'choose-target-action-space':
      if (answer.kind !== 'space-chosen') throw new Error('validateAnswer: expected space-chosen');
      return;
    case 'choose-vault-card':
    case 'choose-supporter-card':
      if (answer.kind !== 'card-chosen') throw new Error('validateAnswer: expected card-chosen');
      return;
    case 'choose-spell-level':
      if (answer.kind !== 'level-chosen') throw new Error('validateAnswer: expected level-chosen');
      return;
    case 'choose-deck':
      if (answer.kind !== 'deck-chosen') throw new Error('validateAnswer: expected deck-chosen');
      return;
    case 'choose-voter':
      if (answer.kind !== 'voter-chosen') throw new Error('validateAnswer: expected voter-chosen');
      return;
    case 'reaction-window':
      if (answer.kind !== 'reaction-played' && answer.kind !== 'reaction-passed') {
        throw new Error(
          `validateAnswer: reaction-window prompt expects reaction-played or reaction-passed, got ${answer.kind}`,
        );
      }
      if (answer.kind === 'reaction-played') {
        if (!prompt.prompt.reactionOptions.some((o) => o.effectId === answer.effectId)) {
          throw new Error(
            `validateAnswer: reaction effect ${answer.effectId} not in options`,
          );
        }
      }
      return;
    case 'confirm':
      if (answer.kind !== 'confirmed') throw new Error('validateAnswer: expected confirmed');
      return;
  }
}

function lookupSpellCardDef(state: GameState, spellCardId: string) {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.spells.find((s) => s.id === spellCardId);
    if (found) return found;
    const legendary = pack.legendarySpells.find((s) => s.id === spellCardId);
    if (legendary) return legendary;
  }
  return null;
}

// ============================================================================
// Phase machine
// ============================================================================

function handleAdvancePhase(state: GameState): GameState {
  if (state.pendingResolutionStack.length > 0) {
    throw new Error(
      'ADVANCE_PHASE: pending player resolution must be answered first',
    );
  }
  switch (state.phase.kind) {
    case 'setup':
      return { ...state, phase: { kind: 'round-setup', round: 1 } };
    case 'round-setup':
      return processRoundSetup(state, state.phase.round);
    case 'errands':
      return processErrandsAdvance(state);
    case 'resolution':
      return pumpResolutionPhase(state);
    case 'mid-game-scoring':
      return processMidGameScoring(state, state.phase.round);
    case 'final-scoring':
      return finalizeGame(state);
    case 'complete':
      return state;
  }
}

function processRoundSetup(state: GameState, round: RoundNumber): GameState {
  let updated = state;
  if (round > 1) {
    updated = refreshPlayerCardsAndMerit(updated);
    updated = redealTableaus(updated);
    updated = restoreBellTower(updated);
  }
  return {
    ...updated,
    phase: {
      kind: 'errands',
      round,
      activePlayerIndex: state.firstPlayerIndex,
    },
  };
}

function refreshPlayerCardsAndMerit(state: GameState): GameState {
  const players = state.players.map((p) => ({
    ...p,
    ownedSpells: p.ownedSpells.map((s) => ({ ...s, exhausted: false })),
    vaultCards: p.vaultCards.map((v) => ({ ...v, exhausted: false })),
    resources: {
      ...p.resources,
      meritBadges: p.resources.meritBadges + p.resources.meritBadgesSpent,
      meritBadgesSpent: 0,
    },
    bellTowerCards: [],
  }));
  return { ...state, players };
}

function redealTableaus(state: GameState): GameState {
  const spellPool = [...state.spellDeck, ...state.spellTableau];
  const spellTableau = spellPool.slice(0, 3);
  const spellDeck = spellPool.slice(3);

  const vaultPool = [...state.vaultDeck, ...state.vaultTableau];
  const vaultTableau = vaultPool.slice(0, 3);
  const vaultDeck = vaultPool.slice(3);

  const supporterPool = [...state.supporterDeck, ...state.supporterTableau];
  const supporterTableau = supporterPool.slice(0, 5);
  const supporterDeck = supporterPool.slice(5);

  return {
    ...state,
    spellDeck,
    spellTableau,
    vaultDeck,
    vaultTableau,
    supporterDeck,
    supporterTableau,
  };
}

function restoreBellTower(state: GameState): GameState {
  const restored: BellTowerCard[] = [];
  for (const t of state.bellTower.taken) {
    const card = lookupBellTowerCard(state, t.cardId);
    if (card) restored.push(card);
  }
  return {
    ...state,
    bellTower: {
      available: [...state.bellTower.available, ...restored],
      taken: [],
    },
  };
}

function lookupBellTowerCard(
  state: GameState,
  cardId: BellTowerCardId,
): BellTowerCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.bellTowerCards.find((c) => c.id === cardId);
    if (found) return found;
  }
  return null;
}

function processErrandsAdvance(state: GameState): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('processErrandsAdvance: not in errands phase');
  }
  if (state.bellTower.available.length === 0) {
    return {
      ...state,
      phase: {
        kind: 'resolution',
        round: state.phase.round,
        pendingRoomIndex: 0,
        pendingSpaceIndex: 0,
      },
    };
  }
  const next = (state.phase.activePlayerIndex + 1) % state.players.length;
  return {
    ...state,
    phase: { ...state.phase, activePlayerIndex: next },
  };
}

function processMidGameScoring(state: GameState, round: RoundNumber): GameState {
  if (round < 5) {
    const next = (round + 1) as RoundNumber;
    return { ...state, phase: { kind: 'round-setup', round: next } };
  }
  return finalizeGame(state);
}

function finalizeGame(state: GameState): GameState {
  const revealedVoters: ConsortiumVoter[] = state.voters.map((v) => ({
    ...v,
    revealed: true,
  }));
  const result = computeFinalScoring({ ...state, voters: revealedVoters });
  return {
    ...state,
    voters: revealedVoters,
    phase: { kind: 'complete', archmage: result.archmage },
  };
}
