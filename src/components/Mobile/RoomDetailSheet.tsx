import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { visibleRoomSpaces } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { RoomScene } from '../Board/RoomScene';
import { usePlacement } from '../Board/usePlacement';
import { LockIcon } from '../icons';
import { roomGlyph } from './CampusMap';

/**
 * Enlarged single-room view for the mobile shell — a bottom sheet (matching the
 * hand / offer drill-in sheets) that rises over the Campus map so the board
 * stays visible above it. A hued header band gives the chamber a face (glyph
 * watermark, name, side, tag chips) and carries prev/next/close; the body
 * renders the existing RoomScene in `embedded` mode (no duplicate card chrome)
 * so every special room comes for free. Placement reuses the shared usePlacement
 * read-model, so picking a Mage on the bench then tapping a slot here places it
 * exactly like the desktop board.
 */

/** Identity hue for the sheet's top border + title (locked wins, then UC, then
 *  Instant, else a neutral starlight). */
function roomHue(opts: { locked: boolean; uc: boolean; instant: boolean }): string {
  if (opts.locked) return '#fb7185'; // rose
  if (opts.uc) return '#fbbf24'; // amber
  if (opts.instant) return '#a78bfa'; // violet
  return '#cbd5e1'; // slate-300
}

function TagChip({ children, hue }: { children: React.ReactNode; hue?: string }) {
  return (
    <span
      className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/70 ring-1 ring-white/15"
      style={hue ? { color: hue } : undefined}
    >
      {children}
    </span>
  );
}

export function RoomDetailSheet() {
  const state = useGameStore((s) => s.state);
  const openRoomId = useUiStore((s) => s.openRoomId);
  const setOpenRoomId = useUiStore((s) => s.setOpenRoomId);
  const { spaceTargets } = usePromptTargets();
  const {
    mageIndex,
    eligible,
    shadowEligible,
    occupiedSlotPower,
    shadowManaCost,
    onPlace,
    onPlaceShadow,
  } = usePlacement();

  // Rooms present on the board, in grid reading order (for prev/next).
  const orderedRoomIds = useMemo(() => {
    if (!state) return [] as string[];
    return state.roomLayout.grid.flat().filter((id): id is string => !!id);
  }, [state]);

  if (!state || !openRoomId) return null;
  const room = state.rooms.find((r) => r.id === openRoomId);
  if (!room) return null;

  const idx = orderedRoomIds.indexOf(openRoomId);
  const prevId = idx > 0 ? orderedRoomIds[idx - 1] : orderedRoomIds[orderedRoomIds.length - 1];
  const nextId = idx >= 0 && idx < orderedRoomIds.length - 1 ? orderedRoomIds[idx + 1] : orderedRoomIds[0];
  const visible = visibleRoomSpaces(room, spaceTargets);

  const locked = state.roomLocks.some((l) => l.roomId === room.id);
  const hue = roomHue({ locked, uc: room.isUniversityCentral, instant: room.isInstantRoom });

  return (
    <div data-room-sheet className="absolute inset-0 z-30 flex flex-col justify-end">
      {/* scrim — the map shows through above; tap to dismiss */}
      <button
        type="button"
        aria-label="Close room"
        onClick={() => setOpenRoomId(null)}
        className="absolute inset-0 bg-black/55"
      />

      <div
        className="sheet-up relative flex max-h-[80%] flex-col rounded-t-card border-t-4 bg-night-800 shadow-card-lift"
        style={{ borderTopColor: hue }}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/25" />

        {/* header band — gives the chamber a face */}
        <div className="relative flex items-start gap-2 overflow-hidden px-3 pb-2 pt-2">
          {/* faint glyph watermark */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-2 -top-3 select-none text-7xl opacity-10"
          >
            {roomGlyph(room.name)}
          </span>

          <span className="mt-0.5 text-2xl leading-none">{roomGlyph(room.name)}</span>

          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-bold leading-tight" style={{ color: hue }}>
              {room.name}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <TagChip>side {room.side}</TagChip>
              {locked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-300 ring-1 ring-rose-400/40">
                  <LockIcon size={10} /> locked
                </span>
              )}
              {room.isUniversityCentral && <TagChip hue="#fbbf24">University Central</TagChip>}
              {room.isInstantRoom && <TagChip hue="#c4b5fd">⚡ instant</TagChip>}
              {room.maxMagesPerPlayerPerRound !== undefined && (
                <TagChip>max {room.maxMagesPerPlayerPerRound}/round</TagChip>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpenRoomId(null)}
            aria-label="Close room"
            className="shrink-0 rounded-full bg-night-700 px-2.5 py-1.5 text-sm font-bold text-white/85 ring-1 ring-white/20 active:scale-95"
          >
            ✕
          </button>
        </div>

        {/* scrollable room body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 text-base">
          <RoomScene
            room={room}
            state={state}
            eligible={eligible}
            shadowEligible={shadowEligible}
            shadowManaCost={shadowManaCost}
            occupiedSlotPower={occupiedSlotPower}
            onPlace={onPlace}
            onPlaceShadow={onPlaceShadow}
            mageIndex={mageIndex}
            spaces={visible}
            embedded
          />
        </div>

        {/* pager — prev / position / next, in the thumb zone */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={() => prevId && setOpenRoomId(prevId)}
            aria-label="Previous room"
            className="flex items-center gap-1 rounded-full bg-night-700 px-4 py-1.5 text-sm text-white/80 ring-1 ring-white/15 active:scale-95"
          >
            ‹ Prev
          </button>
          <span className="text-[10px] uppercase tracking-widest text-white/40">
            room {idx + 1} of {orderedRoomIds.length}
          </span>
          <button
            type="button"
            onClick={() => nextId && setOpenRoomId(nextId)}
            aria-label="Next room"
            className="flex items-center gap-1 rounded-full bg-night-700 px-4 py-1.5 text-sm text-white/80 ring-1 ring-white/15 active:scale-95"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
