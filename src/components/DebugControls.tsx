// Minimal dev UI for exercising the engine in the browser.
// Lets you inject test mages / spells / vault cards, place workers, cast
// spells, drain the bell tower, and answer prompts — enough to walk through
// the Library and Burn vertical slices end-to-end without running tests.

import { useState } from 'react';
import clsx from 'clsx';
import { useGameStore } from '../store/gameStore';
import { baseGamePack } from '../content/packs/base';
import { listPacks } from '../content/registry';
import { MageIcon, ResourceIcon, type ResourceKind } from './icons';
import type {
  Candidate,
  GameAction,
  GameState,
  MageColor,
  OwnedMage,
  PendingPrompt,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  SupporterCard,
} from '../game/types';

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
function placementBlockedReason(
  state: GameState,
  mage: OwnedMage,
  room: GameState['rooms'][number],
  space: GameState['rooms'][number]['actionSpaces'][number],
): string | null {
  if (room.cannotBePlacedInDirectly) return 'cannot place here';
  if (state.roomLocks.some((l) => l.roomId === room.id)) return 'room locked';
  if (space.occupant) return 'space occupied';
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
  // Action budget.
  const isFast = mage.color === 'purple';
  if (isFast) {
    if (state.phase.fastActionUsed) return 'Fast Action already used';
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
function findSpellL1Timing(
  state: GameState,
  spellCardId: string,
): 'action' | 'fast-action' | 'reaction' | null {
  for (const pack of listPacks()) {
    if (!state.activePackIds.includes(pack.id)) continue;
    const found =
      pack.spells.find((s) => s.id === spellCardId) ??
      pack.legendarySpells.find((s) => s.id === spellCardId);
    if (found) return found.levels[0].timing;
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

  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
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

      {top && <PendingPanel state={state} pending={top} dispatch={dispatch} />}

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
            />
          ))}
        </div>
      </section>

      <RoomsPanel
        state={state}
        selectedMage={effectiveSelectedMage}
        dispatch={dispatch}
        onPlaced={() => setPlacementMageId(null)}
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

      <TableauPanel state={state} />

      <details>
        <summary className="text-xs text-slate-500 cursor-pointer">
          Voters ({state.voters.length})
        </summary>
        <ul className="text-xs space-y-0.5 mt-2">
          {state.voters.map((v) => (
            <li key={v.id} className="text-slate-400">
              {v.revealed ? v.name : '[face-down]'} — {v.criterion} ({v.votes} votes)
            </li>
          ))}
        </ul>
      </details>
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
}: {
  state: GameState;
  pending: PendingResolution;
  dispatch: (action: GameAction) => void;
}) {
  const responder = state.players.find((p) => p.id === pending.responderId);
  const responderLabel = responder
    ? playerDisplayName(state, responder)
    : pending.responderId;
  return (
    <section className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-4 space-y-3">
      <div>
        <h2 className="text-lg font-medium text-amber-100">
          Pending: {pending.prompt.kind}
        </h2>
        <p className="text-sm text-slate-300">
          Responder: <strong>{responderLabel}</strong> · Source:{' '}
          {pending.source.description}
        </p>
        {state.pendingResolutionStack.length > 1 && (
          <p className="text-xs text-slate-500">
            (stack depth: {state.pendingResolutionStack.length})
          </p>
        )}
      </div>
      <PromptControls
        prompt={pending.prompt}
        state={state}
        pending={pending}
        dispatch={dispatch}
      />
    </section>
  );
}

function PromptControls({
  prompt,
  state,
  pending,
  dispatch,
}: {
  prompt: PendingPrompt;
  state: GameState;
  pending: PendingResolution;
  dispatch: (action: GameAction) => void;
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
            Trigger: {prompt.triggerEvent.kind}
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
                onClick={() =>
                  resolve({
                    kind: 'reaction-played',
                    effectId: o.effectId,
                    reactionContext: {},
                  })
                }
                className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400"
              >
                {o.label}
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
          {w.id}: trigger={w.triggerEvent.kind} · queue=[{w.pendingResponderIds.join(', ')}] ·
          reacted=[{w.reactedPlayerIds.join(', ')}]
        </p>
      ))}
    </section>
  );
}

function ResourceLine({ player }: { player: Player }) {
  const r = player.resources;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-300 items-center">
      <ResourcePill kind="gold" count={r.gold} />
      <ResourcePill kind="mana" count={r.mana} />
      <ResourcePill kind="influence" count={r.influence} />
      <ResourcePill kind="intelligence" count={r.intelligence} />
      <ResourcePill kind="wisdom" count={r.wisdom} />
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
  size = 14,
}: {
  kind: ResourceKind;
  count: number;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <ResourceIcon kind={kind} size={size} />
      <span className="tabular-nums">{count}</span>
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
}: {
  state: GameState;
  player: Player;
  isFocus: boolean;
  dispatch: (action: GameAction) => void;
  patchState: (fn: (s: GameState) => GameState) => void;
  selectedMageId: string | null;
  onSelectMage: (id: string | null) => void;
}) {
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
            const colorIsPurple = m.color === 'purple';
            const budgetOpen = colorIsPurple
              ? !fastActionUsed
              : !actionUsed;
            const clickable = placeable && budgetOpen;
            const isSelected = selectedMageId === m.id;
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
                    ? colorIsPurple
                      ? 'Fast Action used'
                      : 'Action used'
                    : null;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!clickable}
                onClick={() => onSelectMage(isSelected ? null : m.id)}
                title={
                  clickable
                    ? isSelected
                      ? 'Selected — click again to deselect'
                      : `Place this ${m.color} mage`
                    : (dimReason ?? m.color)
                }
                className={clsx(
                  'rounded p-0.5 transition-all',
                  isSelected
                    ? 'ring-2 ring-amber-400 bg-amber-400/10'
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

      <details>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Spells ({player.ownedSpells.length})
        </summary>
        <ul className="text-xs mt-1 space-y-0.5 text-slate-300">
          {player.ownedSpells.map((s) => {
            const timing = findSpellL1Timing(state, s.cardId);
            const isFast = timing === 'fast-action';
            const budgetOpen = isFast ? canTakeFastAction : canTakeAction;
            const showCastButton =
              !s.exhausted &&
              s.intPlaced &&
              canAct &&
              timing !== 'reaction';
            return (
              <li key={s.cardId} className="flex items-center gap-2">
                <span>
                  {s.cardId}
                  {timing ? ` (${timing})` : ''}
                  {s.intPlaced ? ' · L1' : ''}
                  {s.wisPlacedLevel2 ? ' · L2' : ''}
                  {s.wisPlacedLevel3 ? ' · L3' : ''}
                  {s.exhausted ? ' (exhausted)' : ''}
                </span>
                {showCastButton && (
                  <button
                    type="button"
                    disabled={!budgetOpen}
                    title={
                      budgetOpen
                        ? undefined
                        : isFast
                          ? 'Fast Action already used this turn'
                          : 'Action already used this turn'
                    }
                    onClick={() =>
                      dispatch({
                        type: 'CAST_SPELL',
                        playerId: player.id,
                        spellCardId: s.cardId,
                        level: 1,
                      })
                    }
                    className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Cast L1
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      <details>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Vault cards ({player.vaultCards.length})
        </summary>
        <ul className="text-xs mt-1 space-y-0.5 text-slate-300">
          {player.vaultCards.map((v, i) => (
            <li key={i}>
              {v.cardId} {v.exhausted ? '(exhausted)' : ''}
            </li>
          ))}
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

      {canAct && (
        <ArsMagnaControls
          player={player}
          dispatch={dispatch}
          enabled={canTakeFastAction}
        />
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

function ArsMagnaControls({
  player,
  dispatch,
  enabled,
}: {
  player: Player;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
}) {
  const redMagesInOffice = player.mages.filter(
    (m) => m.color === 'red' && m.location.kind === 'office' && !m.isWounded,
  );
  if (redMagesInOffice.length === 0 || player.resources.mana < 1) return null;
  return (
    <div className="text-xs space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        mage powers (fast action)
      </p>
      <div className="flex flex-wrap gap-1">
        {redMagesInOffice.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={!enabled}
            title={enabled ? undefined : 'Fast Action already used this turn'}
            onClick={() =>
              dispatch({
                type: 'USE_ABILITY',
                playerId: player.id,
                abilityId: 'base.mage.sorcery.ars-magna',
                sourceCardId: m.id,
              })
            }
            className="px-1.5 py-0.5 rounded bg-red-700 hover:bg-red-600 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            <MageIcon color="red" size={12} />
            Ars Magna ({m.id.slice(-8)})
          </button>
        ))}
      </div>
    </div>
  );
}

function TableauPanel({ state }: { state: GameState }) {
  return (
    <section className="rounded border border-slate-700 bg-slate-900 p-3">
      <h2 className="text-sm font-medium mb-2">Tableaus</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
        <div>
          <p className="font-medium text-slate-200">Spells ({state.spellTableau.length})</p>
          <ul className="space-y-0.5">
            {state.spellTableau.map((cid, i) => (
              <li key={`${cid}-${i}`}>{cid}</li>
            ))}
            {state.spellTableau.length === 0 && (
              <li className="text-slate-500 italic">empty</li>
            )}
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-200">Vault ({state.vaultTableau.length})</p>
          <ul className="space-y-0.5">
            {state.vaultTableau.map((cid, i) => (
              <li key={`${cid}-${i}`}>{cid}</li>
            ))}
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
              return (
                <li
                  key={`${cid}-${i}`}
                  className="rounded bg-slate-950/40 px-2 py-1"
                >
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
  if (state.phase.kind !== 'candidate-draft') return null;
  const activeIdx = state.phase.activePlayerIndex;
  const activePlayer = state.players[activeIdx];
  const candidates = collectAvailableCandidates(state);
  const taken = new Map<string, string>();
  for (const p of state.players) {
    if (p.candidateId) taken.set(p.candidateId, p.name);
  }

  return (
    <div className="min-h-full p-6 max-w-5xl mx-auto space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Argent — candidate draft</h1>
          <p className="text-slate-400 text-sm">
            {activePlayer?.name ?? '?'} is choosing a faction leader.
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

      <section>
        <h2 className="text-lg font-medium mb-2">Candidates</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {candidates.map((c) => {
            const takenBy = taken.get(c.id);
            const disabled = takenBy !== undefined || !activePlayer;
            return (
              <div
                key={c.id}
                className={clsx(
                  'p-3 rounded border space-y-1',
                  takenBy
                    ? 'border-slate-800 bg-slate-900/40 opacity-60'
                    : 'border-slate-700 bg-slate-900',
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{c.name}</h3>
                  <span className="text-xs text-slate-500">{c.title}</span>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                  <span>Department: {c.department} · Mages:</span>
                  <MageIcon
                    color={
                      c.startingMageColor === 'neutral'
                        ? 'off-white'
                        : c.startingMageColor
                    }
                    size={32}
                  />
                  <MageIcon
                    color={
                      c.startingMageColor === 'neutral'
                        ? 'off-white'
                        : c.startingMageColor
                    }
                    size={32}
                  />
                  <span className="capitalize">{c.startingMageColor}</span>
                  {c.startingExtraMeritBadge && (
                    <span className="inline-flex items-center gap-1">
                      ·
                      <ResourceIcon kind="merit-badge" size={14} />
                      +1
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Starter spell: {c.starterSpellId}
                </p>
                {takenBy ? (
                  <p className="text-xs text-amber-300/70">
                    chosen by {takenBy}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!activePlayer) return;
                      dispatch({
                        type: 'CHOOSE_CANDIDATE',
                        playerId: activePlayer.id,
                        candidateId: c.id,
                      });
                    }}
                    className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 text-sm hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Pick (as {activePlayer?.name})
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
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

function RoomsPanel({
  state,
  selectedMage,
  dispatch,
  onPlaced,
}: {
  state: GameState;
  selectedMage: OwnedMage | null;
  dispatch: (action: GameAction) => void;
  onPlaced: () => void;
}) {
  const ownerOfSelected = selectedMage
    ? state.players.find((p) => p.mages.some((m) => m.id === selectedMage.id))
    : null;

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-lg font-medium">Tower ({state.rooms.length} rooms)</h2>
        {selectedMage && ownerOfSelected && (
          <span className="text-xs text-amber-300 inline-flex items-center gap-1.5">
            placing <MageIcon color={selectedMage.color} size={14} /> for{' '}
            {ownerOfSelected.name} — click a highlighted slot
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {state.rooms.map((room, ri) => {
          const isCurrent =
            state.phase.kind === 'resolution' && state.phase.pendingRoomIndex === ri;
          return (
            <div
              key={room.id}
              className={clsx(
                'rounded border p-3 text-xs space-y-1',
                isCurrent
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-slate-700 bg-slate-900',
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{room.name}</span>
                <span className="text-slate-500">side {room.side}</span>
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
              {room.actionSpaces.length === 0 ? (
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
                    const slotBody = (
                      <>
                        <div className="flex items-baseline gap-2">
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
                        </div>
                        {s.description && (
                          <div className="text-slate-300/90">{s.description}</div>
                        )}
                        <div
                          className={clsx(
                            'text-[10px]',
                            s.occupant ? 'text-amber-300' : 'text-slate-500',
                          )}
                        >
                          {s.occupant ? (
                            <span className="inline-flex items-center gap-1">
                              occupied by{' '}
                              <MageIcon
                                color={
                                  state.players
                                    .find((p) => p.id === s.occupant?.ownerId)
                                    ?.mages.find(
                                      (m) => m.id === s.occupant?.mageId,
                                    )?.color ?? 'off-white'
                                }
                                size={12}
                              />
                              {s.occupant.ownerId}
                              {s.occupant.isShadowing ? ' (shadow)' : ''}
                            </span>
                          ) : (
                            'empty'
                          )}
                        </div>
                      </>
                    );
                    if (isPlaceable && selectedMage) {
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => {
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
                            }}
                            className={clsx(
                              'w-full text-left text-[11px] leading-snug rounded px-1.5 py-1',
                              'bg-slate-950/40 text-slate-300',
                              'ring-2 ring-amber-400 hover:bg-amber-400/15 hover:ring-amber-300',
                              'cursor-pointer',
                            )}
                          >
                            {slotBody}
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={s.id}
                        title={
                          selectedMage && placeBlocked
                            ? `cannot place: ${placeBlocked}`
                            : undefined
                        }
                        className={clsx(
                          'text-[11px] leading-snug rounded px-1.5 py-1',
                          s.occupant
                            ? 'bg-amber-400/10 text-amber-200'
                            : 'bg-slate-950/40 text-slate-300',
                          selectedMage && !isPlaceable && !s.occupant && 'opacity-50',
                        )}
                      >
                        {slotBody}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
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
        <h2 className="text-sm font-medium">
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
          {state.bellTower.available.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded bg-slate-950/40 px-2 py-1 text-xs"
            >
              <span className="text-slate-200">{c.name}</span>
              {canClaim && activePlayer && (
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
            </li>
          ))}
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
