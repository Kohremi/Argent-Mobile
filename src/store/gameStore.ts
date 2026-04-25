import { create } from 'zustand';
import { applyAction, initGame } from '../game/engine';
import type { GameAction, GameConfig, GameState } from '../game/types';

interface GameStore {
  /** `null` while no game is in progress. */
  state: GameState | null;
  start: (config: GameConfig) => void;
  dispatch: (action: GameAction) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  start: (config) => set({ state: initGame(config) }),
  dispatch: (action) => {
    const current = get().state;
    if (!current) {
      throw new Error('gameStore.dispatch: no active game');
    }
    set({ state: applyAction(current, action) });
  },
  reset: () => set({ state: null }),
}));
