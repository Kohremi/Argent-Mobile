// Minimal dev UI for exercising the engine in the browser.
// Lets you inject test mages / spells / vault cards, place workers, cast
// spells, drain the bell tower, and answer prompts — enough to walk through
// the Library and Burn vertical slices end-to-end without running tests.

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useGameStore } from '../store/gameStore';
import { baseGamePack } from '../content/packs/base';
import { listPacks } from '../content/registry';
import { computeFinalScoring } from '../game/scoring';
import { BellIcon, LockIcon, MageIcon, ResourceIcon, type ResourceKind } from './icons';
import type {
  Candidate,
  Department,
  GameAction,
  GameState,
  Mage,
  MageColor,
  OwnedMage,
  PendingPrompt,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  SpellCard,
  SupporterCard,
  VaultCard,
} from '../game/types';

/**
 * Direct-on-board selection driven by the top pending prompt. When set, the
 * relevant panel highlights eligible items and dispatches RESOLVE_PENDING on
 * click — replacing the menu of ID buttons that used to sit in the banner.
 */
type SelectionMode =
  | { kind: 'mage'; eligibleIds: Set<string>; onSelect: (id: string) => void }
  | {
      kind: 'action-space';
      eligibleIds: Set<string>;
      onSelect: (id: string) => void;
    }
  | {
      kind: 'vault-card';
      eligibleIds: Set<string>;
      onSelect: (id: string) => void;
    }
  | {
      kind: 'supporter-card';
      eligibleIds: Set<string>;
      onSelect: (id: string) => void;
    }
  | { kind: 'voter'; eligibleIds: Set<string>; onSelect: (id: string) => void };

/**
 * Active when the top pending is the research-spend menu — the UI hides
 * that prompt's buttons and instead lets the player drive the action by
 * clicking elements on the board: a spell tableau card, an INT token, a
 * WIS token, or the next empty WIS slot. The `source` field tracks the
 * mid-chain state when the player has clicked an INT/WIS token to start
 * a move — the destination is captured on the next click.
 */
interface ResearchInputMode {
  resolutionId: string;
  responderId: string;
  /** Top-level options the engine has on offer (from the prompt). */
  availableOptions: Set<string>;
  /** Player who's spending the Research (display label). */
  responderLabel: string;
  /** Player who's spending the Research (for filtering tokens / slots). */
  /** Set after the player clicks an INT or WIS token. Cleared on cancel. */
  source: { kind: 'int' | 'wis'; cardId: string } | null;
  onClickTableauSpell: (cardId: string) => void;
  onClickIntToken: (cardId: string) => void;
  onClickWisToken: (cardId: string) => void;
  onClickEmptyWisSlot: (cardId: string) => void;
  onDiscard: () => void;
  onCancelMove: () => void;
}

function deriveSelectionMode(
  pending: PendingResolution | undefined,
  dispatch: (action: GameAction) => void,
): SelectionMode | null {
  if (!pending) return null;
  const { prompt } = pending;
  const resolve = (answer: ResolutionAnswer) => {
    dispatch({ type: 'RESOLVE_PENDING', resolutionId: pending.id, answer });
  };
  switch (prompt.kind) {
    case 'choose-target-mage':
      return {
        kind: 'mage',
        eligibleIds: new Set(prompt.eligibleMageIds),
        onSelect: (id) => resolve({ kind: 'mage-chosen', mageId: id }),
      };
    case 'choose-target-action-space':
      return {
        kind: 'action-space',
        eligibleIds: new Set(prompt.eligibleSpaceIds),
        onSelect: (id) => resolve({ kind: 'space-chosen', spaceId: id }),
      };
    case 'choose-vault-card':
      return {
        kind: 'vault-card',
        eligibleIds: new Set(prompt.eligibleCardIds),
        onSelect: (id) => resolve({ kind: 'card-chosen', cardId: id }),
      };
    case 'choose-supporter-card':
      return {
        kind: 'supporter-card',
        eligibleIds: new Set(prompt.eligibleCardIds),
        onSelect: (id) => resolve({ kind: 'card-chosen', cardId: id }),
      };
    case 'choose-voter':
      return {
        kind: 'voter',
        eligibleIds: new Set(prompt.eligibleVoterIds),
        onSelect: (id) => resolve({ kind: 'voter-chosen', voterId: id }),
      };
    default:
      return null;
  }
}

const INJECTABLE_MAGE_COLORS: MageColor[] = [
  'red',
  'blue',
  'green',
  'purple',
  'grey',
  'off-white',
];

const MAGE_CARD_BY_COLOR: Record<MageColor, string> = {
  red: 'base.mage.sorcery',
  blue: 'base.mage.divinity',
  green: 'base.mage.natural-magick',
  purple: 'base.mage.planar-studies',
  grey: 'base.mage.mysticism',
  'off-white': 'base.mage.neutral',
};

// ===== Debug-mode state mutators (bypass the engine) =====

function injectMage(state: GameState, playerId: PlayerId, color: MageColor): GameState {
  const seq = state.nextSequenceId;
  const mageId = `dbg-mage-${seq}`;
  return {
    ...state,
    nextSequenceId: seq + 1,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: [
              ...p.mages,
              {
                id: mageId,
                cardId: MAGE_CARD_BY_COLOR[color],
                color,
                location: { kind: 'office', playerId },
                isShadowing: false,
                isWounded: false,
              },
            ],
          },
    ),
  };
}

function injectBurnAndMana(state: GameState, playerId: PlayerId): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            ownedSpells: [
              ...p.ownedSpells.filter((s) => s.cardId !== 'base.spell.burn'),
              {
                cardId: 'base.spell.burn',
                intPlaced: true,
                wisPlacedLevel2: false,
                wisPlacedLevel3: false,
                exhausted: false,
              },
            ],
            resources: { ...p.resources, mana: Math.max(p.resources.mana, 5) },
          },
    ),
  };
}

function injectPhaseSteppers(state: GameState, playerId: PlayerId): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            vaultCards: [
              ...p.vaultCards,
              { cardId: 'base.vault.phase-steppers', exhausted: false },
            ],
          },
    ),
  };
}

function bumpResource(
  state: GameState,
  playerId: PlayerId,
  key: 'gold' | 'meritBadges',
  delta: number,
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              [key]: Math.max(0, p.resources[key] + delta),
            },
          },
    ),
  };
}

function drainBellTower(state: GameState): GameState {
  return { ...state, bellTower: { ...state.bellTower, available: [] } };
}

function forceLibrarySide(state: GameState, side: 'A' | 'B'): GameState {
  const target = baseGamePack.rooms.find(
    (r) => r.name === 'Library' && r.side === side,
  );
  if (!target) return state;
  return {
    ...state,
    rooms: state.rooms.map((r) => (r.name === 'Library' ? target : r)),
  };
}

function forceVaultSide(state: GameState, side: 'A' | 'B'): GameState {
  const target = baseGamePack.rooms.find(
    (r) => r.name === 'Vault' && r.side === side,
  );
  if (!target) return state;
  const idx = state.rooms.findIndex((r) => r.name === 'Vault');
  if (idx !== -1) {
    return {
      ...state,
      rooms: state.rooms.map((r, i) => (i === idx ? target : r)),
    };
  }
  // Vault not in layout — replace first non-UC room.
  const replaceIdx = state.rooms.findIndex((r) => !r.isUniversityCentral);
  if (replaceIdx === -1) return state;
  return {
    ...state,
    rooms: state.rooms.map((r, i) => (i === replaceIdx ? target : r)),
  };
}

// ===== Lookup helpers =====

/**
 * Mirrors the engine-side rules for placing a mage on a space, so the UI
 * can pre-highlight viable targets and disable the rest. Returns null if
 * placement is allowed, or a short string explaining why it is not.
 */
/**
 * Mirrors `canArsMagnaTakeSpace` in the engine: a red mage can place on
 * an occupied slot by spending 1 Mana to wound the occupant, provided the
 * target isn't a same-team mage, isn't green/blue, and isn't already
 * wounded.
 */
function isArsMagnaPlacement(
  state: GameState,
  mage: OwnedMage,
  space: GameState['rooms'][number]['actionSpaces'][number],
): boolean {
  if (mage.color !== 'red') return false;
  if (!space.occupant) return false;
  const owner = state.players.find((p) =>
    p.mages.some((m) => m.id === mage.id),
  );
  if (!owner) return false;
  if (space.occupant.ownerId === owner.id) return false;
  if (owner.resources.mana < 1) return false;
  const occMage = state.players
    .find((p) => p.id === space.occupant?.ownerId)
    ?.mages.find((m) => m.id === space.occupant?.mageId);
  if (!occMage) return false;
  if (occMage.isWounded) return false;
  if (occMage.color === 'green') return false;
  if (occMage.color === 'blue') return false;
  return true;
}

function placementBlockedReason(
  state: GameState,
  mage: OwnedMage,
  room: GameState['rooms'][number],
  space: GameState['rooms'][number]['actionSpaces'][number],
): string | null {
  if (room.cannotBePlacedInDirectly) return 'cannot place here';
  if (state.roomLocks.some((l) => l.roomId === room.id)) return 'room locked';
  if (space.occupant && !isArsMagnaPlacement(state, mage, space)) {
    return 'space occupied';
  }
  if (
    space.slotType === 'shadow' ||
    space.slotType === 'shadow-merit' ||
    space.slotType === 'wound'
  ) {
    return `${space.slotType} slot not yet supported`;
  }
  if (state.phase.kind !== 'errands') return 'not in errands phase';
  if (state.pendingResolutionStack.length > 0) return 'resolve pending prompt first';
  if (mage.location.kind !== 'office') return 'mage not in office';
  if (mage.isWounded) return 'wounded mages must heal first';
  // Per-room-per-round limit.
  const owner = state.players.find((p) =>
    p.mages.some((m) => m.id === mage.id),
  );
  if (!owner) return 'mage owner not found';
  const roomLimit = room.maxMagesPerPlayerPerRound ?? Infinity;
  if (Number.isFinite(roomLimit)) {
    const placedHere = owner.roundPlacements.filter(
      (rid) => rid === room.id,
    ).length;
    if (placedHere >= roomLimit) return `${room.name}: already at room limit this round`;
  }
  // Action budget. Purple (Planar Studies) Mages prefer the Fast Action
  // but can fall back to the Regular Action when the Fast Action is
  // spent — they're blocked only if BOTH budgets are gone (or the
  // Regular Action is already spent, which prevents any Fast Action by
  // the "Fast before Regular" rule).
  if (mage.color === 'purple') {
    if (state.phase.actionUsed) return 'Action already used';
    if (state.phase.fastActionUsed && state.phase.actionUsed) {
      return 'no Actions left this turn';
    }
  } else {
    if (state.phase.actionUsed) return 'Action already used';
  }
  return null;
}

function findOwnerLabel(state: GameState, mageId: string): string {
  for (const p of state.players) {
    const m = p.mages.find((x) => x.id === mageId);
    if (m) return `${p.name} — ${m.color} mage`;
  }
  return mageId;
}

function findCandidateName(state: GameState, candidateId: string): string | null {
  if (!candidateId) return null;
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    const c = pack.candidates.find((cand) => cand.id === candidateId);
    if (c) return c.name;
  }
  return null;
}

function playerDisplayName(state: GameState, player: Player): string {
  const leaderName = findCandidateName(state, player.candidateId);
  return leaderName ? `${player.name} (${leaderName})` : player.name;
}

/**
 * Looks up a spell's level-1 timing across the active packs (regular + leader
 * spells). Returns null if not found.
 */
function findSpellCard(
  state: GameState,
  spellCardId: string,
): SpellCard | null {
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    const found =
      pack.spells.find((s) => s.id === spellCardId) ??
      pack.legendarySpells.find((s) => s.id === spellCardId);
    if (found) return found;
  }
  return null;
}


function findSupporterCard(
  state: GameState,
  supporterId: string,
): SupporterCard | null {
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    const found = pack.supporters.find((s) => s.id === supporterId);
    if (found) return found;
  }
  return null;
}

function findVaultCard(
  state: GameState,
  vaultId: string,
): VaultCard | null {
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    const found = pack.vaultCards.find((v) => v.id === vaultId);
    if (found) return found;
  }
  return null;
}


function describePhase(state: GameState): string {
  const p = state.phase;
  switch (p.kind) {
    case 'setup':
      return 'Setup';
    case 'candidate-draft': {
      const player = state.players[p.activePlayerIndex];
      return `Candidate Draft (active: ${player?.name ?? '?'})`;
    }
    case 'mage-draft-first-choice': {
      const chooser = state.players[p.chooserIndex];
      return `Mage Draft — choose order (${chooser?.name ?? '?'})`;
    }
    case 'mage-draft': {
      const idx = p.pickOrder[p.nextPickIndex];
      const player = idx !== undefined ? state.players[idx] : undefined;
      return `Mage Draft — pick ${p.nextPickIndex + 1}/${p.pickOrder.length} (${player?.name ?? '?'})`;
    }
    case 'initial-mark-placement': {
      const player = state.players[p.activePlayerIndex];
      return `Initial Mark Placement (${player?.name ?? '?'})`;
    }
    case 'round-setup':
      return `Round ${p.round} — Round Setup`;
    case 'errands': {
      const player = state.players[p.activePlayerIndex];
      const label = player ? playerDisplayName(state, player) : '?';
      return `Round ${p.round} — Errands (active: ${label})`;
    }
    case 'resolution':
      return `Round ${p.round} — Resolution (room ${p.pendingRoomIndex + 1}/${state.rooms.length})`;
    case 'mid-game-scoring':
      return `Round ${p.round} — Mid-game scoring`;
    case 'final-scoring':
      return 'Final scoring';
    case 'complete':
      return `Complete — Archmage: ${p.archmage ?? 'none'}`;
  }
}

// ===== Components =====

export function DebugControls() {
  const state = useGameStore((s) => s.state);
  const dispatch = useGameStore((s) => s.dispatch);
  const patchState = useGameStore((s) => s.patchState);
  const reset = useGameStore((s) => s.reset);

  // Hooks must run unconditionally on every render — keep this above any
  // early returns. Two-step placement: click a mage in the active player's
  // inventory to select it, then click an eligible space to place it.
  const [placementMageId, setPlacementMageId] = useState<string | null>(null);
  // When a reaction option needs a slot pick (Shield Potion etc.), we hold
  // its effectId here while the player clicks a slot on the board. The
  // current top-of-stack pending resolution id is captured so we know which
  // reaction window to resolve when the player completes the pick.
  const [reactionAwaitingSlot, setReactionAwaitingSlot] = useState<
    { resolutionId: string; effectId: string } | null
  >(null);
  // While the player is spending a Research, they may click an INT or WIS
  // token to start a move; this holds the source card id until they click
  // the destination (a tableau spell for INT, an empty WIS slot on another
  // owned spell for WIS).
  const [researchMoveSource, setResearchMoveSource] = useState<
    { kind: 'int' | 'wis'; cardId: string } | null
  >(null);

  if (!state) return null;

  // While the candidate draft is open, show only that — gameplay isn't
  // available until every player has picked a leader.
  if (state.phase.kind === 'candidate-draft') {
    return <CandidateDraftScreen state={state} dispatch={dispatch} reset={reset} />;
  }
  if (state.phase.kind === 'mage-draft-first-choice') {
    return (
      <MageDraftFirstChoiceScreen state={state} dispatch={dispatch} reset={reset} />
    );
  }
  if (state.phase.kind === 'mage-draft') {
    return <MageDraftScreen state={state} dispatch={dispatch} reset={reset} />;
  }
  if (state.phase.kind === 'initial-mark-placement') {
    return (
      <InitialMarkPlacementScreen state={state} dispatch={dispatch} reset={reset} />
    );
  }

  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  // Clear the awaiting-slot state if the underlying prompt has changed
  // out from under us (e.g. the reaction was resolved another way, or the
  // window closed). React reads stale state safely; we just won't expose
  // the override in this render.
  const reactionSlotActive =
    reactionAwaitingSlot !== null &&
    top !== undefined &&
    top.id === reactionAwaitingSlot.resolutionId &&
    top.prompt.kind === 'reaction-window';

  // Override the normal SelectionMode while a reaction is awaiting a slot
  // pick: highlight all open base slots, and on click submit the reaction
  // with destinationSpaceId in reactionContext.
  let selectionMode = deriveSelectionMode(top, dispatch);
  if (reactionSlotActive && reactionAwaitingSlot && top) {
    const openSlots = new Set<string>();
    const lockedRoomIds = new Set(state.roomLocks.map((l) => l.roomId));
    for (const r of state.rooms) {
      if (r.cannotBePlacedInDirectly) continue;
      // Reaction movement can't go into a newly locked room.
      if (lockedRoomIds.has(r.id)) continue;
      for (const s of r.actionSpaces) {
        if (!s.occupant) openSlots.add(s.id);
      }
    }
    selectionMode = {
      kind: 'action-space',
      eligibleIds: openSlots,
      onSelect: (id) => {
        dispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: reactionAwaitingSlot.resolutionId,
          answer: {
            kind: 'reaction-played',
            effectId: reactionAwaitingSlot.effectId,
            reactionContext: { destinationSpaceId: id },
          },
        });
        setReactionAwaitingSlot(null);
      },
    };
  } else if (reactionAwaitingSlot !== null && !reactionSlotActive) {
    // Lazily clear stale state on next render. (Setting state mid-render
    // would warn; we tolerate one render with stale state.)
    queueMicrotask(() => setReactionAwaitingSlot(null));
  }

  // Detect the research-spend menu prompt at the top of the stack. When
  // present, we hide the engine-level option buttons and let the player
  // drive the action by clicking elements on the board.
  const researchMode: ResearchInputMode | null = (() => {
    if (!top || top.prompt.kind !== 'choose-from-options') return null;
    if (top.resume.effectId !== 'base.system.spend-research') return null;
    const availableOptions = new Set(top.prompt.options.map((o) => o.id));
    const resolutionId = top.id;
    const responderId = top.responderId;
    const responderLabel =
      state.players.find((p) => p.id === responderId)?.name ?? responderId;
    // Chains a sequence of option-chosen RESOLVE_PENDING dispatches.
    // Reads fresh state between dispatches so we always target the
    // current top-of-stack prompt id.
    const chain = (optionIds: string[]) => {
      for (const optionId of optionIds) {
        const fresh = useGameStore.getState().state;
        if (!fresh) return;
        const currentTop =
          fresh.pendingResolutionStack[fresh.pendingResolutionStack.length - 1];
        if (!currentTop) return;
        dispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: currentTop.id,
          answer: {
            kind: 'option-chosen',
            optionId,
            payload: {},
          },
        });
      }
    };
    return {
      resolutionId,
      responderId,
      availableOptions,
      responderLabel,
      source: researchMoveSource,
      onClickTableauSpell: (cardId: string) => {
        if (researchMoveSource === null) {
          if (!availableOptions.has('draft')) return;
          chain(['draft', cardId]);
        } else if (researchMoveSource.kind === 'int') {
          if (!availableOptions.has('move-int')) return;
          chain(['move-int', researchMoveSource.cardId, cardId]);
          setResearchMoveSource(null);
        }
      },
      onClickIntToken: (cardId: string) => {
        if (researchMoveSource !== null) {
          // If they re-click while a source is set, treat as a cancel +
          // start a fresh move from this token.
          setResearchMoveSource({ kind: 'int', cardId });
          return;
        }
        if (!availableOptions.has('move-int')) return;
        setResearchMoveSource({ kind: 'int', cardId });
      },
      onClickWisToken: (cardId: string) => {
        if (researchMoveSource !== null) {
          setResearchMoveSource({ kind: 'wis', cardId });
          return;
        }
        if (!availableOptions.has('move-wis')) return;
        setResearchMoveSource({ kind: 'wis', cardId });
      },
      onClickEmptyWisSlot: (cardId: string) => {
        if (researchMoveSource === null) {
          if (!availableOptions.has('add-wis')) return;
          chain(['add-wis', cardId]);
        } else if (researchMoveSource.kind === 'wis') {
          if (researchMoveSource.cardId === cardId) {
            // No-op: can't move a WIS onto its own card.
            return;
          }
          if (!availableOptions.has('move-wis')) return;
          chain(['move-wis', researchMoveSource.cardId, cardId]);
          setResearchMoveSource(null);
        }
      },
      onDiscard: () => {
        chain(['discard']);
        setResearchMoveSource(null);
      },
      onCancelMove: () => setResearchMoveSource(null),
    };
  })();

  // Lazily clear move-source if it's stale (different prompt, or no
  // research prompt at all).
  if (researchMoveSource !== null && researchMode === null) {
    queueMicrotask(() => setResearchMoveSource(null));
  }
  const responderId = top?.responderId;
  const errandsActiveId =
    state.phase.kind === 'errands'
      ? (state.players[state.phase.activePlayerIndex]?.id ?? null)
      : null;
  const focusPlayerId = responderId ?? errandsActiveId;

  // Auto-clear the selection if it becomes invalid (turn changed, mage was
  // wounded, etc.) - cheaper than wiring useEffect.
  const selectedMage = placementMageId
    ? state.players.flatMap((p) => p.mages).find((m) => m.id === placementMageId)
    : null;
  const selectionValid =
    selectedMage !== undefined &&
    selectedMage !== null &&
    selectedMage.location.kind === 'office' &&
    !selectedMage.isWounded &&
    state.phase.kind === 'errands' &&
    state.pendingResolutionStack.length === 0 &&
    (() => {
      const owner = state.players.find((p) =>
        p.mages.some((m) => m.id === selectedMage.id),
      );
      return owner?.id === errandsActiveId;
    })();
  const effectiveSelectedMage = selectionValid ? selectedMage : null;

  return (
    <div className="min-h-full p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Argent — debug</h1>
          <p className="text-slate-400 text-sm">
            {describePhase(state)} · seed {state.rngSeed} · seq {state.nextSequenceId}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: 'ADVANCE_PHASE' })}
            disabled={state.pendingResolutionStack.length > 0}
            className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-400"
          >
            Advance Phase
          </button>
          <button
            type="button"
            onClick={reset}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
          >
            Back to setup
          </button>
        </div>
      </header>

      {state.phase.kind === 'complete' && <FinalScoringPanel state={state} />}

      {top && (
        <PendingPanel
          state={state}
          pending={top}
          dispatch={dispatch}
          hasBoardSelection={selectionMode !== null}
          reactionAwaitingSlot={reactionAwaitingSlot}
          onReactionAwaitingSlot={setReactionAwaitingSlot}
          researchMode={researchMode}
        />
      )}

      {state.activeReactionWindows.length > 0 && (
        <ReactionWindowsPanel state={state} />
      )}

      <section>
        <h2 className="text-lg font-medium mb-2">Players</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {state.players.map((p) => (
            <PlayerCard
              key={p.id}
              state={state}
              player={p}
              isFocus={p.id === focusPlayerId}
              dispatch={dispatch}
              patchState={patchState}
              selectedMageId={effectiveSelectedMage?.id ?? null}
              onSelectMage={setPlacementMageId}
              selectionMode={selectionMode}
              researchMode={researchMode}
            />
          ))}
        </div>
      </section>

      <RoomsPanel
        state={state}
        selectedMage={effectiveSelectedMage}
        dispatch={dispatch}
        onPlaced={() => setPlacementMageId(null)}
        selectionMode={selectionMode}
      />

      <BellTowerPanel state={state} dispatch={dispatch} />

      <section className="rounded border border-slate-700 bg-slate-900 p-4 space-y-2">
        <h2 className="text-lg font-medium">Debug</h2>
        <div className="flex flex-wrap gap-2">
          <DebugButton onClick={() => patchState(drainBellTower)}>
            Drain Bell Tower ({state.bellTower.available.length} cards)
          </DebugButton>
          <DebugButton onClick={() => patchState((s) => forceLibrarySide(s, 'A'))}>
            Force Library A
          </DebugButton>
          <DebugButton onClick={() => patchState((s) => forceLibrarySide(s, 'B'))}>
            Force Library B
          </DebugButton>
          <DebugButton onClick={() => patchState((s) => forceVaultSide(s, 'A'))}>
            Force Vault A
          </DebugButton>
          <DebugButton onClick={() => patchState((s) => forceVaultSide(s, 'B'))}>
            Force Vault B
          </DebugButton>
        </div>
        <p className="text-xs text-slate-500">
          Active packs: {state.activePackIds.join(', ')} · Pending stack:{' '}
          {state.pendingResolutionStack.length} · Reaction windows:{' '}
          {state.activeReactionWindows.length}
        </p>
      </section>

      <TableauPanel
        state={state}
        selectionMode={selectionMode}
        researchMode={researchMode}
      />

      <VoterTableauPanel state={state} selectionMode={selectionMode} />
    </div>
  );
}

function DebugButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
    >
      {children}
    </button>
  );
}

function PendingPanel({
  state,
  pending,
  dispatch,
  hasBoardSelection,
  reactionAwaitingSlot,
  onReactionAwaitingSlot,
  researchMode,
}: {
  state: GameState;
  pending: PendingResolution;
  dispatch: (action: GameAction) => void;
  hasBoardSelection: boolean;
  reactionAwaitingSlot: { resolutionId: string; effectId: string } | null;
  onReactionAwaitingSlot: (
    s: { resolutionId: string; effectId: string } | null,
  ) => void;
  researchMode: ResearchInputMode | null;
}) {
  const responder = state.players.find((p) => p.id === pending.responderId);
  const responderLabel = responder
    ? playerDisplayName(state, responder)
    : pending.responderId;
  const slotPickActive =
    reactionAwaitingSlot !== null &&
    reactionAwaitingSlot.resolutionId === pending.id;
  const researchActive =
    researchMode !== null && researchMode.resolutionId === pending.id;
  return (
    <section className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-4 space-y-3">
      <div>
        <h2 className="text-lg font-medium text-amber-100">
          {researchActive
            ? `${responderLabel} is spending a Research`
            : `Pending: ${pending.prompt.kind}`}
        </h2>
        {!researchActive && (
          <p className="text-sm text-slate-300">
            Responder: <strong>{responderLabel}</strong> · Source:{' '}
            {pending.source.description}
          </p>
        )}
        {state.pendingResolutionStack.length > 1 && (
          <p className="text-xs text-slate-500">
            (stack depth: {state.pendingResolutionStack.length})
          </p>
        )}
      </div>
      {researchActive && researchMode ? (
        <div className="space-y-2">
          {researchMode.source === null ? (
            <p className="text-xs text-amber-200/90 italic">
              Click a spell in the tableau to learn it, an empty WIS slot
              to upgrade an owned spell, or an INT / WIS token to start a
              move.
            </p>
          ) : researchMode.source.kind === 'int' ? (
            <p className="text-xs text-amber-200/90 italic">
              Moving INT from {researchMode.source.cardId} — click a spell
              in the tableau as the destination, or cancel.
            </p>
          ) : (
            <p className="text-xs text-amber-200/90 italic">
              Moving WIS from {researchMode.source.cardId} — click an
              empty WIS slot on another owned spell, or cancel.
            </p>
          )}
          <div className="flex gap-2">
            {researchMode.source !== null && (
              <button
                type="button"
                onClick={researchMode.onCancelMove}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
              >
                Cancel move
              </button>
            )}
            <button
              type="button"
              onClick={researchMode.onDiscard}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
            >
              Discard Research
            </button>
          </div>
        </div>
      ) : slotPickActive ? (
        <div className="space-y-2">
          <p className="text-xs text-amber-200/90 italic">
            Click an open slot on the board to land your mage there, or
            cancel.
          </p>
          <button
            type="button"
            onClick={() => onReactionAwaitingSlot(null)}
            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
          >
            Cancel reaction
          </button>
        </div>
      ) : hasBoardSelection ? (
        <p className="text-xs text-amber-200/90 italic">
          Click a highlighted target on the board to choose.
        </p>
      ) : (
        <PromptControls
          prompt={pending.prompt}
          state={state}
          pending={pending}
          dispatch={dispatch}
          onReactionAwaitingSlot={onReactionAwaitingSlot}
        />
      )}
    </section>
  );
}

function PromptControls({
  prompt,
  state,
  pending,
  dispatch,
  onReactionAwaitingSlot,
}: {
  prompt: PendingPrompt;
  state: GameState;
  pending: PendingResolution;
  dispatch: (action: GameAction) => void;
  onReactionAwaitingSlot: (
    s: { resolutionId: string; effectId: string } | null,
  ) => void;
}) {
  const resolve = (answer: ResolutionAnswer) => {
    dispatch({
      type: 'RESOLVE_PENDING',
      resolutionId: pending.id,
      answer,
    });
  };

  switch (prompt.kind) {
    case 'choose-from-options':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                resolve({
                  kind: 'option-chosen',
                  optionId: opt.id,
                  payload: opt.payload,
                })
              }
              disabled={opt.available === false}
              title={opt.unavailableReason}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {opt.label}
            </button>
          ))}
        </div>
      );

    case 'choose-target-mage':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.eligibleMageIds.length === 0 && (
            <p className="text-xs text-slate-400">no eligible targets</p>
          )}
          {prompt.eligibleMageIds.map((mid) => (
            <button
              key={mid}
              type="button"
              onClick={() => resolve({ kind: 'mage-chosen', mageId: mid })}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {findOwnerLabel(state, mid)}
            </button>
          ))}
        </div>
      );

    case 'choose-target-action-space':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.eligibleSpaceIds.map((sid) => (
            <button
              key={sid}
              type="button"
              onClick={() => resolve({ kind: 'space-chosen', spaceId: sid })}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {sid}
            </button>
          ))}
        </div>
      );

    case 'choose-vault-card':
    case 'choose-supporter-card':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.eligibleCardIds.map((cid) => (
            <button
              key={cid}
              type="button"
              onClick={() => resolve({ kind: 'card-chosen', cardId: cid })}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {cid}
            </button>
          ))}
        </div>
      );

    case 'choose-peeked-supporter':
      // The eligible cards aren't on the tableau (typically peeked off the
      // top of the supporter deck) so the player needs to see their full
      // text inline to pick. Render each as a small card-button.
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.eligibleCardIds.map((cid) => {
            const card = findSupporterCard(state, cid);
            if (!card) {
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => resolve({ kind: 'card-chosen', cardId: cid })}
                  className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
                >
                  {cid}
                </button>
              );
            }
            return (
              <button
                key={cid}
                type="button"
                onClick={() => resolve({ kind: 'card-chosen', cardId: cid })}
                className="w-60 text-left rounded px-2 py-2 bg-slate-950 ring-2 ring-amber-400 hover:bg-amber-500/15 hover:ring-amber-300"
              >
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-medium text-slate-100">
                    {card.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {card.department}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    {card.timing}
                  </span>
                </div>
                {card.title && (
                  <div className="text-[10px] text-slate-500 italic mt-0.5">
                    {card.title}
                  </div>
                )}
                {card.description && (
                  <div className="text-[11px] text-slate-300/90 mt-0.5">
                    {card.description}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      );

    case 'choose-spell-level':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.availableLevels.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => resolve({ kind: 'level-chosen', level })}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              L{level}
            </button>
          ))}
        </div>
      );

    case 'choose-deck':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.eligibleDecks.map((deck) => (
            <button
              key={deck}
              type="button"
              onClick={() => resolve({ kind: 'deck-chosen', deck })}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {deck}
            </button>
          ))}
        </div>
      );

    case 'choose-voter':
      return (
        <div className="flex flex-wrap gap-2">
          {prompt.eligibleVoterIds.map((vid) => (
            <button
              key={vid}
              type="button"
              onClick={() => resolve({ kind: 'voter-chosen', voterId: vid })}
              className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {vid}
            </button>
          ))}
        </div>
      );

    case 'reaction-window':
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Trigger:{' '}
            {prompt.triggerEvents
              .map((e) =>
                'mageId' in e ? `${e.kind} (${e.mageId})` : e.kind,
              )
              .join(', ')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolve({ kind: 'reaction-passed' })}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600"
            >
              Pass
            </button>
            {prompt.reactionOptions.length === 0 && (
              <span className="text-xs text-slate-500 self-center">
                no reactions available
              </span>
            )}
            {prompt.reactionOptions.map((o) => (
              <button
                key={o.effectId}
                type="button"
                onClick={() => {
                  if (o.requiresSlotPick) {
                    // Two-step: collect the slot pick on the board, then
                    // submit reaction-played with destinationSpaceId.
                    onReactionAwaitingSlot({
                      resolutionId: pending.id,
                      effectId: o.effectId,
                    });
                    return;
                  }
                  resolve({
                    kind: 'reaction-played',
                    effectId: o.effectId,
                    reactionContext: {},
                  });
                }}
                className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
                title={
                  o.requiresSlotPick
                    ? 'Then pick an open slot on the board'
                    : undefined
                }
              >
                {o.label}
                {o.requiresSlotPick && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-700">
                    pick slot
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      );

    case 'confirm':
      return (
        <button
          type="button"
          onClick={() => resolve({ kind: 'confirmed' })}
          className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
        >
          {prompt.message}
        </button>
      );
  }
}

function ReactionWindowsPanel({ state }: { state: GameState }) {
  return (
    <section className="rounded border border-purple-500/40 bg-purple-500/10 p-3 space-y-1">
      <h2 className="text-sm font-medium text-purple-100">
        Reaction windows: {state.activeReactionWindows.length}
      </h2>
      {state.activeReactionWindows.map((w) => (
        <p key={w.id} className="text-xs text-slate-300">
          {w.id}: triggers=[{w.triggerEvents.map((e) => e.kind).join(', ')}] ·
          queue=[{w.pendingResponderIds.join(', ')}] · reacted=[
          {w.reactedPlayerIds.join(', ')}]
        </p>
      ))}
    </section>
  );
}

function ResourceLine({ player }: { player: Player }) {
  const r = player.resources;
  // Total INT/WIS "earned" = currently unused + already spent on spell
  // research. Each `intPlaced` consumed 1 INT; each `wisPlacedLevel2` /
  // `wisPlacedLevel3` consumed 1 WIS. Show as "unused (total)" so the
  // player can see both their available pool and how much they've earned
  // overall this game.
  //
  // The candidate's leader spell is "free" at game start — it ships with
  // intPlaced=true but no INT was spent on it, so we exclude it from the
  // spent tally.
  let intSpent = 0;
  let wisSpent = 0;
  for (const s of player.ownedSpells) {
    const isLeaderSpell = s.cardId === player.candidateStartingSpellId;
    if (isLeaderSpell) continue;
    if (s.intPlaced) intSpent += 1;
    if (s.wisPlacedLevel2) wisSpent += 1;
    if (s.wisPlacedLevel3) wisSpent += 1;
  }
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-300 items-center">
      <ResourcePill kind="gold" count={r.gold} />
      <ResourcePill kind="mana" count={r.mana} />
      <ResourcePill kind="influence" count={r.influence} />
      <ResourcePill
        kind="intelligence"
        count={r.intelligence}
        totalEarned={r.intelligence + intSpent}
      />
      <ResourcePill
        kind="wisdom"
        count={r.wisdom}
        totalEarned={r.wisdom + wisSpent}
      />
      <ResourcePill kind="marks" count={r.marks} />
      <ResourcePill kind="merit-badge" count={r.meritBadges} />
      {r.meritBadgesSpent > 0 && (
        <span className="text-slate-500">spent {r.meritBadgesSpent} MB</span>
      )}
    </div>
  );
}

function ResourcePill({
  kind,
  count,
  totalEarned,
  size = 14,
}: {
  kind: ResourceKind;
  count: number;
  /**
   * Optional grand-total this player has accumulated across the whole game
   * (used by INT/WIS: unused + already spent on research). When set and
   * greater than `count`, rendered in parens after the unused count, e.g.
   * "INT 2 (4)" = 2 unused, 4 earned this game.
   */
  totalEarned?: number;
  size?: number;
}) {
  const showTotal = totalEarned !== undefined && totalEarned > count;
  return (
    <span className="inline-flex items-center gap-1">
      <ResourceIcon kind={kind} size={size} />
      <span className="tabular-nums">
        {count}
        {showTotal && (
          <span className="text-slate-500"> ({totalEarned})</span>
        )}
      </span>
    </span>
  );
}

function PlayerCard({
  state,
  player,
  isFocus,
  dispatch,
  patchState,
  selectedMageId,
  onSelectMage,
  selectionMode,
  researchMode,
}: {
  state: GameState;
  player: Player;
  isFocus: boolean;
  dispatch: (action: GameAction) => void;
  patchState: (fn: (s: GameState) => GameState) => void;
  selectedMageId: string | null;
  onSelectMage: (id: string | null) => void;
  selectionMode: SelectionMode | null;
  researchMode: ResearchInputMode | null;
}) {
  const mageMode = selectionMode?.kind === 'mage' ? selectionMode : null;
  // Research-driven token / slot clicks only apply to the spells owned by
  // the responder (you can't move an opponent's INT/WIS).
  const researchTargetsThisPlayer =
    researchMode !== null && researchMode.responderId === player.id;
  const isErrandsActive =
    state.phase.kind === 'errands' &&
    state.players[state.phase.activePlayerIndex]?.id === player.id;
  const canAct = isErrandsActive && state.pendingResolutionStack.length === 0;
  const actionUsed =
    state.phase.kind === 'errands' && isErrandsActive
      ? state.phase.actionUsed
      : false;
  const fastActionUsed =
    state.phase.kind === 'errands' && isErrandsActive
      ? state.phase.fastActionUsed
      : false;
  const canTakeAction = canAct && !actionUsed;
  const canTakeFastAction = canAct && !fastActionUsed;

  return (
    <div
      className={clsx(
        'rounded border p-3 space-y-2',
        isFocus
          ? 'border-amber-400/60 bg-amber-400/5'
          : 'border-slate-700 bg-slate-900',
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">{playerDisplayName(state, player)}</h3>
          <p className="text-xs text-slate-500">
            {player.id} · color {player.color} · init {player.initiativeOrder}
          </p>
        </div>
        {isErrandsActive && (
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500 text-slate-950">
              active
            </span>
            <div className="flex gap-1 text-[10px]">
              <span
                className={clsx(
                  'px-1.5 py-0.5 rounded uppercase tracking-wide',
                  actionUsed
                    ? 'bg-slate-800 text-slate-500 line-through'
                    : 'bg-emerald-500/20 text-emerald-300',
                )}
                title="Mandatory: 1 Action per turn"
              >
                action
              </span>
              <span
                className={clsx(
                  'px-1.5 py-0.5 rounded uppercase tracking-wide',
                  fastActionUsed
                    ? 'bg-slate-800 text-slate-500 line-through'
                    : 'bg-purple-500/20 text-purple-300',
                )}
                title="Optional: 1 Fast Action per turn"
              >
                fast
              </span>
            </div>
          </div>
        )}
      </div>

      <ResourceLine player={player} />

      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
          Workers ({player.mages.length})
        </p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {player.mages.length === 0 && (
            <span className="text-xs text-slate-500 italic">no mages yet</span>
          )}
          {player.mages.map((m) => {
            const inOffice = m.location.kind === 'office';
            const placeable =
              canAct && inOffice && !m.isWounded;
            // Purple (Planar Studies) mages prefer the Fast Action but can
            // fall back to the Regular Action when Fast is spent — so the
            // tile stays clickable as long as the Regular Action is still
            // available. Non-purple mages always consume the Regular Action.
            const budgetOpen = !actionUsed;
            const mageTargetable = mageMode?.eligibleIds.has(m.id) ?? false;
            // Prompt-driven targeting wins over placement selection: an
            // active prompt blocks normal play anyway, and the eligibility
            // filter already screens for the right mages.
            const clickable = mageMode
              ? mageTargetable
              : placeable && budgetOpen;
            const isSelected = !mageMode && selectedMageId === m.id;
            const dimReason = !inOffice
              ? m.location.kind === 'action-space'
                ? 'on a slot'
                : m.location.kind === 'infirmary'
                  ? 'in infirmary'
                  : 'banished'
              : m.isWounded
                ? 'wounded'
                : !canAct
                  ? 'not your turn'
                  : !budgetOpen
                    ? 'Action used'
                    : null;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (mageMode) {
                    mageMode.onSelect(m.id);
                    return;
                  }
                  onSelectMage(isSelected ? null : m.id);
                }}
                title={
                  mageMode
                    ? mageTargetable
                      ? 'click to target this mage'
                      : 'not a legal target'
                    : clickable
                      ? isSelected
                        ? 'Selected — click again to deselect'
                        : `Place this ${m.color} mage`
                      : (dimReason ?? m.color)
                }
                className={clsx(
                  'rounded p-0.5 transition-all',
                  isSelected
                    ? 'ring-2 ring-amber-400 bg-amber-400/10'
                    : mageMode && mageTargetable
                      ? 'ring-2 ring-amber-400 hover:bg-amber-400/20'
                      : clickable
                        ? 'hover:ring-2 hover:ring-amber-400/40 hover:bg-slate-800'
                        : 'opacity-40 cursor-not-allowed',
                )}
              >
                <MageIcon color={m.color} size={28} />
              </button>
            );
          })}
        </div>
      </div>

      <details open={player.ownedSpells.length > 0}>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Spells ({player.ownedSpells.length})
        </summary>
        <ul className="text-xs mt-1 space-y-1 text-slate-300">
          {player.ownedSpells.length === 0 && (
            <li className="text-slate-500 italic">none yet</li>
          )}
          {player.ownedSpells.map((s) => {
            const card = findSpellCard(state, s.cardId);
            if (!card) {
              return (
                <li key={s.cardId} className="flex items-center gap-2">
                  <span>
                    {s.cardId}
                    {s.exhausted ? ' (exhausted)' : ''}
                  </span>
                </li>
              );
            }
            const researched: (1 | 2 | 3)[] = [];
            if (s.intPlaced) researched.push(1);
            if (s.wisPlacedLevel2) researched.push(2);
            if (s.wisPlacedLevel3) researched.push(3);
            return (
              <li
                key={s.cardId}
                className={clsx(
                  'rounded px-2 py-1',
                  s.exhausted ? 'bg-slate-950/20 opacity-60' : 'bg-slate-950/40',
                )}
              >
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-medium text-slate-200">
                    {card.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {card.department}
                  </span>
                  {card.unique && (
                    <span
                      className="text-[10px] uppercase tracking-wide text-amber-300"
                      title="Faction leader spell — single-level, no research needed"
                    >
                      unique
                    </span>
                  )}
                  {s.exhausted && (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      exhausted
                    </span>
                  )}
                  {!card.unique && researched.length > 0 && (
                    <span className="text-[10px] uppercase tracking-wide text-emerald-300/70">
                      researched: {researched.join(',')}
                    </span>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {card.levels.map((lv) => {
                    const owned =
                      (lv.level === 1 && s.intPlaced) ||
                      (lv.level === 2 && s.wisPlacedLevel2) ||
                      (lv.level === 3 && s.wisPlacedLevel3);
                    const isFast = lv.timing === 'fast-action';
                    const budgetOpen = isFast ? canTakeFastAction : canTakeAction;
                    const canCast =
                      !s.exhausted &&
                      owned &&
                      canAct &&
                      lv.timing !== 'reaction';
                    // Per-level INT/WIS box: L1 holds an INT when learned,
                    // L2/L3 each hold a WIS when the level is unlocked.
                    // Leader (unique) spells never need research and use a
                    // dash placeholder.
                    const tokenKind: 'int' | 'wis' | null = card.unique
                      ? null
                      : lv.level === 1
                        ? 'int'
                        : 'wis';
                    // Determine whether THIS slot/token is clickable in
                    // the current research-input mode. Only the responder's
                    // own spells participate; unique spells never do.
                    let researchClick: (() => void) | undefined;
                    let researchHint: string | undefined;
                    // Note: an exhausted spell is still a legal RESEARCH
                    // target (exhaustion only blocks casting, not adding /
                    // moving WIS). Don't gate by `s.exhausted` here.
                    if (
                      researchMode &&
                      researchTargetsThisPlayer &&
                      !card.unique
                    ) {
                      const src = researchMode.source;
                      if (src === null) {
                        // Idle: clickable if this slot/token can start a
                        // valid action.
                        if (
                          owned &&
                          tokenKind === 'int' &&
                          researchMode.availableOptions.has('move-int')
                        ) {
                          researchClick = () =>
                            researchMode.onClickIntToken(s.cardId);
                          researchHint = 'Move this INT to a new spell';
                        } else if (
                          owned &&
                          tokenKind === 'wis' &&
                          researchMode.availableOptions.has('move-wis')
                        ) {
                          researchClick = () =>
                            researchMode.onClickWisToken(s.cardId);
                          researchHint = 'Move this WIS to another spell';
                        } else if (
                          !owned &&
                          tokenKind === 'wis' &&
                          s.intPlaced &&
                          ((lv.level === 2) ||
                            (lv.level === 3 && s.wisPlacedLevel2)) &&
                          researchMode.availableOptions.has('add-wis')
                        ) {
                          researchClick = () =>
                            researchMode.onClickEmptyWisSlot(s.cardId);
                          researchHint = `Add WIS to unlock L${lv.level}`;
                        }
                      } else if (src.kind === 'wis') {
                        // Move-WIS in progress — destination must be a
                        // different owned learned spell's next empty WIS.
                        if (
                          !owned &&
                          tokenKind === 'wis' &&
                          s.intPlaced &&
                          ((lv.level === 2) ||
                            (lv.level === 3 && s.wisPlacedLevel2)) &&
                          src.cardId !== s.cardId
                        ) {
                          researchClick = () =>
                            researchMode.onClickEmptyWisSlot(s.cardId);
                          researchHint = `Place moved WIS here (L${lv.level})`;
                        }
                      }
                      // src.kind === 'int' destinations are tableau spells,
                      // handled in TableauPanel.
                    }
                    const tokenBox = researchClick ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          researchClick?.();
                        }}
                        title={researchHint}
                        className={clsx(
                          'inline-flex items-center justify-center w-5 h-5 rounded border text-[9px] uppercase tracking-wide font-semibold ring-2 ring-amber-400 hover:bg-amber-400/30 cursor-pointer',
                          owned
                            ? lv.level === 1
                              ? 'border-cyan-300 bg-cyan-500/30 text-cyan-200'
                              : 'border-violet-300 bg-violet-500/30 text-violet-200'
                            : 'border-amber-400 bg-amber-400/15 text-amber-200',
                        )}
                      >
                        {owned ? (tokenKind === 'int' ? 'I' : 'W') : '+'}
                      </button>
                    ) : (
                      <span
                        className={clsx(
                          'inline-flex items-center justify-center w-5 h-5 rounded border text-[9px] uppercase tracking-wide font-semibold',
                          owned
                            ? lv.level === 1
                              ? 'border-cyan-300 bg-cyan-500/20 text-cyan-200'
                              : 'border-violet-300 bg-violet-500/20 text-violet-200'
                            : 'border-slate-700 bg-slate-950/30 text-slate-700',
                        )}
                        title={
                          card.unique
                            ? 'Leader spell — no research required'
                            : owned
                              ? `${tokenKind === 'int' ? 'INT' : 'WIS'} placed (L${lv.level} unlocked)`
                              : `L${lv.level} requires ${tokenKind === 'int' ? 'an INT' : 'a WIS'}`
                        }
                      >
                        {card.unique
                          ? '—'
                          : owned
                            ? (tokenKind === 'int' ? 'I' : 'W')
                            : ''}
                      </span>
                    );
                    return (
                      <li
                        key={lv.level}
                        className={clsx(
                          'flex items-baseline gap-1.5 text-[11px]',
                          !owned && 'opacity-50',
                        )}
                      >
                        {tokenBox}
                        <span className="text-slate-500">L{lv.level}</span>
                        <span className="font-medium text-slate-300">
                          {lv.title}
                        </span>
                        <span className="text-[10px] uppercase text-slate-500">
                          {lv.timing}
                        </span>
                        <span className="text-[10px] uppercase text-cyan-300/70 inline-flex items-center gap-0.5">
                          {lv.manaCost}
                          <ResourceIcon kind="mana" size={10} />
                        </span>
                        <span className="text-slate-400/80 flex-1">
                          {lv.description ?? ''}
                        </span>
                        {canCast && (
                          <button
                            type="button"
                            disabled={!budgetOpen}
                            title={
                              budgetOpen
                                ? `Cast ${lv.title}`
                                : isFast
                                  ? 'Fast Action already used'
                                  : 'Action already used'
                            }
                            onClick={() =>
                              dispatch({
                                type: 'CAST_SPELL',
                                playerId: player.id,
                                spellCardId: s.cardId,
                                level: lv.level,
                              })
                            }
                            className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Cast
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </details>

      <details open={player.vaultCards.length > 0}>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Vault cards ({player.vaultCards.length})
        </summary>
        <ul className="text-xs mt-1 space-y-1 text-slate-300">
          {player.vaultCards.length === 0 && (
            <li className="text-slate-500 italic">none yet</li>
          )}
          {player.vaultCards.map((v, i) => {
            const card = findVaultCard(state, v.cardId);
            if (!card) {
              return (
                <li key={i}>
                  {v.cardId} {v.exhausted ? '(exhausted)' : ''}
                </li>
              );
            }
            const isFast = card.timing === 'fast-action';
            const playable =
              canAct &&
              !v.exhausted &&
              (card.timing === 'action' || card.timing === 'fast-action') &&
              (isFast ? !fastActionUsed : !actionUsed);
            const reason =
              v.exhausted
                ? 'exhausted — refreshes at next round'
                : card.timing === 'reaction'
                  ? 'fires from a reaction window'
                  : !canAct
                    ? 'not your turn'
                    : isFast
                      ? 'Fast Action already used'
                      : 'Action already used';
            return (
              <li
                key={i}
                className={clsx(
                  'flex items-start gap-2 rounded px-2 py-1',
                  v.exhausted ? 'bg-slate-950/20 opacity-60' : 'bg-slate-950/40',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-200">
                      {card.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {card.type}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                      {card.timing}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-amber-300/70 inline-flex items-center gap-0.5">
                      {card.goldCost}
                      <ResourceIcon kind="gold" size={11} />
                    </span>
                    {v.exhausted && (
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        exhausted
                      </span>
                    )}
                  </div>
                  {card.description && (
                    <div className="text-[11px] text-slate-300/90">
                      {card.description}
                    </div>
                  )}
                </div>
                {(card.timing === 'action' || card.timing === 'fast-action') && (
                  <button
                    type="button"
                    disabled={!playable}
                    title={playable ? `Play ${card.name}` : reason}
                    onClick={() =>
                      dispatch({
                        type: 'PLAY_VAULT_CARD',
                        playerId: player.id,
                        vaultCardId: v.cardId,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed self-start"
                  >
                    Play
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      <details open={player.supporters.length > 0}>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Supporters ({player.supporters.length})
        </summary>
        <ul className="text-xs mt-1 space-y-1 text-slate-300">
          {player.supporters.length === 0 && (
            <li className="text-slate-500 italic">none yet</li>
          )}
          {player.supporters.map((cid, i) => {
            const card = findSupporterCard(state, cid);
            if (!card) {
              return <li key={`${cid}-${i}`}>{cid}</li>;
            }
            const isFast = card.timing === 'fast-action';
            const playable =
              canAct &&
              (card.timing === 'action' || card.timing === 'fast-action') &&
              (isFast ? !fastActionUsed : !actionUsed);
            const reasonNotPlayable =
              card.timing === 'passive'
                ? 'familiar — passive, never played'
                : card.timing === 'endgame'
                  ? 'endgame scoring only'
                  : card.timing === 'reaction'
                    ? 'fires from a reaction window'
                    : !canAct
                      ? 'not your turn'
                      : isFast
                        ? 'Fast Action already used'
                        : 'Action already used';
            return (
              <li
                key={`${cid}-${i}`}
                className="flex items-start gap-2 rounded bg-slate-950/40 px-2 py-1"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-200">
                      {card.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {card.department}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                      {card.timing}
                    </span>
                  </div>
                  {card.title && (
                    <div className="text-[10px] text-slate-500 italic">
                      {card.title}
                    </div>
                  )}
                  {card.description && (
                    <div className="text-[11px] text-slate-300/90">
                      {card.description}
                    </div>
                  )}
                </div>
                {(card.timing === 'action' || card.timing === 'fast-action') && (
                  <button
                    type="button"
                    disabled={!playable}
                    title={playable ? `Play ${card.name}` : reasonNotPlayable}
                    onClick={() =>
                      dispatch({
                        type: 'PLAY_SUPPORTER',
                        playerId: player.id,
                        supporterCardId: cid,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed self-start"
                  >
                    Play
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      {player.personalDiscard.length > 0 && (
        <details>
          <summary className="text-xs text-slate-400 cursor-pointer">
            Discard ({player.personalDiscard.length})
          </summary>
          <ul className="text-xs mt-1 space-y-0.5 text-slate-300">
            {player.personalDiscard.map((d, i) => (
              <li key={i}>
                {d.kind} — {d.cardId}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canAct && selectedMageId && (
        <p className="text-[11px] text-amber-300/80">
          Selected — click a highlighted slot to place, or click the mage
          again to cancel.
        </p>
      )}

      {canAct && !actionUsed && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'PASS_TURN', playerId: player.id })}
          className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          title="Forfeit your Action and end your turn"
        >
          Pass turn
        </button>
      )}

      <div className="pt-1 border-t border-slate-800 space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          inject (debug)
        </p>
        <div className="flex flex-wrap gap-1">
          {INJECTABLE_MAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => patchState((s) => injectMage(s, player.id, c))}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] inline-flex items-center gap-1"
              title={`Inject a ${c} mage`}
            >
              +<MageIcon color={c} size={11} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => patchState((s) => injectBurnAndMana(s, player.id))}
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
          >
            +Burn +5 mana
          </button>
          <button
            type="button"
            onClick={() => patchState((s) => injectPhaseSteppers(s, player.id))}
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
          >
            +Phase Steppers
          </button>
          <button
            type="button"
            onClick={() => patchState((s) => bumpResource(s, player.id, 'gold', 5))}
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] inline-flex items-center gap-1"
            title="Inject 5 Gold"
          >
            +5 <ResourceIcon kind="gold" size={11} />
          </button>
          <button
            type="button"
            onClick={() => patchState((s) => bumpResource(s, player.id, 'meritBadges', 1))}
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] inline-flex items-center gap-1"
            title="Inject 1 Merit Badge"
          >
            +1 <ResourceIcon kind="merit-badge" size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VoterTableauPanel — the Consortium voter board.
//
// Renders every voter as a row with the voter's identity (or "[face-down]"
// for unrevealed mystery voters), per-player mark slots, and a per-row
// "peek" affordance that reveals the voter's identity locally to a player
// who has placed their mark on it. The "peeked" state lives in component
// state — it's a UI memory aid, not game state — so it disappears on reload.
// ============================================================================

const PLAYER_COLOR_BG: Record<string, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-400',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
};

/**
 * Final scoring header — renders only when the game has reached the
 * `complete` phase. Surfaces the winner banner, per-player vote totals,
 * and the tiebreaker that landed the archmage (or explains why no
 * archmage emerged). The Voters table below adds per-row highlights
 * to show which player won each voter (or that they abstained).
 */
function FinalScoringPanel({ state }: { state: GameState }) {
  const result = computeFinalScoring(state);
  const archmage =
    result.archmage !== null
      ? state.players.find((p) => p.id === result.archmage)
      : null;
  const tiebreakerLabel: Record<typeof result.tiebreaker, string> = {
    votes: 'Most votes',
    influence: 'Tied on votes — won on total Influence',
    'influence-arrival':
      'Tied on votes and Influence — reached that Influence value first',
    none: 'Game tied — no Archmage',
  };
  return (
    <section className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-4 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-amber-200">Final Scoring</h2>
        {archmage ? (
          <div className="flex items-baseline gap-2">
            <span
              className={clsx(
                'inline-block w-3 h-3 rounded-full',
                PLAYER_COLOR_BG[archmage.color] ?? 'bg-slate-400',
              )}
            />
            <span className="text-lg font-medium">
              <span className="text-amber-200">{archmage.name}</span> wins as
              Archmage
            </span>
          </div>
        ) : (
          <span className="text-lg font-medium text-slate-300">
            No Archmage — game tied at every tiebreaker
          </span>
        )}
        <span className="text-xs text-slate-400 italic">
          ({tiebreakerLabel[result.tiebreaker]})
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {state.players.map((p) => {
          const votes = result.votesPerPlayer[p.id] ?? 0;
          const isWinner = result.archmage === p.id;
          return (
            <div
              key={p.id}
              className={clsx(
                'rounded border p-2 flex items-center gap-2',
                isWinner
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-slate-700 bg-slate-900',
              )}
            >
              <span
                className={clsx(
                  'inline-block w-3 h-3 rounded-full',
                  PLAYER_COLOR_BG[p.color] ?? 'bg-slate-400',
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-[11px] text-slate-400">
                  IP {p.resources.influence}
                  {p.influenceArrivalSeq > 0
                    ? ` · seq ${p.influenceArrivalSeq}`
                    : ''}
                </div>
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {votes}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function VoterTableauPanel({
  state,
  selectionMode,
}: {
  state: GameState;
  selectionMode: SelectionMode | null;
}) {
  const voterMode =
    selectionMode?.kind === 'voter' ? selectionMode : null;
  // Per-player peeked voters: lets the active player reveal a face-down
  // voter they've marked. Resets on page reload (intentional — it's a UI
  // memory aid, not authoritative game state).
  const [peeked, setPeeked] = useState<Record<string, Set<string>>>({});
  const peekedFor = (playerId: string) => peeked[playerId] ?? new Set<string>();
  const togglePeek = (playerId: string, voterId: string) => {
    setPeeked((prev) => {
      const next = new Set(prev[playerId] ?? new Set<string>());
      if (next.has(voterId)) next.delete(voterId);
      else next.add(voterId);
      return { ...prev, [playerId]: next };
    });
  };

  const activeId =
    state.phase.kind === 'errands'
      ? (state.players[state.phase.activePlayerIndex]?.id ?? null)
      : null;
  // Voters only reveal globally when the game is complete (at which point
  // `finalizeGame` has already flipped every voter's `revealed` flag).
  // mid-game-scoring is a pass-through phase between rounds and must NOT
  // expose face-down voters.
  const scoringRevealed = state.phase.kind === 'complete';
  // Pre-compute per-voter winners so each row can highlight the awarded
  // player's column. Only done when the game is complete; mid-game we
  // don't show would-be winners (voters could still be marked).
  const voterWinners: Record<string, string | null> = scoringRevealed
    ? Object.fromEntries(
        computeFinalScoring(state).voterAwards.map((a) => [
          a.voterId,
          a.winnerPlayerId,
        ]),
      )
    : {};

  const playerHasMark = (playerId: string, voterId: string) =>
    state.voterMarks.some(
      (m) => m.voterId === voterId && m.playerId === playerId,
    );

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <h2 className="text-lg font-medium">
          Consortium Voters ({state.voters.length})
        </h2>
        <span className="text-xs text-slate-500">
          {state.voters.filter((v) => v.revealed).length} face-up ·{' '}
          {state.voters.filter((v) => !v.revealed).length} face-down ·{' '}
          {state.voterMarks.length} mark{state.voterMarks.length === 1 ? '' : 's'} placed
        </span>
      </div>
      <div className="rounded border border-slate-700 bg-slate-900 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-950/40 text-slate-400 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-2 py-1.5 w-1/2">Voter</th>
              {state.players.map((p) => (
                <th key={p.id} className="text-center px-1 py-1.5">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.voters.map((v) => {
              const revealedNow =
                v.revealed ||
                scoringRevealed ||
                (activeId !== null &&
                  peekedFor(activeId).has(v.id) &&
                  playerHasMark(activeId, v.id));
              const voterEligible =
                voterMode?.eligibleIds.has(v.id) ?? false;
              return (
                <tr
                  key={v.id}
                  className={clsx(
                    'border-t border-slate-800 align-top',
                    voterMode && voterEligible && 'ring-2 ring-amber-400 cursor-pointer hover:bg-amber-400/10',
                    voterMode && !voterEligible && 'opacity-50',
                  )}
                  onClick={
                    voterMode && voterEligible
                      ? () => voterMode.onSelect(v.id)
                      : undefined
                  }
                >
                  <td className="px-2 py-1.5">
                    {revealedNow ? (
                      <div>
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="font-medium text-slate-200">
                            {v.name}
                          </span>
                          {v.isAlwaysFaceUp && (
                            <span className="text-[10px] uppercase tracking-wide text-amber-300/70">
                              required
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            {v.votes} vote{v.votes === 1 ? '' : 's'}
                          </span>
                        </div>
                        {v.title && (
                          <div className="text-[10px] text-slate-500 italic">
                            {v.title}
                          </div>
                        )}
                        {v.description && (
                          <div className="text-[11px] text-slate-300/90">
                            {v.description}
                          </div>
                        )}
                        {scoringRevealed && voterWinners[v.id] === null && (
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">
                            abstained
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-slate-500 italic">
                          [face-down voter]
                        </span>
                        {activeId !== null && playerHasMark(activeId, v.id) && (
                          <button
                            type="button"
                            onClick={() => togglePeek(activeId, v.id)}
                            className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px]"
                            title="Reveal this voter to yourself (UI only)"
                          >
                            Peek
                          </button>
                        )}
                      </div>
                    )}
                    {revealedNow && !v.revealed && !scoringRevealed && activeId !== null && peekedFor(activeId).has(v.id) && (
                      <button
                        type="button"
                        onClick={() => togglePeek(activeId, v.id)}
                        className="mt-1 px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px]"
                        title="Hide this voter again"
                      >
                        Hide
                      </button>
                    )}
                  </td>
                  {state.players.map((p) => {
                    const marked = playerHasMark(p.id, v.id);
                    const colorClass =
                      PLAYER_COLOR_BG[p.color] ?? 'bg-slate-400';
                    const wonThisVoter =
                      scoringRevealed && voterWinners[v.id] === p.id;
                    return (
                      <td
                        key={p.id}
                        className={clsx(
                          'px-1 py-1.5 text-center',
                          wonThisVoter && 'bg-amber-400/10',
                        )}
                      >
                        <span
                          className={clsx(
                            'inline-block w-4 h-4 rounded-full border',
                            marked
                              ? `${colorClass} border-slate-200`
                              : 'border-slate-700 bg-slate-950/40',
                          )}
                          title={
                            marked
                              ? `${p.name} has placed a Mark here`
                              : `${p.name} has not marked this voter`
                          }
                        />
                        {wonThisVoter && (
                          <div className="text-[10px] text-amber-300 font-medium mt-1">
                            +{v.votes}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TableauPanel({
  state,
  selectionMode,
  researchMode,
}: {
  state: GameState;
  selectionMode: SelectionMode | null;
  researchMode: ResearchInputMode | null;
}) {
  const vaultMode =
    selectionMode?.kind === 'vault-card' ? selectionMode : null;
  const supporterMode =
    selectionMode?.kind === 'supporter-card' ? selectionMode : null;
  // Spell tableau cards become clickable in two research-mode situations:
  //  1) idle and 'draft' is an available top-level option (learn a new
  //     spell using 1 INT from the pool),
  //  2) the player has clicked an INT token to start a move-INT, so this
  //     pick is the destination tableau spell.
  const spellResearchClickable =
    researchMode !== null &&
    ((researchMode.source === null &&
      researchMode.availableOptions.has('draft')) ||
      researchMode.source?.kind === 'int');
  return (
    <section className="rounded border border-slate-700 bg-slate-900 p-3">
      <h2 className="text-sm font-medium mb-2">Tableaus</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
        <div>
          <p className="font-medium text-slate-200">
            Spells ({state.spellTableau.length}/3)
          </p>
          <ul className="space-y-1">
            {state.spellTableau.map((cid, i) => {
              const card = findSpellCard(state, cid);
              if (!card) {
                return <li key={`${cid}-${i}`}>{cid}</li>;
              }
              const body = (
                <>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-200">
                      {card.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {card.department}
                    </span>
                    {card.unique && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-300">
                        unique
                      </span>
                    )}
                  </div>
                  <ul className="text-[11px] text-slate-400 space-y-0.5 mt-0.5">
                    {card.levels.map((lv) => (
                      <li key={lv.level} className="flex items-baseline gap-1">
                        <span className="text-slate-500">L{lv.level}</span>
                        <span className="text-slate-300">{lv.title}</span>
                        <span className="text-[10px] uppercase text-slate-500">
                          {lv.timing}
                        </span>
                        <span className="text-[10px] text-cyan-300/70 inline-flex items-center gap-0.5">
                          {lv.manaCost}
                          <ResourceIcon kind="mana" size={9} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              );
              if (spellResearchClickable && researchMode) {
                return (
                  <li key={`${cid}-${i}`}>
                    <button
                      type="button"
                      onClick={() => researchMode.onClickTableauSpell(cid)}
                      className="w-full text-left rounded px-2 py-1 bg-slate-950/40 ring-2 ring-amber-400 hover:bg-amber-400/15 hover:ring-amber-300 cursor-pointer"
                      title={
                        researchMode.source === null
                          ? 'Click to learn this spell (uses 1 INT)'
                          : 'Click to draft this as the new spell (move INT)'
                      }
                    >
                      {body}
                    </button>
                  </li>
                );
              }
              return (
                <li
                  key={`${cid}-${i}`}
                  className="rounded bg-slate-950/40 px-2 py-1"
                >
                  {body}
                </li>
              );
            })}
            {state.spellTableau.length === 0 && (
              <li className="text-slate-500 italic">empty</li>
            )}
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-200">
            Vault ({state.vaultTableau.length}/3)
          </p>
          <ul className="space-y-1">
            {state.vaultTableau.map((cid, i) => {
              const card = findVaultCard(state, cid);
              if (!card) {
                return <li key={`${cid}-${i}`}>{cid}</li>;
              }
              const eligible = vaultMode?.eligibleIds.has(cid) ?? false;
              const body = (
                <>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-200">
                      {card.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {card.type}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                      {card.timing}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-amber-300/70 inline-flex items-center gap-0.5">
                      {card.goldCost}
                      <ResourceIcon kind="gold" size={11} />
                    </span>
                  </div>
                  {card.description && (
                    <div className="text-[11px] text-slate-300/90">
                      {card.description}
                    </div>
                  )}
                </>
              );
              if (vaultMode && eligible) {
                return (
                  <li key={`${cid}-${i}`}>
                    <button
                      type="button"
                      onClick={() => vaultMode.onSelect(cid)}
                      className="w-full text-left rounded px-2 py-1 bg-slate-950/40 ring-2 ring-amber-400 hover:bg-amber-400/15 hover:ring-amber-300 cursor-pointer"
                    >
                      {body}
                    </button>
                  </li>
                );
              }
              return (
                <li
                  key={`${cid}-${i}`}
                  className={clsx(
                    'rounded bg-slate-950/40 px-2 py-1',
                    vaultMode && !eligible && 'opacity-50',
                  )}
                >
                  {body}
                </li>
              );
            })}
            {state.vaultTableau.length === 0 && (
              <li className="text-slate-500 italic">empty</li>
            )}
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-200">
            Supporters ({state.supporterTableau.length}/5)
          </p>
          <ul className="space-y-1">
            {state.supporterTableau.map((cid, i) => {
              const card = findSupporterCard(state, cid);
              if (!card) {
                return <li key={`${cid}-${i}`}>{cid}</li>;
              }
              const eligible = supporterMode?.eligibleIds.has(cid) ?? false;
              const body = (
                <>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-200">
                      {card.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {card.department}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                      {card.timing}
                    </span>
                  </div>
                  {card.title && (
                    <div className="text-[10px] text-slate-500 italic">
                      {card.title}
                    </div>
                  )}
                  {card.description && (
                    <div className="text-[11px] text-slate-300/90">
                      {card.description}
                    </div>
                  )}
                </>
              );
              if (supporterMode && eligible) {
                return (
                  <li key={`${cid}-${i}`}>
                    <button
                      type="button"
                      onClick={() => supporterMode.onSelect(cid)}
                      className="w-full text-left rounded px-2 py-1 bg-slate-950/40 ring-2 ring-amber-400 hover:bg-amber-400/15 hover:ring-amber-300 cursor-pointer"
                    >
                      {body}
                    </button>
                  </li>
                );
              }
              return (
                <li
                  key={`${cid}-${i}`}
                  className={clsx(
                    'rounded bg-slate-950/40 px-2 py-1',
                    supporterMode && !eligible && 'opacity-50',
                  )}
                >
                  {body}
                </li>
              );
            })}
            {state.supporterTableau.length === 0 && (
              <li className="text-slate-500 italic">empty</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function collectAvailableCandidates(state: GameState): Candidate[] {
  const out: Candidate[] = [];
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    out.push(...pack.candidates);
  }
  return out;
}

function CandidateDraftScreen({
  state,
  dispatch,
  reset,
}: {
  state: GameState;
  dispatch: (action: GameAction) => void;
  reset: () => void;
}) {
  // Local "highlighted" candidate per active player. Player clicks a card
  // to highlight; clicks the "Pick as X" button to confirm.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const activeIdx =
    state.phase.kind === 'candidate-draft' ? state.phase.activePlayerIndex : -1;
  const activePlayerId = state.players[activeIdx]?.id ?? null;

  // Reset highlight when the choosing player changes (turn rotated to the
  // next picker). Effect runs after render so it never crashes the
  // render-phase tree.
  useEffect(() => {
    setHighlighted(null);
  }, [activePlayerId]);

  if (state.phase.kind !== 'candidate-draft') return null;
  const activePlayer = state.players[activeIdx];
  const candidates = collectAvailableCandidates(state);
  const taken = new Map<string, string>();
  for (const p of state.players) {
    if (p.candidateId) taken.set(p.candidateId, p.name);
  }

  // Build the spell/mage lookup once.
  const spellById = new Map<string, SpellCard>();
  const mageByDept = new Map<Department | 'students', Mage | undefined>();
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    for (const sp of pack.legendarySpells) spellById.set(sp.id, sp);
    for (const sp of pack.spells) spellById.set(sp.id, sp);
    for (const m of pack.mages) {
      if (m.department) mageByDept.set(m.department, m);
    }
  }

  // Group candidates by department to render pairs side by side.
  const departmentOrder: Department[] = [
    'sorcery',
    'natural-magick',
    'mysticism',
    'planar-studies',
    'divinity',
    'students',
  ];
  const byDept = new Map<Department, Candidate[]>();
  for (const c of candidates) {
    if (!byDept.has(c.department)) byDept.set(c.department, []);
    byDept.get(c.department)!.push(c);
  }

  const departmentLabel: Record<Department, string> = {
    sorcery: 'Sorcery',
    'natural-magick': 'Natural Magick',
    mysticism: 'Mysticism',
    'planar-studies': 'Planar Studies',
    divinity: 'Divinity',
    students: 'Student Council',
    wild: 'Wild',
  };

  const highlightedCandidate = highlighted
    ? candidates.find((c) => c.id === highlighted) ?? null
    : null;

  return (
    <div className="min-h-full p-6 max-w-5xl mx-auto space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Argent — candidate draft</h1>
          <p className="text-slate-400 text-sm">
            {activePlayer?.name ?? '?'} is choosing a faction leader. Click a
            leader to preview, then confirm with the Pick button.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
        >
          Back to setup
        </button>
      </header>

      <section>
        <h2 className="text-lg font-medium mb-2">Players</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {state.players.map((p, i) => (
            <li
              key={p.id}
              className={clsx(
                'p-2 rounded border',
                i === activeIdx
                  ? 'border-amber-400/60 bg-amber-400/5'
                  : 'border-slate-700 bg-slate-900',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.name}</span>
                {i === activeIdx && (
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-500 text-slate-950">
                    choosing
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {p.candidateId
                  ? `picked: ${p.candidateId.split('.').pop()}`
                  : 'no pick yet'}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-medium">Faction Leaders</h2>
          {activePlayer && (
            <button
              type="button"
              disabled={
                !highlightedCandidate || taken.has(highlightedCandidate.id)
              }
              onClick={() => {
                if (!highlightedCandidate || !activePlayer) return;
                dispatch({
                  type: 'CHOOSE_CANDIDATE',
                  playerId: activePlayer.id,
                  candidateId: highlightedCandidate.id,
                });
                setHighlighted(null);
              }}
              className="px-4 py-2 rounded bg-amber-500 text-slate-950 font-medium hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {highlightedCandidate
                ? `Pick ${highlightedCandidate.name} (as ${activePlayer.name})`
                : `Pick (as ${activePlayer.name}) — select a leader first`}
            </button>
          )}
        </div>

        {departmentOrder.map((dept) => {
          const pair = byDept.get(dept) ?? [];
          if (pair.length === 0) return null;
          return (
            <div key={dept}>
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-1.5">
                {departmentLabel[dept]}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pair.map((c) =>
                  renderCandidateCard({
                    c,
                    spell: spellById.get(c.starterSpellId) ?? null,
                    mage: mageByDept.get(dept) ?? null,
                    isHighlighted: highlighted === c.id,
                    takenBy: taken.get(c.id),
                    onClick: () => {
                      if (taken.has(c.id)) return;
                      setHighlighted((cur) => (cur === c.id ? null : c.id));
                    },
                  }),
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function renderCandidateCard(args: {
  c: Candidate;
  spell: SpellCard | null;
  mage: Mage | null;
  isHighlighted: boolean;
  takenBy: string | undefined;
  onClick: () => void;
}) {
  const { c, spell, mage, isHighlighted, takenBy, onClick } = args;
  const mageColor =
    c.startingMageColor === 'neutral' ? 'off-white' : c.startingMageColor;
  const level1 = spell?.levels[0];
  const timingLabel =
    level1 === undefined
      ? null
      : level1.timing === 'fast-action'
        ? 'Fast Action'
        : level1.timing === 'reaction'
          ? 'Reaction'
          : 'Action';
  return (
    <button
      key={c.id}
      type="button"
      onClick={onClick}
      disabled={takenBy !== undefined}
      className={clsx(
        'text-left p-3 rounded border space-y-2 w-full transition-colors',
        takenBy
          ? 'border-slate-800 bg-slate-900/40 opacity-60 cursor-not-allowed'
          : isHighlighted
            ? 'border-amber-400 bg-amber-400/10 ring-2 ring-amber-400/40'
            : 'border-slate-700 bg-slate-900 hover:border-slate-500',
      )}
    >
      <div className="flex items-baseline justify-between">
        <h4 className="text-base font-semibold">{c.name}</h4>
        {c.startingExtraMeritBadge && (
          <span className="inline-flex items-center gap-1 text-xs">
            <ResourceIcon kind="merit-badge" size={12} />
            +1
          </span>
        )}
      </div>

      {/* Spell preview — styled like an in-game spell card. */}
      {spell && level1 ? (
        <div className="rounded border border-violet-500/40 bg-violet-500/5 p-2 space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-violet-200">
              {spell.name}
            </span>
            <span className="text-[10px] text-slate-400 inline-flex items-center gap-1">
              {timingLabel}
              {' · '}
              <ResourceIcon kind="mana" size={11} />
              {level1.manaCost}
            </span>
          </div>
          <p className="text-[11px] text-slate-200/90 italic leading-snug">
            {level1.description}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 italic">
          spell: {c.starterSpellId}
        </p>
      )}

      {/* Department mage + ability. */}
      <div className="rounded border border-slate-700 bg-slate-950/40 p-2 space-y-1">
        <div className="flex items-center gap-2">
          <MageIcon color={mageColor} size={28} />
          <MageIcon color={mageColor} size={28} />
          <span className="text-xs text-slate-400">
            ×2 {mage?.name ?? `${c.startingMageColor} mages`}
          </span>
        </div>
        {mage?.description && (
          <p className="text-[11px] text-slate-200/90 italic leading-snug">
            {mage.description}
          </p>
        )}
      </div>

      {takenBy && (
        <p className="text-xs text-amber-300/70">chosen by {takenBy}</p>
      )}
    </button>
  );
}

function MageDraftFirstChoiceScreen({
  state,
  dispatch,
  reset,
}: {
  state: GameState;
  dispatch: (action: GameAction) => void;
  reset: () => void;
}) {
  if (state.phase.kind !== 'mage-draft-first-choice') return null;
  const chooser = state.players[state.phase.chooserIndex];
  const otherIdx = (state.phase.chooserIndex + 1) % state.players.length;
  const other = state.players[otherIdx];
  if (!chooser || !other) return null;

  return (
    <div className="min-h-full p-6 max-w-3xl mx-auto space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Argent — mage draft (order)</h1>
          <p className="text-slate-400 text-sm">
            {playerDisplayName(state, chooser)} chose their leader second and
            picks who drafts first.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
        >
          Back to setup
        </button>
      </header>
      <section className="rounded border border-slate-700 bg-slate-900 p-4 space-y-3">
        <p className="text-sm text-slate-300">
          The draft order will be a snake: A, B, B, A, A, B (each player gets
          3 picks).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'CHOOSE_DRAFT_FIRST',
                playerId: chooser.id,
                draftFirst: true,
              })
            }
            className="px-3 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
          >
            Draft first ({chooser.name} starts)
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'CHOOSE_DRAFT_FIRST',
                playerId: chooser.id,
                draftFirst: false,
              })
            }
            className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
          >
            Pass first pick to {other.name}
          </button>
        </div>
      </section>
      <MageDraftPoolPanel state={state} />
    </div>
  );
}

function MageDraftScreen({
  state,
  dispatch,
  reset,
}: {
  state: GameState;
  dispatch: (action: GameAction) => void;
  reset: () => void;
}) {
  if (state.phase.kind !== 'mage-draft') return null;
  const phase = state.phase;
  const activeIdx = phase.pickOrder[phase.nextPickIndex];
  const activePlayer = activeIdx !== undefined ? state.players[activeIdx] : undefined;

  return (
    <div className="min-h-full p-6 max-w-4xl mx-auto space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Argent — mage draft</h1>
          <p className="text-slate-400 text-sm">
            Pick {phase.nextPickIndex + 1} of {phase.pickOrder.length} —{' '}
            {activePlayer ? playerDisplayName(state, activePlayer) : '?'} is
            choosing
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
        >
          Back to setup
        </button>
      </header>

      <section>
        <h2 className="text-lg font-medium mb-2">Pool</h2>
        {activePlayer ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(
              ['red', 'grey', 'green', 'blue', 'purple', 'off-white'] as MageColor[]
            ).map((color) => {
              const remaining = state.mageDraftPool[color] ?? 0;
              const owned = activePlayer.mages.filter(
                (m) => m.color === color,
              ).length;
              const disabled = remaining < 1 || owned >= 2;
              const reason =
                remaining < 1
                  ? 'pool is empty'
                  : owned >= 2
                    ? 'already have 2 of this color'
                    : undefined;
              return (
                <button
                  key={color}
                  type="button"
                  disabled={disabled}
                  title={reason}
                  onClick={() =>
                    dispatch({
                      type: 'DRAFT_MAGE',
                      playerId: activePlayer.id,
                      color,
                    })
                  }
                  className={clsx(
                    'rounded border p-3 text-left text-sm space-y-1',
                    'border-slate-700 bg-slate-900 hover:border-amber-400/60 hover:bg-slate-800',
                    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-700 disabled:hover:bg-slate-900',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MageIcon color={color} size={36} />
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium capitalize">{color}</span>
                        <span className="text-xs text-slate-400">
                          {remaining} left
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        you have {owned}/2{owned >= 2 ? ' (max)' : ''}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">no active picker</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Pick order</h2>
        <ol className="text-xs text-slate-400 space-y-0.5">
          {phase.pickOrder.map((idx, i) => {
            const p = state.players[idx];
            const isCurrent = i === phase.nextPickIndex;
            const isPast = i < phase.nextPickIndex;
            return (
              <li
                key={i}
                className={clsx(
                  isCurrent && 'text-amber-300 font-medium',
                  isPast && 'text-slate-600 line-through',
                )}
              >
                {i + 1}. {p?.name ?? '?'}
                {isCurrent ? ' ← current' : ''}
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Players</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {state.players.map((p) => (
            <li
              key={p.id}
              className="rounded border border-slate-700 bg-slate-900 p-2"
            >
              <div className="font-medium">{playerDisplayName(state, p)}</div>
              <div className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap">
                <span>
                  {p.mages.length} mage{p.mages.length === 1 ? '' : 's'}:
                </span>
                {p.mages.length === 0 ? (
                  <span className="italic text-slate-500">(none)</span>
                ) : (
                  p.mages.map((m, i) => (
                    <MageIcon key={i} color={m.color} size={24} />
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function InitialMarkPlacementScreen({
  state,
  dispatch,
  reset,
}: {
  state: GameState;
  dispatch: (action: GameAction) => void;
  reset: () => void;
}) {
  if (state.phase.kind !== 'initial-mark-placement') return null;
  const phase = state.phase;
  const activePlayer = state.players[phase.activePlayerIndex];
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  const eligibleSet =
    top?.prompt.kind === 'choose-voter'
      ? new Set(top.prompt.eligibleVoterIds)
      : new Set<string>();
  const resolveWithVoter = (voterId: string) => {
    if (!top) return;
    dispatch({
      type: 'RESOLVE_PENDING',
      resolutionId: top.id,
      answer: { kind: 'voter-chosen', voterId },
    });
  };

  return (
    <div className="min-h-full p-6 max-w-5xl mx-auto space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Argent — initial mark placement</h1>
          <p className="text-slate-400 text-sm">
            Each player places their starting Mark on a Voter before round 1.
            Currently choosing:{' '}
            <strong>
              {activePlayer ? playerDisplayName(state, activePlayer) : '?'}
            </strong>
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
        >
          Back to setup
        </button>
      </header>

      <section>
        <h2 className="text-lg font-medium mb-2">Players</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {state.players.map((p, i) => {
            const hasPlaced = p.resources.marks > 0;
            return (
              <li
                key={p.id}
                className={clsx(
                  'p-2 rounded border flex items-center justify-between gap-2',
                  i === phase.activePlayerIndex
                    ? 'border-amber-400/60 bg-amber-400/5'
                    : 'border-slate-700 bg-slate-900',
                )}
              >
                <span className="font-medium">{playerDisplayName(state, p)}</span>
                {hasPlaced ? (
                  <span className="text-[11px] uppercase tracking-wide text-emerald-300/70">
                    placed
                  </span>
                ) : i === phase.activePlayerIndex ? (
                  <span className="text-[11px] uppercase tracking-wide text-amber-300">
                    choosing
                  </span>
                ) : (
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">
                    waiting
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">
          Pick a Consortium Voter to mark
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          Marks on face-down voters let you peek at them during play and
          break voter-level ties at endgame scoring.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {state.voters.map((v) => {
            const eligible = eligibleSet.has(v.id);
            return (
              <button
                key={v.id}
                type="button"
                disabled={!eligible}
                onClick={() => resolveWithVoter(v.id)}
                className={clsx(
                  'rounded border p-3 text-left text-xs space-y-0.5',
                  eligible
                    ? 'border-slate-700 bg-slate-900 hover:border-amber-400/60 hover:bg-slate-800 cursor-pointer'
                    : 'border-slate-800 bg-slate-900/40 opacity-50 cursor-not-allowed',
                )}
              >
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-medium text-slate-200">
                    {v.revealed ? v.name : '[face-down voter]'}
                  </span>
                  {v.isAlwaysFaceUp && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-300/70">
                      required
                    </span>
                  )}
                </div>
                {v.revealed && v.title && (
                  <div className="text-[10px] text-slate-500 italic">
                    {v.title}
                  </div>
                )}
                {v.revealed && v.description && (
                  <div className="text-[11px] text-slate-300/90">
                    {v.description}
                  </div>
                )}
                {!v.revealed && (
                  <div className="text-[11px] text-slate-500 italic">
                    contents hidden until end of game (or peek after placement)
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MageDraftPoolPanel({ state }: { state: GameState }) {
  return (
    <section className="rounded border border-slate-700 bg-slate-900 p-3">
      <h2 className="text-sm font-medium mb-2">Pool (after leader picks)</h2>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs text-slate-300">
        {(
          ['red', 'grey', 'green', 'blue', 'purple', 'off-white'] as MageColor[]
        ).map((color) => (
          <li
            key={color}
            className="capitalize inline-flex items-center gap-1.5"
          >
            <MageIcon color={color} size={14} />
            {color}: {state.mageDraftPool[color] ?? 0}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Lists every mage currently in the infirmary (wounded — any player). Future
 * "move from infirmary" effects (Heal, Chain of Healing, Amelioration, Rheye
 * Cal's spell, etc.) will need to pick from this set.
 */
function InfirmaryRoster({
  state,
  selectionMode,
}: {
  state: GameState;
  selectionMode: SelectionMode | null;
}) {
  const mageMode = selectionMode?.kind === 'mage' ? selectionMode : null;
  const wounded: { mage: OwnedMage; ownerId: string; ownerName: string }[] = [];
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind === 'infirmary') {
        wounded.push({ mage: m, ownerId: p.id, ownerName: p.name });
      }
    }
  }
  if (wounded.length === 0) {
    return (
      <p className="text-[10px] text-slate-500 italic">infirmary is empty</p>
    );
  }
  return (
    <ul className="space-y-1">
      {wounded.map(({ mage, ownerId, ownerName }) => {
        const eligible = mageMode?.eligibleIds.has(mage.id) ?? false;
        const body = (
          <>
            <MageIcon color={mage.color} size={14} />
            <span className="capitalize text-slate-200">{mage.color}</span>
            <span className="text-slate-500">({mage.id.slice(-8)})</span>
            <span className="text-slate-400">— {ownerName}</span>
            <span className="text-slate-600 text-[10px]">{ownerId}</span>
          </>
        );
        if (mageMode && eligible) {
          return (
            <li key={mage.id}>
              <button
                type="button"
                onClick={() => mageMode.onSelect(mage.id)}
                className="w-full text-left rounded px-1.5 py-1 text-[11px] leading-snug bg-slate-950/40 ring-2 ring-amber-400 hover:bg-amber-400/20 cursor-pointer flex items-center gap-1.5"
              >
                {body}
              </button>
            </li>
          );
        }
        return (
          <li
            key={mage.id}
            className={clsx(
              'rounded bg-slate-950/40 px-1.5 py-1 text-[11px] leading-snug flex items-center gap-1.5',
              mageMode && !eligible && 'opacity-50',
            )}
          >
            {body}
          </li>
        );
      })}
    </ul>
  );
}

function RoomsPanel({
  state,
  selectedMage,
  dispatch,
  onPlaced,
  selectionMode,
}: {
  state: GameState;
  selectedMage: OwnedMage | null;
  dispatch: (action: GameAction) => void;
  onPlaced: () => void;
  selectionMode: SelectionMode | null;
}) {
  const ownerOfSelected = selectedMage
    ? state.players.find((p) => p.mages.some((m) => m.id === selectedMage.id))
    : null;
  const mageMode = selectionMode?.kind === 'mage' ? selectionMode : null;
  const spaceMode =
    selectionMode?.kind === 'action-space' ? selectionMode : null;

  // Render rooms in the spatial layout produced at game start.
  // Each cell is either a room or an empty slot (visualized as a faint
  // placeholder so the grid shape is legible). Adjacency-aware spells
  // use this same grid via getOrthogonallyAdjacentRoomIds.
  const layout = state.roomLayout;
  const roomById = new Map(state.rooms.map((r) => [r.id, r] as const));
  const roomIndexById = new Map(state.rooms.map((r, i) => [r.id, i] as const));
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-lg font-medium">
          Tower ({state.rooms.length} rooms, {layout.cols}×{layout.rows} grid)
        </h2>
        {selectedMage && ownerOfSelected && (
          <span className="text-xs text-amber-300 inline-flex items-center gap-1.5">
            placing <MageIcon color={selectedMage.color} size={14} /> for{' '}
            {ownerOfSelected.name} — click a highlighted slot
          </span>
        )}
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }}
      >
        {layout.grid.flatMap((row, rowIdx) =>
          row.map((cellRoomId, colIdx) => {
            if (cellRoomId == null) {
              return (
                <div
                  key={`empty-${rowIdx}-${colIdx}`}
                  className="rounded border border-dashed border-slate-800 bg-slate-900/30 min-h-[6rem]"
                  aria-hidden="true"
                />
              );
            }
            const room = roomById.get(cellRoomId);
            const ri = roomIndexById.get(cellRoomId);
            if (!room || ri === undefined) return null;
            return renderRoomCell(room, ri);
          }),
        )}
      </div>
    </section>
  );

  function renderRoomCell(room: typeof state.rooms[number], ri: number) {
          const isCurrent =
            state.phase.kind === 'resolution' && state.phase.pendingRoomIndex === ri;
          const isLocked = state.roomLocks.some((l) => l.roomId === room.id);
          return (
            <div
              key={room.id}
              className={clsx(
                'rounded border p-3 text-xs space-y-1',
                isLocked
                  ? 'border-rose-500 bg-rose-900/20'
                  : isCurrent
                    ? 'border-amber-400 bg-amber-400/10'
                    : 'border-slate-700 bg-slate-900',
              )}
            >
              <div className="flex items-baseline gap-2">
                {isLocked && <LockIcon size={14} />}
                <span className="text-sm font-medium">{room.name}</span>
                <span className="text-slate-500">side {room.side}</span>
                {isLocked && (
                  <span className="text-[10px] uppercase tracking-wide text-rose-300">
                    locked
                  </span>
                )}
                {room.isUniversityCentral && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-300/70">
                    UC
                  </span>
                )}
                {room.isInstantRoom && (
                  <span className="text-[10px] uppercase tracking-wide text-purple-300/70">
                    instant
                  </span>
                )}
                {room.maxMagesPerPlayerPerRound !== undefined && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    max {room.maxMagesPerPlayerPerRound}/round
                  </span>
                )}
              </div>
              {room.description && (
                <p className="text-[11px] text-slate-300 italic">
                  {room.description}
                </p>
              )}
              {room.cannotBePlacedInDirectly ? (
                <InfirmaryRoster state={state} selectionMode={selectionMode} />
              ) : room.actionSpaces.length === 0 ? (
                <p className="text-[10px] text-slate-500 italic">
                  no action spaces (or specials handled elsewhere)
                </p>
              ) : (
                <ul className="space-y-1">
                  {room.actionSpaces.map((s) => {
                    const slotIndex = (s.id.split('.').pop() ?? '').replace(
                      'slot-',
                      'Slot ',
                    );
                    const placeBlocked = selectedMage
                      ? placementBlockedReason(state, selectedMage, room, s)
                      : 'no mage selected';
                    const isPlaceable = selectedMage !== null && placeBlocked === null;
                    const isArsMagna =
                      selectedMage !== null &&
                      isArsMagnaPlacement(state, selectedMage, s);
                    const spaceEligible = spaceMode?.eligibleIds.has(s.id) ?? false;
                    const occupantMageEligible =
                      s.occupant !== null &&
                      (mageMode?.eligibleIds.has(s.occupant.mageId) ?? false);
                    const shadowOccupant = s.shadowOccupant ?? null;
                    const shadowMageEligible =
                      shadowOccupant !== null &&
                      (mageMode?.eligibleIds.has(shadowOccupant.mageId) ?? false);
                    const occupantColor = (occ: { ownerId: string; mageId: string }) =>
                      state.players
                        .find((p) => p.id === occ.ownerId)
                        ?.mages.find((m) => m.id === occ.mageId)?.color ??
                      'off-white';
                    /**
                     * Slot tile — one of the two boxes that visually represents
                     * a slot position. The shadow tile (left) has a dashed
                     * purple border; the base tile (right) has a solid slate
                     * border. Mage icon centered when occupied. Clickable if
                     * the surrounding context (prompt mode / placement mode)
                     * allows it.
                     */
                    const renderSlotTile = (args: {
                      isShadow: boolean;
                      occupant: typeof s.occupant;
                      onClick: (() => void) | undefined;
                      ringClass: string;
                      title: string;
                    }) => {
                      const { isShadow, occupant, onClick, ringClass, title } = args;
                      // The shadow tile is always rendered with a dashed
                      // purple border. The base tile is normally solid-slate
                      // but switches to dashed-purple when its occupant is
                      // flagged isShadowing (Paralocation / Rennel-applied
                      // suppression).
                      const occupantShadowed = occupant?.isShadowing === true;
                      const borderClass =
                        isShadow || occupantShadowed
                          ? 'border-purple-400/50 border-dashed'
                          : 'border-slate-500';
                      const filledClass = occupant
                        ? isShadow || occupantShadowed
                          ? 'bg-purple-500/15'
                          : 'bg-amber-400/15'
                        : 'bg-slate-950/40';
                      const content = occupant ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <MageIcon
                            color={occupantColor(occupant)}
                            size={18}
                          />
                          <span className="text-[8px] uppercase tracking-wide text-slate-400 leading-none">
                            {occupant.ownerId}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[8px] uppercase tracking-wide text-slate-600">
                          {isShadow ? 'shadow' : 'slot'}
                        </span>
                      );
                      if (onClick) {
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onClick();
                            }}
                            title={title}
                            className={clsx(
                              'w-9 h-9 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0',
                              borderClass,
                              filledClass,
                              ringClass ?? '',
                              'hover:bg-amber-400/25 cursor-pointer',
                            )}
                          >
                            {content}
                          </button>
                        );
                      }
                      return (
                        <div
                          title={title}
                          className={clsx(
                            'w-9 h-9 rounded border-2 flex items-center justify-center flex-shrink-0',
                            borderClass,
                            filledClass,
                            ringClass ?? '',
                          )}
                        >
                          {content}
                        </div>
                      );
                    };

                    // Base tile click handler: prefer space-prompt selection,
                    // then PLACE_WORKER placement, then a mage-target click on
                    // the existing occupant.
                    const baseClick: (() => void) | undefined =
                      spaceMode && spaceEligible
                        ? () => spaceMode.onSelect(s.id)
                        : isPlaceable && selectedMage
                          ? () => {
                              dispatch({
                                type: 'PLACE_WORKER',
                                playerId:
                                  state.players.find((p) =>
                                    p.mages.some(
                                      (m) => m.id === selectedMage.id,
                                    ),
                                  )?.id ?? '',
                                mageId: selectedMage.id,
                                actionSpaceId: s.id,
                              });
                              onPlaced();
                            }
                          : occupantMageEligible && mageMode
                            ? () => mageMode.onSelect(s.occupant!.mageId)
                            : undefined;
                    const baseRing =
                      spaceMode && spaceEligible
                        ? 'ring-2 ring-amber-400'
                        : isPlaceable && isArsMagna
                          ? 'ring-2 ring-red-500'
                          : isPlaceable
                            ? 'ring-2 ring-amber-400'
                            : occupantMageEligible && mageMode
                              ? 'ring-2 ring-amber-400'
                              : '';
                    const baseTitle = s.occupant
                      ? `${s.occupant.ownerId}${s.occupant.isShadowing ? ' (shadow)' : ''}`
                      : isPlaceable
                        ? `place ${selectedMage?.color ?? ''} mage here`
                        : 'empty base slot';

                    // Shadow tile click handler: only active for a mage-target
                    // prompt when this slot has an eligible shadow occupant.
                    const shadowClick: (() => void) | undefined =
                      shadowMageEligible && mageMode && shadowOccupant
                        ? () => mageMode.onSelect(shadowOccupant.mageId)
                        : undefined;
                    const shadowRing =
                      shadowMageEligible && mageMode
                        ? 'ring-2 ring-amber-400'
                        : '';
                    const shadowTitle = shadowOccupant
                      ? `${shadowOccupant.ownerId} (shadow)`
                      : 'shadow slot (only via shadow-specific effects)';

                    const slotInfo = (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-medium text-slate-200">
                            {slotIndex}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            {s.slotType}
                          </span>
                          {s.costToActivate?.meritBadges && (
                            <span className="text-[10px] uppercase tracking-wide text-orange-300/70 inline-flex items-center gap-1">
                              cost: {s.costToActivate.meritBadges}
                              <ResourceIcon kind="merit-badge" size={11} />
                            </span>
                          )}
                          {isPlaceable && isArsMagna && (
                            <span className="text-[10px] uppercase tracking-wide text-red-300 inline-flex items-center gap-1">
                              ars magna — spend 1
                              <ResourceIcon kind="mana" size={11} />
                            </span>
                          )}
                        </div>
                        {s.description && (
                          <div className="text-slate-300/90 mt-0.5">
                            {s.description}
                          </div>
                        )}
                      </div>
                    );

                    return (
                      <li
                        key={s.id}
                        title={
                          selectedMage && placeBlocked && !isPlaceable
                            ? `cannot place: ${placeBlocked}`
                            : undefined
                        }
                        className={clsx(
                          'flex items-center gap-2 text-[11px] leading-snug rounded px-1.5 py-1.5',
                          s.occupant || shadowOccupant
                            ? 'bg-amber-400/5'
                            : 'bg-slate-950/40 text-slate-300',
                          selectedMage && !isPlaceable && !s.occupant && 'opacity-60',
                          spaceMode && !spaceEligible && 'opacity-60',
                        )}
                      >
                        {renderSlotTile({
                          isShadow: true,
                          occupant: shadowOccupant,
                          onClick: shadowClick,
                          ringClass: shadowRing,
                          title: shadowTitle,
                        })}
                        {renderSlotTile({
                          isShadow: false,
                          occupant: s.occupant,
                          onClick: baseClick,
                          ringClass: baseRing,
                          title: baseTitle,
                        })}
                        {slotInfo}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
  }
}

function BellTowerPanel({
  state,
  dispatch,
}: {
  state: GameState;
  dispatch: (action: GameAction) => void;
}) {
  const activePlayer =
    state.phase.kind === 'errands'
      ? state.players[state.phase.activePlayerIndex] ?? null
      : null;
  const actionAvailable =
    state.phase.kind === 'errands' ? !state.phase.actionUsed : false;
  const canClaim =
    activePlayer !== null &&
    state.pendingResolutionStack.length === 0 &&
    actionAvailable;

  return (
    <section className="rounded border border-slate-700 bg-slate-900 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium inline-flex items-center gap-1.5">
          <BellIcon size={14} />
          Bell Tower ({state.bellTower.available.length} available
          {state.bellTower.taken.length
            ? `, ${state.bellTower.taken.length} taken`
            : ''}
          )
        </h2>
        <span className="text-[10px] text-slate-500">
          claiming the last card ends the round
        </span>
      </div>
      {state.bellTower.available.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          empty — round ends on next advance
        </p>
      ) : (
        <ul className="space-y-1">
          {state.bellTower.available.map((c) => {
            const isGoldOrMana = c.id === 'base.bell.gold-or-mana';
            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded bg-slate-950/40 px-2 py-1 text-xs"
              >
                <span className="text-slate-200 inline-flex items-center gap-1.5">
                  <BellIcon size={12} />
                  {c.name}
                </span>
                {canClaim && activePlayer && (
                  <div className="flex items-center gap-1">
                    {isGoldOrMana ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: 'CLAIM_BELL_TOWER',
                              playerId: activePlayer.id,
                              bellTowerCardId: c.id,
                              claimChoice: 'gold',
                            })
                          }
                          className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-[11px] inline-flex items-center gap-1"
                          title={`Claim and gain 2 Gold (as ${activePlayer.name})`}
                        >
                          Claim +2 <ResourceIcon kind="gold" size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: 'CLAIM_BELL_TOWER',
                              playerId: activePlayer.id,
                              bellTowerCardId: c.id,
                              claimChoice: 'mana',
                            })
                          }
                          className="px-2 py-0.5 rounded bg-cyan-500 text-slate-950 hover:bg-cyan-400 text-[11px] inline-flex items-center gap-1"
                          title={`Claim and gain 1 Mana (as ${activePlayer.name})`}
                        >
                          Claim +1 <ResourceIcon kind="mana" size={11} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: 'CLAIM_BELL_TOWER',
                            playerId: activePlayer.id,
                            bellTowerCardId: c.id,
                          })
                        }
                        className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-[11px]"
                      >
                        Claim (as {activePlayer.name})
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {state.bellTower.taken.length > 0 && (
        <details>
          <summary className="text-[11px] text-slate-500 cursor-pointer">
            Taken this round
          </summary>
          <ul className="text-[11px] mt-1 space-y-0.5 text-slate-400">
            {state.bellTower.taken.map((t, i) => {
              const taker = state.players.find((p) => p.id === t.takenBy);
              return (
                <li key={`${t.cardId}-${i}`}>
                  {t.cardId} — claimed by{' '}
                  {taker ? playerDisplayName(state, taker) : t.takenBy}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
