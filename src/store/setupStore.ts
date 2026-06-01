import { create } from 'zustand';
import type { PackId, RoomId } from '../game/types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MIN_ROOMS = 6;
const MAX_ROOMS = 12;

export type LayoutModeId = 'first-time' | 'random' | 'custom';

interface SetupState {
  selectedPackIds: PackId[];
  playerNames: string[];
  /**
   * Number of rooms in play. Auto-recomputed to the default for the player
   * count whenever the player count changes, but the user may then override
   * manually via `setNumberOfRooms`. Only meaningful in `'random'` layout
   * mode — `'first-time'` is always 8 and `'custom'` derives count from
   * the room list.
   */
  numberOfRooms: number;
  /** Which board layout the player chose on the setup screen. */
  layoutMode: LayoutModeId;
  /**
   * Room IDs included in the `'custom'` layout. Each entry already encodes
   * the chosen side (Side A vs Side B). The engine shuffles these into a
   * random grid at game start — the user only picks WHICH rooms / sides,
   * not their positions.
   */
  customRoomIds: RoomId[];
  setSelectedPacks: (ids: PackId[]) => void;
  togglePack: (id: PackId) => void;
  setPlayerName: (index: number, name: string) => void;
  setPlayerCount: (count: number) => void;
  setNumberOfRooms: (n: number) => void;
  setLayoutMode: (m: LayoutModeId) => void;
  /**
   * Toggle a specific room/side in the custom layout. If the opposite side
   * of the same room is currently selected it gets swapped out — a room
   * can only be in the layout under one side at a time.
   */
  toggleCustomRoomSide: (
    roomId: RoomId,
    otherSideRoomId: RoomId | null,
  ) => void;
}

function defaultPlayerNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
}

/** Default room count for a given player count. */
export function defaultRoomCountForPlayerCount(playerCount: number): number {
  if (playerCount <= 3) return 8;
  if (playerCount === 4) return 10;
  return 12;
}

export const useSetupStore = create<SetupState>((set) => ({
  // Base is always required. Other packs are off by default.
  selectedPackIds: ['base'],
  playerNames: defaultPlayerNames(2),
  numberOfRooms: defaultRoomCountForPlayerCount(2),
  // Default to the recommended beginner layout for new games.
  layoutMode: 'first-time',
  // Custom layout pre-seats the always-included University Central rooms
  // (Council / Library / Infirmary) on side A. The picker UI lets the
  // user flip them to side B but doesn't allow fully removing them.
  customRoomIds: [
    'base.room.council-chamber.a',
    'base.room.library.a',
    'base.room.infirmary.a',
  ],

  setSelectedPacks: (ids) => set({ selectedPackIds: ids }),

  togglePack: (id) =>
    set((s) => {
      // Base pack cannot be toggled off.
      if (id === 'base') return s;
      const next = s.selectedPackIds.includes(id)
        ? s.selectedPackIds.filter((p) => p !== id)
        : [...s.selectedPackIds, id];
      return { selectedPackIds: next };
    }),

  setPlayerName: (index, name) =>
    set((s) => {
      if (index < 0 || index >= s.playerNames.length) return s;
      const next = s.playerNames.slice();
      next[index] = name;
      return { playerNames: next };
    }),

  setPlayerCount: (count) =>
    set((s) => {
      const clamped = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, count));
      const next = s.playerNames.slice(0, clamped);
      while (next.length < clamped) {
        next.push(`Player ${next.length + 1}`);
      }
      // Auto-correct room count to the default for the new player count.
      return {
        playerNames: next,
        numberOfRooms: defaultRoomCountForPlayerCount(clamped),
      };
    }),

  setNumberOfRooms: (n) =>
    set(() => ({
      numberOfRooms: Math.max(MIN_ROOMS, Math.min(MAX_ROOMS, n)),
    })),

  setLayoutMode: (m) => set(() => ({ layoutMode: m })),

  toggleCustomRoomSide: (roomId, otherSideRoomId) =>
    set((s) => {
      const current = s.customRoomIds;
      if (current.includes(roomId)) {
        // Already selected — clicking the same side deselects it.
        return { customRoomIds: current.filter((id) => id !== roomId) };
      }
      // Otherwise add this side; if the room's other side was previously
      // selected, drop it first so the room is only in once.
      const filtered =
        otherSideRoomId === null
          ? current
          : current.filter((id) => id !== otherSideRoomId);
      return { customRoomIds: [...filtered, roomId] };
    }),
}));

export const PLAYER_COUNT_RANGE = { min: MIN_PLAYERS, max: MAX_PLAYERS };
export const ROOM_COUNT_RANGE = { min: MIN_ROOMS, max: MAX_ROOMS };
