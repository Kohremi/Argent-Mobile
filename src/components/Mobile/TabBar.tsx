import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

/**
 * Primary navigation for the mobile shell — a thumb-zone bottom tab bar that
 * switches the focal "stage" between the four main views. Each tab is a ≥44px
 * touch target. Selecting a tab also closes any drilled-in room.
 */

type Tab = 'campus' | 'tableau' | 'rivals' | 'council';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'campus', label: 'Campus', glyph: '🏰' },
  { id: 'tableau', label: 'Offer', glyph: '🃏' },
  { id: 'rivals', label: 'Rivals', glyph: '🎓' },
  { id: 'council', label: 'Council', glyph: '⚖️' },
];

export function TabBar() {
  const state = useGameStore((s) => s.state);
  const mobileTab = useUiStore((s) => s.mobileTab);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const setOpenRoomId = useUiStore((s) => s.setOpenRoomId);

  const rivalCount = state ? Math.max(0, state.players.length - 1) : 0;

  return (
    <nav className="z-30 flex shrink-0 items-stretch bg-night-800/95 ring-1 ring-white/10 backdrop-blur">
      {TABS.map((tab) => {
        const selected = mobileTab === tab.id;
        const badge = tab.id === 'rivals' && rivalCount > 0 ? rivalCount : null;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setOpenRoomId(null);
              setMobileTab(tab.id);
            }}
            aria-current={selected ? 'page' : undefined}
            className={clsx(
              'relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-colors',
              selected ? 'text-starlight' : 'text-white/55',
            )}
          >
            {selected && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-starlight" />
            )}
            <span className="relative text-lg leading-none">
              {tab.glyph}
              {badge !== null && (
                <span className="absolute -right-2 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-night-600 px-0.5 text-[9px] font-bold text-white ring-1 ring-white/20">
                  {badge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
