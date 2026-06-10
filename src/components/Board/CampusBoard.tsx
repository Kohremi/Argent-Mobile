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
import { ROOM_PX, roomArtFor } from './roomArt';

/**
 * The university as ONE floating castle (docs/UI_DESIGN.md §7, hybrid art):
 * each grid row is a story; rooms are chambers carved into shared masonry,
 * bottom-anchored so floors align (ceiling heights vary per room).
 * Horizontal neighbors connect through floor-level doorway arches; stories
 * connect by staircases. The whole building drifts gently as a single mass
 * above a rock foundation, with spires along the roofline.
 */

const CELL_W = 264;
const CELL_H = 248; // tallest chamber; shorter rooms leave masonry above
const GAP_X = 18; // shared wall thickness
const GAP_Y = 46; // floor slab between stories

type CellExit = 'flip' | 'destroy';

/** Chamber enter/exit set-pieces (docs/UI_DESIGN.md §7.4): Flux flips the
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

/** A floor-level doorway arch punched through a shared wall. */
function Doorway({ x, floorY }: { x: number; floorY: number }) {
  return (
    <svg
      className="pointer-events-none absolute z-20"
      style={{ left: x - 19, top: floorY - 50 }}
      width="38"
      height="50"
      viewBox="0 0 38 50"
    >
      <path d="M3 50 V20 a16 16 0 0 1 32 0 V50 Z" fill="#4d4458" />
      <path d="M8 50 V22 a11 11 0 0 1 22 0 V50 Z" fill="#0e0b1d" />
      <path d="M8 50 V22 a11 11 0 0 1 22 0 V50" fill="none" stroke="#7ee8fa" strokeOpacity=".25" strokeWidth="1.5" />
    </svg>
  );
}

/** A staircase connecting two stories through the floor slab. */
function Stairs({ cx, top }: { cx: number; top: number }) {
  return (
    <svg
      className="pointer-events-none absolute z-20"
      style={{ left: cx - 34, top: top - 5 }}
      width="68"
      height={GAP_Y + 10}
      viewBox={`0 0 68 ${GAP_Y + 10}`}
    >
      <path d="M6 0 h56 v8 h-8 v8 h-8 v8 h-8 v8 h-8 v8 h-8 v8 h-8 v8 H6 Z" fill="#4d4458" transform="scale(1, .85)" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={10 + i * 9} y={6 + i * 8} width="40" height="4" rx="1" fill="#241f43" transform="scale(1, .85)" />
      ))}
    </svg>
  );
}

/** Roofline spires + battlements along the top of the castle. */
function Roofline({ width }: { width: number }) {
  const spires = [0.08, 0.5, 0.92];
  return (
    <svg
      className="pointer-events-none absolute z-0"
      style={{ left: -14, top: -58 }}
      width={width + 28}
      height="60"
    >
      {/* battlement strip */}
      {Array.from({ length: Math.ceil((width + 28) / 26) }).map((_, i) => (
        <rect key={i} x={i * 26} y="44" width="15" height="16" fill="#4d4458" rx="2" />
      ))}
      {/* spires */}
      {spires.map((f) => {
        const x = f * (width + 28);
        return (
          <g key={f}>
            <rect x={x - 13} y="22" width="26" height="38" fill="#3f3852" rx="3" />
            <path d={`M${x - 17} 24 L${x} 0 L${x + 17} 24 Z`} fill="#6c5a8e" />
            <circle cx={x} cy="4" r="2.5" fill="#ffe9a8" />
          </g>
        );
      })}
    </svg>
  );
}

/** Floating rock foundation + drifting cloud wisps under the castle. */
function Foundation({ width }: { width: number }) {
  return (
    <svg
      className="pointer-events-none absolute z-0"
      style={{ left: -22, bottom: -74 }}
      width={width + 44}
      height="80"
    >
      <path
        d={`M10 6 H${width + 34} L${width - 60} 38 Q${width / 2 + 22} 78 ${width / 2 - 60} 52 L90 40 Z`}
        fill="#2a2240"
      />
      <path
        d={`M40 6 H${width - 20} L${width - 110} 28 Q${width / 2} 52 150 30 Z`}
        fill="#3f3852"
        opacity=".8"
      />
      <ellipse cx={width * 0.22} cy="58" rx="56" ry="9" fill="#e8e4da" opacity=".1" />
      <ellipse cx={width * 0.74} cy="66" rx="72" ry="10" fill="#e8e4da" opacity=".08" />
    </svg>
  );
}

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

  // Connections between adjacent occupied cells: doorways within a story,
  // staircases between stories. Adjacency is engine truth (the grid).
  const doorways: { x: number; floorY: number }[] = [];
  const stairs: { cx: number; top: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r]?.[c]) continue;
      const floorY = r * (CELL_H + GAP_Y) + CELL_H;
      if (grid[r]?.[c + 1]) {
        doorways.push({ x: c * (CELL_W + GAP_X) + CELL_W + GAP_X / 2, floorY });
      }
      if (grid[r + 1]?.[c]) {
        stairs.push({ cx: c * (CELL_W + GAP_X) + CELL_W / 2, top: floorY });
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

  return (
    <div className="h-full w-full overflow-auto">
      <div className="flex min-h-full min-w-full items-center justify-center px-12 py-20">
        {/* the whole castle drifts as one */}
        <div className="relative animate-floaty" style={{ width: stageW, height: stageH }}>
          <Roofline width={stageW} />
          <Foundation width={stageW} />

          {/* masonry shell — walls between and around the chambers */}
          <div
            className="absolute -inset-3.5 z-0 rounded-2xl"
            style={{
              background: 'linear-gradient(180deg, #3f3852, #332c47 55%, #3a3050)',
              boxShadow: '0 30px 60px -20px #00000099, inset 0 0 0 2px #574d6b',
            }}
          />

          {/* chambers — one AnimatePresence per cell so flip/destroy exits
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
              const height = room ? ROOM_PX[roomArtFor(room.name).height] : CELL_H;
              return (
                <div
                  key={cellKey}
                  className="absolute z-10"
                  style={{
                    left: c * (CELL_W + GAP_X),
                    // Bottom-anchor: floors align along each story.
                    top: r * (CELL_H + GAP_Y) + (CELL_H - height),
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
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }),
          )}

          {/* connections */}
          {doorways.map((d, i) => (
            <Doorway key={`d-${i}`} {...d} />
          ))}
          {stairs.map((s, i) => (
            <Stairs key={`s-${i}`} {...s} />
          ))}
        </div>
      </div>
    </div>
  );
}
