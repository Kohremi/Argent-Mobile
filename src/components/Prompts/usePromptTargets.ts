import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { reactionDestinationSlots, topPending } from './promptHelpers';

/**
 * Targeting read-model for board/dock/rail components (docs/UI_DESIGN.md §8):
 * which mages / action-spaces are currently pickable for the top prompt, and
 * the answer callbacks. Components render eligible things "lit" and route
 * clicks here — the PromptDirector renders only the banner/sheet chrome.
 */
export interface PromptTargets {
  /** Mage ids pickable right now (choose-target-mage). */
  mageTargets: Set<string>;
  /** Action-space ids pickable right now (choose-target-action-space or a
   *  reaction's destination slot pick). */
  spaceTargets: Set<string>;
  pickMage: (mageId: string) => void;
  pickSpace: (spaceId: string) => void;
}

const EMPTY = new Set<string>();

export function usePromptTargets(): PromptTargets {
  const state = useGameStore((s) => s.state);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const reactionSlotPick = useUiStore((s) => s.reactionSlotPick);

  if (!state) {
    return { mageTargets: EMPTY, spaceTargets: EMPTY, pickMage: () => {}, pickSpace: () => {} };
  }
  const pending = topPending(state);
  if (!pending) {
    return { mageTargets: EMPTY, spaceTargets: EMPTY, pickMage: () => {}, pickSpace: () => {} };
  }

  // A chosen reaction that needs a destination slot overrides the prompt's
  // own targeting (the window is still the top pending).
  if (
    reactionSlotPick &&
    pending.id === reactionSlotPick.resolutionId &&
    pending.prompt.kind === 'reaction-window'
  ) {
    return {
      mageTargets: EMPTY,
      spaceTargets: reactionDestinationSlots(state, pending),
      pickMage: () => {},
      pickSpace: (spaceId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: {
            kind: 'reaction-played',
            effectId: reactionSlotPick.effectId,
            reactionContext: { destinationSpaceId: spaceId },
          },
        }),
    };
  }

  if (pending.prompt.kind === 'choose-target-mage') {
    return {
      mageTargets: new Set(pending.prompt.eligibleMageIds),
      spaceTargets: EMPTY,
      pickMage: (mageId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'mage-chosen', mageId },
        }),
      pickSpace: () => {},
    };
  }

  if (pending.prompt.kind === 'choose-target-action-space') {
    return {
      mageTargets: EMPTY,
      spaceTargets: new Set(pending.prompt.eligibleSpaceIds),
      pickMage: () => {},
      pickSpace: (spaceId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'space-chosen', spaceId },
        }),
    };
  }

  return { mageTargets: EMPTY, spaceTargets: EMPTY, pickMage: () => {}, pickSpace: () => {} };
}
