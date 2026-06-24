import type { MarkSupportOption } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { promptDraftsFromShelf, reactionDestinationSlots, topPending } from './promptHelpers';

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
  /** Political Struggle: "place a Support Marker in this faction" options on the
   *  current gain-mark prompt (empty otherwise). Picked via `pickVoter(opt.id)`. */
  supportOptions: MarkSupportOption[];
  /** Assassins: voter ids that can be Hit right now (click the hit box). */
  hitTargets: Set<string>;
  pickHit: (voterId: string) => void;
  /** Card ids draftable right now by clicking the board's tableau shelf
   *  (choose-vault-card / choose-supporter-card whose cards are shown). */
  cardTargets: Set<string>;
  pickMage: (mageId: string) => void;
  pickSpace: (spaceId: string) => void;
  pickVoter: (voterId: string) => void;
  pickCard: (cardId: string) => void;
}

const EMPTY = new Set<string>();
const NO_SUPPORT: MarkSupportOption[] = [];
const NONE: PromptTargets = {
  mageTargets: EMPTY,
  spaceTargets: EMPTY,
  voterTargets: EMPTY,
  cardTargets: EMPTY,
  supportOptions: NO_SUPPORT,
  hitTargets: EMPTY,
  pickMage: () => {},
  pickSpace: () => {},
  pickVoter: () => {},
  pickCard: () => {},
  pickHit: () => {},
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
    const hitOptions = pending.prompt.hitOptions ?? [];
    const hitById = new Map(hitOptions.map((o) => [o.voterId, o.id] as const));
    return {
      ...NONE,
      voterTargets: new Set(pending.prompt.eligibleVoterIds),
      supportOptions: pending.prompt.supportOptions ?? NO_SUPPORT,
      hitTargets: new Set(hitById.keys()),
      pickVoter: (voterId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'voter-chosen', voterId },
        }),
      pickHit: (voterId) => {
        const optionId = hitById.get(voterId);
        if (optionId) {
          tryDispatch({
            type: 'RESOLVE_PENDING',
            resolutionId: pending.id,
            answer: { kind: 'voter-chosen', voterId: optionId },
          });
        }
      },
    };
  }

  // Vault / supporter drafts whose cards are all on the shelf → click a card.
  if (
    (pending.prompt.kind === 'choose-vault-card' ||
      pending.prompt.kind === 'choose-supporter-card') &&
    promptDraftsFromShelf(state, pending)
  ) {
    return {
      ...NONE,
      cardTargets: new Set(pending.prompt.eligibleCardIds),
      pickCard: (cardId) =>
        tryDispatch({
          type: 'RESOLVE_PENDING',
          resolutionId: pending.id,
          answer: { kind: 'card-chosen', cardId },
        }),
    };
  }

  // Adventuring B pool draft: composite `kind::cardId` options (the pool is
  // shown on the shelf). Map each AFFORDABLE option's cardId → its option id
  // so a click dispatches the right option-chosen.
  if (
    pending.resume.effectId === 'base.room.adventuring-b.draft' &&
    pending.prompt.kind === 'choose-from-options'
  ) {
    const byCard = new Map<string, string>();
    for (const o of pending.prompt.options) {
      const sep = o.id.indexOf('::');
      if (sep < 0 || o.available === false) continue; // 'pass' / unaffordable
      byCard.set(o.id.slice(sep + 2), o.id);
    }
    return {
      ...NONE,
      cardTargets: new Set(byCard.keys()),
      pickCard: (cardId) => {
        const optionId = byCard.get(cardId);
        if (optionId) {
          tryDispatch({
            type: 'RESOLVE_PENDING',
            resolutionId: pending.id,
            answer: { kind: 'option-chosen', optionId, payload: {} },
          });
        }
      },
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
