import { useState } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { GameState, OwnedMage, Player, Room } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
import { ActionSlot } from './ActionSlot';
import { ROOM_PX, roomArtFor } from './roomArt';

/**
 * One chamber of the university (docs/UI_DESIGN.md §7.2, hybrid art model).
 * Bottom-anchored within its story so floors align; ceiling height varies by
 * room (roomArt registry). Interior = name plaque, scene art (image override
 * with procedural SVG fallback), and the slot floor. Engine-driven overlays:
 * locked, eligibility ring, one-shot FX.
 */

export interface RoomSceneProps {
  room: Room;
  state: GameState;
  eligible: Set<string>;
  onPlace: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  /** Chamber width — the column's width, sized to its widest room. */
  width: number;
}

export function RoomScene({ room, state, eligible, onPlace, mageIndex, width }: RoomSceneProps) {
  const locked = state.roomLocks.some((l) => l.roomId === room.id);
  const art = roomArtFor(room.name);
  const height = ROOM_PX[art.height];
  const hasEligible = room.actionSpaces.some((s) => eligible.has(s.id));
  const [artBroken, setArtBroken] = useState(false);
  const showImage = art.artUrl && !artBroken;

  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-lg transition-all duration-300',
        'border-[3px] bg-night-800/95',
        hasEligible ? 'border-leyline/70' : 'border-[#4d4458]',
        locked && 'opacity-80 saturate-50',
      )}
      style={{
        width,
        height,
        boxShadow: hasEligible
          ? 'inset 0 0 26px #00000066, 0 0 18px 2px #7ee8fa33'
          : 'inset 0 0 26px #00000066',
        background:
          'linear-gradient(180deg, #241f43 0%, #1f1b3f 70%, #2a2240 100%)',
      }}
    >
      {/* name plaque */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-center">
        <div
          className="rounded-b-lg bg-[#3a2f24] px-3 py-0.5 text-center ring-1 ring-black/40"
          style={{ boxShadow: '0 2px 4px #00000088' }}
        >
          <h3 className="font-display text-[14px] font-bold leading-tight" style={{ color: art.hue }}>
            {room.name}
          </h3>
          <p className="text-[8px] uppercase tracking-[0.2em] text-white/40">
            side {room.side}
            {room.isUniversityCentral && ' · ★'}
            {room.isInstantRoom && ' · ⚡'}
          </p>
        </div>
      </div>

      {/* scene: image override or procedural vignette */}
      <div className="absolute inset-x-1.5 top-9 bottom-[86px]">
        {showImage ? (
          <img
            src={art.artUrl}
            alt={room.name}
            onError={() => setArtBroken(true)}
            className="h-full w-full rounded object-cover"
          />
        ) : (
          <art.Scene hue={art.hue} />
        )}
      </div>

      {/* slot floor */}
      <div
        className="absolute inset-x-0 bottom-0 h-[84px]"
        style={{
          background: 'linear-gradient(180deg, #181430cc, #131027)',
          boxShadow: 'inset 0 3px 6px #00000088',
        }}
      >
        <div className="flex h-full items-end justify-center gap-1.5 px-2 pb-1.5">
          {room.actionSpaces.map((space) => (
            <ActionSlot
              key={space.id}
              space={space}
              available={eligible.has(space.id)}
              onPlace={onPlace}
              mageIndex={mageIndex}
            />
          ))}
          {room.actionSpaces.length === 0 && (
            <p className="pb-6 text-[11px] italic text-white/35">No action spaces</p>
          )}
        </div>
      </div>

      {/* locked overlay */}
      {locked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-night-900/55">
          <span className="rounded-full bg-night-800/95 px-3 py-1.5 font-display text-sm text-white/90 ring-1 ring-white/25">
            🔒 Locked
          </span>
        </div>
      )}

      <RoomFxOverlay roomId={room.id} />
    </div>
  );
}

/** One-shot effect overlays for this room, fed by useStateDiffFx. */
function RoomFxOverlay({ roomId }: { roomId: string }) {
  const fx = useUiStore((s) => s.roomFx);
  const mine = fx.filter((f) => f.roomId === roomId);
  return (
    <AnimatePresence>
      {mine.map((f) => {
        if (f.kind === 'wound') {
          // Red impact flash — bad things hit.
          return (
            <motion.div
              key={f.id}
              className="pointer-events-none absolute inset-0 z-30 rounded-lg"
              style={{ background: 'radial-gradient(ellipse at 50% 70%, #ff5d7daa, transparent 65%)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0], x: [0, -3, 3, -2, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          );
        }
        if (f.kind === 'banish') {
          // Violet ring expands — the student is spirited away.
          return (
            <motion.div
              key={f.id}
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
            >
              <motion.span
                className="h-16 w-16 rounded-full border-4 border-dept-mysticism"
                initial={{ scale: 0.3, opacity: 0.9 }}
                animate={{ scale: 2.6, opacity: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
            </motion.div>
          );
        }
        // flip — cyan sweep while the chamber swaps sides.
        return (
          <motion.div
            key={f.id}
            className="pointer-events-none absolute inset-0 z-30 rounded-lg"
            style={{
              background:
                'linear-gradient(110deg, transparent 20%, #7ee8fa66 50%, transparent 80%)',
              backgroundSize: '300% 100%',
            }}
            initial={{ opacity: 0, backgroundPosition: '120% 0' }}
            animate={{ opacity: [0, 1, 0], backgroundPosition: '-20% 0' }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        );
      })}
    </AnimatePresence>
  );
}
