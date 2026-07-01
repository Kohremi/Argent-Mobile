import clsx from 'clsx';
import { useEffect, useMemo } from 'react';
import type { ActionSpaceSlotType, GameState, MageColor, OwnedMage, Room } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  buildMageIndex,
  localPlayer,
  PLAYER_AURA,
  roomPlacementEligibility,
} from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from '../Board/MageToken';
import { LockIcon, RoomIcon } from '../icons';

/**
 * The university as a spatial icon map (the mobile "zoomed-out" view): rooms in
 * their real `roomLayout.grid` positions, each a compact tile with a glyph, the
 * room's name, and its live occupancy — seated students shown as their actual
 * coloured tokens (occupancy is the thing players scan for), open slots as small
 * type-ringed dots. A picked-up Mage glows the rooms it can be placed in and
 * dims the rest, turning the board into a decision surface; a dot in your aura
 * marks rooms where you already have a student. Tapping a tile drills into the
 * enlarged room view (RoomDetailSheet). Adjacency-accurate, so the spatial shape
 * that some spells care about is legible.
 */

/**
 * One drawable spot on a room tile. Occupied spots carry the seated student so
 * the tile can paint the real token (colour + owner aura + wound); open spots
 * carry only their slot `kind`, drawn as a type-ringed dot — so an open 3-slot
 * room reads differently from a full one.
 */
type TileSpot =
  | { kind: 'mage'; mage: OwnedMage; aura: string; shadow: boolean }
  | { kind: 'open'; slotType: ActionSpaceSlotType };

function roomSpots(
  room: Room,
  state: GameState,
  mageOf: (mageId: string) => { mage: OwnedMage; auraColor: string } | undefined,
): TileSpot[] {
  // Infirmary holds resting wounded mages in beds, not action-space occupants —
  // draw each as its wounded token so the ward's load is visible.
  if (room.cannotBePlacedInDirectly) {
    const spots: TileSpot[] = [];
    for (const p of state.players) {
      for (const m of p.mages) {
        if (m.location.kind === 'infirmary')
          spots.push({ kind: 'mage', mage: m, aura: PLAYER_AURA[p.color], shadow: false });
      }
    }
    return spots;
  }
  const spots: TileSpot[] = [];
  for (const s of room.actionSpaces) {
    const occ = s.occupant as { mageId: string } | null;
    const shadow = s.shadowOccupant as { mageId: string } | null;
    if (occ) {
      const e = mageOf(occ.mageId);
      if (e) spots.push({ kind: 'mage', mage: e.mage, aura: e.auraColor, shadow: false });
    } else {
      spots.push({ kind: 'open', slotType: s.slotType });
    }
    if (shadow) {
      const e = mageOf(shadow.mageId);
      if (e) spots.push({ kind: 'mage', mage: e.mage, aura: e.auraColor, shadow: true });
    }
  }
  return spots;
}

/** Ring colour per open-slot kind — keeps the slot-type read at a glance. */
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

function SpotPip({ spot }: { spot: TileSpot }) {
  if (spot.kind === 'mage') {
    return (
      <MageToken
        color={spot.mage.color as MageColor}
        aura={spot.aura}
        isWounded={spot.mage.isWounded}
        isShadowing={spot.shadow || spot.mage.isShadowing}
        golem={spot.mage.isTemporary === true}
        size={24}
        // Shared-layout glide: a wounded Mage visibly travels from its slot tile
        // to its Infirmary bed (and a placed Mage settles in), so an opponent's
        // Ars Magna reads as a real move rather than a blink. Shadow occupants
        // reuse the base id, so they keep a distinct glide track.
        glideId={`map-mage-${spot.mage.id}${spot.shadow ? '-shadow' : ''}`}
      />
    );
  }
  return (
    <span
      title={SLOT_LABEL[spot.slotType]}
      className={clsx(
        'h-2.5 w-2.5 rounded-full bg-black/40 ring-1 ring-inset',
        SLOT_RING[spot.slotType],
      )}
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
  dimmed,
  myAura,
  spots,
  spotlightKey,
  onOpen,
}: {
  room: Room;
  placeable: boolean;
  locked: boolean;
  /** Picking a Mage / answering a prompt and this room isn't a target — recede. */
  dimmed: boolean;
  /** The local player's aura when they already have a student here, else null. */
  myAura: string | null;
  spots: TileSpot[];
  /** Smart Camera follow: when set, pulse this tile (re-keyed to replay). */
  spotlightKey: number | null;
  onOpen: () => void;
}) {
  const shown = spots.slice(0, 8);
  const overflow = spots.length - shown.length;
  const cost = roomCostBadge(room);
  const cap = room.maxMagesPerPlayerPerRound;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-room={room.id}
      data-available={placeable ? true : undefined}
      className={clsx(
        'relative flex min-h-[96px] flex-col items-stretch justify-between gap-1 overflow-hidden rounded-lg border p-1.5 text-center transition-all',
        locked
          ? 'border-rose-500 bg-rose-900/20'
          : placeable
            ? 'border-amber-400 bg-amber-400/15 shadow-glow-sm'
            : tileIdentityClass(room),
        dimmed && 'opacity-35 saturate-50',
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
      {/* Smart Camera follow-pulse: a one-shot ring when an opponent just acted
          here (or was wounded into the Infirmary). Re-keyed so it replays. */}
      {spotlightKey != null && (
        <span
          key={spotlightKey}
          aria-hidden
          className="smart-cue smart-cue-bot pointer-events-none absolute inset-0 rounded-lg"
        />
      )}

      {/* "Your student is here" — a dot in the local player's aura. */}
      {myAura && (
        <span
          aria-hidden
          title="You have a student here"
          className="pointer-events-none absolute left-1 top-1 h-2 w-2 rounded-full ring-1 ring-black/40"
          style={{ background: myAura }}
        />
      )}

      <div className="flex w-full items-start justify-between gap-1">
        <RoomIcon name={room.name} size={22} className="text-slate-100" />
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

      <span className="px-0.5 text-[10px] font-bold leading-tight text-slate-100">
        <span className="line-clamp-2">{room.name}</span>
        <span className="mt-0.5 block text-[8px] font-normal uppercase tracking-wide text-slate-500">
          side {room.side}
          {cap != null && <span className="ml-1 text-slate-600">· max {cap}/rd</span>}
        </span>
      </span>

      <div className="flex min-h-[24px] flex-wrap items-center justify-center gap-1">
        {shown.map((s, i) => (
          <SpotPip key={i} spot={s} />
        ))}
        {overflow > 0 && <span className="text-[8px] text-slate-400">+{overflow}</span>}
      </div>
    </button>
  );
}

export function CampusMap() {
  const state = useGameStore((s) => s.state);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const setOpenRoomId = useUiStore((s) => s.setOpenRoomId);
  const boardSpotlight = useUiStore((s) => s.boardSpotlight);
  const { spaceTargets, roomTargets, pickRoom } = usePromptTargets();

  // Smart Camera follow: pan the spotlit room into view when a new follow-cue
  // fires (nonce changes). Instant scroll so it doesn't fight the Mage glide.
  useEffect(() => {
    if (!boardSpotlight?.roomId) return; // off-board action (Mark / recruit) → no pan
    const el = document.querySelector(`[data-room="${boardSpotlight.roomId}"]`);
    el?.scrollIntoView({ block: 'center', inline: 'center' });
  }, [boardSpotlight?.nonce, boardSpotlight?.roomId]);

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
  const myId = localPlayer(state, localPlayerId)?.id ?? null;
  const mageOf = (mageId: string) => {
    const entry = mageIndex.get(mageId);
    return entry ? { mage: entry.mage, auraColor: PLAYER_AURA[entry.owner.color] } : undefined;
  };
  // While picking a Mage to place (or answering a space / room prompt), the
  // board is a decision surface: only target rooms stay lit; the rest recede.
  const picking = selectedMageId != null || promptRooms.size > 0 || roomTargets.size > 0;
  // A room holds one of my students if I own any base/shadow occupant in it.
  const iAmIn = (room: Room) =>
    myId != null &&
    room.actionSpaces.some(
      (s) =>
        (s.occupant as { ownerId: string } | null)?.ownerId === myId ||
        (s.shadowOccupant as { ownerId: string } | null)?.ownerId === myId,
    );

  return (
    <div className="h-full overflow-auto p-3">
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
                  className="min-h-[96px] rounded-lg border border-dashed border-slate-800 bg-slate-900/30"
                />
              );
            }
            const room = roomById.get(roomId);
            if (!room) return null;
            const locked = state.roomLocks.some((l) => l.roomId === room.id);
            const isRoomTarget = roomTargets.has(room.id);
            const placeable =
              placeableRooms.has(room.id) || promptRooms.has(room.id) || isRoomTarget;
            // Follow-pulse the room an opponent just acted in, plus the Infirmary
            // when that move wounded someone (Ars Magna).
            const spotlit =
              boardSpotlight != null &&
              (room.id === boardSpotlight.roomId ||
                (boardSpotlight.wounded && room.cannotBePlacedInDirectly));
            return (
              <RoomMapTile
                key={room.id}
                room={room}
                placeable={placeable}
                locked={locked}
                dimmed={picking && !placeable && !locked}
                myAura={iAmIn(room) ? PLAYER_AURA[localPlayer(state, localPlayerId)!.color] : null}
                spots={roomSpots(room, state, mageOf)}
                spotlightKey={spotlit ? boardSpotlight!.nonce : null}
                onOpen={isRoomTarget ? () => pickRoom(room.id) : () => setOpenRoomId(room.id)}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
