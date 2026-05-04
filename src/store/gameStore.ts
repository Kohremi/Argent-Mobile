import { create } from 'zustand';
import { applyAction, initGame } from '../game/engine';
import type { GameAction, GameConfig, GameState } from '../game/types';

interface GameStore {
  /** `null` while no game is in progress. */
  state: GameState | null;
  start: (config: GameConfig) => void;
  dispatch: (action: GameAction) => void;
  /**
   * Debug-only escape hatch for the dev UI. Replaces state with the result
   * of applying `fn` to current state. Bypasses `applyAction` entirely;
   * production callers should use `dispatch`, not this.
   */
  patchState: (fn: (s: GameState) => GameState) => void;
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
  patchState: (fn) => {
    const current = get().state;
    if (!current) return;
    set({ state: fn(current) });
  },
  reset: () => set({ state: null }),
}));
