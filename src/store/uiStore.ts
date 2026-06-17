import { create } from 'zustand';
import type { GameAction } from '../game/types';
import type { RoomFx } from '../components/FX/useStateDiffFx';
import { botOwnsCurrentDecision } from '../utils/uiSelectors';
import { useGameStore } from './gameStore';

/**
 * Presentation-layer state (docs/UI_DESIGN.md §8). Selection, drawers, and
 * transient feedback live here — never game truth, which stays in gameStore.
 */
interface UiStore {
  /** Office mage currently picked up for placement (TargetingLayer source). */
  selectedMageId: string | null;
  selectMage: (mageId: string | null) => void;

  /**
   * The single hand card whose popover is currently open (spell level menu).
   * Lifted out of the card component so only ONE popover is ever open: opening
   * another card replaces this id, and selecting a Mage or dispatching any
   * action (cast / play / place) clears it — so a stray menu never lingers.
   */
  openCardId: string | null;
  setOpenCard: (cardId: string | null) => void;

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
  roomFx: (RoomFx & { id: number })[];
  pushRoomFx: (fx: RoomFx[]) => void;
  expireRoomFx: (ids: number[]) => void;

  /** Campus zoom factor (drag-to-pan uses native scroll). */
  boardZoom: number;
  setBoardZoom: (zoom: number) => void;

  /**
   * Hot-seat privacy (docs/UI_DESIGN.md §9.4): pending-resolution ids whose
   * secret content the responder has confirmed revealing ("everyone else,
   * eyes away"). Secret prompts render a curtain until their id is here.
   */
  privacyRevealedForId: string | null;
  setPrivacyRevealed: (pendingId: string | null) => void;

  /**
   * A transient private peek (deck tops, etc.): shown behind its own
   * curtain, dismissed with Done. Set AFTER the producing dispatch.
   */
  peek: { title: string; cards: { name: string; sub?: string | undefined }[] } | null;
  peekRevealed: boolean;
  setPeek: (peek: { title: string; cards: { name: string; sub?: string | undefined }[] }) => void;
  revealPeek: () => void;
  clearPeek: () => void;

  /**
   * Dispatch wrapper for UI events: clears selection on success, converts
   * engine rejections into a toast instead of an uncaught throw.
   */
  tryDispatch: (action: GameAction) => boolean;
}

export const useUiStore = create<UiStore>((set) => ({
  selectedMageId: null,
  // Picking up (or dropping) a Mage dismisses any open card popover.
  selectMage: (mageId) => set({ selectedMageId: mageId, openCardId: null }),

  openCardId: null,
  setOpenCard: (cardId) => set({ openCardId: cardId }),

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

  privacyRevealedForId: null,
  setPrivacyRevealed: (pendingId) => set({ privacyRevealedForId: pendingId }),

  peek: null,
  peekRevealed: false,
  setPeek: (peek) => set({ peek, peekRevealed: false }),
  revealPeek: () => set({ peekRevealed: true }),
  clearPeek: () => set({ peek: null, peekRevealed: false }),

  tryDispatch: (action) => {
    // Block human input while a bot ("Klank") owns the current decision — the
    // active Errands seat is a bot, or the top pending prompt is owed by one —
    // so a human can't act on the bot's behalf. The bot driver dispatches
    // through gameStore directly, so it's unaffected.
    const gs = useGameStore.getState().state;
    if (gs && botOwnsCurrentDecision(gs)) return false;
    try {
      useGameStore.getState().dispatch(action);
      set({
        selectedMageId: null,
        openCardId: null,
        lastError: null,
        reactionSlotPick: null,
        privacyRevealedForId: null,
      });
      return true;
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
