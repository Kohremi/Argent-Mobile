import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  localPlayer,
  PLAYER_AURA,
  researchTotals,
} from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { ResourceIcon } from '../icons';
import { MageToken } from '../Board/MageToken';
import { PortraitBust } from '../Player/PortraitBust';
import { PlayerBuffBadges } from '../Player/PlayerBuffBadges';
import { ActionBudget, MeritBadge, RESOURCE_ORDER_COMPACT } from '../Player/PlayerDock';
import { computeTurnActions } from '../Player/turnActions';
import { MobileHand } from './MobileHand';

/**
 * Command center for the mobile shell — a bottom sheet docked above the tab bar.
 * In single-player it always shows the LOCAL (human) seat: their identity,
 * resources, mage bench, and hands. Turn controls (pick-to-place, End turn,
 * scenario actions) are live only on the human's turn; while the bots play it
 * shows an "opponents are playing" state with the board still visible. Between
 * turns it offers ADVANCE_PHASE. With no bound seat (legacy hot-seat) it follows
 * the active player.
 */
export function MobileDock() {
  const state = useGameStore((s) => s.state);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const selectMage = useUiStore((s) => s.selectMage);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const expanded = useUiStore((s) => s.dockExpanded);
  const setExpanded = useUiStore((s) => s.setDockExpanded);
  const { mageTargets, pickMage } = usePromptTargets();
  if (!state) return null;

  const active = activePlayer(state);
  const pendings = state.pendingResolutionStack.length;

  // Always show the LOCAL seat's board — including through the night (resolution)
  // / setup / scoring phases, when there's no active Errands player, so you can
  // still read your stats to make decisions. Only the turn controls swap out for
  // an "opponents playing" pill or the between-phase Advance button.
  const self = localPlayer(state, localPlayerId) ?? state.players[0]!;
  const myTurn = active?.id === self.id;
  // No active Errands player → a between-turns phase (Nightfall, setup, scoring),
  // which now auto-advances in every mode, so the dock shows a quiet "working"
  // state rather than a manual Advance button or a phase label that just repeats
  // the top bar. A short activity verb conveys what's auto-resolving.
  const betweenTurns = !active;
  const electionRunning =
    state.phase.kind === 'final-scoring' || state.phase.kind === 'complete';
  const betweenActivity = electionRunning
    ? 'the election'
    : state.phase.kind === 'round-setup'
      ? 'new round'
      : state.phase.kind === 'mid-game-scoring'
        ? 'scoring'
        : 'resolving';
  const aura = PLAYER_AURA[self.color];
  const research = researchTotals(self);
  const bench = self.mages.filter((m) => m.location.kind === 'office');
  const turn = myTurn ? computeTurnActions(state, self) : null;
  // Bench is hidden when collapsed — but stay visible if a prompt is targeting a
  // bench mage (so the player can't get stuck unable to reach it).
  const showBench = expanded || mageTargets.size > 0;

  return (
    <footer
      className="z-30 flex shrink-0 flex-col gap-1.5 bg-night-800/95 px-3 pb-1.5 pt-1 ring-1 ring-white/10 backdrop-blur"
      style={{ boxShadow: `inset 0 3px 0 ${aura}` }}
    >
      {/* expand toggle — a wide, easy-to-hit button (the hand & bench live inside) */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? 'Hide hand and bench' : 'Show hand and bench'}
        className="-mt-0.5 flex w-full items-center justify-center gap-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45 transition active:text-white/80"
      >
        <span className="h-1 w-8 rounded-full bg-white/25" />
        <span>{expanded ? 'Hide hand ▾' : 'Hand & bench ▴'}</span>
        <span className="h-1 w-8 rounded-full bg-white/25" />
      </button>

      {/* identity + budget + turn control (or an "opponents playing" pill) */}
      <div className="flex items-center gap-2">
        <PortraitBust player={self} state={state} expression="neutral" size={36} />
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-display text-sm font-bold leading-tight"
            style={{ color: aura }}
          >
            {self.name}
          </p>
          <p className="text-[9px] uppercase tracking-widest text-white/40">
            {myTurn ? 'your move' : betweenTurns ? betweenActivity : 'waiting…'}
          </p>
        </div>
        <MeritBadge count={self.resources.meritBadges} className="mr-1" />
        {myTurn && turn ? (
          <>
            <ActionBudget fast={turn.fastActions} regular={turn.regularActions} />
            {turn.voluntaryPass ? (
              <button
                type="button"
                disabled={pendings > 0}
                onClick={() => tryDispatch({ type: 'PASS_FOR_ROUND', playerId: self.id })}
                className="shrink-0 rounded-full bg-gradient-to-b from-starlight to-amber-300 px-3 py-2 font-display text-xs font-bold text-ink-900 shadow-card disabled:opacity-40"
              >
                Pass round
              </button>
            ) : (
              <button
                type="button"
                disabled={pendings > 0}
                onClick={() => tryDispatch({ type: 'PASS_TURN', playerId: self.id })}
                className="shrink-0 rounded-full bg-gradient-to-b from-starlight to-amber-300 px-4 py-2 font-display text-xs font-bold text-ink-900 shadow-card disabled:opacity-40"
              >
                End turn
              </button>
            )}
          </>
        ) : betweenTurns ? (
          // Night (resolution) / setup / scoring auto-advance — no manual button.
          // Just a quiet pulse so it's clear the game is progressing on its own.
          <span
            className="h-2.5 w-2.5 shrink-0 animate-breathe rounded-full"
            style={{ background: aura }}
            title="The game is advancing automatically"
          />
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-night-700 px-3 py-1.5 text-[11px] font-bold text-starlight ring-1 ring-starlight/30">
            <span className="animate-breathe">🤖</span>
            <span className="max-w-[7rem] truncate">{active?.name} is playing…</span>
          </span>
        )}
      </div>

      {/* resources */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {RESOURCE_ORDER_COMPACT.map(({ kind, key }) => {
          const isInt = key === 'intelligence';
          const isWis = key === 'wisdom';
          return (
            <span
              key={key}
              className="flex shrink-0 items-center gap-1 rounded-full bg-night-700 px-2 py-1 text-xs font-bold ring-1 ring-white/10"
            >
              <ResourceIcon kind={kind} className="h-3.5 w-3.5" />
              {isInt ? (
                <span>
                  {research.intRemaining}
                  <span className="text-white/45">/{research.intTotal}</span>
                </span>
              ) : isWis ? (
                <span>
                  {research.wisRemaining}
                  <span className="text-white/45">/{research.wisTotal}</span>
                </span>
              ) : (
                (self.resources as unknown as Record<string, number>)[key] ?? 0
              )}
            </span>
          );
        })}
      </div>

      {/* bench — pick a student up to place on the Campus map; picking one
          auto-collapses the dock so the board is visible to place it. */}
      {showBench && (
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="mr-1 shrink-0 text-[9px] uppercase tracking-widest text-white/40">
            bench
          </span>
          {bench.length === 0 && (
            <span className="text-[11px] italic text-white/35">no students in the office</span>
          )}
          {bench.map((m) => {
            const targeted = mageTargets.has(m.id);
            const picked = selectedMageId === m.id;
            const interactive = myTurn || targeted;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!interactive}
                onClick={() => {
                  if (targeted) {
                    pickMage(m.id);
                    setExpanded(false);
                  } else {
                    const next = picked ? null : m.id;
                    selectMage(next);
                    if (next) setExpanded(false);
                  }
                }}
                className={clsx(
                  'shrink-0 rounded-xl px-1 py-0.5 transition',
                  targeted && 'animate-breathe',
                  picked
                    ? 'scale-110 bg-night-600 ring-2 ring-starlight shadow-glow-sm'
                    : interactive
                      ? 'hover:bg-night-700'
                      : 'opacity-60',
                )}
                style={targeted ? { filter: 'drop-shadow(0 0 7px #ff5d7d)' } : undefined}
                title={`${m.color} student${m.isWounded ? ' (wounded)' : ''}`}
              >
                <MageToken color={m.color} aura={aura} isWounded={m.isWounded} size={40} glideId={m.id} />
              </button>
            );
          })}
        </div>
      )}

      {/* expanded: hands + buffs + scenario actions */}
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-white/10 pt-1.5">
          <MobileHand state={state} player={self} />
          <PlayerBuffBadges state={state} playerId={self.id} />
          {turn && (
            <div className="flex flex-wrap gap-1.5">
              {turn.canSkipFast && (
                <button
                  type="button"
                  disabled={pendings > 0}
                  onClick={() => tryDispatch({ type: 'SKIP_FAST_ACTION', playerId: self.id })}
                  className="rounded-full bg-night-700 px-3 py-1.5 text-xs font-bold text-white/80 ring-1 ring-white/15 disabled:opacity-40"
                  title={`Forfeit your Fast Action (avoids the +${turn.fastSurcharge} Mana cost this round).`}
                >
                  Skip fast action
                </button>
              )}
              {turn.canInfirmaryStrike && (
                <button
                  type="button"
                  disabled={pendings > 0}
                  onClick={() =>
                    tryDispatch({
                      type: 'USE_ABILITY',
                      playerId: self.id,
                      abilityId: 'assassins.scenario.infirmary-strike',
                    })
                  }
                  className="rounded-full bg-rose-800 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-rose-400/50 disabled:opacity-40"
                >
                  🗡 Infirmary Strike
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </footer>
  );
}
