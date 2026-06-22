import clsx from 'clsx';
import { ResourceIcon, type ResourceKind } from '../icons';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, PLAYER_AURA, researchTotals } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from '../Board/MageToken';
import { HandFans } from '../Cards/HandFans';
import { PortraitBust } from './PortraitBust';
import { PlayerBuffBadges } from './PlayerBuffBadges';
import { StaffBadge } from './StaffBadge';
import { getBotPersonality } from '../../game/ai';
import { getScenario } from '../../content/scenarios';

/**
 * Bottom command center for the active player (docs/UI_DESIGN.md §8):
 * identity, resource chips, the mage bench (placement source — click a
 * student to pick them up, then click a glowing circle on the campus),
 * the three hand fans (spells / vault / allies), and turn controls.
 */

// Shared display order (dock + rival rail): influence, gold, mana, INT, WIS,
// marks, merit badges.
export const RESOURCE_ORDER: { kind: ResourceKind; key: string }[] = [
  { kind: 'influence', key: 'influence' },
  { kind: 'gold', key: 'gold' },
  { kind: 'mana', key: 'mana' },
  { kind: 'intelligence', key: 'intelligence' },
  { kind: 'wisdom', key: 'wisdom' },
  { kind: 'marks', key: 'marks' },
  { kind: 'merit-badge', key: 'meritBadges' },
];

export function PlayerDock() {
  const state = useGameStore((s) => s.state);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const selectMage = useUiStore((s) => s.selectMage);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  const { mageTargets, pickMage } = usePromptTargets();
  if (!state) return null;

  const player = activePlayer(state);
  const pendings = state.pendingResolutionStack.length;

  if (!player) {
    // Between turns (round-setup / resolution / mid-game-scoring) there's no
    // active player, so the dock offers the engine's ADVANCE_PHASE directly
    // instead of pointing at the console. The election phases drive
    // themselves through the ScoringCeremony, so no Advance there.
    const electionRunning =
      state.phase.kind === 'final-scoring' || state.phase.kind === 'complete';
    const betweenLabel =
      state.phase.kind === 'round-setup'
        ? `Round ${state.phase.round} — setup`
        : state.phase.kind === 'resolution'
          ? 'Resolution phase'
          : state.phase.kind === 'mid-game-scoring'
            ? 'Mid-game scoring'
            : 'Between turns';
    return (
      <footer className="z-30 flex h-16 items-center justify-center gap-3 bg-night-800/95 ring-1 ring-white/10">
        {electionRunning ? (
          <p className="text-sm text-white/60">The election is underway…</p>
        ) : (
          <>
            <p className="text-sm text-white/60">{betweenLabel}</p>
            <button
              type="button"
              disabled={pendings > 0}
              onClick={() => tryDispatch({ type: 'ADVANCE_PHASE' })}
              className="rounded-full bg-gradient-to-b from-starlight to-amber-300 px-5 py-1.5 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-lift active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0"
            >
              Advance ▸
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setDebugOpen(true)}
          className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/70 ring-1 ring-white/15 transition hover:text-white"
        >
          Console
        </button>
      </footer>
    );
  }

  const aura = PLAYER_AURA[player.color];
  const research0 = researchTotals(player);
  const bench = player.mages.filter((m) => m.location.kind === 'office');

  // Action budget for this turn. `activePlayer()` is non-null only during
  // errands, so the phase is always 'errands' here — the guard just narrows
  // the type. The counts are derived (not hard-coded to 1) so the readout
  // already reflects a future module that grants more than one per turn:
  //   regular = base Action (1 until used) + bonus grants (Flare / Dazzle /
  //             Bend Time, tracked in extraActions)
  //   fast    = the optional Fast Action, usable only BEFORE the regular one
  const errands = state.phase.kind === 'errands' ? state.phase : null;
  const regularActions = errands
    ? (errands.actionUsed ? 0 : 1) + (errands.extraActions ?? 0)
    : 0;
  // The scenario rule for the round in play (Dimensional Rift round twists).
  const scenarioRule =
    errands && state.scenarioId
      ? getScenario(state.scenarioId)?.rounds.find((r) => r.round === errands.round)
      : undefined;
  // Fast Actions left this turn: the per-turn limit (raised to 2 by Time Stands
  // Still) minus those already taken. Fast Actions are only usable before the
  // Regular Action.
  const fastActionLimit = scenarioRule?.maxFastActionsPerTurn ?? 1;
  const fastActions =
    errands && !errands.actionUsed
      ? Math.max(0, fastActionLimit - (errands.fastActionsUsed ?? 0))
      : 0;
  // Dimensional Rift R5 (Time Flux): the round runs on voluntary passes — the
  // turn control becomes "Pass for this round" instead of "End turn".
  const voluntaryPass = !!(errands && scenarioRule?.voluntaryPassRound);
  // When a Fast Action costs extra Mana this round, offer a way to skip it so a
  // forced-Fast placement (e.g. a Planar mage) is taken as the Regular Action.
  const fastSurcharge = scenarioRule?.fastActionManaSurcharge ?? 0;
  const canSkipFast = !!(
    errands &&
    !errands.actionUsed &&
    fastActions > 0 &&
    fastSurcharge > 0
  );
  // Wounded mages aren't shown here — they rest in the Infirmary ward on the
  // board (RoomScene bed grid), which renders + targets them and owns their
  // glide animation. Duplicating them here collided the framer-motion
  // layoutId and made the bed tokens vanish until a targeting prompt opened.

  return (
    <footer
      className="z-30 flex flex-col bg-night-800/95 px-4 py-1.5 ring-1 ring-white/10 backdrop-blur"
      style={{ boxShadow: `inset 0 3px 0 ${aura}` }}
    >
      {/* row 2: hands (rendered first so popovers escape upward cleanly) */}
      <HandFans state={state} player={player} />

      <div className="flex items-stretch gap-4">
      {/* identity */}
      <div className="flex min-w-[150px] items-center gap-2.5">
        <PortraitBust player={player} state={state} expression="neutral" size={44} />
        <div>
          <p className="flex items-center gap-1.5 font-display text-base font-bold leading-tight" style={{ color: aura }}>
            {player.name}
            {player.controlledByBot && (
              <span
                className="rounded-full bg-night-900/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-starlight ring-1 ring-starlight/40"
                title="Played by an AI"
              >
                🤖 {getBotPersonality(player.botPersonalityId).name}
              </span>
            )}
            <StaffBadge state={state} playerId={player.id} />
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/40">
            {player.controlledByBot
              ? `${getBotPersonality(player.botPersonalityId).name} is thinking…`
              : 'your move'}
          </p>
          <PlayerBuffBadges state={state} playerId={player.id} className="mt-1" />
        </div>
      </div>

      {/* resources — INT/WIS show remaining of total (unspent / earned) */}
      <div className="flex items-center gap-1.5">
        {RESOURCE_ORDER.map(({ kind, key }) => {
          const research =
            key === 'intelligence'
              ? { rem: research0.intRemaining, total: research0.intTotal, label: 'INT' }
              : key === 'wisdom'
                ? { rem: research0.wisRemaining, total: research0.wisTotal, label: 'WIS' }
                : null;
          return (
            <span
              key={key}
              className="flex items-center gap-1 rounded-full bg-night-700 px-2 py-1 text-xs font-bold ring-1 ring-white/10"
              title={
                research
                  ? `${research.label} — ${research.rem} unspent of ${research.total} total`
                  : key
              }
            >
              <ResourceIcon kind={kind} className="h-3.5 w-3.5" />
              {research ? (
                <span>
                  {research.rem}
                  <span className="text-white/45">/{research.total}</span>
                </span>
              ) : (
                (player.resources as unknown as Record<string, number>)[key] ?? 0
              )}
            </span>
          );
        })}
      </div>

      {/* bench */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        <p className="mr-1 shrink-0 text-[10px] uppercase tracking-widest text-white/40">
          bench
        </p>
        {bench.map((m) => {
          const targeted = mageTargets.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                targeted ? pickMage(m.id) : selectMage(selectedMageId === m.id ? null : m.id)
              }
              className={clsx(
                'rounded-xl px-1 pt-1 transition-all duration-150',
                targeted && 'animate-breathe',
                selectedMageId === m.id
                  ? 'scale-110 bg-night-600 ring-2 ring-starlight shadow-glow-sm'
                  : 'hover:-translate-y-1 hover:bg-night-700',
              )}
              style={
                targeted
                  ? { filter: 'drop-shadow(0 0 7px #ff5d7d)' }
                  : selectedMageId === m.id
                    ? ({ '--glow': '#ffe9a866' } as React.CSSProperties)
                    : undefined
              }
              title={`${m.color} student${m.isWounded ? ' (wounded)' : ''}`}
            >
              <MageToken color={m.color} aura={aura} isWounded={m.isWounded} size={42} glideId={m.id} />
            </button>
          );
        })}
        {bench.length === 0 && (
          <p className="text-xs italic text-white/35">no students in the office</p>
        )}
      </div>

      {/* turn controls */}
      <div className="flex items-center gap-2">
        {errands && <ActionBudget fast={fastActions} regular={regularActions} />}
        {canSkipFast && (
          <button
            type="button"
            disabled={pendings > 0}
            onClick={() =>
              tryDispatch({ type: 'SKIP_FAST_ACTION', playerId: player.id })
            }
            title={`Forfeit your Fast Action so your next placement counts as your Regular Action — avoids the +${fastSurcharge} Mana Fast Action cost this round.`}
            className="rounded-full bg-night-700 px-4 py-1.5 font-display text-sm font-bold text-white/80 ring-1 ring-white/15 shadow-card transition hover:-translate-y-0.5 hover:text-white active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            Skip fast action
          </button>
        )}
        {voluntaryPass ? (
          <button
            type="button"
            disabled={pendings > 0}
            onClick={() =>
              tryDispatch({ type: 'PASS_FOR_ROUND', playerId: player.id })
            }
            title="Opt out of all remaining turns this round. The round ends once every player has passed."
            className="rounded-full bg-gradient-to-b from-starlight to-amber-300 px-4 py-1.5 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-lift active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            Pass for this round
          </button>
        ) : (
          <button
            type="button"
            disabled={pendings > 0}
            onClick={() => tryDispatch({ type: 'PASS_TURN', playerId: player.id })}
            className="rounded-full bg-gradient-to-b from-starlight to-amber-300 px-4 py-1.5 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-lift active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            End turn
          </button>
        )}
      </div>
      </div>
    </footer>
  );
}

/**
 * Turn action-budget readout: how many Fast / Regular actions the active
 * player has left this turn. Count-first (not a checkmark) so it reads
 * correctly if a future module grants more than one of either per turn.
 */
function ActionBudget({ fast, regular }: { fast: number; regular: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <BudgetChip label="Fast" count={fast} tone="#7dd3fc" />
      <BudgetChip label={regular === 1 ? 'Action' : 'Actions'} count={regular} tone="#ffe9a8" />
    </div>
  );
}

/** One budget pill: a glowing count + a label, dimmed once it hits zero. */
function BudgetChip({ label, count, tone }: { label: string; count: number; tone: string }) {
  const spent = count === 0;
  return (
    <span
      className={clsx(
        'flex items-center gap-1 rounded-full bg-night-700 px-2 py-1 text-[9px] font-bold uppercase tracking-widest ring-1 ring-white/10',
        spent ? 'text-white/35' : 'text-white/70',
      )}
      title={`${count} ${label} action${count === 1 ? '' : 's'} remaining this turn`}
    >
      <span
        className="font-arcane text-sm leading-none"
        style={spent ? undefined : { color: tone, textShadow: `0 0 6px ${tone}99` }}
      >
        {count}
      </span>
      {label}
    </span>
  );
}
