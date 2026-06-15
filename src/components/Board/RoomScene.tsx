import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  INFIRMARY_GOLD_BED,
  INFIRMARY_MANA_BED,
  INFIRMARY_REWARD_BEDS,
} from '../../game/effects/helpers';
import type { ActionSpace, GameState, OwnedMage, Player, Room } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import { LockIcon, ResourceIcon } from '../icons';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from './MageToken';

/**
 * One chamber of the university, rendered as a flat functional card that
 * mirrors the engine console's room panel (see DebugControls' RoomsPanel):
 * a slate card with a header line (name · side · tags), an optional room
 * description, and a worker-placement list — one row per slot, a shadow
 * tile + a base tile + the slot's always-visible effect text. No room art,
 * no friezes, no Infirmary beds; wounded students show as a plain roster.
 *
 * Interaction is still driven by the engine dry-run read-model: `eligible`
 * lights placeable slots (click → onPlace), and prompt targeting (mages /
 * spaces) routes clicks through usePromptTargets.
 */

export interface RoomSceneProps {
  room: Room;
  state: GameState;
  eligible: Set<string>;
  onPlace: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  /** Kept for API compatibility — the layout grid sizes the card now. */
  width?: number | string;
  /** The slots to render (pool rooms collapse to occupied + one open). */
  spaces: ActionSpace[];
}

type Occupant = { ownerId: string; mageId: string; isShadowing?: boolean };

/** Reads a slot's "Slot N" label out of its id (e.g. "…slot-3" → "Slot 3"). */
function slotLabel(spaceId: string): string {
  return (spaceId.split('.').pop() ?? '').replace('slot-', 'Slot ');
}

export function RoomScene({
  room,
  state,
  eligible,
  onPlace,
  mageIndex,
  spaces,
}: RoomSceneProps) {
  const locked = state.roomLocks.some((l) => l.roomId === room.id);
  const hasEligible = spaces.some((s) => eligible.has(s.id));

  return (
    <div
      className={clsx(
        'relative rounded border p-3 text-xs space-y-1 transition-colors',
        locked
          ? 'border-rose-500 bg-rose-900/20'
          : hasEligible
            ? 'border-amber-400 bg-amber-400/10'
            : 'border-slate-700 bg-slate-900',
      )}
    >
      {/* header line: lock · name · side · tags */}
      <div className="flex items-baseline gap-2 flex-wrap">
        {locked && <LockIcon size={14} />}
        <span className="text-sm font-medium text-slate-100">{room.name}</span>
        <span className="text-slate-500">side {room.side}</span>
        {locked && (
          <span className="text-[10px] uppercase tracking-wide text-rose-300">
            locked
          </span>
        )}
        {room.isUniversityCentral && (
          <span className="text-[10px] uppercase tracking-wide text-amber-300/70">
            UC
          </span>
        )}
        {room.isInstantRoom && (
          <span className="text-[10px] uppercase tracking-wide text-purple-300/70">
            instant
          </span>
        )}
        {room.maxMagesPerPlayerPerRound !== undefined && (
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            max {room.maxMagesPerPlayerPerRound}/round
          </span>
        )}
      </div>

      {room.description && (
        <p className="text-[11px] text-slate-300 italic">{room.description}</p>
      )}

      {room.cannotBePlacedInDirectly ? (
        <InfirmarySlots room={room} state={state} />
      ) : spaces.length === 0 ? (
        <p className="text-[10px] text-slate-500 italic">no action spaces</p>
      ) : (
        <ul className="space-y-1">
          {spaces.map((s) => (
            <SlotRow
              key={s.id}
              space={s}
              eligible={eligible.has(s.id)}
              onPlace={onPlace}
              mageIndex={mageIndex}
            />
          ))}
        </ul>
      )}

      <RoomFxOverlay roomId={room.id} />
    </div>
  );
}

/** One slot: shadow tile + base tile + the slot's effect text. */
function SlotRow({
  space,
  eligible,
  onPlace,
  mageIndex,
}: {
  space: ActionSpace;
  eligible: boolean;
  onPlace: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
}) {
  const { mageTargets, spaceTargets, pickMage, pickSpace } = usePromptTargets();
  const occupant = space.occupant as Occupant | null;
  const shadowOccupant = (space.shadowOccupant ?? null) as Occupant | null;
  const cost = space.costToActivate;
  const isMerit = space.slotType === 'merit' || space.slotType === 'shadow-merit';
  const spaceTargeted = spaceTargets.has(space.id);

  // Base tile click precedence (mirrors the console): space-target prompt,
  // then placement, then selecting the occupant for a mage-target prompt.
  const occMageTargeted =
    occupant !== null && mageTargets.has(occupant.mageId);
  const baseClick = spaceTargeted
    ? () => pickSpace(space.id)
    : eligible
      ? () => onPlace(space.id)
      : occMageTargeted && occupant
        ? () => pickMage(occupant.mageId)
        : undefined;
  const baseRing =
    spaceTargeted || eligible || occMageTargeted ? 'ring-2 ring-amber-400' : '';
  const baseTitle = occMageTargeted
    ? 'Choose this student'
    : occupant
      ? 'occupied'
      : eligible || spaceTargeted
        ? 'place here'
        : 'empty slot';

  const shadowMageTargeted =
    shadowOccupant !== null && mageTargets.has(shadowOccupant.mageId);
  const shadowClick =
    shadowMageTargeted && shadowOccupant
      ? () => pickMage(shadowOccupant.mageId)
      : undefined;
  const shadowTitle = shadowMageTargeted ? 'Choose this student' : 'shadow slot';

  return (
    <li
      className={clsx(
        'flex items-center gap-2 text-[11px] leading-snug rounded px-1.5 py-1.5',
        occupant || shadowOccupant
          ? 'bg-amber-400/5'
          : 'bg-slate-950/40 text-slate-300',
      )}
    >
      <SlotTile
        isShadow
        occupant={shadowOccupant}
        mageIndex={mageIndex}
        onClick={shadowClick}
        ring={shadowMageTargeted ? 'ring-2 ring-amber-400' : ''}
        title={shadowTitle}
      />
      <SlotTile
        occupant={occupant}
        mageIndex={mageIndex}
        onClick={baseClick}
        ring={baseRing}
        title={baseTitle}
        dataAvailable={eligible || spaceTargeted}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-slate-200">
            {slotLabel(space.id)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {space.slotType}
          </span>
          {isMerit && (
            <span className="text-[10px] uppercase tracking-wide text-orange-300/70 inline-flex items-center gap-1">
              merit
              <ResourceIcon kind="merit-badge" size={11} />
            </span>
          )}
          {cost?.meritBadges ? (
            <span className="text-[10px] uppercase tracking-wide text-orange-300/70 inline-flex items-center gap-1">
              cost: {cost.meritBadges}
              <ResourceIcon kind="merit-badge" size={11} />
            </span>
          ) : null}
          {cost?.gold ? (
            <span className="text-[10px] uppercase tracking-wide text-amber-300/70 inline-flex items-center gap-1">
              cost: {cost.gold}
              <ResourceIcon kind="gold" size={11} />
            </span>
          ) : null}
          {cost?.mana ? (
            <span className="text-[10px] uppercase tracking-wide text-cyan-300/70 inline-flex items-center gap-1">
              cost: {cost.mana}
              <ResourceIcon kind="mana" size={11} />
            </span>
          ) : null}
        </div>
        <div className="text-slate-300/90 mt-0.5">
          {space.description ?? 'No effect text.'}
        </div>
      </div>
    </li>
  );
}

/** A single placement tile — square box, dashed purple for shadow, with the
 *  occupant's mage glyph + owner label when filled. Clickable only when the
 *  surrounding context (placement / prompt targeting) allows it. */
function SlotTile({
  isShadow,
  occupant,
  mageIndex,
  onClick,
  ring,
  title,
  dataAvailable,
}: {
  isShadow?: boolean;
  occupant: Occupant | null;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  onClick: (() => void) | undefined;
  ring: string;
  title: string;
  dataAvailable?: boolean;
}) {
  const entry = occupant ? mageIndex.get(occupant.mageId) : undefined;
  const occupantShadowed = isShadow || occupant?.isShadowing === true;
  const borderClass = occupantShadowed
    ? 'border-purple-400/50 border-dashed'
    : 'border-slate-500';
  const filledClass = occupant
    ? occupantShadowed
      ? 'bg-purple-500/15'
      : 'bg-amber-400/15'
    : 'bg-slate-950/40';
  const content = entry ? (
    <MageToken
      color={entry.mage.color}
      aura={PLAYER_AURA[entry.owner.color]}
      isWounded={entry.mage.isWounded}
      isShadowing={isShadow || entry.mage.isShadowing}
      golem={entry.mage.isTemporary === true}
      size={entry.mage.isTemporary ? 38 : 32}
    />
  ) : (
    <span className="text-[8px] uppercase tracking-wide text-slate-600">
      {isShadow ? 'shadow' : 'slot'}
    </span>
  );

  const className = clsx(
    'w-9 h-9 rounded border-2 flex items-center justify-center flex-shrink-0',
    borderClass,
    filledClass,
    ring,
  );
  if (onClick) {
    return (
      <button
        type="button"
        data-available={dataAvailable ? true : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={title}
        className={clsx(
          className,
          'hover:bg-amber-400/25 cursor-pointer transition-colors',
        )}
      >
        {content}
      </button>
    );
  }
  return (
    <div title={title} className={className}>
      {content}
    </div>
  );
}

/**
 * The Infirmary ward as a growing row of slot tiles (wraps left→right,
 * top→bottom). Side B leads with its two buffed-bonus slots — labelled
 * "4 Gold" and "2 Mana" instead of "SLOT" — then a generic slot per resting
 * wounded mage, then exactly one open "SLOT" (a new one appears as the
 * previous fills). Occupant tiles light up + become clickable for mage
 * prompts. Bed occupancy is read from `mage.location.bed` (engine truth).
 */
type WardEntry = { mage: OwnedMage; owner: Player };

const INFIRMARY_REWARD_LABEL: Record<string, { text: string; cls: string; border: string }> = {
  [INFIRMARY_GOLD_BED]: { text: '4 Gold', cls: 'text-amber-300', border: 'border-amber-500/60' },
  [INFIRMARY_MANA_BED]: { text: '2 Mana', cls: 'text-cyan-300', border: 'border-cyan-500/60' },
};

type WardSlot =
  | { kind: 'reward'; bedId: string; entry: WardEntry | undefined }
  | { kind: 'rest'; entry: WardEntry }
  | { kind: 'open' };

/** Sort key for resting wounded mages: numbered ward beds ascending, then any
 *  bedless infirmary mages last. */
function restOrder(entry: WardEntry): number {
  const bed = entry.mage.location.kind === 'infirmary' ? entry.mage.location.bed : undefined;
  const m = bed?.match(/^bed-(\d+)$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function InfirmarySlots({ room, state }: { room: Room; state: GameState }) {
  const { mageTargets, pickMage } = usePromptTargets();

  const rewardBedIds = room.actionSpaces
    .map((s) => INFIRMARY_REWARD_BEDS[s.id])
    .filter((b): b is string => Boolean(b));
  const rewardSet = new Set(rewardBedIds);

  // Partition every wounded mage by where it's lying (mage.location.bed).
  const rewardOccupant = new Map<string, WardEntry>();
  const restEntries: WardEntry[] = [];
  for (const owner of state.players) {
    for (const mage of owner.mages) {
      if (mage.location.kind !== 'infirmary') continue;
      const bed = mage.location.bed;
      if (bed && rewardSet.has(bed)) rewardOccupant.set(bed, { mage, owner });
      else restEntries.push({ mage, owner });
    }
  }
  restEntries.sort((a, b) => restOrder(a) - restOrder(b));

  const slots: WardSlot[] = [];
  for (const bedId of rewardBedIds) {
    slots.push({ kind: 'reward', bedId, entry: rewardOccupant.get(bedId) });
  }
  for (const entry of restEntries) slots.push({ kind: 'rest', entry });
  slots.push({ kind: 'open' });

  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((slot, i) => {
        const entry = slot.kind === 'open' ? undefined : slot.entry;
        const reward = slot.kind === 'reward' ? INFIRMARY_REWARD_LABEL[slot.bedId] : undefined;
        const targeted = entry ? mageTargets.has(entry.mage.id) : false;
        const key =
          slot.kind === 'reward'
            ? slot.bedId
            : slot.kind === 'rest'
              ? slot.entry.mage.id
              : `open-${i}`;

        const content = entry ? (
          <MageToken
            color={entry.mage.color}
            aura={PLAYER_AURA[entry.owner.color]}
            isWounded={entry.mage.isWounded}
            isShadowing={entry.mage.isShadowing}
            golem={entry.mage.isTemporary === true}
            size={entry.mage.isTemporary ? 44 : 38}
          />
        ) : reward ? (
          <span
            className={clsx(
              'text-[9px] font-semibold uppercase tracking-wide leading-tight text-center',
              reward.cls,
            )}
          >
            {reward.text}
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-slate-600">SLOT</span>
        );

        const className = clsx(
          'w-14 h-12 rounded border-2 flex items-center justify-center flex-shrink-0 p-0.5',
          reward ? reward.border : 'border-slate-500',
          entry ? 'bg-amber-400/15' : 'bg-slate-950/40',
          targeted && 'ring-2 ring-amber-400',
        );

        if (targeted && entry) {
          return (
            <button
              key={key}
              type="button"
              data-islot={slot.kind}
              title="Choose this student"
              onClick={() => pickMage(entry.mage.id)}
              className={clsx(className, 'hover:bg-amber-400/25 cursor-pointer transition-colors')}
            >
              {content}
            </button>
          );
        }
        return (
          <div key={key} data-islot={slot.kind} title={reward?.text} className={className}>
            {content}
          </div>
        );
      })}
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
              className="pointer-events-none absolute inset-0 z-30"
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
