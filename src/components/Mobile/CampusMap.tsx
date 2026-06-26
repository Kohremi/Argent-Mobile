import clsx from 'clsx';
import { useMemo } from 'react';
import type { ActionSpaceSlotType, GameState, Room } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  buildMageIndex,
  PLAYER_AURA,
  roomPlacementEligibility,
} from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { LockIcon } from '../icons';
import { BellTower } from '../Board/BellTower';

/**
 * The university as a spatial icon map (the mobile "zoomed-out" view): rooms in
 * their real `roomLayout.grid` positions, each a compact tile with a glyph,
 * abbreviation, and occupancy pips. A picked-up Mage glows the rooms it can be
 * placed in; tapping a tile drills into the enlarged room view (RoomDetailSheet).
 * Adjacency-accurate, so the spatial shape that some spells care about is legible.
 */

/** Pick an emoji glyph for a room from keywords in its name (data has none). */
const GLYPH_RULES: [RegExp, string][] = [
  [/infirmary|ward/i, '🚑'],
  [/library|archive/i, '📚'],
  [/astronomy|tower|observ/i, '🔭'],
  [/chapel|cathedral|shrine/i, '⛪'],
  [/council|chamber|senate/i, '⚖️'],
  [/great hall|hall|dining/i, '🏛️'],
  [/golem/i, '🤖'],
  [/labor|laboratory|lab\b/i, '🧪'],
  [/tavern|inn|pub/i, '🍺'],
  [/atelier|workshop|synthesis|forge/i, '🛠️'],
  [/archmage|study|sanctum/i, '📖'],
  [/training|field|yard|arena/i, '🛡️'],
  [/dorm|dormitory|residence/i, '🛏️'],
  [/guild|market|bazaar/i, '🏷️'],
  [/staff|wand|relic/i, '🪄'],
  [/garden|grove|nature/i, '🌿'],
];

function roomGlyph(name: string): string {
  for (const [re, g] of GLYPH_RULES) if (re.test(name)) return g;
  return '🏰';
}

/** Short uppercase abbreviation from the room name (initials, max 4 chars). */
function roomAbbr(name: string): string {
  const words = name.replace(/[^a-z0-9 ]/gi, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0]!.slice(0, 4).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 4)
    .toUpperCase();
}

/**
 * One drawable spot on a room tile. Unlike the old occupancy pips (which only
 * drew *occupied* slots), every action space contributes a slot — so an open
 * 3-slot room reads differently from a full one, and the slot's `kind` shows
 * what sort of spot it is. `color` null = open; set = the seated mage's aura.
 */
type Slot = { kind: ActionSpaceSlotType; color: string | null; shadow: boolean };

function roomSlots(room: Room, state: GameState, mageOwnerColor: (mageId: string) => string): Slot[] {
  // Infirmary holds resting wounded mages in beds, not action-space occupants —
  // draw each as a filled "wound" bed so the ward's load is visible.
  if (room.cannotBePlacedInDirectly) {
    const slots: Slot[] = [];
    for (const p of state.players) {
      for (const m of p.mages) {
        if (m.location.kind === 'infirmary')
          slots.push({ kind: 'wound', color: PLAYER_AURA[p.color], shadow: false });
      }
    }
    return slots;
  }
  const slots: Slot[] = [];
  for (const s of room.actionSpaces) {
    const occ = s.occupant as { mageId: string } | null;
    const shadow = s.shadowOccupant as { mageId: string } | null;
    slots.push({ kind: s.slotType, color: occ ? mageOwnerColor(occ.mageId) : null, shadow: false });
    if (shadow) slots.push({ kind: 'shadow', color: mageOwnerColor(shadow.mageId), shadow: true });
  }
  return slots;
}

/** Ring colour per slot kind — visible whether the slot is open or filled. */
const SLOT_RING: Record<ActionSpaceSlotType, string> = {
  regular: 'ring-white/35',
  merit: 'ring-amber-300/90',
  'shadow-merit': 'ring-amber-300/90',
  shadow: 'ring-violet-300/80',
  wound: 'ring-rose-400/85',
};

const SLOT_LABEL: Record<ActionSpaceSlotType, string> = {
  regular: 'Open slot',
  merit: 'Merit slot',
  'shadow-merit': 'Merit shadow slot',
  shadow: 'Shadow slot',
  wound: 'Infirmary bed',
};

function SlotPip({ slot }: { slot: Slot }) {
  const filled = slot.color != null;
  return (
    <span
      title={SLOT_LABEL[slot.kind]}
      className={clsx(
        'h-2.5 w-2.5 rounded-full ring-1 ring-inset transition-colors',
        SLOT_RING[slot.kind],
        slot.shadow && 'opacity-55',
        !filled && 'bg-black/40',
      )}
      style={filled ? { background: slot.color! } : undefined}
    />
  );
}

/** The cheapest entry cost printed on any of the room's slots, as a tiny chip. */
function roomCostBadge(room: Room): string | null {
  for (const s of room.actionSpaces) {
    const c = s.costToActivate;
    if (!c) continue;
    if (c.meritBadges) return `✦${c.meritBadges}`;
    if (c.gold) return `${c.gold}g`;
    if (c.mana) return `${c.mana}m`;
  }
  return null;
}

/**
 * Default tile skin keyed on the room's identity (only used when the tile isn't
 * in a locked / placeable interaction state, which take priority): University
 * Central glows amber, Instant rooms violet, the Infirmary reads as dashed/inert.
 */
function tileIdentityClass(room: Room): string {
  if (room.cannotBePlacedInDirectly)
    return 'border-dashed border-slate-600 bg-slate-900/50 hover:bg-slate-900';
  if (room.isUniversityCentral)
    return 'border-amber-300/45 bg-gradient-to-b from-amber-400/10 to-slate-900/85 hover:from-amber-400/15';
  if (room.isInstantRoom)
    return 'border-violet-400/45 bg-gradient-to-b from-violet-500/10 to-slate-900/85 hover:from-violet-500/15';
  return 'border-slate-700 bg-slate-900/80 hover:bg-slate-800';
}

function RoomMapTile({
  room,
  placeable,
  locked,
  slots,
  onOpen,
}: {
  room: Room;
  placeable: boolean;
  locked: boolean;
  slots: Slot[];
  onOpen: () => void;
}) {
  const shown = slots.slice(0, 8);
  const overflow = slots.length - shown.length;
  const cost = roomCostBadge(room);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-room={room.id}
      data-available={placeable ? true : undefined}
      className={clsx(
        'relative flex min-h-[84px] flex-col items-center justify-between gap-1 overflow-hidden rounded-lg border p-1.5 text-center transition-colors',
        locked
          ? 'border-rose-500 bg-rose-900/20'
          : placeable
            ? 'border-amber-400 bg-amber-400/15 shadow-glow-sm'
            : tileIdentityClass(room),
      )}
      style={placeable ? ({ '--glow': '#ffe9a877' } as React.CSSProperties) : undefined}
      title={`${room.name} (side ${room.side})`}
    >
      {/* Identity accents: Instant rooms get a left edge-stripe, University */}
      {/* Central a top crown — only when not overridden by an interaction state. */}
      {!locked && !placeable && room.isInstantRoom && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-violet-400/70" />
      )}
      {!locked && !placeable && room.isUniversityCentral && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300/0 via-amber-300/80 to-amber-300/0"
        />
      )}

      <div className="flex w-full items-start justify-between">
        <span className="text-lg leading-none">{roomGlyph(room.name)}</span>
        <span className="flex items-center gap-0.5">
          {cost && (
            <span className="rounded bg-amber-400/15 px-1 text-[7px] font-bold leading-tight text-amber-200/90 ring-1 ring-amber-300/30">
              {cost}
            </span>
          )}
          {locked && <LockIcon size={11} />}
          {room.isUniversityCentral && (
            <span className="text-[7px] font-bold uppercase text-amber-300/80">UC</span>
          )}
          {room.isInstantRoom && (
            <span className="text-[7px] font-bold uppercase text-purple-300/80">⚡</span>
          )}
        </span>
      </div>
      <span className="text-[9px] font-bold leading-tight text-slate-200">
        {roomAbbr(room.name)}
        <span className="ml-1 font-normal text-slate-500">{room.side}</span>
      </span>
      <div className="flex min-h-[10px] flex-wrap items-center justify-center gap-1">
        {shown.map((s, i) => (
          <SlotPip key={i} slot={s} />
        ))}
        {overflow > 0 && <span className="text-[8px] text-slate-400">+{overflow}</span>}
      </div>
    </button>
  );
}

export function CampusMap() {
  const state = useGameStore((s) => s.state);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const setOpenRoomId = useUiStore((s) => s.setOpenRoomId);
  const { spaceTargets } = usePromptTargets();

  const mageIndex = useMemo(
    () => (state ? buildMageIndex(state) : (new Map() as ReturnType<typeof buildMageIndex>)),
    [state],
  );

  const placeableRooms = useMemo(() => {
    if (!state || !selectedMageId) return new Set<string>();
    const player = activePlayer(state);
    if (!player) return new Set<string>();
    return roomPlacementEligibility(state, player.id, selectedMageId);
  }, [state, selectedMageId]);

  // Rooms that hold a slot the current prompt is targeting — surface them too.
  const promptRooms = useMemo(() => {
    if (!state || spaceTargets.size === 0) return new Set<string>();
    const out = new Set<string>();
    for (const room of state.rooms) {
      if (room.actionSpaces.some((s) => spaceTargets.has(s.id))) out.add(room.id);
    }
    return out;
  }, [state, spaceTargets]);

  if (!state) return null;
  const { grid, cols } = state.roomLayout;
  const roomById = new Map(state.rooms.map((r) => [r.id, r] as const));
  const ownerColor = (mageId: string) => {
    const entry = mageIndex.get(mageId);
    return entry ? PLAYER_AURA[entry.owner.color] : '#94a3b8';
  };

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto mb-2 max-w-[640px]">
        <BellTower state={state} />
      </div>
      <div
        className="mx-auto grid max-w-[640px] items-stretch gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(72px, 1fr))` }}
      >
        {grid.flatMap((row, r) =>
          row.map((roomId, c) => {
            if (!roomId) {
              return (
                <div
                  key={`empty-${r}-${c}`}
                  aria-hidden="true"
                  className="min-h-[84px] rounded-lg border border-dashed border-slate-800 bg-slate-900/30"
                />
              );
            }
            const room = roomById.get(roomId);
            if (!room) return null;
            const locked = state.roomLocks.some((l) => l.roomId === room.id);
            return (
              <RoomMapTile
                key={room.id}
                room={room}
                placeable={placeableRooms.has(room.id) || promptRooms.has(room.id)}
                locked={locked}
                slots={roomSlots(room, state, ownerColor)}
                onOpen={() => setOpenRoomId(room.id)}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
