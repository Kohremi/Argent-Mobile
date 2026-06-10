import { useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  buildMageIndex,
  eligiblePlacementSlots,
} from '../../utils/uiSelectors';

import { RoomScene } from './RoomScene';

/**
 * The floating campus (docs/UI_DESIGN.md §7.1): islands laid out from
 * `state.roomLayout.grid`, connected by ley-lines, drifting with staggered
 * floaty loops. The stage is larger than the viewport and scrolls.
 */

const CELL_W = 264;
const CELL_H = 220;
const GAP_X = 72;
const GAP_Y = 56;

type CellExit = 'flip' | 'destroy';

/** Island enter/exit set-pieces (docs/UI_DESIGN.md §7.4): Flux flips the
 *  tile in 3D; Devastation cracks it loose and drops it out of the sky. */
const islandVariants = {
  enter: (kind: CellExit | undefined) =>
    kind === 'flip' ? { rotateY: -92, opacity: 0.4 } : { opacity: 0, scale: 0.92 },
  idle: {
    rotateY: 0,
    opacity: 1,
    scale: 1,
    y: 0,
    rotate: 0,
    transition: { duration: 0.45, ease: 'easeOut' as const },
  },
  exit: (kind: CellExit | undefined) =>
    kind === 'flip'
      ? { rotateY: 92, opacity: 0.4, transition: { duration: 0.3, ease: 'easeIn' as const } }
      : kind === 'destroy'
        ? {
            y: 140,
            rotate: 7,
            opacity: 0,
            scale: 0.82,
            filter: 'brightness(.5)',
            transition: { duration: 0.9, ease: 'easeIn' as const },
          }
        : { opacity: 0 },
};

const oppositeOf = (roomId: string): string | null =>
  roomId.endsWith('.a')
    ? `${roomId.slice(0, -2)}.b`
    : roomId.endsWith('.b')
      ? `${roomId.slice(0, -2)}.a`
      : null;

export function CampusBoard() {
  const state = useGameStore((s) => s.state);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const tryDispatch = useUiStore((s) => s.tryDispatch);

  const mageIndex = useMemo(
    () => (state ? buildMageIndex(state) : new Map()),
    [state],
  );

  const eligible = useMemo(() => {
    if (!state || !selectedMageId) return new Set<string>();
    const player = activePlayer(state);
    if (!player) return new Set<string>();
    return eligiblePlacementSlots(state, player.id, selectedMageId);
  }, [state, selectedMageId]);

  // Previous grid cell contents, for choosing flip vs destroy exits.
  // Synchronous (render-time) so the exit kind is correct the moment a
  // tile leaves — effects/timeouts would race AnimatePresence.
  const prevGridRef = useRef(new Map<string, string | null>());

  if (!state) return null;
  const { grid, cols, rows } = state.roomLayout;
  const roomById = new Map(state.rooms.map((r) => [r.id, r] as const));

  const stageW = cols * CELL_W + (cols - 1) * GAP_X;
  const stageH = rows * CELL_H + (rows - 1) * GAP_Y;

  // Ley-lines between orthogonally adjacent occupied cells.
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r]?.[c]) continue;
      const cx = c * (CELL_W + GAP_X) + CELL_W / 2;
      const cy = r * (CELL_H + GAP_Y) + CELL_H / 2;
      if (grid[r]?.[c + 1]) {
        lines.push({ x1: cx, y1: cy, x2: cx + CELL_W + GAP_X, y2: cy });
      }
      if (grid[r + 1]?.[c]) {
        lines.push({ x1: cx, y1: cy, x2: cx, y2: cy + CELL_H + GAP_Y });
      }
    }
  }

  const onPlace = (spaceId: string) => {
    const player = activePlayer(state);
    if (!player || !selectedMageId) return;
    tryDispatch({
      type: 'PLACE_WORKER',
      playerId: player.id,
      mageId: selectedMageId,
      actionSpaceId: spaceId,
    });
  };

  let driftIndex = 0;
  return (
    <div className="h-full w-full overflow-auto">
      <div className="flex min-h-full min-w-full items-center justify-center p-10">
        <div className="relative" style={{ width: stageW, height: stageH }}>
          {/* ley-line layer */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={stageW}
            height={stageH}
          >
            {lines.map((l, i) => (
              <line
                key={i}
                {...l}
                stroke="#7ee8fa"
                strokeOpacity="0.18"
                strokeWidth="2.5"
                strokeDasharray="2 9"
                strokeLinecap="round"
              />
            ))}
          </svg>

          {/* islands — one AnimatePresence per cell so flip/destroy exits
              play per-tile (3D flips swap .a ↔ .b in place) */}
          {grid.map((row, r) =>
            row.map((roomId, c) => {
              const cellKey = `${r}-${c}`;
              const prevId = prevGridRef.current.get(cellKey);
              let exitKind: CellExit | undefined;
              if (prevId && prevId !== roomId) {
                exitKind = roomId === oppositeOf(prevId) ? 'flip' : 'destroy';
              }
              prevGridRef.current.set(cellKey, roomId);
              const room = roomId ? roomById.get(roomId) : undefined;
              return (
                <div
                  key={cellKey}
                  className="absolute"
                  style={{
                    left: c * (CELL_W + GAP_X),
                    top: r * (CELL_H + GAP_Y),
                    perspective: 900,
                  }}
                >
                  <AnimatePresence custom={exitKind} initial={false}>
                    {room && (
                      <motion.div
                        key={room.id}
                        custom={exitKind}
                        variants={islandVariants}
                        initial="enter"
                        animate="idle"
                        exit="exit"
                      >
                        <RoomScene
                          room={room}
                          state={state}
                          eligible={eligible}
                          onPlace={onPlace}
                          mageIndex={mageIndex}
                          driftIndex={driftIndex++}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
