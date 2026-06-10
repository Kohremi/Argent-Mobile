import clsx from 'clsx';
import type { GamePhase, GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { PLAYER_AURA } from '../../utils/uiSelectors';

/** HUD bar: day dial, phase banner, bell meter, player strip, debug toggle. */

function phaseLabel(phase: GamePhase): string {
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
    default: return '…';
  }
}

function activeIndex(state: GameState): number | null {
  const p = state.phase;
  if (p.kind === 'errands' || p.kind === 'candidate-draft') return p.activePlayerIndex;
  return null;
}

export function TopBar() {
  const state = useGameStore((s) => s.state);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  if (!state) return null;

  const bells = state.bellTower.available.length;
  const active = activeIndex(state);

  return (
    <header className="z-30 flex h-14 items-center gap-4 bg-night-800/90 px-4 ring-1 ring-white/10 backdrop-blur">
      <h1 className="font-display text-lg font-extrabold tracking-wide text-starlight">
        Argent
      </h1>

      <span className="rounded-full bg-night-700 px-3 py-1 font-display text-sm text-white/90 ring-1 ring-white/15">
        {phaseLabel(state.phase)}
      </span>

      <span
        className="flex items-center gap-1.5 rounded-full bg-night-700 px-3 py-1 text-sm ring-1 ring-white/15"
        title="Bell Tower offerings remaining this round"
      >
        🔔
        <span className="font-bold text-starlight">{bells}</span>
      </span>

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
