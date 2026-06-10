import { useState } from 'react';
import clsx from 'clsx';
import type { GamePhase, GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, claimableBellCards, PLAYER_AURA } from '../../utils/uiSelectors';

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
    case 'complete': return 'Game Over';
    default: return '…';
  }
}

function activeIndex(state: GameState): number | null {
  const p = state.phase;
  if (p.kind === 'errands' || p.kind === 'candidate-draft') return p.activePlayerIndex;
  return null;
}

/** Bell count chip + claim popover. Claiming a bell is the round's clock:
 *  each claim advances the sky; the last one rings in Nightfall. */
function BellTowerMeter({ state }: { state: GameState }) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const [open, setOpen] = useState(false);
  const player = activePlayer(state);
  const claimable = player ? claimableBellCards(state, player.id) : new Set<string>();
  const bells = state.bellTower.available.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-1.5 rounded-full bg-night-700 px-3 py-1 text-sm ring-1 transition',
          claimable.size > 0 ? 'ring-starlight/60 hover:ring-starlight' : 'ring-white/15',
          open && 'ring-2 ring-starlight',
        )}
        title="Bell Tower offerings remaining this round"
      >
        🔔
        <span className="font-bold text-starlight">{bells}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-80 animate-pop rounded-card bg-night-700/98 p-2 shadow-card-lift ring-1 ring-white/15">
          <p className="mb-1.5 font-display text-sm font-bold text-starlight">
            Bell Tower
            <span className="ml-2 text-[10px] font-normal uppercase tracking-widest text-white/40">
              claiming ends your turn
            </span>
          </p>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {state.bellTower.available.map((card) => {
              const ok = claimable.has(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    setOpen(false);
                    if (player) {
                      tryDispatch({
                        type: 'CLAIM_BELL_TOWER',
                        playerId: player.id,
                        bellTowerCardId: card.id,
                      });
                    }
                  }}
                  className={clsx(
                    'rounded-lg px-2 py-1 text-left text-xs ring-1 transition',
                    ok
                      ? 'bg-night-600 ring-leyline/40 hover:-translate-y-0.5 hover:ring-starlight/70'
                      : 'bg-night-800 opacity-50 ring-white/10',
                  )}
                >
                  <span className="font-bold text-white/95">{card.name}</span>
                  <span className="block text-[11px] leading-snug text-white/65">
                    {card.description}
                  </span>
                </button>
              );
            })}
            {bells === 0 && (
              <p className="px-2 py-1 text-xs italic text-white/40">
                All bells claimed — nightfall comes when the turn ends.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
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
