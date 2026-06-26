import { useEffect } from 'react';
import type { Player } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import { PortraitBust } from './PortraitBust';
import { PlayerTableau } from './PlayerTableau';

/**
 * Opponent quick-reference (read-only): a focused overlay showing a rival's
 * full tableau — resources, researched spells, vault items, supporters, and the
 * vault / supporter discard piles. Opened by clicking a rival in the left rail
 * (OpponentRail); the backdrop blocks all other actions until the player closes
 * it (Return button, click-away, or Esc). Face-down "secret" supporter discards
 * stay hidden (shown as a count) — opponents may not peek at them. The tableau
 * body is shared with the mobile views via PlayerTableau.
 */
export function OpponentInspector() {
  const state = useGameStore((s) => s.state);
  const inspectPlayerId = useUiStore((s) => s.inspectPlayerId);
  const setInspectPlayerId = useUiStore((s) => s.setInspectPlayerId);

  // Esc closes the overlay (matches the click-away / Return affordances).
  useEffect(() => {
    if (!inspectPlayerId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectPlayerId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectPlayerId, setInspectPlayerId]);

  if (!state || !inspectPlayerId) return null;
  const player: Player | undefined = state.players.find((p) => p.id === inspectPlayerId);
  if (!player) return null;

  const aura = PLAYER_AURA[player.color];
  const close = () => setInspectPlayerId(null);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-night-900/80 px-6 backdrop-blur"
      onClick={close}
    >
      <div
        data-testid="opponent-inspector"
        className="max-h-[86vh] w-full max-w-3xl animate-pop overflow-y-auto rounded-card bg-night-800/97 p-4 shadow-card-lift ring-1 ring-white/15"
        style={{ boxShadow: `inset 0 3px 0 ${aura}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3">
          <PortraitBust player={player} state={state} expression="neutral" size={40} />
          <div className="min-w-0">
            <p className="font-display text-lg font-bold leading-tight" style={{ color: aura }}>
              {player.name}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-white/40">
              quick reference · read-only
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-full bg-night-700 px-4 py-1.5 font-display text-sm font-bold text-white/85 ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:text-white"
          >
            ✕ Return
          </button>
        </div>

        <PlayerTableau state={state} player={player} />
      </div>
    </div>
  );
}
