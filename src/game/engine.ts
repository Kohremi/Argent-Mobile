// Pure game engine. No React, no DOM, no I/O.
// Everything here is deterministic given (state, action). All randomness
// lives in state.rng, all id generation in state.nextSequenceId.

import { getPack } from '../content/registry';
import { validateAction } from './actions';
import { computeFinalScoring } from './scoring';
import { buildInitialState } from './setup';
import { getEffect, hasEffect } from './effects/index';
import {
  applyCandidateAllocation,
  applyVaultPurchase,
  buildReactionOptionsFor,
  buildReactionQueue,
  buildSnakeDraftOrder,
  canArsMagnaTakeSpace,
  describeSpaceSource,
  lookupCandidate,
  MAGE_CARD_BY_COLOR,
  woundMage,
} from './effects/helpers';
import type {
  BellTowerCard,
  BellTowerCardId,
  BuyVaultCardAction,
  CastSpellAction,
  ChooseCandidateAction,
  ChooseDraftFirstAction,
  ClaimBellTowerAction,
  ConsortiumVoter,
  DraftMageAction,
  PlaySupporterAction,
  PlayVaultCardAction,
  SupporterCard,
  VaultCard,
  EffectContext,
  EffectResult,
  GameAction,
  GameConfig,
  GameState,
  GameStatePatch,
  OwnedMage,
  PassTurnAction,
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

  let next: GameState;
  switch (action.type) {
    case 'PLACE_WORKER':
      next = handlePlaceWorker(state, action);
      break;
    case 'CAST_SPELL':
      next = handleCastSpell(state, action);
      break;
    case 'BUY_VAULT_CARD':
      next = handleBuyVaultCard(state, action);
      break;
    case 'USE_ABILITY':
      next = handleUseAbility(state, action);
      break;
    case 'PASS_TURN':
      next = handlePassTurn(state, action);
      break;
    case 'PLAY_SUPPORTER':
      next = handlePlaySupporter(state, action);
      break;
    case 'PLAY_VAULT_CARD':
      next = handlePlayVaultCard(state, action);
      break;
    case 'RECRUIT_SUPPORTER':
      throw new Error(
        `applyAction: action "${action.type}" not yet implemented (phase=${state.phase.kind})`,
      );
    case 'CLAIM_BELL_TOWER':
      next = handleClaimBellTower(state, action);
      break;
    case 'RESOLVE_PENDING':
      next = handleResolvePending(state, action);
      break;
    case 'CHOOSE_CANDIDATE':
      next = handleChooseCandidate(state, action);
      break;
    case 'CHOOSE_DRAFT_FIRST':
      next = handleChooseDraftFirst(state, action);
      break;
    case 'DRAFT_MAGE':
      next = handleDraftMage(state, action);
      break;
    case 'ADVANCE_PHASE':
      next = handleAdvancePhase(state);
      break;
    default: {
      const exhaustive: never = action;
      throw new Error(`applyAction: unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
  return autoAdvanceIfTurnDone(next);
}

// ============================================================================
// Generic helpers
// ============================================================================

function applyPatch(state: GameState, patch: GameStatePatch | undefined): GameState {
  if (!patch) return state;
  return { ...state, ...patch };
}

type ActionBudgetKind = 'action' | 'fast-action';

/**
 * Validates that the active player's per-turn Action / Fast-Action budget is
 * available for the given slot kind, then marks it spent.
 *
 * Per the Argent rulebook, a turn proceeds: (optional) Fast Action FIRST,
 * then (mandatory) Regular Action. After the Regular Action resolves, the
 * turn ends automatically — Fast Actions cannot follow the Regular Action,
 * and you cannot take two Fast Actions in place of a Regular Action.
 *
 * Reactions are NOT counted here — they fire from an open reaction window,
 * not from the player's own turn budget.
 */
function consumeActionBudget(
  state: GameState,
  kind: ActionBudgetKind,
  label: string,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error(`${label}: only valid during errands phase`);
  }
  if (kind === 'action') {
    if (state.phase.actionUsed) {
      throw new Error(`${label}: you already used your Action this turn`);
    }
    return { ...state, phase: { ...state.phase, actionUsed: true } };
  }
  // kind === 'fast-action'
  if (state.phase.actionUsed) {
    throw new Error(
      `${label}: a Fast Action must be taken BEFORE your Regular Action`,
    );
  }
  if (state.phase.fastActionUsed) {
    throw new Error(`${label}: you already used your Fast Action this turn`);
  }
  return { ...state, phase: { ...state.phase, fastActionUsed: true } };
}

/**
 * If the active player has spent their Regular Action and no prompts or
 * reaction windows are still open, the turn ends automatically (per
 * rulebook). Called at the end of every dispatch so that turns advance
 * without an explicit "end turn" action.
 */
function autoAdvanceIfTurnDone(state: GameState): GameState {
  if (state.phase.kind !== 'errands') return state;
  if (!state.phase.actionUsed) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  return processErrandsAdvance(state);
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

    // Effect-less / unregistered slots: no reward to take, just complete.
    if (!hasEffect(space.effectId)) {
      curr = completeCurrentSpaceResolution(curr);
      continue;
    }

    // Push the forfeit-or-reward prompt and pause. The resume effect will
    // either deduct the merit cost and invoke the slot's real effect, or
    // grant the player 1 IP and skip the effect.
    curr = pushResolutionChoicePrompt(curr, room, space, space.occupant.ownerId);
    return curr;
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
  // Red (Sorcery) mages may place on an OCCUPIED slot if they can pay
  // 1 mana and the occupant is a valid Ars Magna target (opposing, not
  // wounded, not green, not blue). All other placements require an empty
  // slot.
  const isArsMagnaPlacement =
    mage.color === 'red' &&
    canArsMagnaTakeSpace(state, action.playerId, space);
  if (space.occupant && !isArsMagnaPlacement) {
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

  // Merit-cost spaces are placeable even without enough Merit Badges. The
  // cost (and the choice to take the reward or forfeit for 1 IP) is deferred
  // to the resolution phase via `base.system.resolution-choice`. If the
  // player still can't afford the cost when the prompt fires, only the
  // forfeit option is available.

  const roomLimit = room.maxMagesPerPlayerPerRound ?? Infinity;
  if (Number.isFinite(roomLimit)) {
    const placedHere = player.roundPlacements.filter(
      (rid) => rid === room.id,
    ).length;
    if (placedHere >= roomLimit) {
      throw new Error(
        `PLACE_WORKER: already placed ${placedHere} mage${placedHere === 1 ? '' : 's'} in ${room.name} this round (limit ${roomLimit})`,
      );
    }
  }

  // TODO: Purple-mage placement-as-fast-action trigger (the Planar Studies
  // mage power). Not yet implemented; purple still pays the Fast Action
  // budget through the standard placement path below.

  // Purple (Planar Studies) Mages place as a Fast Action; everyone else
  // consumes the Action budget.
  const budgetKind: ActionBudgetKind =
    mage.color === 'purple' ? 'fast-action' : 'action';
  state = consumeActionBudget(state, budgetKind, 'PLACE_WORKER');

  // Red Mage Ars Magna: spending 1 mana when placing wounds the slot's
  // occupant and lets the red mage take that slot. The standard placement
  // logic below assumes an empty slot — we branch here for Ars Magna and
  // route the rest through the existing `ars-magna.complete` continuation
  // which handles the Infirmary bonus prompt + the move into the slot.
  if (isArsMagnaPlacement && space.occupant) {
    const targetMageId = space.occupant.mageId;
    const stateAfterCosts: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id !== action.playerId
          ? p
          : {
              ...p,
              resources: { ...p.resources, mana: p.resources.mana - 1 },
              roundPlacements: [...p.roundPlacements, room.id],
            },
      ),
    };
    const wounded = woundMage(
      stateAfterCosts,
      targetMageId,
      action.playerId,
    );
    const source: ResolutionSource = {
      kind: 'mage-power',
      id: action.mageId,
      triggeringPlayerId: action.playerId,
      description: 'Ars Magna (placement)',
    };
    const ctx: EffectContext = {
      state: stateAfterCosts,
      source,
      triggeringPlayerId: action.playerId,
      allowReactions: true,
    };
    const result: EffectResult = {
      kind: 'open-reaction',
      patch: wounded.patch,
      window: {
        triggerEvent: wounded.triggerEvent,
        pendingResponderIds: buildReactionQueue(
          stateAfterCosts,
          action.playerId,
        ),
        reactedPlayerIds: [],
        afterResume: {
          effectId: 'base.mage.sorcery.ars-magna.complete',
          context: {
            sourceMageId: action.mageId,
            targetSpaceId: space.id,
            triggerEvent: wounded.triggerEvent as unknown as SerializableContext,
          },
        },
        source,
      },
    };
    return applyEffectResult(stateAfterCosts, result, ctx);
  }

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
    return {
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
      roundPlacements: [...p.roundPlacements, room.id],
    };
  });

  const placed: GameState = {
    ...state,
    rooms: updatedRooms,
    players: updatedPlayers,
  };

  // Instant rooms resolve at placement time. We push the same forfeit-or-
  // reward prompt the resolution pump uses for non-instant rooms, then the
  // resume effect either runs the slot's effect or grants 1 IP and skips it.
  if (room.isInstantRoom && hasEffect(space.effectId)) {
    return pushResolutionChoicePrompt(placed, room, space, action.playerId);
  }

  return placed;
}

/**
 * Pushes the "take the reward (paying any merit cost) or forfeit for 1 IP"
 * prompt for the given action space. Used by both `pumpResolutionPhase`
 * (non-instant rooms, fired during the resolution phase) and
 * `handlePlaceWorker` (instant rooms, fired at placement).
 */
function pushResolutionChoicePrompt(
  state: GameState,
  room: Room,
  space: GameState['rooms'][number]['actionSpaces'][number],
  playerId: string,
): GameState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`pushResolutionChoicePrompt: player ${playerId} not found`);
  }
  const meritCost =
    space.slotType === 'merit' ? (space.costToActivate?.meritBadges ?? 0) : 0;
  const canAffordReward =
    meritCost === 0 || player.resources.meritBadges >= meritCost;

  const source: ResolutionSource = describeSpaceSource(
    space.id,
    room.name,
    room.side,
    space.index,
    playerId,
  );
  const promptInput: PendingResolutionInput = {
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        canAffordReward
          ? {
              id: 'reward',
              label:
                meritCost > 0
                  ? `Take reward (spend ${meritCost} MB)`
                  : 'Take reward',
              payload: {},
              available: true,
            }
          : {
              id: 'reward',
              label: `Take reward (spend ${meritCost} MB)`,
              payload: {},
              available: false,
              unavailableReason: `requires ${meritCost} Merit Badge${meritCost === 1 ? '' : 's'} (you have ${player.resources.meritBadges})`,
            },
        { id: 'forfeit', label: 'Forfeit for 1 IP', payload: {} },
      ],
    },
    resume: {
      effectId: 'base.system.resolution-choice',
      context: {
        spaceId: space.id,
        innerEffectId: space.effectId,
        meritCost,
      },
    },
    source,
  };
  return pushPending(state, promptInput);
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
  state = consumeActionBudget(state, 'action', 'BUY_VAULT_CARD');
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
  // Ars Magna is a Sorcery Mage power that fires on placement; until the
  // place-time trigger is fully wired, USE_ABILITY stands in for it and
  // consumes the player's Regular Action. The rulebook lists Mage Powers
  // with "Place" timing — the placement itself is the Action, the power
  // rides along.
  state = consumeActionBudget(state, 'action', 'USE_ABILITY');
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

  const cardDef = lookupSpellCardDef(state, action.spellCardId);
  if (!cardDef) throw new Error(`CAST_SPELL: spell card ${action.spellCardId} not in active packs`);
  const levelDef = cardDef.levels[action.level - 1];
  if (!levelDef) throw new Error(`CAST_SPELL: invalid level ${action.level}`);

  // Unique (leader) spells have no L2/L3 to research; their L1 is always
  // available since `intPlaced` is set at candidate allocation. Regular
  // spell books still gate on the research flags.
  if (!cardDef.unique) {
    if (action.level === 1 && !owned.intPlaced) {
      throw new Error(`CAST_SPELL: spell L1 not researched`);
    }
    if (action.level === 2 && !owned.wisPlacedLevel2) {
      throw new Error(`CAST_SPELL: spell L2 not researched`);
    }
    if (action.level === 3 && !owned.wisPlacedLevel3) {
      throw new Error(`CAST_SPELL: spell L3 not researched`);
    }
  }

  if (player.resources.mana < levelDef.manaCost) {
    throw new Error(
      `CAST_SPELL: insufficient mana (need ${levelDef.manaCost}, have ${player.resources.mana})`,
    );
  }
  if (levelDef.timing === 'reaction') {
    throw new Error(
      'CAST_SPELL: reaction-timing spells fire from a reaction window, not as a direct action',
    );
  }

  // Consume the appropriate per-turn budget slot (action vs fast-action) per
  // the level's timing.
  state = consumeActionBudget(
    state,
    levelDef.timing === 'fast-action' ? 'fast-action' : 'action',
    'CAST_SPELL',
  );

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

function handleChooseCandidate(
  state: GameState,
  action: ChooseCandidateAction,
): GameState {
  if (state.phase.kind !== 'candidate-draft') {
    throw new Error(
      `CHOOSE_CANDIDATE: only valid during candidate-draft phase (current: ${state.phase.kind})`,
    );
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `CHOOSE_CANDIDATE: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error(`CHOOSE_CANDIDATE: player ${action.playerId} not found`);
  if (player.candidateId !== '') {
    throw new Error(`CHOOSE_CANDIDATE: player ${action.playerId} already chose a candidate`);
  }

  const candidate = lookupCandidate(state, action.candidateId);
  if (!candidate) {
    throw new Error(
      `CHOOSE_CANDIDATE: candidate "${action.candidateId}" not in active packs`,
    );
  }
  const taken = state.players.some(
    (p) => p.id !== action.playerId && p.candidateId === action.candidateId,
  );
  if (taken) {
    throw new Error(
      `CHOOSE_CANDIDATE: candidate "${action.candidateId}" already taken`,
    );
  }

  const allocated = applyCandidateAllocation(state, action.playerId, candidate);

  // Find the next un-chosen player in turn order; transition out of the
  // candidate draft when everyone has picked.
  const nPlayers = allocated.players.length;
  const startIdx = state.phase.activePlayerIndex;
  let nextIdx = startIdx;
  let allChosen = true;
  for (let step = 1; step <= nPlayers; step++) {
    const idx = (startIdx + step) % nPlayers;
    if (allocated.players[idx]?.candidateId === '') {
      nextIdx = idx;
      allChosen = false;
      break;
    }
  }

  if (!allChosen) {
    return {
      ...allocated,
      phase: { kind: 'candidate-draft', activePlayerIndex: nextIdx },
    };
  }

  // Everyone has picked. 2-player games hand the draft-order choice to the
  // 2nd leader-picker (the player who just picked, i.e. `action.playerId`).
  // 3+ player games skip the choice and use the leader-pick order as the
  // draft order.
  if (nPlayers === 2) {
    return {
      ...allocated,
      phase: { kind: 'mage-draft-first-choice', chooserIndex: startIdx },
    };
  }
  const firstLeaderPickerIdx = state.firstPlayerIndex;
  return {
    ...allocated,
    phase: {
      kind: 'mage-draft',
      pickOrder: buildSnakeDraftOrder(nPlayers, firstLeaderPickerIdx),
      nextPickIndex: 0,
    },
  };
}

function handleChooseDraftFirst(
  state: GameState,
  action: ChooseDraftFirstAction,
): GameState {
  if (state.phase.kind !== 'mage-draft-first-choice') {
    throw new Error(
      `CHOOSE_DRAFT_FIRST: only valid during mage-draft-first-choice phase (current: ${state.phase.kind})`,
    );
  }
  const chooserId = state.players[state.phase.chooserIndex]?.id;
  if (chooserId !== action.playerId) {
    throw new Error(
      `CHOOSE_DRAFT_FIRST: only ${chooserId ?? '?'} may make this choice (you=${action.playerId})`,
    );
  }
  const firstDrafterIdx = action.draftFirst
    ? state.phase.chooserIndex
    : (state.phase.chooserIndex + 1) % state.players.length;
  return {
    ...state,
    phase: {
      kind: 'mage-draft',
      pickOrder: buildSnakeDraftOrder(state.players.length, firstDrafterIdx),
      nextPickIndex: 0,
    },
  };
}

function handleDraftMage(state: GameState, action: DraftMageAction): GameState {
  if (state.phase.kind !== 'mage-draft') {
    throw new Error(
      `DRAFT_MAGE: only valid during mage-draft phase (current: ${state.phase.kind})`,
    );
  }
  const phase = state.phase;
  if (phase.nextPickIndex >= phase.pickOrder.length) {
    throw new Error('DRAFT_MAGE: all draft picks already resolved');
  }
  const expectedPlayerIdx = phase.pickOrder[phase.nextPickIndex];
  const expectedPlayerId = state.players[expectedPlayerIdx!]?.id;
  if (expectedPlayerId !== action.playerId) {
    throw new Error(
      `DRAFT_MAGE: not your pick (active=${expectedPlayerId ?? '?'}, you=${action.playerId})`,
    );
  }
  const remaining = state.mageDraftPool[action.color] ?? 0;
  if (remaining < 1) {
    throw new Error(
      `DRAFT_MAGE: no ${action.color} mages left in the pool`,
    );
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error(`DRAFT_MAGE: player ${action.playerId} not found`);
  const ownedOfColor = player.mages.filter((m) => m.color === action.color).length;
  if (ownedOfColor >= 2) {
    throw new Error(
      `DRAFT_MAGE: cannot have more than 2 ${action.color} mages (already have ${ownedOfColor})`,
    );
  }

  const seq = state.nextSequenceId;
  const newMage: OwnedMage = {
    id: `m-${seq}`,
    cardId: MAGE_CARD_BY_COLOR[action.color],
    color: action.color,
    location: { kind: 'office', playerId: action.playerId },
    isShadowing: false,
    isWounded: false,
  };

  const updated: GameState = {
    ...state,
    nextSequenceId: seq + 1,
    mageDraftPool: { ...state.mageDraftPool, [action.color]: remaining - 1 },
    players: state.players.map((p) =>
      p.id !== action.playerId ? p : { ...p, mages: [...p.mages, newMage] },
    ),
    phase: { ...phase, nextPickIndex: phase.nextPickIndex + 1 },
  };

  // If that was the last pick, transition into the initial-mark placement
  // step so every player puts their starting Mark on a Voter.
  if (updated.phase.kind === 'mage-draft' && updated.phase.nextPickIndex >= phase.pickOrder.length) {
    return enterInitialMarkPlacement(updated);
  }
  return updated;
}

/**
 * Transitions into the initial-mark-placement phase: sets the active player
 * to `firstPlayerIndex` and pushes their choose-voter prompt. When the
 * prompt resolves via `base.system.initial-mark`, the resume effect either
 * advances to the next player or transitions to round-setup.
 */
function enterInitialMarkPlacement(state: GameState): GameState {
  const firstIdx = state.firstPlayerIndex;
  const player = state.players[firstIdx];
  if (!player) {
    // No players? Just bypass straight to round-setup.
    return { ...state, phase: { kind: 'round-setup', round: 1 } };
  }
  const next: GameState = {
    ...state,
    phase: { kind: 'initial-mark-placement', activePlayerIndex: firstIdx },
  };
  return pushPending(next, {
    responderId: player.id,
    prompt: {
      kind: 'choose-voter',
      eligibleVoterIds: next.voters.map((v) => v.id),
    },
    resume: { effectId: 'base.system.initial-mark', context: {} },
    source: {
      kind: 'system',
      id: 'base.system.initial-mark',
      triggeringPlayerId: player.id,
      description: 'Place your starting Mark',
    },
  });
}

/**
 * PASS_TURN: explicit "I forfeit my Action this turn" — consumes the Action
 * budget and advances to the next player. The Fast Action is also surrendered;
 * passing means giving up the whole turn per Argent rules.
 */
function handlePassTurn(state: GameState, action: PassTurnAction): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('PASS_TURN: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('PASS_TURN: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `PASS_TURN: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const passed: GameState = {
    ...state,
    phase: { ...state.phase, actionUsed: true },
  };
  return processErrandsAdvance(passed);
}

/**
 * PLAY_SUPPORTER: spend the supporter from the player's office to invoke its
 * effect. Consumes Action or Fast-Action budget based on the card's timing,
 * moves the card to the personal discard pile, and dispatches to the effect.
 *
 * Reaction- and passive-timing supporters cannot be played as actions.
 * Reaction supporters fire from a reaction window; passive supporters
 * (familiars) sit in the office for endgame scoring.
 */
function handlePlaySupporter(
  state: GameState,
  action: PlaySupporterAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('PLAY_SUPPORTER: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('PLAY_SUPPORTER: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `PLAY_SUPPORTER: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error(`PLAY_SUPPORTER: player ${action.playerId} not found`);
  if (!player.supporters.includes(action.supporterCardId)) {
    throw new Error(
      `PLAY_SUPPORTER: ${action.supporterCardId} not in your office`,
    );
  }
  const card = lookupSupporterCardDef(state, action.supporterCardId);
  if (!card) {
    throw new Error(
      `PLAY_SUPPORTER: supporter ${action.supporterCardId} not in active packs`,
    );
  }
  if (card.timing === 'reaction') {
    throw new Error(
      'PLAY_SUPPORTER: reaction supporters fire from a reaction window, not as a direct action',
    );
  }
  if (card.timing === 'passive' || card.timing === 'endgame') {
    throw new Error(
      `PLAY_SUPPORTER: ${card.name} (${card.timing}) cannot be played as an action`,
    );
  }

  state = consumeActionBudget(
    state,
    card.timing === 'fast-action' ? 'fast-action' : 'action',
    'PLAY_SUPPORTER',
  );

  // Move the card from office → personal discard.
  const consumed: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.id !== action.playerId
        ? p
        : {
            ...p,
            supporters: p.supporters.filter((id) => id !== action.supporterCardId),
            personalDiscard: [
              ...p.personalDiscard,
              { kind: 'supporter' as const, cardId: action.supporterCardId },
            ],
          },
    ),
  };

  if (!hasEffect(card.effectId)) {
    // Effect not yet implemented — card is consumed but does nothing.
    return consumed;
  }
  const source: ResolutionSource = {
    kind: 'supporter',
    id: card.id,
    triggeringPlayerId: action.playerId,
    description: card.name,
  };
  const ctx: EffectContext = {
    state: consumed,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
  };
  const result = getEffect(card.effectId)(ctx);
  return applyEffectResult(consumed, result, ctx);
}

/**
 * PLAY_VAULT_CARD: use a vault card the player owns. Treasure cards get
 * marked exhausted (refresh at round-start); consumables are removed from
 * the player's vault cards and added to their personal discard pile.
 *
 * Only `action` / `fast-action` timing cards are playable through this
 * handler. Reaction-timing cards fire from a reaction window via the
 * reaction-options mechanism.
 */
function handlePlayVaultCard(
  state: GameState,
  action: PlayVaultCardAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('PLAY_VAULT_CARD: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('PLAY_VAULT_CARD: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `PLAY_VAULT_CARD: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error(`PLAY_VAULT_CARD: player ${action.playerId} not found`);

  const card = lookupVaultCardDef(state, action.vaultCardId);
  if (!card) {
    throw new Error(
      `PLAY_VAULT_CARD: vault card ${action.vaultCardId} not in active packs`,
    );
  }
  if (card.timing === 'reaction') {
    throw new Error(
      'PLAY_VAULT_CARD: reaction-timing vault cards fire from a reaction window, not as a direct action',
    );
  }

  // Find the first unexhausted copy in the player's vault.
  const ownedIdx = player.vaultCards.findIndex(
    (v) => v.cardId === action.vaultCardId && !v.exhausted,
  );
  if (ownedIdx === -1) {
    throw new Error(
      `PLAY_VAULT_CARD: ${action.vaultCardId} not in your vault (or all copies exhausted)`,
    );
  }

  state = consumeActionBudget(
    state,
    card.timing === 'fast-action' ? 'fast-action' : 'action',
    'PLAY_VAULT_CARD',
  );

  // Treasures exhaust in place; consumables go to discard.
  const consumed: GameState = {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== action.playerId) return p;
      if (card.type === 'treasure') {
        return {
          ...p,
          vaultCards: p.vaultCards.map((v, i) =>
            i === ownedIdx ? { ...v, exhausted: true } : v,
          ),
        };
      }
      // consumable
      return {
        ...p,
        vaultCards: p.vaultCards.filter((_, i) => i !== ownedIdx),
        personalDiscard: [
          ...p.personalDiscard,
          { kind: 'consumable' as const, cardId: action.vaultCardId },
        ],
      };
    }),
  };

  if (!hasEffect(card.effectId)) {
    // Effect not yet wired — card is still spent.
    return consumed;
  }
  const source: ResolutionSource = {
    kind: 'vault-card',
    id: card.id,
    triggeringPlayerId: action.playerId,
    description: card.name,
  };
  const ctx: EffectContext = {
    state: consumed,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
  };
  const result = getEffect(card.effectId)(ctx);
  return applyEffectResult(consumed, result, ctx);
}

function handleClaimBellTower(
  state: GameState,
  action: ClaimBellTowerAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('CLAIM_BELL_TOWER: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error('CLAIM_BELL_TOWER: resolve pending prompt first');
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `CLAIM_BELL_TOWER: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const card = state.bellTower.available.find(
    (c) => c.id === action.bellTowerCardId,
  );
  if (!card) {
    throw new Error(
      `CLAIM_BELL_TOWER: card ${action.bellTowerCardId} not in bell tower`,
    );
  }
  state = consumeActionBudget(state, 'action', 'CLAIM_BELL_TOWER');

  const claimed: GameState = {
    ...state,
    bellTower: {
      available: state.bellTower.available.filter((c) => c.id !== card.id),
      taken: [...state.bellTower.taken, { cardId: card.id, takenBy: action.playerId }],
    },
    players: state.players.map((p) =>
      p.id !== action.playerId
        ? p
        : { ...p, bellTowerCards: [...p.bellTowerCards, card.id] },
    ),
  };

  if (!hasEffect(card.effectId)) return claimed;
  const source: ResolutionSource = {
    kind: 'bell-tower',
    id: card.id,
    triggeringPlayerId: action.playerId,
    description: card.name,
  };
  const ctx: EffectContext = {
    state: claimed,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
  };
  const result = getEffect(card.effectId)(ctx);
  return applyEffectResult(claimed, result, ctx);
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

function lookupSupporterCardDef(
  state: GameState,
  supporterId: string,
): SupporterCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.supporters.find((s) => s.id === supporterId);
    if (found) return found;
  }
  return null;
}

function lookupVaultCardDef(
  state: GameState,
  vaultId: string,
): VaultCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.vaultCards.find((v) => v.id === vaultId);
    if (found) return found;
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
    case 'candidate-draft':
      throw new Error(
        'ADVANCE_PHASE: candidate-draft must end via CHOOSE_CANDIDATE for each player',
      );
    case 'mage-draft-first-choice':
      throw new Error(
        'ADVANCE_PHASE: mage-draft-first-choice must end via CHOOSE_DRAFT_FIRST',
      );
    case 'mage-draft':
      throw new Error(
        'ADVANCE_PHASE: mage-draft must end via DRAFT_MAGE for each pick',
      );
    case 'initial-mark-placement':
      throw new Error(
        'ADVANCE_PHASE: initial-mark-placement must end via RESOLVE_PENDING for each player',
      );
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
    updated = healInfirmaryMages(updated);
  }
  return {
    ...updated,
    phase: {
      kind: 'errands',
      round,
      activePlayerIndex: state.firstPlayerIndex,
      actionUsed: false,
      fastActionUsed: false,
    },
  };
}

/**
 * Per the rulebook, every wounded Mage returns to its owner's Office at the
 * start of each new round. Run as part of `processRoundSetup` for rounds 2+.
 */
function healInfirmaryMages(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      mages: p.mages.map((m) =>
        m.location.kind === 'infirmary'
          ? {
              ...m,
              isWounded: false,
              isShadowing: false,
              location: { kind: 'office' as const, playerId: p.id },
            }
          : m,
      ),
    })),
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
    roundPlacements: [],
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
    phase: {
      ...state.phase,
      activePlayerIndex: next,
      actionUsed: false,
      fastActionUsed: false,
    },
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
