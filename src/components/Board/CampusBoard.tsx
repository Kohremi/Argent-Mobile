import { useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Room } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  buildMageIndex,
  eligiblePlacementSlots,
  infirmaryBeds,
  visibleRoomSpaces,
} from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';

import { infirmaryRoomHeight, roomHeight, ROOM_W, RoomScene } from './RoomScene';
import { SHELF_H, SHELF_MT, TableauShelf } from './TableauShelf';

/**
 * The university as ONE floating castle (docs/UI_DESIGN.md §7, function-first
 * revision): each grid row is a story; rooms are uniform-width chambers whose
 * HEIGHT follows their visible slot count (slots stack vertically with their
 * effect text beside them). Stories reserve space for their tallest chamber;
 * rooms bottom-anchor so floors align. Horizontal neighbors connect through
 * floor-level doorway arches; stories connect by staircases. The whole
 * building drifts gently as one mass above a rock foundation.
 */

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

/** A floor-level passage between two rooms: a doorway arch when the rooms
 *  share a wall, stretching into a corridor when their widths differ. */
function Corridor({ x1, x2, floorY }: { x1: number; x2: number; floorY: number }) {
  const w = Math.max(38, x2 - x1 + 12); // reach 6px into each room's wall
  const left = x1 - 6;
  return (
    <svg
      className="pointer-events-none absolute z-20"
      style={{ left, top: floorY - 50 }}
      width={w}
      height="50"
      viewBox={`0 0 ${w} 50`}
    >
      {/* masonry tube */}
      <rect x="0" y="4" width={w} height="46" rx="8" fill="#4d4458" />
      {/* dark interior */}
      <path
        d={`M5 50 V24 a14 14 0 0 1 14 -14 H${w - 19} a14 14 0 0 1 14 14 V50 Z`}
        fill="#0e0b1d"
      />
      <path
        d={`M5 50 V24 a14 14 0 0 1 14 -14 H${w - 19} a14 14 0 0 1 14 14 V50`}
        fill="none"
        stroke="#7ee8fa"
        strokeOpacity=".22"
        strokeWidth="1.5"
      />
      {/* corridor floor */}
      <rect x="5" y="45" width={w - 10} height="5" fill="#241f43" />
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

  // Pan (drag the sky to scroll) + zoom (store-backed so it survives turns).
  const zoom = useUiStore((s) => s.boardZoom);
  const setBoardZoom = useUiStore((s) => s.setBoardZoom);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Prompt-targeted slots must stay visible even in collapsed pool rooms.
  const { spaceTargets } = usePromptTargets();
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Don't hijack clicks on slots/tokens/controls.
    if ((e.target as HTMLElement).closest('button')) return;
    const el = scrollRef.current;
    if (!el) return;
    el.dataset['panning'] = 'true';
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = el.scrollLeft;
    const startTop = el.scrollTop;
    const move = (ev: PointerEvent) => {
      el.scrollLeft = startLeft - (ev.clientX - startX);
      el.scrollTop = startTop - (ev.clientY - startY);
    };
    const up = () => {
      delete el.dataset['panning'];
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!state) return null;
  const { grid, cols, rows } = state.roomLayout;
  const roomById = new Map(state.rooms.map((r) => [r.id, r] as const));

  // Each room owns its size: HEIGHT follows its VISIBLE slot column (pool
  // rooms like the Great Hall collapse to occupied + one open seat, so the
  // hall grows as it fills). Stories reserve space for their tallest room;
  // rooms bottom-anchor within the story so floors stay aligned and the
  // floor-level corridors keep bridging actual edges.
  const visibleByCell = new Map<string, ReturnType<typeof visibleRoomSpaces>>();
  // The Infirmary sizes by its bed grid, every other room by its slot column.
  const cellHeight = (room: Room, visibleCount: number) =>
    room.name === 'Infirmary'
      ? infirmaryRoomHeight(infirmaryBeds(state, room).length)
      : roomHeight(visibleCount);
  const rowH: number[] = Array.from({ length: rows }, (_, r) => {
    let h = roomHeight(1);
    for (let c = 0; c < cols; c++) {
      const id = grid[r]?.[c];
      const room = id ? roomById.get(id) : undefined;
      if (!room) continue;
      const visible = visibleRoomSpaces(room, spaceTargets);
      visibleByCell.set(`${r}-${c}`, visible);
      h = Math.max(h, cellHeight(room, visible.length));
    }
    return h;
  });
  const rowY: number[] = [];
  let acc = 0;
  for (let r = 0; r < rows; r++) {
    rowY.push(acc);
    acc += rowH[r]! + GAP_Y;
  }
  const stageH = acc - GAP_Y;
  const stageW = cols * ROOM_W + (cols - 1) * GAP_X;
  // Castle + the tableau shelf beneath it (pan/zoom treats them as one stage).
  const totalH = stageH + SHELF_MT + SHELF_H;

  const colX = (c: number) => c * (ROOM_W + GAP_X);
  const occupied = (r: number, c: number) => visibleByCell.has(`${r}-${c}`);

  // Connections between adjacent occupied cells: corridors within a story,
  // staircases between stories. Adjacency is engine truth (the grid).
  const corridors: { x1: number; x2: number; floorY: number }[] = [];
  const stairs: { cx: number; top: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupied(r, c)) continue;
      const floorY = rowY[r]! + rowH[r]!;
      if (occupied(r, c + 1)) {
        corridors.push({ x1: colX(c) + ROOM_W, x2: colX(c + 1), floorY });
      }
      if (occupied(r + 1, c)) {
        stairs.push({ cx: colX(c) + ROOM_W / 2, top: floorY });
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

  const fitZoom = () => {
    const el = scrollRef.current;
    if (!el) return;
    setBoardZoom(
      Math.min((el.clientWidth - 90) / stageW, (el.clientHeight - 160) / totalH),
    );
  };

  return (
    <div
      ref={scrollRef}
      className="relative h-full w-full cursor-grab overflow-auto data-[panning=true]:cursor-grabbing"
      onPointerDown={onPanStart}
    >
      <div
        className="flex min-h-full min-w-full items-center justify-center px-12 py-20"
        style={{ width: stageW * zoom + 96, height: totalH * zoom + 200 }}
      >
        <div style={{ width: stageW * zoom, height: totalH * zoom }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
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
              const visible = visibleByCell.get(cellKey);
              const height =
                room && visible ? cellHeight(room, visible.length) : roomHeight(1);
              return (
                <div
                  key={cellKey}
                  className="absolute z-10"
                  style={{
                    left: colX(c),
                    // Bottom-anchor: floors align along each story.
                    top: rowY[r]! + rowH[r]! - height,
                    perspective: 900,
                  }}
                >
                  <AnimatePresence custom={exitKind} initial={false}>
                    {room && visible && (
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
                          width={ROOM_W}
                          spaces={visible}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }),
          )}

          {/* connections */}
          {corridors.map((d, i) => (
            <Corridor key={`d-${i}`} {...d} />
          ))}
          {stairs.map((s, i) => (
            <Stairs key={`s-${i}`} {...s} />
          ))}
        </div>

        {/* the round's card offers, laid out beneath the university */}
        <TableauShelf state={state} width={stageW} />
        </div>
        </div>
      </div>

      {/* zoom controls */}
      <div className="fixed bottom-44 right-60 z-30 flex items-center gap-1 rounded-full bg-night-800/90 px-2 py-1 ring-1 ring-white/15 backdrop-blur">
        <button
          type="button"
          onClick={() => setBoardZoom(zoom - 0.15)}
          className="h-6 w-6 rounded-full text-sm font-bold text-white/80 hover:bg-night-600"
          title="Zoom out"
        >
          −
        </button>
        <span className="w-10 text-center text-[11px] font-bold text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setBoardZoom(zoom + 0.15)}
          className="h-6 w-6 rounded-full text-sm font-bold text-white/80 hover:bg-night-600"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={fitZoom}
          className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white/70 hover:bg-night-600"
          title="Fit the whole campus"
        >
          Fit
        </button>
      </div>

      <SlotTooltip />
    </div>
  );
}

/** Rich hover card for action spaces — replaces the native title tooltip
 *  (slot effects were invisible until a slow OS hover). */
function SlotTooltip() {
  const hovered = useUiStore((s) => s.hoveredSlot);
  if (!hovered) return null;
  const { space, rect } = hovered;
  const cost = space.costToActivate;
  return (
    <div
      className="pointer-events-none fixed z-50 w-56 -translate-x-1/2 -translate-y-full rounded-card bg-night-800/97 p-2.5 shadow-card-lift ring-1 ring-starlight/40"
      style={{ left: rect.x + rect.w / 2, top: rect.y - 8 }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-night-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
          {space.slotType}
        </span>
        {cost?.meritBadges ? (
          <span className="rounded-full bg-night-600 px-1.5 py-0.5 text-[9px] font-bold text-starlight">
            {cost.meritBadges} badge{cost.meritBadges > 1 ? 's' : ''}
          </span>
        ) : null}
        {cost?.gold ? (
          <span className="rounded-full bg-night-600 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
            {cost.gold} gold
          </span>
        ) : null}
        {cost?.mana ? (
          <span className="rounded-full bg-night-600 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">
            {cost.mana} mana
          </span>
        ) : null}
      </div>
      <p className="text-[12px] leading-snug text-white/90">
        {space.description ?? 'No effect text.'}
      </p>
    </div>
  );
}
