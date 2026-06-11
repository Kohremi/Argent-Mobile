import { create } from 'zustand';
import type { ActionSpace, GameAction } from '../game/types';
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
   * One-shot room effects derived from GameState diffs (docs/UI_DESIGN.md §8
   * "FX from state diffs") — wound flashes, banish rings, flip glows.
   * RoomScene renders entries for its room; useStateDiffFx expires them.
   */
  roomFx: { id: number; roomId: string; kind: 'wound' | 'banish' | 'flip' }[];
  pushRoomFx: (fx: { roomId: string; kind: 'wound' | 'banish' | 'flip' }[]) => void;
  expireRoomFx: (ids: number[]) => void;

  /** Campus zoom factor (drag-to-pan uses native scroll). */
  boardZoom: number;
  setBoardZoom: (zoom: number) => void;

  /** Hovered action space + its screen rect — drives the slot tooltip. */
  hoveredSlot: { space: ActionSpace; rect: { x: number; y: number; w: number } } | null;
  setHoveredSlot: (
    hovered: { space: ActionSpace; rect: { x: number; y: number; w: number } } | null,
  ) => void;

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

  roomFx: [],
  pushRoomFx: (fx) =>
    set((s) => ({
      roomFx: [
        ...s.roomFx,
        ...fx.map((f, i) => ({ ...f, id: Date.now() * 100 + s.roomFx.length + i })),
      ],
    })),
  expireRoomFx: (ids) =>
    set((s) => ({ roomFx: s.roomFx.filter((f) => !ids.includes(f.id)) })),

  boardZoom: 1,
  setBoardZoom: (zoom) => set({ boardZoom: Math.min(1.4, Math.max(0.4, zoom)) }),

  hoveredSlot: null,
  setHoveredSlot: (hovered) => set({ hoveredSlot: hovered }),

  tryDispatch: (action) => {
    try {
      useGameStore.getState().dispatch(action);
      set({ selectedMageId: null, lastError: null, reactionSlotPick: null, hoveredSlot: null });
      return true;
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
