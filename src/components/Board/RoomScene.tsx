import clsx from 'clsx';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  INFIRMARY_GOLD_BED,
  INFIRMARY_MANA_BED,
  INFIRMARY_REWARD_BEDS,
} from '../../game/effects/helpers';
import type { ActionSpace, GameState, MageColor, OwnedMage, Player, Room } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
import { isPoolRoom, PLAYER_AURA, type OccupiedSlotPower } from '../../utils/uiSelectors';
import { LockIcon, MageIcon, ResourceIcon, type ResourceKind } from '../icons';

/**
 * Distinct ring for "Mage power" placement targets (Ars Magna / Natural Magick
 * B displacement / Planar Studies B shadow) — a fuchsia glow that sets them
 * apart from the amber ring used for ordinary empty-slot placement / prompt
 * targeting, so the player can tell at a glance they're spending a power.
 */
const POWER_RING = 'ring-2 ring-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.7)]';
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
  /** Slots whose shadow position the selected Mage may drop into (Planar B). */
  shadowEligible?: Set<string>;
  /** Mana cost of a shadow placement (1 for Planar B, 0 under a buff). */
  shadowManaCost?: number;
  /** The selected Mage's occupied-slot power (Ars Magna / Natural Magick B). */
  occupiedSlotPower?: OccupiedSlotPower | null | undefined;
  onPlace: (spaceId: string) => void;
  /** Dispatches a shadow placement (PLACE_WORKER with isShadowing). */
  onPlaceShadow?: (spaceId: string) => void;
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
  shadowEligible,
  shadowManaCost = 1,
  occupiedSlotPower,
  onPlace,
  onPlaceShadow,
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

      {room.id === 'base.room.astronomy-tower.a' && (
        <AstronomyTowerTrack state={state} side="A" />
      )}
      {room.id === 'base.room.astronomy-tower.b' && (
        <AstronomyTowerTrack state={state} side="B" />
      )}

      {room.cannotBePlacedInDirectly ? (
        <InfirmarySlots room={room} state={state} />
      ) : spaces.length === 0 ? (
        <p className="text-[10px] text-slate-500 italic">no action spaces</p>
      ) : isPoolRoom(room) ? (
        <PoolSlots
          spaces={spaces}
          eligible={eligible}
          occupiedSlotPower={occupiedSlotPower}
          onPlace={onPlace}
          mageIndex={mageIndex}
        />
      ) : (
        <ul className="space-y-1">
          {spaces.map((s) => (
            <SlotRow
              key={s.id}
              space={s}
              eligible={eligible.has(s.id)}
              shadowEligible={shadowEligible?.has(s.id) === true}
              shadowManaCost={shadowManaCost}
              occupiedSlotPower={occupiedSlotPower}
              onPlace={onPlace}
              onPlaceShadow={onPlaceShadow}
              mageIndex={mageIndex}
              noShadow={room.noShadowSlots === true}
            />
          ))}
        </ul>
      )}

      {room.id === 'mancers.room.laboratory.a' && <LaboratoryRewards side="A" />}
      {room.id === 'mancers.room.laboratory.b' && <LaboratoryRewards side="B" />}

      <RoomFxOverlay roomId={room.id} />
    </div>
  );
}

/**
 * Astronomy Tower reward track. Each cell is either a set of resource parts
 * (icon + amount) or a free-text label (the special spaces). Mirrors
 * `ASTRONOMY_A_TRACK` / `ASTRONOMY_B_TRACK` in the engine; the cell the marker
 * sits on gets a highlighted outline. The marker position is engine truth
 * (`state.astronomyTowerMarker`).
 */
type AstronomyTrackCell = {
  parts?: { amount: number; kind: ResourceKind }[];
  text?: string;
};

const ASTRONOMY_A_TRACK_DISPLAY: AstronomyTrackCell[] = [
  { parts: [{ amount: 1, kind: 'wisdom' }, { amount: 2, kind: 'mana' }] },
  { parts: [{ amount: 2, kind: 'research' }] },
  { parts: [{ amount: 8, kind: 'gold' }] },
  { parts: [{ amount: 1, kind: 'intelligence' }, { amount: 1, kind: 'research' }] },
  { parts: [{ amount: 4, kind: 'mana' }] },
  { parts: [{ amount: 2, kind: 'marks' }] },
];

const ASTRONOMY_B_TRACK_DISPLAY: AstronomyTrackCell[] = [
  { text: 'Start' },
  { parts: [{ amount: 5, kind: 'mana' }] },
  { parts: [{ amount: 8, kind: 'gold' }] },
  { parts: [{ amount: 2, kind: 'marks' }] },
  {
    parts: [
      { amount: 1, kind: 'intelligence' },
      { amount: 1, kind: 'wisdom' },
      { amount: 1, kind: 'research' },
    ],
  },
  { text: 'Draft 2 Vault' },
  { text: 'Gain a Mage' },
  { text: 'Choose any' },
];

function AstronomyTowerTrack({
  state,
  side,
}: {
  state: GameState;
  side: 'A' | 'B';
}) {
  const marker = state.astronomyTowerMarker;
  const track =
    side === 'A' ? ASTRONOMY_A_TRACK_DISPLAY : ASTRONOMY_B_TRACK_DISPLAY;
  return (
    <div className="space-y-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        Reward track — marker on space {marker + 1}
        {side === 'B' && ' (resets each round)'}
      </div>
      <div className="flex gap-1 justify-center flex-wrap">
        {track.map((space, i) => {
          const isMarker = i === marker;
          return (
            <div
              key={i}
              title={`Space ${i + 1}${isMarker ? ' (marker here)' : ''}`}
              className={clsx(
                'w-12 h-12 rounded border-2 flex flex-col items-center justify-center gap-0.5 flex-shrink-0 p-0.5',
                isMarker
                  ? 'border-amber-400 bg-amber-400/15 ring-2 ring-amber-400/40'
                  : 'border-slate-600 bg-slate-950/40',
              )}
            >
              {space.parts?.map((part, j) => (
                <span
                  key={j}
                  className="inline-flex items-center gap-0.5 text-[10px] text-slate-200 leading-none"
                >
                  {part.amount}
                  <ResourceIcon kind={part.kind} size={11} />
                </span>
              ))}
              {space.text && (
                <span className="text-[8px] text-slate-300 leading-tight text-center">
                  {space.text}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tiny per-mage-colour reward key shown at the bottom of each Laboratory side
 * — the reward depends on which colour Mage is placed. Helps the player
 * remember which colour grants which reward without consulting the rulebook.
 */
function LaboratoryRewards({ side }: { side: 'A' | 'B' }) {
  const rowsA: Array<{ color: MageColor; label: string; icon: ReactNode }> = [
    { color: 'red', label: '+2', icon: <ResourceIcon kind="mana" size={11} /> },
    { color: 'green', label: '+4', icon: <ResourceIcon kind="gold" size={11} /> },
    { color: 'purple', label: '+1', icon: <ResourceIcon kind="research" size={11} /> },
    { color: 'grey', label: '+1', icon: <ResourceIcon kind="marks" size={11} /> },
    { color: 'blue', label: 'Heal+Move', icon: null },
  ];
  const rowsB: Array<{ color: MageColor; label: string; icon: ReactNode }> = [
    { color: 'blue', label: '+3', icon: <ResourceIcon kind="mana" size={11} /> },
    { color: 'grey', label: '+1', icon: <ResourceIcon kind="marks" size={11} /> },
    { color: 'green', label: '+1', icon: <ResourceIcon kind="intelligence" size={11} /> },
    { color: 'purple', label: '+1', icon: <ResourceIcon kind="wisdom" size={11} /> },
    { color: 'red', label: '+1', icon: <ResourceIcon kind="research" size={11} /> },
  ];
  const rows = side === 'A' ? rowsA : rowsB;
  return (
    <div className="mt-2 pt-2 border-t border-slate-700/70 space-y-1">
      <div className="text-[9px] uppercase tracking-wide text-slate-400">
        Reward by Mage colour
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 items-center">
        {rows.map((r) => (
          <span
            key={r.color}
            className="inline-flex items-center gap-0.5 text-[10px] text-slate-300"
          >
            <MageIcon color={r.color} size={12} />
            <span className="text-slate-500">→</span>
            <span className="font-medium">{r.label}</span>
            {r.icon}
          </span>
        ))}
      </div>
      <div className="text-[9px] text-slate-500 italic">
        Slot 1 doubles the reward.
      </div>
    </div>
  );
}

/** One slot: shadow tile + base tile + the slot's effect text. */
function SlotRow({
  space,
  eligible,
  shadowEligible = false,
  shadowManaCost = 1,
  occupiedSlotPower,
  onPlace,
  onPlaceShadow,
  mageIndex,
  noShadow,
}: {
  space: ActionSpace;
  eligible: boolean;
  /** The selected Mage may shadow-place into this slot (Planar Studies B). */
  shadowEligible?: boolean;
  shadowManaCost?: number;
  /** The selected Mage's occupied-slot power (Ars Magna / Natural Magick B). */
  occupiedSlotPower?: OccupiedSlotPower | null | undefined;
  onPlace: (spaceId: string) => void;
  onPlaceShadow?: ((spaceId: string) => void) | undefined;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  /** Room has no shadow positions (Great Hall, Golem Lab) — hide the shadow tile. */
  noShadow?: boolean;
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
  // A "power placement" onto an OCCUPIED base slot — Ars Magna (wound & take,
  // 1 Mana) or Natural Magick B (displace & take, free). Normal placement can't
  // land on an occupied base, so an eligible+occupied slot is always a power.
  const baseIsPowerTarget =
    eligible && occupant !== null && occupiedSlotPower != null;
  const baseClick = spaceTargeted
    ? () => pickSpace(space.id)
    : eligible
      ? () => onPlace(space.id)
      : occMageTargeted && occupant
        ? () => pickMage(occupant.mageId)
        : undefined;
  const baseRing = baseIsPowerTarget
    ? POWER_RING
    : spaceTargeted || eligible || occMageTargeted
      ? 'ring-2 ring-amber-400'
      : '';
  const powerVerb =
    occupiedSlotPower?.kind === 'ars-magna'
      ? 'Ars Magna — wound the occupant & take this slot (1 Mana)'
      : occupiedSlotPower?.kind === 'natural-b'
        ? 'Natural Magick — displace the occupant & take this slot'
        : 'Take this slot — choose to wound (Ars Magna, 1 Mana) or displace the occupant';
  const baseTitle = baseIsPowerTarget
    ? powerVerb
    : occMageTargeted
      ? 'Choose this student'
      : occupant
        ? 'occupied'
        : eligible || spaceTargeted
          ? 'place here'
          : 'empty slot';

  const shadowMageTargeted =
    shadowOccupant !== null && mageTargets.has(shadowOccupant.mageId);
  // The selected Mage may shadow-place here (Planar Studies B / a buff). The
  // shadow slot must be empty; pick-a-mage targeting takes precedence.
  const shadowPlaceable =
    shadowEligible && !shadowMageTargeted && shadowOccupant === null;
  const shadowClick =
    shadowMageTargeted && shadowOccupant
      ? () => pickMage(shadowOccupant.mageId)
      : shadowPlaceable && onPlaceShadow
        ? () => onPlaceShadow(space.id)
        : undefined;
  const shadowRing = shadowPlaceable
    ? POWER_RING
    : shadowMageTargeted
      ? 'ring-2 ring-amber-400'
      : '';
  const shadowTitle = shadowMageTargeted
    ? 'Choose this student'
    : shadowPlaceable
      ? shadowManaCost > 0
        ? `Shadow here — pay ${shadowManaCost} Mana`
        : 'Shadow here'
      : 'shadow slot';
  // On an empty placeable shadow tile, label it with the Mana cost instead of
  // the generic "shadow".
  const shadowEmptyLabel =
    shadowPlaceable && shadowManaCost > 0 ? (
      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-cyan-300">
        {shadowManaCost}
        <ResourceIcon kind="mana" size={10} />
      </span>
    ) : undefined;

  return (
    <li
      className={clsx(
        'flex items-center gap-2 text-[11px] leading-snug rounded px-1.5 py-1.5',
        occupant || shadowOccupant
          ? 'bg-amber-400/5'
          : 'bg-slate-950/40 text-slate-300',
      )}
    >
      {!noShadow && (
        <SlotTile
          isShadow
          occupant={shadowOccupant}
          mageIndex={mageIndex}
          onClick={shadowClick}
          ring={shadowRing}
          title={shadowTitle}
          dataAvailable={shadowPlaceable}
          emptyLabel={shadowEmptyLabel}
        />
      )}
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
          {baseIsPowerTarget && (
            <span
              className="inline-flex items-center gap-0.5 rounded border border-fuchsia-400/60 bg-fuchsia-500/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200"
              title={baseTitle}
            >
              {occupiedSlotPower!.kind === 'ars-magna' ? (
                <>
                  Ars Magna
                  {occupiedSlotPower!.manaCost}
                  <ResourceIcon kind="mana" size={10} />
                </>
              ) : occupiedSlotPower!.kind === 'natural-b' ? (
                'displace'
              ) : (
                'wound / displace'
              )}
            </span>
          )}
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

/**
 * A "pool" room (the Great Hall's many identical seats) rendered like the
 * Infirmary ward: a growing, wrapping row of square tiles — the occupied
 * seats plus exactly one open "SLOT" (a new one appears once this fills, via
 * `visibleRoomSpaces`). No per-slot label / type / effect blurb, since the
 * room description at the top already explains what every seat does.
 *
 * Each tile carries the same interactions as `SlotRow`'s base tile: place a
 * selected mage on the open seat, answer a space-target prompt, or pick an
 * occupant for a mage-target prompt.
 */
function PoolSlots({
  spaces,
  eligible,
  occupiedSlotPower,
  onPlace,
  mageIndex,
}: {
  spaces: ActionSpace[];
  eligible: Set<string>;
  occupiedSlotPower?: OccupiedSlotPower | null | undefined;
  onPlace: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
}) {
  const { mageTargets, spaceTargets, pickMage, pickSpace } = usePromptTargets();
  return (
    <div className="flex flex-wrap gap-1">
      {spaces.map((space) => {
        const occupant = space.occupant as Occupant | null;
        const entry = occupant ? mageIndex.get(occupant.mageId) : undefined;
        const isEligible = eligible.has(space.id);
        const spaceTargeted = spaceTargets.has(space.id);
        const occMageTargeted =
          occupant !== null && mageTargets.has(occupant.mageId);
        // Ars Magna / Natural Magick B taking an occupied seat (e.g. in the
        // Great Hall) — give it the distinct power ring.
        const isPowerTarget =
          isEligible && occupant !== null && occupiedSlotPower != null;

        const onClick: (() => void) | undefined = spaceTargeted
          ? () => pickSpace(space.id)
          : isEligible
            ? () => onPlace(space.id)
            : occMageTargeted && occupant
              ? () => pickMage(occupant.mageId)
              : undefined;
        const highlighted = spaceTargeted || isEligible || occMageTargeted;
        const title = isPowerTarget
          ? occupiedSlotPower!.kind === 'ars-magna'
            ? 'Ars Magna — wound the occupant & take this seat (1 Mana)'
            : occupiedSlotPower!.kind === 'natural-b'
              ? 'Natural Magick — displace the occupant & take this seat'
              : 'Take this seat — choose to wound (Ars Magna, 1 Mana) or displace'
          : occMageTargeted
            ? 'Choose this student'
            : occupant
              ? 'occupied'
              : isEligible || spaceTargeted
                ? 'place here'
                : 'empty slot';

        const content = entry ? (
          <MageToken
            color={entry.mage.color}
            aura={PLAYER_AURA[entry.owner.color]}
            isWounded={entry.mage.isWounded}
            isShadowing={entry.mage.isShadowing}
            golem={entry.mage.isTemporary === true}
            size={entry.mage.isTemporary ? 44 : 38}
          />
        ) : (
          <span className="text-[9px] uppercase tracking-wide text-slate-600">
            SLOT
          </span>
        );

        const className = clsx(
          'w-14 h-12 rounded border-2 border-slate-500 flex items-center justify-center flex-shrink-0 p-0.5',
          occupant ? 'bg-amber-400/15' : 'bg-slate-950/40',
          isPowerTarget
            ? POWER_RING
            : highlighted && 'ring-2 ring-amber-400',
        );

        if (onClick) {
          return (
            <button
              key={space.id}
              type="button"
              data-available={isEligible || spaceTargeted ? true : undefined}
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
          <div key={space.id} title={title} className={className}>
            {content}
          </div>
        );
      })}
    </div>
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
  emptyLabel,
}: {
  isShadow?: boolean;
  occupant: Occupant | null;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
  onClick: (() => void) | undefined;
  ring: string;
  title: string;
  dataAvailable?: boolean;
  /** Replaces the default "shadow"/"slot" text when the tile is empty. */
  emptyLabel?: ReactNode;
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
    emptyLabel ?? (
      <span className="text-[8px] uppercase tracking-wide text-slate-600">
        {isShadow ? 'shadow' : 'slot'}
      </span>
    )
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
        if (f.kind === 'mana-gain') {
          // Sorcery Side B — a cyan "+N ✦" floats up off the room as the
          // placed Mage drinks in the ambient power.
          return (
            <motion.div
              key={f.id}
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
            >
              <motion.span
                className="flex items-center gap-1 rounded-full bg-night-900/80 px-2.5 py-1 font-display text-base font-extrabold text-cyan-300 ring-1 ring-cyan-300/50"
                style={{ textShadow: '0 0 10px rgba(125,232,250,0.8)' }}
                initial={{ y: 14, scale: 0.6, opacity: 0 }}
                animate={{ y: [-14, -34], scale: [1, 1.05], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1, ease: 'easeOut', times: [0, 0.2, 0.7, 1] }}
              >
                +{f.value ?? 1}
                <ResourceIcon kind="mana" size={18} />
              </motion.span>
            </motion.div>
          );
        }
        if (f.kind === 'buff-activate') {
          // Mysticism Side B — the In-Place discount switches on: a blue
          // pulse ring + a "Spells −1 ✦" tag rise to announce the power.
          return (
            <motion.div
              key={f.id}
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
            >
              <motion.span
                className="absolute h-14 w-14 rounded-full border-2 border-sky-300/70"
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
              <motion.span
                className="flex items-center gap-1 rounded-full bg-night-900/80 px-2.5 py-1 font-display text-xs font-extrabold text-sky-300 ring-1 ring-sky-300/50"
                style={{ textShadow: '0 0 10px rgba(125,211,252,0.8)' }}
                initial={{ y: 12, scale: 0.7, opacity: 0 }}
                animate={{ y: [-8, -26], scale: [1, 1.04], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1, ease: 'easeOut', times: [0, 0.25, 0.7, 1] }}
              >
                Spells −1
                <ResourceIcon kind="mana" size={13} />
              </motion.span>
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
