import { create } from 'zustand';
import { applyAction, initGame } from '../game/engine';
import type { GameAction, GameConfig, GameState } from '../game/types';

interface GameStore {
  /** `null` while no game is in progress. */
  state: GameState | null;
  /**
   * Seat-control: the player id THIS client controls (the human seat). Single-
   * player sets it to the lone human; the rest of the table is bots, auto-driven
   * by `useBotDriver`. Designed as the per-client hook a future "join room"
   * system sets — each client would own its own `localPlayerId`, with every
   * other seat either a bot (driven locally) or a remote human (driven by their
   * client). `null` falls back to legacy hot-seat behaviour (the UI follows the
   * active player).
   */
  localPlayerId: string | null;
  /**
   * Start a game. The local (human) seat is auto-derived from the config: when
   * exactly one seat is human, this client binds to it (single-player); with
   * zero or many human seats `localPlayerId` stays `null` (all-bot / hot-seat).
   */
  start: (config: GameConfig) => void;
  setLocalPlayerId: (id: string | null) => void;
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
  localPlayerId: null,
  start: (config) => {
    const state = initGame(config);
    // Bind to the lone human seat (single-player). Zero or many humans → no
    // binding, so the UI follows the active player (all-bot / hot-seat).
    const humanSeats = (config.controlledByBot ?? []).flatMap((isBot, i) =>
      isBot ? [] : [i],
    );
    const localPlayerId =
      humanSeats.length === 1 ? state.players[humanSeats[0]!]?.id ?? null : null;
    set({ state, localPlayerId });
  },
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
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
  reset: () => set({ state: null, localPlayerId: null }),
}));
