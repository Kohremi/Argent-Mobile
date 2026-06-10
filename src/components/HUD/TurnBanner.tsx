import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { activePlayer, PLAYER_AURA } from '../../utils/uiSelectors';

/**
 * Hot-seat hand-off splash (docs/UI_DESIGN.md §9.5): when the active player
 * changes during Errands, a full-width color-washed banner sweeps in with
 * the incoming player's name. Auto-dismisses; click to skip. Doubles as the
 * anti-information-leak curtain between turns.
 */
export function TurnBanner() {
  const state = useGameStore((s) => s.state);
  const active = state ? activePlayer(state) : null;
  const round = state?.phase.kind === 'errands' ? state.phase.round : null;
  const prevIdRef = useRef<string | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);

  const activeId = active?.id ?? null;
  useEffect(() => {
    if (activeId && prevIdRef.current !== null && prevIdRef.current !== activeId) {
      setShownFor(activeId);
      const t = setTimeout(() => setShownFor(null), 1400);
      return () => clearTimeout(t);
    }
    prevIdRef.current = activeId;
    return undefined;
  }, [activeId]);
  // Keep ref current even when the banner fires.
  useEffect(() => {
    prevIdRef.current = activeId;
  }, [activeId]);

  if (!shownFor || !active || shownFor !== active.id) return null;
  const aura = PLAYER_AURA[active.color];

  return (
    <button
      type="button"
      onClick={() => setShownFor(null)}
      className="absolute inset-0 z-50 flex cursor-pointer items-center justify-center"
      style={{
        background: `linear-gradient(100deg, transparent 0%, ${aura}33 18%, #171430ee 38%, #171430ee 62%, ${aura}33 82%, transparent 100%)`,
      }}
    >
      <span className="animate-pop text-center">
        <span className="block font-display text-4xl font-extrabold" style={{ color: aura }}>
          {active.name}
        </span>
        <span className="mt-1 block text-sm uppercase tracking-[0.3em] text-white/70">
          {round ? `Day ${round} · ` : ''}your move
        </span>
      </span>
    </button>
  );
}
