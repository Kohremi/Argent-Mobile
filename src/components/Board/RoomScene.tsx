import { useState } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { ActionSpace, GameState, OwnedMage, Player, Room } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
import { infirmaryBeds, type InfirmaryBed } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { ActionSlot, TargetableToken } from './ActionSlot';
import { roomArtFor } from './roomArt';

/**
 * One chamber of the university (docs/UI_DESIGN.md §7.2, function-first
 * revision). The interior is the worker-placement column: one row per slot —
 * circle on the left, the slot's effect text always visible beside it.
 * Flavor lives ON THE WALLS: the top wall band is a sprite frieze (the
 * procedural scene art, or an image override, dimmed behind the plaque) and
 * the side walls carry the room's hue. Height follows the visible slot
 * count; bottom-anchored within its story so floors align.
 */

/** Uniform chamber width: 64px slot + always-visible effect text. */
export const ROOM_W = 312;
const TOP_WALL = 44; // frieze band + plaque
const ROW_H = 72;
const ROW_GAP = 4;
const BOTTOM_WALL = 12;

/** Chamber height for a visible slot count — CampusBoard sizes stories
 *  with this same function, so geometry and render never drift. */
export function roomHeight(slotCount: number): number {
  if (slotCount === 0) return TOP_WALL + 34 + BOTTOM_WALL;
  return TOP_WALL + slotCount * ROW_H + (slotCount - 1) * ROW_GAP + BOTTOM_WALL;
}

/* ------------------------- the Infirmary ward ---------------------------- */
// Beds instead of slots: a 3-wide grid that grows as the ward fills
// (Great-Hall style — always exactly one open bed on show). Side B's two
// improved-reward beds (gold = Gold bonus, blue = Mana bonus) are always
// visible; wounded students lie on their side in white beds.

const BED_H = 64;
const BED_GAP = 4;

export function infirmaryRoomHeight(bedCount: number): number {
  const bedRows = Math.max(1, Math.ceil(bedCount / 3));
  return TOP_WALL + bedRows * BED_H + (bedRows - 1) * BED_GAP + BOTTOM_WALL;
}

/** Side-view hospital bed; the frame color is the bed's identity. */
function BedSprite({ frame, blanket }: { frame: string; blanket: string }) {
  return (
    <svg
      className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2"
      width="86"
      height="42"
      viewBox="0 0 86 42"
    >
      {/* head/foot boards */}
      <rect x="2" y="2" width="8" height="34" rx="3" fill={frame} />
      <rect x="76" y="12" width="8" height="24" rx="3" fill={frame} />
      {/* mattress */}
      <rect x="8" y="22" width="70" height="10" rx="4" fill="#fdf8ec" />
      {/* pillow */}
      <rect x="11" y="17" width="17" height="9" rx="4" fill="#ffffff" />
      {/* blanket */}
      <rect x="30" y="18" width="46" height="11" rx="3" fill={blanket} />
      {/* legs */}
      <rect x="11" y="34" width="4" height="7" rx="1" fill={frame} />
      <rect x="71" y="34" width="4" height="7" rx="1" fill={frame} />
    </svg>
  );
}

function BedCell({ bed }: { bed: InfirmaryBed }) {
  const { spaceTargets, pickSpace } = usePromptTargets();
  const setHoveredSlot = useUiStore((s) => s.setHoveredSlot);

  // Reward beds color themselves by their bonus: gold for Gold, blue for Mana.
  let frame = '#e8e4da';
  let blanket = '#f3e8cd';
  let chip: string | null = null;
  let chipColor = '#ffe9a8';
  if (bed.kind === 'reward') {
    const gold = bed.space.description?.match(/(\d+) Gold/i);
    const mana = bed.space.description?.match(/(\d+) Mana/i);
    if (gold) {
      frame = '#ffd166';
      blanket = '#ffd166';
      chip = `${gold[1]}g`;
      chipColor = '#ffd166';
    } else if (mana) {
      frame = '#5aa9e6';
      blanket = '#5aa9e6';
      chip = `${mana[1]}✦`;
      chipColor = '#5aa9e6';
    }
  }

  // Reward + rest beds carry their occupant on the bed entry (derived from
  // the mage's location.bed); 'open' beds have none.
  const entry = bed.kind === 'open' ? undefined : bed.entry;
  const rewardTaken = bed.kind === 'reward' && !!bed.entry;
  const targeted = bed.kind === 'reward' && spaceTargets.has(bed.space.id);

  return (
    <div
      data-bed={bed.kind}
      className={clsx(
        'relative h-[60px] rounded-md bg-night-900/45 ring-1',
        targeted ? 'ring-leyline' : 'ring-white/5',
      )}
      onPointerEnter={
        bed.kind === 'reward'
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHoveredSlot({ space: bed.space, rect: { x: r.x, y: r.y, w: r.width } });
            }
          : undefined
      }
      onPointerLeave={bed.kind === 'reward' ? () => setHoveredSlot(null) : undefined}
    >
      <BedSprite frame={frame} blanket={blanket} />
      {chip && (
        <span
          className={clsx(
            'absolute right-1 top-0.5 rounded-full bg-night-800/90 px-1.5 text-[9px] font-bold leading-4 ring-1',
            // Bed taken → the buffed rate is blocked until the heal sweep.
            rewardTaken && 'opacity-40 line-through',
          )}
          style={{ color: chipColor, borderColor: chipColor, boxShadow: `0 0 0 1px ${chipColor}55` }}
        >
          {chip}
        </span>
      )}
      {/* space-targeting click surface (engine dry-run truth, as everywhere) */}
      {targeted && (
        <button
          type="button"
          data-available="true"
          onClick={() => pickSpace(bed.space.id)}
          className="absolute inset-0 z-[2] animate-breathe cursor-pointer rounded-md border-2 border-leyline"
          style={{ boxShadow: '0 0 12px #7ee8fa66' }}
        />
      )}
      {/* the patient, lying on their side across the mattress */}
      {entry && (
        <TargetableToken
          entry={entry}
          size={36}
          className="absolute bottom-2.5 left-1/2 z-[1] -translate-x-1/2 rotate-90"
        />
      )}
    </div>
  );
}

export interface RoomSceneProps {
  room: Room;
  state: GameState;
  eligible: Set<string>;
  onPlace: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  /** Chamber width (uniform across the castle). */
  width: number;
  /** The slots to render (pool rooms collapse to occupied + one open). */
  spaces: ActionSpace[];
}

export function RoomScene({
  room,
  state,
  eligible,
  onPlace,
  mageIndex,
  width,
  spaces,
}: RoomSceneProps) {
  const locked = state.roomLocks.some((l) => l.roomId === room.id);
  const art = roomArtFor(room.name);
  const isInfirmary = room.name === 'Infirmary';
  const beds = isInfirmary ? infirmaryBeds(state, room) : null;
  const height = beds ? infirmaryRoomHeight(beds.length) : roomHeight(spaces.length);
  const hasEligible = spaces.some((s) => eligible.has(s.id));
  const [artBroken, setArtBroken] = useState(false);
  const showImage = art.artUrl && !artBroken;

  return (
    <div
      className={clsx(
        'relative rounded-lg border-[3px] bg-night-800/95 transition-all duration-300',
        hasEligible ? 'border-leyline/70' : 'border-transparent',
        locked && 'opacity-80 saturate-50',
      )}
      style={{
        width,
        height,
        // Side/bottom walls carry the room's identity hue.
        borderColor: hasEligible ? undefined : `${art.hue}55`,
        boxShadow: hasEligible
          ? `inset 0 0 0 1px ${art.hue}33, inset 0 0 22px #00000066, 0 0 18px 2px #7ee8fa33`
          : `inset 0 0 0 1px ${art.hue}33, inset 0 0 22px #00000066`,
        background: 'linear-gradient(180deg, #1c1838 0%, #171430 70%, #1d1837 100%)',
      }}
    >
      {/* top wall: sprite frieze (the room's flavor) behind the plaque */}
      <div
        className="absolute inset-x-0 top-0 overflow-hidden rounded-t-[5px]"
        style={{ height: TOP_WALL, background: '#2c2547', boxShadow: 'inset 0 -3px 6px #00000088' }}
      >
        <div className="absolute inset-0 opacity-50">
          {showImage ? (
            <img
              src={art.artUrl}
              alt=""
              onError={() => setArtBroken(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <art.Scene hue={art.hue} />
          )}
        </div>
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(90deg, #2c2547ee, transparent 30%, transparent 70%, #2c2547ee)' }}
        />
        {/* hue accent line along the bottom of the wall band */}
        <div className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: `${art.hue}99` }} />
        {/* name plaque */}
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded bg-night-900/80 px-2.5 py-0.5 text-center ring-1 ring-black/40">
            <h3 className="font-display text-[13px] font-bold leading-tight" style={{ color: art.hue }}>
              {room.name}
              <span className="ml-1.5 align-middle text-[8px] font-normal uppercase tracking-[0.2em] text-white/40">
                side {room.side}
                {room.isUniversityCentral && ' · ★'}
                {room.isInstantRoom && ' · ⚡'}
              </span>
            </h3>
          </div>
        </div>
      </div>

      {/* the Infirmary ward: a growing 3-wide grid of beds */}
      {beds && (
        <div
          className="absolute inset-x-1 grid grid-cols-3 content-start"
          style={{ top: TOP_WALL, bottom: BOTTOM_WALL - 4, gap: BED_GAP, paddingTop: BED_GAP }}
        >
          {beds.map((bed, i) => (
            <BedCell
              key={bed.kind === 'reward' ? bed.space.id : bed.kind === 'rest' ? bed.bedId : `open-${i}`}
              bed={bed}
            />
          ))}
        </div>
      )}

      {/* the worker-placement column: slot + its effect text, one per row */}
      {!beds && (
      <div
        className="absolute inset-x-1 flex flex-col"
        style={{ top: TOP_WALL, bottom: BOTTOM_WALL - 4, gap: ROW_GAP, paddingTop: ROW_GAP }}
      >
        {spaces.map((space) => (
          <div
            key={space.id}
            className="flex min-h-0 flex-1 items-end gap-2 rounded-md bg-night-900/45 px-1 ring-1 ring-white/5"
          >
            <ActionSlot
              space={space}
              available={eligible.has(space.id)}
              onPlace={onPlace}
              mageIndex={mageIndex}
            />
            {/* bottom-anchored beside the circle, so the rules text reads
                as flowing out of the slot itself */}
            <p className="line-clamp-3 min-w-0 flex-1 pb-1 font-rules text-[11.5px] leading-[1.25] tracking-[0.01em] text-parchment-200/85">
              {space.description ?? 'No effect text.'}
            </p>
          </div>
        ))}
        {spaces.length === 0 && (
          <p className="flex flex-1 items-center justify-center text-[11px] italic text-white/35">
            No action spaces
          </p>
        )}
      </div>
      )}

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
