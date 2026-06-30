import { create } from 'zustand';
import type {
  Department,
  MageAbilitySide,
  PackId,
  RoomId,
  ScenarioId,
} from '../game/types';
import { getScenario } from '../content/scenarios';

/** The six magic departments that have worker-Mage abilities, in display
 *  order. Technomancy is from the Mancers expansion. */
export const ABILITY_DEPARTMENTS: { id: Department; label: string; pack?: PackId }[] = [
  { id: 'sorcery', label: 'Sorcery' },
  { id: 'mysticism', label: 'Mysticism' },
  { id: 'natural-magick', label: 'Natural Magick' },
  { id: 'planar-studies', label: 'Planar Studies' },
  { id: 'divinity', label: 'Divinity' },
  { id: 'technomancy', label: 'Technomancy', pack: 'mancers' },
];

function defaultMageAbilitySides(): Record<Department, MageAbilitySide> {
  return {
    sorcery: 'A',
    mysticism: 'A',
    'natural-magick': 'A',
    'planar-studies': 'A',
    divinity: 'A',
    technomancy: 'A',
    students: 'A',
    wild: 'A',
  };
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MIN_ROOMS = 6;
const MAX_ROOMS = 12;

export type LayoutModeId = 'first-time' | 'random' | 'custom';

interface SetupState {
  selectedPackIds: PackId[];
  playerNames: string[];
  /**
   * Per-player "controlled by the AI" flags, parallel to `playerNames` by
   * index. Kept in sync with the player count by `setPlayerCount`.
   */
  playerControlledByBot: boolean[];
  /**
   * Per-player AI personality id (e.g. 'klank', 'thickhide'), parallel to
   * `playerNames`. Only meaningful where `playerControlledByBot[i]` is true.
   */
  playerBotPersonality: string[];
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
  /**
   * Per-department choice of which worker-Mage power side (A/B) is in play.
   * Defaults to all Side A — all currently-wired abilities are Side A; the
   * Side B selector is forward-looking.
   */
  mageAbilitySides: Record<Department, MageAbilitySide>;
  /**
   * Total rounds in play (5 or 6). Defaults to 5. Auto-bumped to 6 when Summer
   * Break is selected (no scenario), and forced to 5 whenever a scenario is
   * selected. The user may still override manually when no scenario is active.
   */
  roundCount: 5 | 6;
  /** Selected Scenario (alternate game mode), or null for a normal game. */
  scenarioId: ScenarioId | null;
  setSelectedPacks: (ids: PackId[]) => void;
  togglePack: (id: PackId) => void;
  setRoundCount: (n: 5 | 6) => void;
  setScenario: (id: ScenarioId | null) => void;
  setPlayerName: (index: number, name: string) => void;
  setPlayerControlledByBot: (index: number, controlled: boolean) => void;
  setPlayerBotPersonality: (index: number, personalityId: string) => void;
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
  setMageAbilitySide: (dept: Department, side: MageAbilitySide) => void;
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
  // Base is always required; the Mancers expansion is on by default. Other packs
  // are off by default.
  selectedPackIds: ['base', 'mancers'],
  // Single-player by default: seat 0 is you, the rest are bots. Every seat stays
  // fully customisable — toggle any to human for hot-seat, or all to bots.
  playerNames: defaultPlayerNames(3),
  playerControlledByBot: [false, true, true],
  playerBotPersonality: ['klank', 'klank', 'malfoy'],
  numberOfRooms: defaultRoomCountForPlayerCount(3),
  // Default to a randomised board layout for replayability.
  layoutMode: 'random',
  // Custom layout pre-seats the always-included University Central rooms
  // (Council / Library / Infirmary) on side A. The picker UI lets the
  // user flip them to side B but doesn't allow fully removing them.
  customRoomIds: [
    'base.room.council-chamber.a',
    'base.room.library.a',
    'base.room.infirmary.a',
  ],
  mageAbilitySides: defaultMageAbilitySides(),
  roundCount: 5,
  scenarioId: null,

  setSelectedPacks: (ids) => set({ selectedPackIds: ids }),

  togglePack: (id) =>
    set((s) => {
      // Base pack cannot be toggled off.
      if (id === 'base') return s;
      // A pack the active scenario requires is locked on (e.g. Talismans needs
      // Mancers for its Synthesis Treasures).
      const required = s.scenarioId
        ? (getScenario(s.scenarioId)?.requiresPackIds ?? [])
        : [];
      if (required.includes(id)) return s;
      const next = s.selectedPackIds.includes(id)
        ? s.selectedPackIds.filter((p) => p !== id)
        : [...s.selectedPackIds, id];
      // Summer Break is a 6-round game by default; auto-set the toggle when it
      // is turned on/off, unless a scenario (always 5 rounds) is active.
      let roundCount = s.roundCount;
      if (id === 'summerbreak' && s.scenarioId === null) {
        roundCount = next.includes('summerbreak') ? 6 : 5;
      }
      return { selectedPackIds: next, roundCount };
    }),

  setRoundCount: (n) =>
    set((s) => (s.scenarioId !== null ? s : { roundCount: n })),

  setScenario: (id) =>
    set((s) => {
      // Auto-enable any packs the scenario requires (Talismans → Mancers).
      const required = id ? (getScenario(id)?.requiresPackIds ?? []) : [];
      const selectedPackIds = [...s.selectedPackIds];
      for (const pid of required) {
        if (!selectedPackIds.includes(pid)) selectedPackIds.push(pid);
      }
      return {
        scenarioId: id,
        selectedPackIds,
        // Scenarios are always 5-round games. Selecting one forces 5; clearing
        // it restores the Summer-Break-aware default.
        roundCount:
          id !== null ? 5 : selectedPackIds.includes('summerbreak') ? 6 : 5,
      };
    }),

  setPlayerName: (index, name) =>
    set((s) => {
      if (index < 0 || index >= s.playerNames.length) return s;
      const next = s.playerNames.slice();
      next[index] = name;
      return { playerNames: next };
    }),

  setPlayerControlledByBot: (index, controlled) =>
    set((s) => {
      if (index < 0 || index >= s.playerControlledByBot.length) return s;
      const next = s.playerControlledByBot.slice();
      next[index] = controlled;
      return { playerControlledByBot: next };
    }),

  setPlayerBotPersonality: (index, personalityId) =>
    set((s) => {
      if (index < 0 || index >= s.playerBotPersonality.length) return s;
      const next = s.playerBotPersonality.slice();
      next[index] = personalityId;
      return { playerBotPersonality: next };
    }),

  setPlayerCount: (count) =>
    set((s) => {
      const clamped = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, count));
      const next = s.playerNames.slice(0, clamped);
      while (next.length < clamped) {
        next.push(`Player ${next.length + 1}`);
      }
      // Keep the per-player arrays the same length as the player list. New
      // seats default to bots (single-player friendly); the user can flip any.
      const bots = s.playerControlledByBot.slice(0, clamped);
      while (bots.length < clamped) bots.push(true);
      const personalities = s.playerBotPersonality.slice(0, clamped);
      while (personalities.length < clamped) personalities.push('klank');
      // Auto-correct room count to the default for the new player count.
      return {
        playerNames: next,
        playerControlledByBot: bots,
        playerBotPersonality: personalities,
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

  setMageAbilitySide: (dept, side) =>
    set((s) => ({
      mageAbilitySides: { ...s.mageAbilitySides, [dept]: side },
    })),
}));

export const PLAYER_COUNT_RANGE = { min: MIN_PLAYERS, max: MAX_PLAYERS };
export const ROOM_COUNT_RANGE = { min: MIN_ROOMS, max: MAX_ROOMS };
