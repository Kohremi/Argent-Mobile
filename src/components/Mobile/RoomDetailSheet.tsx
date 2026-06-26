import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { visibleRoomSpaces } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { RoomScene } from '../Board/RoomScene';
import { usePlacement } from '../Board/usePlacement';

/**
 * Enlarged single-room view for the mobile shell — a full-screen sheet that
 * renders the existing RoomScene (so every special room comes for free) for the
 * drilled-in `openRoomId`, with prev/next navigation across the rooms in grid
 * order. Placement reuses the shared usePlacement read-model, so picking a Mage
 * on the bench then tapping a slot here places it exactly like the desktop board.
 */
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

  return (
    <div
      data-room-sheet
      className="sheet-up absolute inset-0 z-30 flex flex-col bg-night-900/97 backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={() => prevId && setOpenRoomId(prevId)}
          aria-label="Previous room"
          className="rounded-full bg-night-700 px-3 py-1.5 text-sm text-white/80 ring-1 ring-white/15"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-display text-base font-bold text-starlight">{room.name}</p>
          <p className="text-[10px] uppercase tracking-widest text-white/40">
            side {room.side} · room {idx + 1} of {orderedRoomIds.length}
          </p>
        </div>
        <button
          type="button"
          onClick={() => nextId && setOpenRoomId(nextId)}
          aria-label="Next room"
          className="rounded-full bg-night-700 px-3 py-1.5 text-sm text-white/80 ring-1 ring-white/15"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => setOpenRoomId(null)}
          aria-label="Close room"
          className="rounded-full bg-night-700 px-3 py-1.5 text-sm font-bold text-white/85 ring-1 ring-white/20"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-base">
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
        />
      </div>
    </div>
  );
}
