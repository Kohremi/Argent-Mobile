// Pure game engine. No React, no DOM, no I/O.
// Everything here is deterministic given (state, action). All randomness
// lives in state.rng, all id generation in state.nextSequenceId.

import { getPack } from '../content/registry';
import { validateAction } from './actions';
import { computeFinalScoring, playerOwnsWildSupporter } from './scoring';
import { buildInitialState } from './setup';
import { getEffect, hasEffect } from './effects/index';
import {
  applyCandidateAllocation,
  buildReactionOptionsFor,
  buildReactionQueue,
  actsAsColor,
  buildSnakeDraftOrder,
  canArsMagnaTakeSpace,
  clearInfirmaryBSlots,
  countPlayerMagesInRoom,
  describeSpaceSource,
  magesLosePowers,
  lookupCandidate,
  MAGE_CARD_BY_COLOR,
  placementsBlocked,
  spellManaDiscountFor,
  spellManaSurchargesAgainst,
  spellsBlocked,
  woundMage,
} from './effects/helpers';
import { buildAdventuringBPickPrompt } from './effects/helpers';
import type {
  ActionSpace,
  BellTowerCard,
  BellTowerCardId,
  BendTimeKind,
  BuyVaultCardAction,
  DiscardBonusActionsAction,
  CastSpellAction,
  ChooseCandidateAction,
  ChooseDraftFirstAction,
  ClaimBellTowerAction,
  ConsortiumVoter,
  DraftMageAction,
  PlaySupporterAction,
  PlayVaultCardAction,
  ShadowOnPlaceBuff,
  SupporterCard,
  VaultCard,
  EffectContext,
  EffectResult,
  GameAction,
  GameConfig,
  GamePhase,
  GameState,
  GameStatePatch,
  OwnedMage,
  PassTurnAction,
  PendingResolution,
  PendingResolutionInput,
  PlaceWorkerAction,
  Player,
  PlayerId,
  ReactionTriggerEvent,
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
  WorkerOccupancy,
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
    case 'DISCARD_BONUS_ACTIONS':
      next = handleDiscardBonusActions(state, action);
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
  bendTimeKind?: BendTimeKind,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error(`${label}: only valid during errands phase`);
  }
  if (kind === 'action') {
    if (state.phase.actionUsed) {
      // Bonus actions (Flare / Dazzle / Bend Time) cover the spend after
      // the base Action is gone — decrement the counter and let the action
      // through. Under Bend Time, also enforce "each must be a different
      // type" against the bendTimeUsedKinds tracker.
      const bonus = state.phase.extraActions ?? 0;
      if (bonus > 0) {
        const used = state.phase.bendTimeUsedKinds;
        if (used) {
          // Under Bend Time, the bonus action must be one of the 4 named
          // types (place / spell / supporter / vault) and each may be used
          // at most once.
          if (!bendTimeKind) {
            throw new Error(
              `${label}: Bend Time — only Place / Cast Spell / Play Supporter / Play Vault Card count as bonus actions`,
            );
          }
          if (used.includes(bendTimeKind)) {
            throw new Error(
              `${label}: Bend Time — already used a ${bendTimeKind} action this turn`,
            );
          }
          return {
            ...state,
            phase: {
              ...state.phase,
              extraActions: bonus - 1,
              bendTimeUsedKinds: [...used, bendTimeKind],
            },
          };
        }
        return {
          ...state,
          phase: { ...state.phase, extraActions: bonus - 1 },
        };
      }
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
 * Surfaces the next queued Research prompt if the resolution stack is
 * otherwise idle. Cards that grant N Research push N entries into
 * `state.researchQueue`; this drains one entry per call. Each surfaced
 * prompt is built against the current (post-previous-research) state, so
 * options reflect the player's actual pool / spellbook at that moment.
 *
 * Returns the same state if there's nothing to drain or another prompt /
 * reaction is still active.
 */
function drainResearchQueueIfIdle(state: GameState): GameState {
  if (state.researchQueue.length === 0) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  const [next, ...rest] = state.researchQueue;
  if (!next) return state;
  const withoutEntry: GameState = { ...state, researchQueue: rest };
  // Invoke the spawn-research-prompt effect; it returns a pause carrying
  // a fresh prompt scoped to the queued player.
  const ctx: EffectContext = {
    state: withoutEntry,
    source: next.source,
    triggeringPlayerId: next.playerId,
    allowReactions: false,
    ...(next.restrictDepartment !== undefined
      ? { resumeContext: { restrictDepartment: next.restrictDepartment } }
      : {}),
  };
  const result = getEffect('base.system.spawn-research-prompt')(ctx);
  return applyEffectResult(withoutEntry, result, ctx);
}

/**
 * Opens a `bell-tower-last-claimed` reaction window once the claim's own
 * effect chain has fully resolved (stack idle, no nested reaction windows).
 * Triggers Tardy / Stop Time for opponents who have those spells researched
 * and unexhausted. Cleared on open so it fires at most once per claim.
 */
function drainBellTowerLastEventIfIdle(state: GameState): GameState {
  if (!state.pendingBellTowerLastEvent) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  const pending = state.pendingBellTowerLastEvent;
  const withoutPending: GameState = { ...state, pendingBellTowerLastEvent: null };

  const triggerEvent: ReactionTriggerEvent = {
    kind: 'bell-tower-last-claimed',
    cardId: pending.cardId,
    byPlayerId: pending.byPlayerId,
  };

  // Reaction order: all OTHER players in turn order starting from the claimer.
  // Filter to only those with at least one applicable option — otherwise the
  // window would surface an empty "pass only" prompt that gates the turn for
  // no reason. Tardy and Stop Time are the only reactions for this event.
  const claimerIndex = withoutPending.players.findIndex(
    (p) => p.id === pending.byPlayerId,
  );
  const responderIds: PlayerId[] = [];
  if (claimerIndex >= 0) {
    for (let i = 1; i <= withoutPending.players.length; i++) {
      const p =
        withoutPending.players[(claimerIndex + i) % withoutPending.players.length];
      if (!p || p.id === pending.byPlayerId) continue;
      const opts = buildReactionOptionsFor(
        withoutPending,
        p.id,
        [triggerEvent],
        pending.source,
      );
      if (opts.length > 0) responderIds.push(p.id);
    }
  }

  if (responderIds.length === 0) return withoutPending;

  const result: EffectResult = {
    kind: 'open-reaction',
    window: {
      triggerEvents: [triggerEvent],
      pendingResponderIds: responderIds,
      reactedPlayerIds: [],
      afterResume: {
        effectId: 'base.system.noop',
        context: {},
      },
      source: pending.source,
    },
  };
  const ctx: EffectContext = {
    state: withoutPending,
    source: pending.source,
    triggeringPlayerId: pending.byPlayerId,
    allowReactions: true,
  };
  return applyEffectResult(withoutPending, result, ctx);
}

/**
 * Surfaces the next placement in a "place a Mage without using Mage powers"
 * chain (Stop Time) once the previous placement's effect chain (including
 * any instant-room reward) has fully resolved and the resolution stack /
 * reaction windows are idle. Decrements `remaining`; clears the chain
 * when it hits zero.
 */
function drainPendingPlaceChainIfIdle(state: GameState): GameState {
  const chain = state.pendingPlaceChain;
  if (!chain) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  if (chain.remaining <= 0) {
    return { ...state, pendingPlaceChain: null };
  }
  const decremented: GameState = {
    ...state,
    pendingPlaceChain: { ...chain, remaining: chain.remaining - 1 },
  };
  const ctx: EffectContext = {
    state: decremented,
    source: chain.source,
    triggeringPlayerId: chain.playerId,
    allowReactions: false,
  };
  const result = getEffect('base.system.place-mage-without-powers')(ctx);
  return applyEffectResult(decremented, result, ctx);
}

/**
 * Surfaces the next Research opportunity in a The Contract chain. The
 * first non-discard pick locks the department for the remaining picks
 * (research-draft / research-add-wis populate `lockedDepartment` after
 * the player drafts or upgrades a spell — see those effects).
 */
function drainContractResearchIfIdle(state: GameState): GameState {
  const chain = state.pendingContractResearch;
  if (!chain) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  if (chain.remaining <= 0) {
    return { ...state, pendingContractResearch: null };
  }
  const decremented: GameState = {
    ...state,
    pendingContractResearch: { ...chain, remaining: chain.remaining - 1 },
  };
  const ctx: EffectContext = {
    state: decremented,
    source: chain.source,
    triggeringPlayerId: chain.playerId,
    allowReactions: false,
    resumeContext: {
      contractChain: true,
      ...(chain.lockedDepartment !== undefined
        ? { restrictDepartment: chain.lockedDepartment }
        : {}),
    },
  };
  const result = getEffect('base.system.spawn-research-prompt')(ctx);
  return applyEffectResult(decremented, result, ctx);
}

/**
 * Drains a single entry from the Revival queue when the stack/reactions
 * are idle. Surfaces a Yes/No "move and heal this wounded mage to an open
 * slot" prompt for its owner. Quietly drops entries whose mage is no
 * longer wounded (a reaction may have restored it) or whose owner has
 * since lost the Revival buff.
 */
function drainRevivalCheckIfIdle(state: GameState): GameState {
  const queue = state.pendingRevivalChecks;
  if (queue.length === 0) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  const [next, ...rest] = queue;
  if (!next) return state;
  const withoutEntry: GameState = { ...state, pendingRevivalChecks: rest };
  const owner = withoutEntry.players.find((p) => p.id === next.ownerId);
  const mage = owner?.mages.find((m) => m.id === next.mageId);
  const stillRevivable =
    owner !== undefined &&
    mage !== undefined &&
    mage.isWounded &&
    mage.location.kind === 'infirmary' &&
    withoutEntry.activeBuffs.some(
      (b) => b.kind === 'revival' && b.casterPlayerId === owner.id,
    );
  if (!stillRevivable) return withoutEntry;
  const ctx: EffectContext = {
    state: withoutEntry,
    source: {
      kind: 'spell',
      id: 'base.spell.will-of-the-divines',
      triggeringPlayerId: owner.id,
      description: 'Revival',
    },
    triggeringPlayerId: owner.id,
    allowReactions: false,
    resumeContext: { mageId: next.mageId },
  };
  const result = getEffect('base.system.revival-prompt')(ctx);
  return applyEffectResult(withoutEntry, result, ctx);
}

/**
 * If the active player has spent their Regular Action and no prompts or
 * reaction windows are still open, the turn ends automatically (per
 * rulebook). Called at the end of every dispatch so that turns advance
 * without an explicit "end turn" action.
 *
 * Before advancing the turn, the research queue is drained one entry at
 * a time so multi-Research cards (Brilliance, Welsie Acktern, etc.) get
 * each opportunity surfaced in sequence.
 */
function autoAdvanceIfTurnDone(state: GameState): GameState {
  // Open the bell-tower-last-claimed reaction window first if pending —
  // it lets opponents react before the active player's regular action ends.
  state = drainBellTowerLastEventIfIdle(state);
  // Then surface the next placement in a Stop Time chain (if any) — its
  // first placement may have left a pending entry once its instant-reward
  // chain resolved.
  state = drainPendingPlaceChainIfIdle(state);
  // Mysticism post-cast trigger: queued at CAST_SPELL time, fires once
  // the spell's full chain (prompts + reactions + place chain) settles.
  // Drained AFTER pendingPlaceChain so multi-placement spells (Slow Time)
  // finish all placements before this surfaces. The drain itself either
  // pushes the Yes/No prompt or clears the flag silently.
  state = drainMysticismPostCastIfIdle(state);
  // Revival checks fire after the wound's reaction window and bonus chain
  // have settled — surface them before any further chain advancement so the
  // owner can re-place their wounded mage immediately.
  state = drainRevivalCheckIfIdle(state);
  // Technomancy (orange) post-placement trigger — same idle-drain
  // pattern as Mysticism post-cast: surfaces a "Pay 3 Gold to gain a
  // Research" prompt once the placement chain has fully settled.
  state = drainTechnomancyTriggerIfIdle(state);
  // Drain a queued research opportunity first — this may add to the stack,
  // in which case we stop and let the player resolve it before any further
  // turn advancement.
  state = drainResearchQueueIfIdle(state);
  // The Contract chain is parallel to the regular research queue — drain
  // one entry per cycle. Its first non-discard pick locks the department
  // for the remaining picks.
  state = drainContractResearchIfIdle(state);
  if (state.phase.kind !== 'errands') return state;
  if (!state.phase.actionUsed) return state;
  // Bonus actions (Flare / Dazzle) hold the turn open after the base
  // Action is spent — the auto-advance waits until they're all gone too.
  if ((state.phase.extraActions ?? 0) > 0) return state;
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
  const reactionOptions = buildReactionOptionsFor(
    state,
    responderId,
    window.triggerEvents,
    window.source,
  );
  const promptInput: PendingResolutionInput = {
    responderId,
    prompt: {
      kind: 'reaction-window',
      triggerEvents: window.triggerEvents,
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
    // Drain queued research before resolving the next slot — a slot that
    // grants multi-Research (current data has none, but the path is wired)
    // would otherwise leave queue entries stranded once resolution ends.
    curr = drainResearchQueueIfIdle(curr);
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
      const position = phase.pendingSlotPosition ?? 'base';
      const occupant = currentOccupantAt(space, position);
      if (!space || !occupant) {
        curr = advanceSlotPosition(curr, space);
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
    const position = phase.pendingSlotPosition ?? 'base';
    const occupant = currentOccupantAt(space, position);
    if (!space || !occupant) {
      curr = advanceSlotPosition(curr, space);
      continue;
    }

    // Effect-less / unregistered slots: no reward to take, just complete.
    if (!hasEffect(space.effectId)) {
      curr = completeCurrentSpaceResolution(curr);
      continue;
    }

    // Push the forfeit-or-reward prompt and pause. The resume effect will
    // either deduct the merit cost (base position only) and invoke the slot's
    // real effect, or grant the player 1 IP and skip the effect.
    curr = pushResolutionChoicePrompt(
      curr,
      room,
      space,
      occupant.ownerId,
      position,
    );
    // Mark the slot's resolution chain as active so handleResolvePending's
    // auto-complete fires only for chain-ending resumes — not for side
    // prompts (e.g. queue-drained Research) that surface between slots.
    if (curr.phase.kind === 'resolution') {
      curr = {
        ...curr,
        phase: { ...curr.phase, slotInProgress: true },
      };
    }
    return curr;
  }
  throw new Error('pumpResolutionPhase: hit iteration cap');
}

function currentOccupantAt(
  space: ActionSpace | undefined,
  position: 'base' | 'shadow',
): WorkerOccupancy | null {
  if (!space) return null;
  return position === 'base' ? space.occupant : (space.shadowOccupant ?? null);
}

/**
 * Moves the position pointer forward when the current slot+position has no
 * occupant: base with no shadow → next slot; base with shadow → shadow;
 * shadow → next slot. `bumpRoom` advances past the current room entirely.
 */
function advanceSlotPosition(
  state: GameState,
  space: ActionSpace | undefined,
): GameState {
  if (state.phase.kind !== 'resolution') return state;
  const phase = state.phase;
  const position = phase.pendingSlotPosition ?? 'base';
  if (position === 'base' && space?.shadowOccupant) {
    return {
      ...state,
      phase: { ...phase, pendingSlotPosition: 'shadow' },
    };
  }
  return advanceResolutionPointer(state, false);
}

/** Advances pointer by one space (`bumpRoom` true skips the rest of the room). */
function advanceResolutionPointer(state: GameState, bumpRoom: boolean): GameState {
  if (state.phase.kind !== 'resolution') return state;
  const phase = state.phase;
  // When the pointer leaves a room with transient room-state, clean up.
  //   - Vault A: return revealed cards to the top of the Vault Deck.
  //   - Adventuring B: return undrafted pool cards to the BOTTOM of each
  //     respective deck and clear the pool ("discard at end of round").
  let next: GameState = state;
  const leavingRoom = bumpRoom ? state.rooms[phase.pendingRoomIndex] : undefined;
  if (
    bumpRoom &&
    state.vaultARevealed !== null &&
    leavingRoom?.id === 'base.room.vault.a'
  ) {
    next = {
      ...next,
      vaultDeck: [...state.vaultARevealed, ...state.vaultDeck],
      vaultARevealed: null,
    };
  }
  if (
    bumpRoom &&
    state.adventuringBPool !== null &&
    leavingRoom?.id === 'base.room.adventuring.b'
  ) {
    const pool = state.adventuringBPool;
    next = {
      ...next,
      spellDeck: [...next.spellDeck, ...pool.spells],
      vaultDeck: [...next.vaultDeck, ...pool.vaultCards],
      supporterDeck: [...next.supporterDeck, ...pool.supporters],
      adventuringBPool: null,
    };
  }
  return {
    ...next,
    phase: bumpRoom
      ? {
          ...phase,
          pendingRoomIndex: phase.pendingRoomIndex + 1,
          pendingSpaceIndex: 0,
          pendingSlotPosition: 'base',
          slotInProgress: false,
        }
      : {
          ...phase,
          pendingSpaceIndex: phase.pendingSpaceIndex + 1,
          pendingSlotPosition: 'base',
          slotInProgress: false,
        },
  };
}

/**
 * Returns the resolution-pointer space's mage (at the current position) to
 * its owner's office, clears the right occupant, advances the pointer
 * (base → shadow if shadow exists, otherwise next slot; shadow → next slot).
 */
function completeCurrentSpaceResolution(state: GameState): GameState {
  if (state.phase.kind !== 'resolution') return state;
  const phase = state.phase;
  const room = state.rooms[phase.pendingRoomIndex];
  if (!room) return state;
  const space = room.actionSpaces[phase.pendingSpaceIndex];
  const position = phase.pendingSlotPosition ?? 'base';
  const occupant = currentOccupantAt(space, position);
  if (!space || !occupant) return advanceSlotPosition(state, space);

  const advancingToShadow = position === 'base' && space.shadowOccupant != null;

  const updatedRooms = state.rooms.map((r, ri) =>
    ri !== phase.pendingRoomIndex
      ? r
      : {
          ...r,
          actionSpaces: r.actionSpaces.map((s, si) =>
            si !== phase.pendingSpaceIndex
              ? s
              : position === 'base'
                ? { ...s, occupant: null }
                : { ...s, shadowOccupant: null },
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
    phase: advancingToShadow
      ? { ...phase, pendingSlotPosition: 'shadow', slotInProgress: false }
      : {
          ...phase,
          pendingSpaceIndex: phase.pendingSpaceIndex + 1,
          pendingSlotPosition: 'base',
          slotInProgress: false,
        },
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
  // Malaise (The Darkness Within L1) blocks all placements globally.
  if (placementsBlocked(state)) {
    throw new Error('PLACE_WORKER: Malaise — Mages cannot be placed');
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

  // Shadow-on-place buff (Zero Hour / Inversion) lets the caster target a
  // slot's shadow position instead of its base. Inversion makes shadowing
  // mandatory — base placement is rejected while it's active, except in
  // rooms with `noShadowSlots: true` (Great Hall), which have no shadow
  // position to target; placements there go to the base normally.
  const shadowBuff = state.activeBuffs.find(
    (b): b is ShadowOnPlaceBuff =>
      b.kind === 'shadow-on-place' && b.casterPlayerId === action.playerId,
  );
  const requestedShadow = action.isShadowing === true;
  if (
    shadowBuff?.mode === 'mandatory' &&
    !requestedShadow &&
    !room.noShadowSlots
  ) {
    throw new Error(
      `PLACE_WORKER: ${shadowBuff.label} requires shadow placement`,
    );
  }
  if (requestedShadow && room.noShadowSlots) {
    throw new Error(
      `PLACE_WORKER: ${room.name} has no shadow position`,
    );
  }
  if (requestedShadow && !shadowBuff) {
    throw new Error(
      'PLACE_WORKER: shadow placement requires a shadow-on-place buff (Zero Hour / Inversion)',
    );
  }

  // Red (Sorcery) mages may place on an OCCUPIED slot if they can pay
  // 1 mana and the occupant is a valid Ars Magna target (opposing, not
  // wounded, not green, not blue). All other placements require an empty
  // slot.
  const isArsMagnaPlacement =
    !requestedShadow &&
    actsAsColor(mage, 'red') &&
    canArsMagnaTakeSpace(state, action.playerId, space);
  if (!requestedShadow && space.occupant && !isArsMagnaPlacement) {
    throw new Error(`PLACE_WORKER: space ${space.id} already occupied`);
  }
  if (
    !requestedShadow &&
    (space.slotType === 'shadow' || space.slotType === 'shadow-merit')
  ) {
    // TODO: shadow placement requires choosing which occupied slot to copy.
    throw new Error(
      `PLACE_WORKER: slot type "${space.slotType}" not yet supported`,
    );
  }
  if (space.slotType === 'wound') {
    throw new Error(`PLACE_WORKER: slot type "wound" not yet supported`);
  }
  if (requestedShadow) {
    if (space.shadowOccupant) {
      throw new Error(
        `PLACE_WORKER: shadow position of ${space.id} already occupied`,
      );
    }
    // Zero Hour (optional mode) requires an opposing mage at the base
    // position. Inversion (mandatory) allows any shadow placement.
    if (shadowBuff!.mode === 'optional') {
      if (!space.occupant || space.occupant.ownerId === action.playerId) {
        throw new Error(
          `PLACE_WORKER: ${shadowBuff!.label} requires an opposing Mage at the base position`,
        );
      }
    }
  }

  // Merit-cost spaces are placeable even without enough Merit Badges. The
  // cost (and the choice to take the reward or forfeit for 1 IP) is deferred
  // to the resolution phase via `base.system.resolution-choice`. If the
  // player still can't afford the cost when the prompt fires, only the
  // forfeit option is available.

  const roomLimit = room.maxMagesPerPlayerPerRound ?? Infinity;
  if (Number.isFinite(roomLimit)) {
    const occupyingHere = countPlayerMagesInRoom(state, action.playerId, room.id);
    if (occupyingHere >= roomLimit) {
      throw new Error(
        `PLACE_WORKER: ${room.name} is at its per-round cap (${occupyingHere}/${roomLimit}) for ${action.playerId}`,
      );
    }
  }

  // Purple (Planar Studies) Mages place as a Fast Action by default, but
  // they CAN consume the Regular Action if the Fast Action has already
  // been used this turn (player chose to place a fast-action-eligible
  // mage late, e.g. after another fast action). Everyone else always
  // consumes the Action budget.
  let budgetKind: ActionBudgetKind = 'action';
  if (actsAsColor(mage, 'purple') && !magesLosePowers(state)) {
    // Mesmerize disables purple's fast-action placement; otherwise prefer
    // fast-action (falling back to the regular action if the fast was
    // already spent this turn).
    budgetKind = state.phase.fastActionUsed ? 'action' : 'fast-action';
  }
  state = consumeActionBudget(
    state,
    budgetKind,
    'PLACE_WORKER',
    budgetKind === 'action' ? 'place' : undefined,
  );

  // Shadow-on-place placement: drop the mage into the slot's shadow
  // position. If the base position is occupied, the base occupant is
  // shadowed (mage-shadowed event opens a reaction window for the affected
  // owner). Shadowing over an empty base (Inversion-only) is just a
  // placement — no event.
  if (requestedShadow) {
    const baseOccupant = space.occupant;
    const updatedRooms = state.rooms.map((r, ri) =>
      ri !== foundRoomIdx
        ? r
        : {
            ...r,
            actionSpaces: r.actionSpaces.map((sp, si) =>
              si !== foundSpaceIdx
                ? sp
                : {
                    ...sp,
                    shadowOccupant: {
                      mageId: action.mageId,
                      ownerId: action.playerId,
                      isShadowing: true,
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
                isShadowing: true,
              },
        ),
      };
    });
    const placed: GameState = {
      ...state,
      rooms: updatedRooms,
      players: updatedPlayers,
    };
    // Instant rooms resolve at placement time. The shadow occupant gets
    // the same forfeit-or-reward prompt as a base occupant, except shadow
    // never pays the slot's merit cost (handled inside the helper). When
    // an opposing mage holds the base, the reaction window is opened on
    // top — the reward prompt waits on the stack until the window closes.
    const withInstantPrompt =
      room.isInstantRoom && hasEffect(space.effectId)
        ? pushResolutionChoicePrompt(
            placed,
            room,
            space,
            action.playerId,
            'shadow',
          )
        : placed;
    const withAdventuring = adventuringBPlacedHook(
      withInstantPrompt,
      room,
      action.playerId,
    );
    if (!baseOccupant) {
      return withAdventuring;
    }
    const event: ReactionTriggerEvent = {
      kind: 'mage-shadowed',
      mageId: baseOccupant.mageId,
      ownerId: baseOccupant.ownerId,
      byPlayerId: action.playerId,
      spaceId: space.id,
    };
    const source: ResolutionSource = {
      kind: 'spell',
      id: shadowBuff!.spellCardId,
      triggeringPlayerId: action.playerId,
      description: shadowBuff!.label,
    };
    const ctx: EffectContext = {
      state: withAdventuring,
      source,
      triggeringPlayerId: action.playerId,
      allowReactions: true,
    };
    const result: EffectResult = {
      kind: 'open-reaction',
      window: {
        triggerEvents: [event],
        pendingResponderIds: buildReactionQueue(
          withAdventuring,
          action.playerId,
        ),
        reactedPlayerIds: [],
        afterResume: { effectId: 'base.system.noop', context: {} },
        source,
      },
    };
    return applyEffectResult(withAdventuring, result, ctx);
  }

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
        triggerEvents: [wounded.triggerEvent],
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
    };
  });

  // Technomancy (orange) post-placement trigger — queued here so it
  // fires AFTER the instant-room reward chain (and the resolution-stack)
  // settles, mirroring the Mysticism post-cast pattern. This keeps the
  // ability out of the placement action itself. The Archmage's
  // Apprentice acts as orange (and every department colour), so
  // placing it ALSO queues the Technomancy trigger when Mancers is
  // active — but only if the Mancers pack is seated, since the
  // Apprentice exists in non-Mancers games too.
  const triggersTechnomancy =
    actsAsColor(mage, 'orange') &&
    state.activePackIds.includes('mancers');
  const pendingTechnomancyTrigger = triggersTechnomancy
    ? [
        ...state.pendingTechnomancyTrigger,
        { playerId: action.playerId, roomId: room.id },
      ]
    : state.pendingTechnomancyTrigger;

  const placed: GameState = {
    ...state,
    rooms: updatedRooms,
    players: updatedPlayers,
    pendingTechnomancyTrigger,
  };

  // Instant rooms resolve at placement time. We push the same forfeit-or-
  // reward prompt the resolution pump uses for non-instant rooms, then the
  // resume effect either runs the slot's effect or grants 1 IP and skips it.
  if (room.isInstantRoom && hasEffect(space.effectId)) {
    const promptState = pushResolutionChoicePrompt(
      placed,
      room,
      space,
      action.playerId,
    );
    return adventuringBPlacedHook(promptState, room, action.playerId);
  }

  return adventuringBPlacedHook(placed, room, action.playerId);
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
  position: 'base' | 'shadow' = 'base',
): GameState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`pushResolutionChoicePrompt: player ${playerId} not found`);
  }
  // Shadow occupants don't pay the slot's merit cost — they didn't get there
  // via normal merit placement.
  const meritCost =
    position === 'base' && space.slotType === 'merit'
      ? (space.costToActivate?.meritBadges ?? 0)
      : 0;
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

/**
 * Adventuring Side B's on-place trigger. When a Mage is placed at any
 * slot of Adventuring B (base OR shadow), the placing player picks a
 * card type to add to the room's draft pool. The prompt is pushed onto
 * the pending stack here; the resume effect handles the deck-pop and
 * pool update.
 */
function adventuringBPlacedHook(
  state: GameState,
  room: Room,
  playerId: PlayerId,
): GameState {
  if (room.id !== 'base.room.adventuring.b') return state;
  return pushPending(state, buildAdventuringBPickPrompt(state, playerId));
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
  // Verify the buyer can either afford the cost outright OR has Auric
  // Catalyst available to waive it. The actual gold deduction happens
  // after the gold-payment reaction window resolves.
  const card = lookupVaultCardDef(state, action.vaultCardId);
  if (!card) {
    throw new Error(
      `BUY_VAULT_CARD: ${action.vaultCardId} not in active packs`,
    );
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) {
    throw new Error(`BUY_VAULT_CARD: player ${action.playerId} not found`);
  }
  const canAfford = player.resources.gold >= card.goldCost;
  const canCatalyst = player.vaultCards.some(
    (v) => v.cardId === 'base.vault.auric-catalyst' && !v.exhausted,
  );
  if (!canAfford && !canCatalyst) {
    throw new Error(
      `BUY_VAULT_CARD: insufficient gold (need ${card.goldCost}, have ${player.resources.gold})`,
    );
  }
  state = consumeActionBudget(state, 'action', 'BUY_VAULT_CARD');
  // Route through the vault-buy system effect which opens a
  // gold-payment-pending reaction window (Auric Catalyst opportunity)
  // before applying the buy.
  const source: ResolutionSource = {
    kind: 'system',
    id: 'base.system.vault-buy',
    triggeringPlayerId: action.playerId,
    description: `Buy ${card.name}`,
  };
  const ctx: EffectContext = {
    state,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
    resumeContext: {
      vaultCardId: action.vaultCardId,
      buyerId: action.playerId,
    },
  };
  const effect = getEffect('base.system.vault-buy');
  return applyEffectResult(state, effect(ctx), ctx);
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
  // Silence (Will of the Divines L2) blocks all Spell casts globally —
  // reaction-timing spells fired from a reaction window are unaffected
  // (they don't go through this handler).
  if (spellsBlocked(state)) {
    throw new Error('CAST_SPELL: Silence — Spells cannot be cast');
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

  // Mana Elixir (and similar) waive the cost of the very next spell this
  // turn. If the flag is set, the mana check is skipped and the cost zeros.
  // Sustained "spells cheaper" buffs (Power bell tower offering) shave more
  // off the printed cost, floored at 0. Energy Drain buffs owned by
  // opponents add a surcharge — opponents' Mana flows to those buff holders,
  // the caster still pays it as part of their cost.
  const discount = spellManaDiscountFor(state, action.playerId);
  const discountedCost = Math.max(0, levelDef.manaCost - discount);
  const surcharges = spellManaSurchargesAgainst(state, action.playerId);
  const surchargeTotal = surcharges.reduce((sum, s) => sum + s.amount, 0);
  const baseCost = player.nextSpellFreeMana ? 0 : discountedCost;
  const effectiveManaCost = baseCost + surchargeTotal;
  if (player.resources.mana < effectiveManaCost) {
    throw new Error(
      `CAST_SPELL: insufficient mana (need ${effectiveManaCost}, have ${player.resources.mana})`,
    );
  }
  if (levelDef.timing === 'reaction') {
    throw new Error(
      'CAST_SPELL: reaction-timing spells fire from a reaction window, not as a direct action',
    );
  }

  // Consume the appropriate per-turn budget slot (action vs fast-action) per
  // the level's timing. Tag the spend as 'spell' under Bend Time so the
  // "different type" tracker can enforce one spell per bend-time window.
  state = consumeActionBudget(
    state,
    levelDef.timing === 'fast-action' ? 'fast-action' : 'action',
    'CAST_SPELL',
    levelDef.timing === 'action' ? 'spell' : undefined,
  );

  // Spend mana, exhaust spell, consume the free-mana / no-exhaust buffs if
  // either was set. Concentration (`nextSpellSkipsExhaust`) leaves the cast
  // spell unexhausted; one-shot, cleared regardless of which spell was cast.
  // Energy Drain surcharges are added to each buff holder's mana pool — the
  // caster's surcharge spend physically becomes the buff holders' gain.
  const skipExhaust = player.nextSpellSkipsExhaust === true;
  const surchargeByPlayer = new Map<string, number>();
  for (const s of surcharges) {
    surchargeByPlayer.set(
      s.casterPlayerId,
      (surchargeByPlayer.get(s.casterPlayerId) ?? 0) + s.amount,
    );
  }
  let next: GameState = {
    ...state,
    players: state.players.map((p) => {
      if (p.id === action.playerId) {
        return {
          ...p,
          resources: {
            ...p.resources,
            mana: p.resources.mana - effectiveManaCost,
          },
          ownedSpells: p.ownedSpells.map((s) =>
            s.cardId !== action.spellCardId
              ? s
              : { ...s, exhausted: skipExhaust ? s.exhausted : true },
          ),
          nextSpellFreeMana: false,
          nextSpellSkipsExhaust: false,
        };
      }
      const gain = surchargeByPlayer.get(p.id) ?? 0;
      if (gain === 0) return p;
      return {
        ...p,
        resources: { ...p.resources, mana: p.resources.mana + gain },
      };
    }),
  };

  const source: ResolutionSource = {
    kind: 'spell',
    id: action.spellCardId,
    triggeringPlayerId: action.playerId,
    description: `${cardDef.name} L${action.level}`,
  };

  // Grey (Mysticism) mage ability: when a player casts a spell as a full
  // Action, they MAY place a grey office mage onto an open base slot AFTER
  // the spell fully resolves. Queue the trigger on `pendingMysticismPostCast`;
  // `drainMysticismPostCastIfIdle` evaluates eligibility (grey-in-office,
  // Malaise / Mesmerize gates) and pushes the Yes/No prompt only once the
  // spell's full resolution chain has settled. This is critical for spells
  // like Dark Pact whose chain banishes / returns mages to office — the
  // eligibility check has to see the post-resolution state, not the state
  // mid-chain.
  const withMysticismQueued: GameState =
    levelDef.timing === 'action'
      ? {
          ...next,
          pendingMysticismPostCast: [
            ...next.pendingMysticismPostCast,
            action.playerId,
          ],
        }
      : next;

  // Invoke the spell's effect.
  if (!hasEffect(levelDef.effectId)) {
    return withMysticismQueued;
  }
  const effect = getEffect(levelDef.effectId);
  const ctx: EffectContext = {
    state: withMysticismQueued,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
  };
  const result = effect(ctx);
  return applyEffectResult(withMysticismQueued, result, ctx);
}

/**
 * Surfaces the Mysticism "place after Action Spell" Yes/No prompt once
 * the casting spell's full resolution chain has settled (stack idle, no
 * active reactions, no pendingPlaceChain). Evaluates eligibility against
 * the CURRENT state — so spells that move a grey mage into office during
 * their own resolution (Dark Pact's banish, etc.) trigger correctly. The
 * trigger is cleared whether the prompt was actually pushed or skipped.
 *
 * Gates (any one suppresses the trigger):
 *   - Mesmerize (`mages-lose-powers`) — disables mage powers globally.
 *   - Malaise (`placements-blocked`) — disables all placements globally.
 *   - No unwounded grey mage in the caster's office.
 *
 * Mandatory shadow-on-place (Inversion) is NOT a suppress gate — the
 * post-cast effect itself detects the buff and offers shadow slots.
 */
function drainMysticismPostCastIfIdle(state: GameState): GameState {
  const queue = state.pendingMysticismPostCast;
  if (queue.length === 0) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  if (state.pendingPlaceChain !== null) return state;

  const [playerId, ...rest] = queue;
  if (playerId === undefined) return state;
  const cleared: GameState = { ...state, pendingMysticismPostCast: rest };
  if (magesLosePowers(cleared)) return cleared;
  if (placementsBlocked(cleared)) return cleared;
  const caster = cleared.players.find((p) => p.id === playerId);
  // The Archmage's Apprentice acts as every department colour — so a
  // caster holding the Apprentice (rather than a literal grey mage)
  // still qualifies for the Mysticism post-cast placement.
  const hasGrey =
    caster?.mages.some(
      (m) =>
        actsAsColor(m, 'grey') &&
        m.location.kind === 'office' &&
        !m.isWounded,
    ) ?? false;
  if (!hasGrey) return cleared;

  const minted = mintId(cleared, 'r');
  const pending: PendingResolution = {
    id: minted.id,
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        {
          id: 'place',
          label: 'Place a Grey (Mysticism) Mage on an open slot',
          payload: {},
        },
        { id: 'skip', label: 'Skip', payload: {} },
      ],
    },
    resume: {
      effectId: 'base.system.mysticism-place-after-cast',
      context: { step: 'choose' },
    },
    source: {
      kind: 'mage-power',
      id: 'base.mage.mysticism.place-after-cast',
      triggeringPlayerId: playerId,
      description: 'Mysticism Mage — place after Action Spell',
    },
  };
  return {
    ...minted.state,
    pendingResolutionStack: [...minted.state.pendingResolutionStack, pending],
  };
}

/**
 * Surfaces the next Technomancy post-placement prompt once the stack is
 * idle. Each queue entry is a `{ playerId, roomId }` tuple captured at
 * the moment an orange Mage was placed by its owner. The trigger fires
 * AFTER any instant-room reward chain, the place-chain pump, and the
 * mysticism drain — so the player resolves them in priority order
 * without their Technomancy decision tangled into the placement step.
 *
 * Gates (any one suppresses):
 *   - Mesmerize (`mages-lose-powers`) — disables mage powers globally.
 *   - Malaise (`placements-blocked`) — disables placements globally and
 *     by extension any placement-tied trigger.
 *   - The triggering player has < 3 Gold (can't pay; skip silently).
 */
function drainTechnomancyTriggerIfIdle(state: GameState): GameState {
  const queue = state.pendingTechnomancyTrigger;
  if (queue.length === 0) return state;
  if (state.pendingResolutionStack.length > 0) return state;
  if (state.activeReactionWindows.length > 0) return state;
  if (state.pendingPlaceChain !== null) return state;
  const [entry, ...rest] = queue;
  if (entry === undefined) return state;
  const cleared: GameState = { ...state, pendingTechnomancyTrigger: rest };
  if (magesLosePowers(cleared)) return cleared;
  if (placementsBlocked(cleared)) return cleared;
  const player = cleared.players.find((p) => p.id === entry.playerId);
  if (!player) return cleared;
  // The Side A power costs 3 Gold. If the player can't afford it, the
  // trigger fizzles silently — no point opening a prompt with only Skip.
  if (player.resources.gold < 3) return cleared;
  const minted = mintId(cleared, 'r');
  const pending: PendingResolution = {
    id: minted.id,
    responderId: entry.playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        {
          id: 'pay',
          label: 'Pay 3 Gold → gain a Research',
          payload: {},
        },
        { id: 'skip', label: 'Skip', payload: {} },
      ],
    },
    resume: {
      effectId: 'mancers.mage.technomancy.place-after',
      context: { roomId: entry.roomId },
    },
    source: {
      kind: 'mage-power',
      id: 'mancers.mage.technomancy.place-after',
      triggeringPlayerId: entry.playerId,
      description: 'Technomancer — post-placement (Side A)',
    },
  };
  return {
    ...minted.state,
    pendingResolutionStack: [...minted.state.pendingResolutionStack, pending],
  };
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
 * DISCARD_BONUS_ACTIONS: drops any remaining bonus actions (extraActions /
 * Bend Time tracker) so the turn auto-advances on the next idle moment.
 * Used by the UI's "Discard remaining bonus actions" button under Bend
 * Time. No-op if Bend Time / Flare / Dazzle isn't actually active.
 */
function handleDiscardBonusActions(
  state: GameState,
  action: DiscardBonusActionsAction,
): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('DISCARD_BONUS_ACTIONS: only valid during errands phase');
  }
  if (state.pendingResolutionStack.length > 0) {
    throw new Error(
      'DISCARD_BONUS_ACTIONS: resolve pending prompt first',
    );
  }
  const activePlayerId = state.players[state.phase.activePlayerIndex]?.id;
  if (activePlayerId !== action.playerId) {
    throw new Error(
      `DISCARD_BONUS_ACTIONS: not your turn (active=${activePlayerId}, you=${action.playerId})`,
    );
  }
  const phase = state.phase;
  const cleared: GamePhase = {
    kind: 'errands',
    round: phase.round,
    activePlayerIndex: phase.activePlayerIndex,
    actionUsed: phase.actionUsed,
    fastActionUsed: phase.fastActionUsed,
    extraActions: 0,
  };
  return { ...state, phase: cleared };
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
    card.timing === 'action' ? 'supporter' : undefined,
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
    card.timing === 'action' ? 'vault' : undefined,
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

  // If this claim empties the bell tower, queue a `bell-tower-last-claimed`
  // event so reactions (Tardy, Stop Time) can open AFTER the card's own
  // effect chain settles — see `drainBellTowerLastEventIfIdle`.
  const isLastCard = state.bellTower.available.length === 1;
  const lastEventSource: ResolutionSource = {
    kind: 'bell-tower',
    id: card.id,
    triggeringPlayerId: action.playerId,
    description: card.name,
  };

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
    ...(isLastCard
      ? {
          pendingBellTowerLastEvent: {
            cardId: card.id,
            byPlayerId: action.playerId,
            source: lastEventSource,
          },
        }
      : {}),
  };

  if (!hasEffect(card.effectId)) return claimed;
  const source: ResolutionSource = {
    kind: 'bell-tower',
    id: card.id,
    triggeringPlayerId: action.playerId,
    description: card.name,
  };
  // When the UI dispatched a pre-supplied `claimChoice`, synthesize the
  // effect's resumeAnswer so it short-circuits the choose-from-options
  // prompt and applies the picked option directly. Without it the effect
  // surfaces a normal pending prompt for the player to resolve later.
  const ctx: EffectContext = {
    state: claimed,
    source,
    triggeringPlayerId: action.playerId,
    allowReactions: true,
    ...(action.claimChoice
      ? {
          resumeAnswer: {
            kind: 'option-chosen' as const,
            optionId: action.claimChoice,
            payload: {},
          },
        }
      : {}),
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

  // If we landed back in resolution with no pending, complete the current
  // space only when its chain was actively in progress, then pump forward.
  // The `slotInProgress` flag distinguishes a chain-ending resume (true —
  // run completeCurrentSpaceResolution) from a side prompt the engine
  // surfaced between slots — e.g. a Research entry drained from
  // `researchQueue` after the previous slot's chain already ended (false
  // — just pump; completing here would clobber the next slot's occupant).
  if (
    curr.phase.kind === 'resolution' &&
    curr.pendingResolutionStack.length === 0 &&
    curr.activeReactionWindows.length === 0
  ) {
    if (curr.phase.slotInProgress) {
      curr = completeCurrentSpaceResolution(curr);
    }
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
    // Pick the trigger event this reaction targets. For single-mage windows
    // we use the only event. For multi-mage windows (batch wound/banish
    // spells) the answer's `forMageId` identifies which event; the option
    // chosen carried its own `forMageId` too, which we use as a fallback.
    const targetMageId = answer.forMageId ?? reactionOption.forMageId;
    const matchedEvent =
      targetMageId !== undefined
        ? (window.triggerEvents.find(
            (e) => 'mageId' in e && e.mageId === targetMageId,
          ) ?? window.triggerEvents[0])
        : window.triggerEvents[0];
    if (!matchedEvent) {
      throw new Error(
        `resolveReactionPrompt: no trigger event matched forMageId=${targetMageId}`,
      );
    }
    const triggerEventValue = matchedEvent as unknown as SerializableContext;
    const reactionCtx: EffectContext = {
      state: curr,
      source: reactionSource,
      triggeringPlayerId: responderId,
      resumeAnswer: answer,
      resumeContext: {
        ...answer.reactionContext,
        triggerEvent: triggerEventValue,
        triggerSource: window.source as unknown as SerializableContext,
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
      // `pass` answers are accepted only when the prompt opted in via
      // `canPass: true` (Ice Comet's optional wound / banish / move legs).
      if (answer.kind === 'pass') {
        if (!prompt.prompt.canPass) {
          throw new Error(
            `validateAnswer: this choose-target-mage prompt does not accept pass`,
          );
        }
        return;
      }
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
    case 'choose-peeked-supporter':
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
    updated = clearArchmagesApprentice(updated);
    updated = returnSummonedMagesToSupply(updated);
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
 * The Archmage's Apprentice is a one-of-one "joker" mage gained for a
 * single round only. At round-setup we strip it from the owner's
 * mages array (regardless of where it sits — office, on a slot, or in
 * the infirmary) and clear the owner pointer. Slot occupancy is
 * cleaned up too so the apprentice doesn't ghost into the next round.
 *
 * If the apprentice is currently on an action space, the slot's
 * `occupant` / `shadowOccupant` reference is also cleared. This is
 * defensive — the Resolution pump's standard cleanup already returns
 * mages to office before round-setup runs, but Side-A/B Studies can
 * grant the apprentice mid-errands and a player could leave it sitting
 * on a slot in some edge case (e.g. if the apprentice was placed via
 * a spell chain). Keep the rooms clean either way.
 */
function clearArchmagesApprentice(state: GameState): GameState {
  if (state.archmagesApprenticeOwner === null) return state;
  // Find the apprentice mage id (if it still exists) so we can scrub
  // any slot references in one pass.
  let apprenticeMageId: string | null = null;
  for (const p of state.players) {
    if (p.id !== state.archmagesApprenticeOwner) continue;
    const m = p.mages.find((mm) => mm.cardId === 'base.mage.archmages-apprentice');
    if (m) apprenticeMageId = m.id;
    break;
  }
  const players = state.players.map((p) =>
    p.id !== state.archmagesApprenticeOwner
      ? p
      : {
          ...p,
          mages: p.mages.filter(
            (m) => m.cardId !== 'base.mage.archmages-apprentice',
          ),
        },
  );
  const rooms = apprenticeMageId
    ? state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) => {
          let next = s;
          if (next.occupant?.mageId === apprenticeMageId) {
            next = { ...next, occupant: null };
          }
          if (next.shadowOccupant?.mageId === apprenticeMageId) {
            next = { ...next, shadowOccupant: null };
          }
          return next;
        }),
      }))
    : state.rooms;
  return {
    ...state,
    archmagesApprenticeOwner: null,
    players,
    rooms,
  };
}

/**
 * Returns every summoned Mage (e.g., from Living Image) to its colour's
 * supply pool. Runs at the start of round-setup for rounds 2+ — by that
 * point Resolution has already collected slot rewards and returned mages
 * to their owner's office, so any remaining `isSummoned: true` mage is
 * safe to remove and recycle into the draft pool.
 *
 * Wounded summons (in the Infirmary) are also recycled, before
 * `healInfirmaryMages` runs.
 */
function returnSummonedMagesToSupply(state: GameState): GameState {
  const returnedByColor: Partial<Record<OwnedMage['color'], number>> = {};
  const players = state.players.map((p) => {
    const keep: OwnedMage[] = [];
    for (const m of p.mages) {
      if (m.isSummoned) {
        returnedByColor[m.color] = (returnedByColor[m.color] ?? 0) + 1;
      } else {
        keep.push(m);
      }
    }
    if (keep.length === p.mages.length) return p;
    return { ...p, mages: keep };
  });
  const mageDraftPool = { ...state.mageDraftPool };
  for (const [color, n] of Object.entries(returnedByColor)) {
    mageDraftPool[color as OwnedMage['color']] =
      (mageDraftPool[color as OwnedMage['color']] ?? 0) + (n ?? 0);
  }
  return { ...state, players, mageDraftPool };
}

/**
 * Per the rulebook, every wounded Mage returns to its owner's Office at the
 * start of each new round. Run as part of `processRoundSetup` for rounds 2+.
 */
function healInfirmaryMages(state: GameState): GameState {
  const healed: GameState = {
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
  // Reset Infirmary B's buffed-bonus slot occupants alongside the heal
  // sweep — the slots track "claimed this round," and a new round
  // starts now.
  return { ...healed, ...clearInfirmaryBSlots(healed) };
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

  // Vault tableau is NOT redealt at round-setup. It auto-refills slot-by-slot
  // from `vaultDeck` whenever a card is drafted / bought / removed (handled
  // in `applyVaultDraft`, `applyVaultPurchase`, `applyVaultPurchaseMaybeWaived`).
  // Cards left in the tableau at end of round stay where they are.

  const supporterPool = [...state.supporterDeck, ...state.supporterTableau];
  const supporterTableau = supporterPool.slice(0, 5);
  const supporterDeck = supporterPool.slice(5);

  return {
    ...state,
    spellDeck,
    spellTableau,
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
  // The active player's "next spell free" / "next spell no-exhaust" buffs
  // (Mana Elixir / Concentration) expire unconditionally when their turn
  // ends, used or not.
  const errandsPhase = state.phase;
  const outgoingId = state.players[errandsPhase.activePlayerIndex]?.id;
  const players = outgoingId
    ? state.players.map((p) =>
        p.id !== outgoingId
          ? p
          : { ...p, nextSpellFreeMana: false, nextSpellSkipsExhaust: false },
      )
    : state.players;
  if (state.bellTower.available.length === 0) {
    // Per rulebook: locks automatically clear at the start of the
    // Resolution phase. Mages that were inside still complete their
    // Errands (resolution walks slots; lock state isn't checked there).
    // ALL active buffs expire here — "until your next turn" buffs whose
    // caster never got another turn within the round also drop, so
    // nothing bleeds across rounds.
    return {
      ...state,
      players,
      roomLocks: [],
      activeBuffs: [],
      pendingRevivalChecks: [],
      pendingMysticismPostCast: [],
      pendingTechnomancyTrigger: [],
      phase: {
        kind: 'resolution',
        round: errandsPhase.round,
        pendingRoomIndex: 0,
        pendingSpaceIndex: 0,
      },
    };
  }
  const next = (errandsPhase.activePlayerIndex + 1) % state.players.length;
  const incomingId = state.players[next]?.id;
  // "Until your next turn" buffs expire the moment their owner's next
  // turn begins. Strip any buff whose `turn-start.playerId` matches the
  // incoming active player.
  const trimmedBuffs = state.activeBuffs.filter(
    (b) =>
      !(b.expiresAt.kind === 'turn-start' && b.expiresAt.playerId === incomingId),
  );
  // Rebuild the phase from scratch so the Bend Time tracker doesn't bleed
  // across turns. (Spreading `...errandsPhase` would carry over a
  // `bendTimeUsedKinds` array; under exactOptionalPropertyTypes we can't
  // just set it to `undefined`.)
  const nextPhase: GamePhase = {
    kind: 'errands',
    round: errandsPhase.round,
    activePlayerIndex: next,
    actionUsed: false,
    fastActionUsed: false,
    extraActions: 0,
  };
  return {
    ...state,
    players,
    activeBuffs: trimmedBuffs,
    // Defensive: the Mysticism + Technomancy triggers should have
    // drained earlier in autoAdvanceIfTurnDone — but reset here so any
    // stray queue entries can't leak across turn boundaries.
    pendingMysticismPostCast: [],
    pendingTechnomancyTrigger: [],
    phase: nextPhase,
  };
}

function processMidGameScoring(state: GameState, round: RoundNumber): GameState {
  if (round < 5) {
    const next = (round + 1) as RoundNumber;
    return { ...state, phase: { kind: 'round-setup', round: next } };
  }
  // End of round 5 — game is over. If any player holds a wild-department
  // supporter (White Ash), they must declare a department BEFORE voters
  // are revealed. Push those prompts and transition to 'final-scoring';
  // the wild-department-choice effect will finalize the game once the
  // last choice is in. If no one holds a wild supporter, finalize now.
  const needsChoice = state.players.filter(
    (p) => playerOwnsWildSupporter(state, p) && !p.wildDepartmentChoice,
  );
  if (needsChoice.length === 0) {
    return finalizeGame(state);
  }
  let next: GameState = { ...state, phase: { kind: 'final-scoring' } };
  // Pendings push onto a LIFO stack; iterate in reverse so the first
  // player in turn order is the first to be asked.
  for (let i = needsChoice.length - 1; i >= 0; i--) {
    const player = needsChoice[i]!;
    next = pushPending(next, {
      responderId: player.id,
      prompt: {
        kind: 'choose-from-options',
        options: [
          { id: 'sorcery', label: 'Sorcery (Red)', payload: {} },
          { id: 'mysticism', label: 'Mysticism (Grey)', payload: {} },
          { id: 'natural-magick', label: 'Natural Magick (Green)', payload: {} },
          { id: 'planar-studies', label: 'Planar Studies (Purple)', payload: {} },
          { id: 'divinity', label: 'Divinity (Blue)', payload: {} },
          { id: 'students', label: 'Students (Off-White)', payload: {} },
        ],
      },
      resume: {
        effectId: 'base.system.wild-department-choice',
        context: {},
      },
      source: {
        kind: 'system',
        id: 'base.system.wild-department-choice',
        triggeringPlayerId: player.id,
        description: 'White Ash — declare a department',
      },
    });
  }
  return next;
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
