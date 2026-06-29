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
import { LiveActionNote } from './LiveActionNote';

/**
 * The mobile shell's single status header — a consolidation of what used to be
 * two stacked strips (a title/chips top bar + a separate live-action row). One
 * 48px bar now carries: a compact round/phase pill, the live-action narration
 * in the flexible middle (folded in from the old second row — see
 * LiveActionNote), then the bell-tower clock, scenario chips, a whose-turn dot,
 * and the engine-console toggle. Merging the strips reclaims the second row's
 * height for the board. Horizontally tight items shrink-0; the note truncates.
 */
export function MobileTopBar() {
  const state = useGameStore((s) => s.state);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  const bellMenuOpen = useUiStore((s) => s.bellMenuOpen);
  const setBellMenuOpen = useUiStore((s) => s.setBellMenuOpen);
  if (!state) return null;

  const active = activePlayer(state);
  const round = 'round' in state.phase ? (state.phase.round as number) : null;

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-2 bg-night-800/90 px-3 ring-1 ring-white/10 backdrop-blur">
      {/* round / phase context (absorbs the old phase chip + the row's "Round N") */}
      <span className="shrink-0 rounded-full bg-night-700 px-2.5 py-1 font-display text-[11px] font-bold text-white/90 ring-1 ring-white/15">
        {round != null ? `Round ${round}` : phaseLabel(state.phase)}
      </span>

      {/* live action narration — the flexible middle, truncates under pressure */}
      <LiveActionNote />

      {/* persistent status cluster */}
      <BellTowerMeter
        state={state}
        active={bellMenuOpen}
        onClick={() => setBellMenuOpen(!bellMenuOpen)}
      />
      <ScenarioChip state={state} />
      <SummerBreakChip state={state} />

      {active && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30"
          style={{ background: PLAYER_AURA[active.color] }}
          title={`${active.name}'s turn`}
        />
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
