import clsx from 'clsx';
import type { GamePhase, GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, claimableBellCards, PLAYER_AURA } from '../../utils/uiSelectors';
import { getScenario } from '../../content/scenarios';
import { getPack } from '../../content/registry';

/** HUD bar: day dial, phase banner, bell meter, player strip, debug toggle.
 *  `phaseLabel`, `BellTowerMeter`, `ScenarioChip`, and `SummerBreakChip` are
 *  exported so the mobile shell's compact top bar can reuse them verbatim. */

export function phaseLabel(phase: GamePhase): string {
  switch (phase.kind) {
    case 'setup': return 'Setup';
    case 'candidate-draft': return 'Candidate Draft';
    case 'mage-draft-first-choice':
    case 'mage-draft': return 'Student Draft';
    case 'initial-mark-placement': return 'First Marks';
    case 'round-setup': return `Day ${phase.round} · Dawn`;
    case 'errands': return `Day ${phase.round} · Errands`;
    case 'resolution': return `Day ${phase.round} · Nightfall`;
    case 'final-scoring': return 'The Election';
    case 'complete': return 'Game Over';
    default: return '…';
  }
}

function activeIndex(state: GameState): number | null {
  const p = state.phase;
  if (p.kind === 'errands' || p.kind === 'candidate-draft') return p.activePlayerIndex;
  return null;
}

/** The round currently in play, if the phase tracks one. */
function currentRound(phase: GamePhase): number | null {
  switch (phase.kind) {
    case 'round-setup':
    case 'errands':
    case 'resolution':
      return phase.round;
    default:
      return null;
  }
}

/** Scenario chip: scenario name + the active round's rule (with a description
 *  tooltip). Renders nothing for a normal game. */
export function ScenarioChip({ state }: { state: GameState }) {
  if (!state.scenarioId) return null;
  const scenario = getScenario(state.scenarioId);
  if (!scenario) return null;
  const round = currentRound(state.phase);
  const rule =
    round === null ? null : scenario.rounds.find((r) => r.round === round);
  return (
    <span
      className="rounded-full bg-leyline/15 px-3 py-1 font-display text-sm text-leyline ring-1 ring-leyline/40"
      title={rule ? `${rule.name} — ${rule.description}` : scenario.description}
    >
      {scenario.name}
      {rule && <span className="ml-2 text-white/80">· {rule.name}</span>}
    </span>
  );
}

/** One-line description of each Summer Break round-end scenario. */
const SUMMER_BREAK_BLURBS: Record<string, string> = {
  'Students Return': 'Round end: draft a Mage from the supply.',
  'Summer Study Credits':
    'Round end: you may swap one of your Mages for one from the supply.',
  'Opening Ceremony': 'Round end: draft one reward from a shared pool.',
};

/** The last round that has a round-end (the final round has none). Mirrors the
 *  engine's `finalRoundFor`: scenarios cap at 5, else the setup override, else
 *  the largest `totalRounds` across active packs. */
function finalRound(state: GameState): number {
  if (state.scenarioId) return 5;
  if (state.totalRoundsOverride !== null) return state.totalRoundsOverride;
  let max = 5;
  for (const id of state.activePackIds) {
    const t = getPack(id)?.totalRounds;
    if (t !== undefined && t > max) max = t;
  }
  return max;
}

/** Summer Break chip: shows when the pack is active, plus the round-end
 *  scenario coming at the end of the current round (suppressed on the final
 *  round, which has none). Independent of the Scenario chip — both can show. */
export function SummerBreakChip({ state }: { state: GameState }) {
  if (!state.activePackIds.includes('summerbreak')) return null;
  const pack = getPack('summerbreak');
  if (!pack) return null;
  const round = currentRound(state.phase);
  const reward =
    round !== null && round < finalRound(state)
      ? pack.roundEndScenarios?.find((s) => s.round === round)
      : undefined;
  return (
    <span
      className="rounded-full bg-player-gold/15 px-3 py-1 font-display text-sm text-player-gold ring-1 ring-player-gold/40"
      title={
        reward
          ? `${reward.name} — ${SUMMER_BREAK_BLURBS[reward.name] ?? ''}`.trim()
          : pack.description
      }
    >
      ☀ Summer Break
      {reward && <span className="ml-2 text-white/80">· {reward.name}</span>}
    </span>
  );
}

/** Bell count chip — the round's clock. The claimable offerings live on the
 *  campus (see Board/BellTower); this is just the remaining-bells indicator,
 *  glowing when the active player has a bell they can claim. */
export function BellTowerMeter({ state }: { state: GameState }) {
  const player = activePlayer(state);
  const claimable =
    player && !player.controlledByBot
      ? claimableBellCards(state, player.id)
      : new Set<string>();
  const bells = state.bellTower.available.length;

  return (
    <span
      className={clsx(
        'flex items-center gap-1.5 rounded-full bg-night-700 px-3 py-1 text-sm ring-1',
        claimable.size > 0 ? 'ring-starlight/60' : 'ring-white/15',
      )}
      title={
        claimable.size > 0
          ? 'Bell Tower — claim an offering on the campus (ends your turn)'
          : 'Bell Tower offerings remaining this round'
      }
    >
      🔔
      <span className="font-bold text-starlight">{bells}</span>
    </span>
  );
}

export function TopBar() {
  const state = useGameStore((s) => s.state);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  if (!state) return null;

  const active = activeIndex(state);

  return (
    <header className="z-30 flex h-14 items-center gap-4 bg-night-800/90 px-4 ring-1 ring-white/10 backdrop-blur">
      <h1 className="font-display text-lg font-extrabold tracking-wide text-starlight">
        Argent
      </h1>

      <span className="rounded-full bg-night-700 px-3 py-1 font-display text-sm text-white/90 ring-1 ring-white/15">
        {phaseLabel(state.phase)}
      </span>

      <BellTowerMeter state={state} />

      <ScenarioChip state={state} />

      <SummerBreakChip state={state} />

      {/* player strip */}
      <div className="ml-auto flex items-center gap-2">
        {state.players.map((p, i) => (
          <span
            key={p.id}
            className={clsx(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-all',
              i === active
                ? 'bg-night-600 ring-starlight/70 shadow-glow-sm'
                : 'bg-night-700/70 ring-white/10 opacity-75',
            )}
            style={
              i === active
                ? ({ '--glow': `${PLAYER_AURA[p.color]}66` } as React.CSSProperties)
                : undefined
            }
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: PLAYER_AURA[p.color] }}
            />
            {p.name}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setDebugOpen(!debugOpen)}
        className={clsx(
          'rounded-full px-3 py-1 text-xs ring-1 transition',
          debugOpen
            ? 'bg-starlight text-ink-900 ring-starlight'
            : 'bg-night-700 text-white/70 ring-white/15 hover:text-white',
        )}
      >
        ⚙ Console
      </button>
    </header>
  );
}
