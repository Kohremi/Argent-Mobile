import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { GameState, OwnedMage, Player, Room } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
import { ActionSlot } from './ActionSlot';

/**
 * One campus building on its floating island (docs/UI_DESIGN.md §7.2).
 * Step-1 placeholder: a tinted panel with the room's identity hue, name in
 * display type, slot row, and the engine-driven state overlays (locked /
 * central-campus laurel / instant hint). Scene art lands in the art pass.
 */

/** Identity hue per base room name; default neutral indigo. */
const ROOM_HUE: Record<string, string> = {
  Vault: '#ff9f43',
  Library: '#5aa9e6',
  Infirmary: '#ff8fab',
  'Council Chamber': '#ffd166',
  'Training Fields': '#ff5d5d',
  Catacombs: '#b16cea',
  Guilds: '#6bcb77',
  Courtyard: '#5fd068',
  Dormitory: '#b388eb',
  'Great Hall': '#ffd166',
  // Mancers (Technomancy annexes)
  Laboratory: '#ff9f43',
  'Research Archive': '#ffd166',
  'Golem Lab': '#9aa0b4',
  'Synthesis Workshop': '#ff7849',
};

export interface RoomSceneProps {
  room: Room;
  state: GameState;
  eligible: Set<string>;
  onPlace: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  /** Stagger index for the ambient floaty drift. */
  driftIndex: number;
}

export function RoomScene({
  room,
  state,
  eligible,
  onPlace,
  mageIndex,
  driftIndex,
}: RoomSceneProps) {
  const locked = state.roomLocks.some((l) => l.roomId === room.id);
  const hue = ROOM_HUE[room.name] ?? '#7ee8fa';
  const hasEligible = room.actionSpaces.some((s) => eligible.has(s.id));

  return (
    <div
      className={clsx(
        'relative h-[220px] w-[264px] rounded-card transition-all duration-300 animate-floaty',
        'bg-night-700/90 ring-1 backdrop-blur',
        hasEligible ? 'ring-leyline/60' : 'ring-white/10',
        locked && 'saturate-50 opacity-80',
      )}
      style={{
        animationDelay: `${(driftIndex % 5) * 0.9}s`,
        boxShadow: hasEligible
          ? '0 16px 32px -8px #00000088, 0 0 18px 2px #7ee8fa33'
          : '0 16px 32px -8px #00000088',
      }}
    >
      {/* identity rim-light */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-1.5 rounded-t-card"
        style={{ background: `linear-gradient(90deg, transparent, ${hue}, transparent)` }}
      />

      {/* header */}
      <div className="flex items-start justify-between px-3 pt-2">
        <div>
          <h3 className="font-display text-[17px] font-bold leading-tight" style={{ color: hue }}>
            {room.name}
          </h3>
          <p className="text-[10px] uppercase tracking-widest text-white/40">
            Side {room.side}
            {room.isUniversityCentral && ' · ★ central'}
            {room.isInstantRoom && ' · ⚡ instant'}
          </p>
        </div>
      </div>

      {/* placeholder scene block (art pass replaces this) */}
      <div
        className="mx-3 mt-1 h-[58px] rounded-lg opacity-60"
        style={{
          background: `radial-gradient(ellipse at 50% 120%, ${hue}33, transparent 70%), linear-gradient(180deg, #1f1b3f, #171430)`,
        }}
      />

      {/* slots */}
      <div className="absolute inset-x-2 bottom-2 flex items-end justify-center gap-1.5">
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
          <p className="pb-4 text-[11px] italic text-white/35">No action spaces</p>
        )}
      </div>

      {/* locked overlay */}
      {locked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-card bg-night-900/55">
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
              className="pointer-events-none absolute inset-0 z-30 rounded-card"
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
        // flip — cyan sweep while the island swaps sides.
        return (
          <motion.div
            key={f.id}
            className="pointer-events-none absolute inset-0 z-30 rounded-card"
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
