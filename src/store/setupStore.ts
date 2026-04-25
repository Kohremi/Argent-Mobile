import { create } from 'zustand';
import type { PackId } from '../game/types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

interface SetupState {
  selectedPackIds: PackId[];
  playerNames: string[];
  setSelectedPacks: (ids: PackId[]) => void;
  togglePack: (id: PackId) => void;
  setPlayerName: (index: number, name: string) => void;
  setPlayerCount: (count: number) => void;
}

function defaultPlayerNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
}

export const useSetupStore = create<SetupState>((set) => ({
  // Base is always required. Other packs are off by default.
  selectedPackIds: ['base'],
  playerNames: defaultPlayerNames(2),

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
      return { playerNames: next };
    }),
}));

export const PLAYER_COUNT_RANGE = { min: MIN_PLAYERS, max: MAX_PLAYERS };
