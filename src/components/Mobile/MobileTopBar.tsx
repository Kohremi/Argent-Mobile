import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, PLAYER_AURA } from '../../utils/uiSelectors';
import {
  BellTowerMeter,
  ScenarioChip,
  SummerBreakChip,
  phaseLabel,
} from '../HUD/TopBar';

/**
 * Compact status bar for the mobile shell: phase, the bell-tower clock,
 * scenario chips, and a dot for whose turn it is. (No app title — dropped to
 * give the status chips more room.) Reuses the desktop TopBar's bell/scenario
 * pieces verbatim. Horizontally scrollable so chips never wrap.
 */
export function MobileTopBar() {
  const state = useGameStore((s) => s.state);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  const bellMenuOpen = useUiStore((s) => s.bellMenuOpen);
  const setBellMenuOpen = useUiStore((s) => s.setBellMenuOpen);
  if (!state) return null;

  const active = activePlayer(state);

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-2 bg-night-800/90 px-3 ring-1 ring-white/10 backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 rounded-full bg-night-700 px-2.5 py-1 font-display text-xs text-white/90 ring-1 ring-white/15">
          {phaseLabel(state.phase)}
        </span>
        <BellTowerMeter
          state={state}
          active={bellMenuOpen}
          onClick={() => setBellMenuOpen(!bellMenuOpen)}
        />
        <ScenarioChip state={state} />
        <SummerBreakChip state={state} />
      </div>

      {active && (
        <span
          className="flex shrink-0 items-center gap-1 rounded-full bg-night-700/70 px-2 py-1 text-[11px] font-semibold text-white/85 ring-1 ring-white/10"
          title={`${active.name}'s turn`}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: PLAYER_AURA[active.color] }}
          />
          <span className="max-w-[5rem] truncate">{active.name}</span>
        </span>
      )}

      <button
        type="button"
        onClick={() => setDebugOpen(!debugOpen)}
        aria-label="Toggle engine console"
        className={clsx(
          'shrink-0 rounded-full px-2 py-1 text-xs ring-1 transition',
          debugOpen
            ? 'bg-starlight text-ink-900 ring-starlight'
            : 'bg-night-700 text-white/70 ring-white/15',
        )}
      >
        ⚙
      </button>
    </header>
  );
}
