import { create } from 'zustand';
import type { GameAction } from '../game/types';
import { useGameStore } from './gameStore';

/**
 * Presentation-layer state (docs/UI_DESIGN.md §8). Selection, drawers, and
 * transient feedback live here — never game truth, which stays in gameStore.
 */
interface UiStore {
  /** Office mage currently picked up for placement (TargetingLayer source). */
  selectedMageId: string | null;
  selectMage: (mageId: string | null) => void;

  /** Dev/debug drawer (full engine controls until PromptDirector lands). */
  debugOpen: boolean;
  setDebugOpen: (open: boolean) => void;

  /** Last rejected action's message — surfaced as a transient toast. */
  lastError: string | null;
  clearError: () => void;

  /**
   * A chosen reaction that still needs a destination slot (Shield Potion /
   * Ancient Armor / Mystic Amulet — `ReactionOption.requiresSlotPick`).
   * While set, the board enters slot-targeting for the reaction instead of
   * the prompt's own targeting.
   */
  reactionSlotPick: { resolutionId: string; effectId: string } | null;
  setReactionSlotPick: (pick: { resolutionId: string; effectId: string } | null) => void;

  /**
   * Dispatch wrapper for UI events: clears selection on success, converts
   * engine rejections into a toast instead of an uncaught throw.
   */
  tryDispatch: (action: GameAction) => boolean;
}

export const useUiStore = create<UiStore>((set) => ({
  selectedMageId: null,
  selectMage: (mageId) => set({ selectedMageId: mageId }),

  debugOpen: false,
  setDebugOpen: (open) => set({ debugOpen: open }),

  lastError: null,
  clearError: () => set({ lastError: null }),

  reactionSlotPick: null,
  setReactionSlotPick: (pick) => set({ reactionSlotPick: pick }),

  tryDispatch: (action) => {
    try {
      useGameStore.getState().dispatch(action);
      set({ selectedMageId: null, lastError: null, reactionSlotPick: null });
      return true;
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
