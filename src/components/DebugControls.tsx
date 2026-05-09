// Minimal dev UI for exercising the engine in the browser.
// Lets you inject test mages / spells / vault cards, place workers, cast
// spells, drain the bell tower, and answer prompts — enough to walk through
// the Library and Burn vertical slices end-to-end without running tests.

import { useState } from 'react';
import clsx from 'clsx';
import { useGameStore } from '../store/gameStore';
import { baseGamePack } from '../content/packs/base';
import { listPacks } from '../content/registry';
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

interface SlotEntry {
  roomName: string;
  spaceId: string;
}

function findEmptyRegularSlots(state: GameState): SlotEntry[] {
  const slots: SlotEntry[] = [];
  for (const r of state.rooms) {
    if (r.cannotBePlacedInDirectly) continue;
    for (const s of r.actionSpaces) {
      if (s.slotType === 'regular' && !s.occupant) {
        slots.push({ roomName: `${r.name} (${r.side})`, spaceId: s.id });
      }
    }
  }
  return slots;
}

function findOwnerLabel(state: GameState, mageId: string): string {
  for (const p of state.players) {
    const m = p.mages.find((x) => x.id === mageId);
    if (m) return `${p.name} — ${m.color} mage`;
  }
  return mageId;
}

function describeMage(m: OwnedMage): string {
  let loc: string;
  if (m.location.kind === 'office') loc = 'office';
  else if (m.location.kind === 'action-space') loc = `at ${m.location.spaceId}`;
  else if (m.location.kind === 'infirmary') loc = 'infirmary';
  else loc = 'banished';
  const tags: string[] = [];
  if (m.isWounded) tags.push('wounded');
  if (m.isShadowing) tags.push('shadow');
  const tagSuffix = tags.length ? ` [${tags.join(', ')}]` : '';
  return `${m.color} (${m.id.slice(-12)}) — ${loc}${tagSuffix}`;
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
    case 'round-setup':
      return `Round ${p.round} — Round Setup`;
    case 'errands': {
      const player = state.players[p.activePlayerIndex];
      return `Round ${p.round} — Errands (active: ${player?.name ?? '?'})`;
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

  if (!state) return null;

  // While the candidate draft is open, show only that — gameplay isn't
  // available until every player has picked a leader.
  if (state.phase.kind === 'candidate-draft') {
    return <CandidateDraftScreen state={state} dispatch={dispatch} reset={reset} />;
  }

  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  const responderId = top?.responderId;
  const errandsActiveId =
    state.phase.kind === 'errands'
      ? (state.players[state.phase.activePlayerIndex]?.id ?? null)
      : null;
  const focusPlayerId = responderId ?? errandsActiveId;

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
            />
          ))}
        </div>
      </section>

      <RoomsPanel state={state} />

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
  return (
    <section className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-4 space-y-3">
      <div>
        <h2 className="text-lg font-medium text-amber-100">
          Pending: {pending.prompt.kind}
        </h2>
        <p className="text-sm text-slate-300">
          Responder: <strong>{responder?.name ?? pending.responderId}</strong> · Source:{' '}
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
    <p className="text-xs text-slate-300">
      gold {r.gold} · mana {r.mana} · IP {r.influence} · INT {r.intelligence} · WIS{' '}
      {r.wisdom} · marks {r.marks} · MB {r.meritBadges}
      {r.meritBadgesSpent ? ` (spent ${r.meritBadgesSpent})` : ''}
    </p>
  );
}

function PlayerCard({
  state,
  player,
  isFocus,
  dispatch,
  patchState,
}: {
  state: GameState;
  player: Player;
  isFocus: boolean;
  dispatch: (action: GameAction) => void;
  patchState: (fn: (s: GameState) => GameState) => void;
}) {
  const isErrandsActive =
    state.phase.kind === 'errands' &&
    state.players[state.phase.activePlayerIndex]?.id === player.id;
  const canAct = isErrandsActive && state.pendingResolutionStack.length === 0;

  const [selectedMageId, setSelectedMageId] = useState('');
  const [selectedSpaceId, setSelectedSpaceId] = useState('');

  const emptySlots = findEmptyRegularSlots(state);
  const officeMages = player.mages.filter(
    (m) => m.location.kind === 'office' && !m.isWounded,
  );

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
          <h3 className="font-medium">{player.name}</h3>
          <p className="text-xs text-slate-500">
            {player.id} · color {player.color} · init {player.initiativeOrder}
          </p>
        </div>
        {isErrandsActive && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-500 text-slate-950">
            active
          </span>
        )}
      </div>

      <ResourceLine player={player} />

      <details>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Mages ({player.mages.length})
        </summary>
        <ul className="text-xs mt-1 space-y-0.5 text-slate-300">
          {player.mages.map((m) => (
            <li key={m.id}>{describeMage(m)}</li>
          ))}
        </ul>
      </details>

      <details>
        <summary className="text-xs text-slate-400 cursor-pointer">
          Spells ({player.ownedSpells.length})
        </summary>
        <ul className="text-xs mt-1 space-y-0.5 text-slate-300">
          {player.ownedSpells.map((s) => (
            <li key={s.cardId} className="flex items-center gap-2">
              <span>
                {s.cardId}
                {s.intPlaced ? ' · L1' : ''}
                {s.wisPlacedLevel2 ? ' · L2' : ''}
                {s.wisPlacedLevel3 ? ' · L3' : ''}
                {s.exhausted ? ' (exhausted)' : ''}
              </span>
              {!s.exhausted && s.intPlaced && canAct && (
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'CAST_SPELL',
                      playerId: player.id,
                      spellCardId: s.cardId,
                      level: 1,
                    })
                  }
                  className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] hover:bg-amber-400"
                >
                  Cast L1
                </button>
              )}
            </li>
          ))}
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

      {canAct && officeMages.length > 0 && emptySlots.length > 0 && (
        <div className="flex gap-1 text-xs">
          <select
            value={selectedMageId}
            onChange={(e) => setSelectedMageId(e.target.value)}
            className="bg-slate-800 px-1 py-0.5 rounded flex-1 min-w-0"
          >
            <option value="">Pick mage…</option>
            {officeMages.map((m) => (
              <option key={m.id} value={m.id}>
                {m.color} ({m.id.slice(-8)})
              </option>
            ))}
          </select>
          <select
            value={selectedSpaceId}
            onChange={(e) => setSelectedSpaceId(e.target.value)}
            className="bg-slate-800 px-1 py-0.5 rounded flex-1 min-w-0"
          >
            <option value="">Pick slot…</option>
            {emptySlots.map((s) => (
              <option key={s.spaceId} value={s.spaceId}>
                {s.roomName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedMageId || !selectedSpaceId}
            onClick={() => {
              dispatch({
                type: 'PLACE_WORKER',
                playerId: player.id,
                mageId: selectedMageId,
                actionSpaceId: selectedSpaceId,
              });
              setSelectedMageId('');
              setSelectedSpaceId('');
            }}
            className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Place
          </button>
        </div>
      )}

      {canAct && (
        <button
          type="button"
          onClick={() =>
            dispatch({ type: 'END_ERRANDS_TURN', playerId: player.id })
          }
          className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
        >
          End turn
        </button>
      )}

      {canAct && (
        <ArsMagnaControls player={player} dispatch={dispatch} />
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
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
            >
              +{c}
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
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
          >
            +5 gold
          </button>
          <button
            type="button"
            onClick={() => patchState((s) => bumpResource(s, player.id, 'meritBadges', 1))}
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]"
          >
            +1 MB
          </button>
        </div>
      </div>
    </div>
  );
}

function ArsMagnaControls({
  player,
  dispatch,
}: {
  player: Player;
  dispatch: (action: GameAction) => void;
}) {
  const redMagesInOffice = player.mages.filter(
    (m) => m.color === 'red' && m.location.kind === 'office' && !m.isWounded,
  );
  if (redMagesInOffice.length === 0 || player.resources.mana < 1) return null;
  return (
    <div className="text-xs space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        mage powers
      </p>
      <div className="flex flex-wrap gap-1">
        {redMagesInOffice.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() =>
              dispatch({
                type: 'USE_ABILITY',
                playerId: player.id,
                abilityId: 'base.mage.sorcery.ars-magna',
                sourceCardId: m.id,
              })
            }
            className="px-1.5 py-0.5 rounded bg-red-700 hover:bg-red-600 text-[10px]"
          >
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
          <p className="font-medium text-slate-200">Supporters ({state.supporterTableau.length})</p>
          <ul className="space-y-0.5">
            {state.supporterTableau.map((cid, i) => (
              <li key={`${cid}-${i}`}>{cid}</li>
            ))}
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
                <p className="text-xs text-slate-400">
                  Department: {c.department} · Mage color:{' '}
                  {c.startingMageColor}
                  {c.startingExtraMeritBadge ? ' · +1 MB' : ''}
                </p>
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

function RoomsPanel({ state }: { state: GameState }) {
  return (
    <section>
      <h2 className="text-lg font-medium mb-2">Tower ({state.rooms.length} rooms)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {state.rooms.map((room, ri) => {
          const isCurrent =
            state.phase.kind === 'resolution' && state.phase.pendingRoomIndex === ri;
          return (
            <div
              key={room.id}
              className={clsx(
                'rounded border p-2 text-xs',
                isCurrent
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-slate-700 bg-slate-900',
              )}
            >
              <div className="font-medium">
                {room.name} ({room.side})
                {room.isUniversityCentral && (
                  <span className="ml-1 text-slate-500">UC</span>
                )}
                {room.isInstantRoom && (
                  <span className="ml-1 text-slate-500">instant</span>
                )}
              </div>
              <div className="text-slate-500">
                {room.actionSpaces.length} slot{room.actionSpaces.length === 1 ? '' : 's'}
              </div>
              {room.actionSpaces.map((s) => (
                <div
                  key={s.id}
                  className={clsx(
                    'text-[10px]',
                    s.occupant ? 'text-amber-300' : 'text-slate-500',
                  )}
                >
                  · {s.id.split('.').pop()} · {s.slotType} ·{' '}
                  {s.occupant
                    ? `[${s.occupant.ownerId} / ${s.occupant.mageId.slice(-8)}${
                        s.occupant.isShadowing ? ' shadow' : ''
                      }]`
                    : 'empty'}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
