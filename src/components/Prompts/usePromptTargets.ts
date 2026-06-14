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
  /** Voter ids pickable right now (choose-voter — click the Consortium). */
  voterTargets: Set<string>;
  pickMage: (mageId: string) => void;
  pickSpace: (spaceId: string) => void;
  pickVoter: (voterId: string) => void;
}

const EMPTY = new Set<string>();
const NONE: PromptTargets = {
  mageTargets: EMPTY,
  spaceTargets: EMPTY,
  voterTargets: EMPTY,
  pickMage: () => {},
  pickSpace: () => {},
  pickVoter: () => {},
};

export function usePromptTargets(): PromptTargets {
  const state = useGameStore((s) => s.state);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const reactionSlotPick = useUiStore((s) => s.reactionSlotPick);

  if (!state) return NONE;
  const pending = topPending(state);
  if (!pending) return NONE;

  // A chosen reaction that needs a destination slot overrides the prompt's
  // own targeting (the window is still the top pending).
  if (
    reactionSlotPick &&
    pending.id === reactionSlotPick.resolutionId &&
    pending.prompt.kind === 'reaction-window'
  ) {
    return {
      ...NONE,
      spaceTargets: reactionDestinationSlots(state, pending),
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
      ...NONE,
      mageTargets: new Set(pending.prompt.eligibleMageIds),
      pickMage: (mageId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'mage-chosen', mageId },
        }),
    };
  }

  if (pending.prompt.kind === 'choose-voter') {
    return {
      ...NONE,
      voterTargets: new Set(pending.prompt.eligibleVoterIds),
      pickVoter: (voterId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'voter-chosen', voterId },
        }),
    };
  }

  if (pending.prompt.kind === 'choose-target-action-space') {
    return {
      ...NONE,
      spaceTargets: new Set(pending.prompt.eligibleSpaceIds),
      pickSpace: (spaceId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'space-chosen', spaceId },
        }),
    };
  }

  return NONE;
}
