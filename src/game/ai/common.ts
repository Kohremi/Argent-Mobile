// Shared plumbing for the bot personalities.
//
// The four personalities (Klank, Malfoy, Thickhide, DarthPotter) were cloned
// from one another, leaving each file with byte-identical copies of the same
// pure helpers — seeded RNG, board lookups, merit-badge budgeting, the
// reaction-window save, the disruption detector, and so on. Those live here so
// every bot shares ONE implementation; what stays in each personality file is
// only its decision POLICY (the Errands cascade and prompt heuristics).
//
// Everything here is a pure function of engine truth (legality is enumerated
// with the engine's own dry-run selectors), so a bot can never attempt a move
// the rules forbid.

import { applyAction } from '../engine';
import { createRng, type Rng } from '../../utils/rng';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../effects/helpers';
import {
  castableSpellLevels,
  playableSupporters,
  playableVaultCards,
} from '../../utils/uiSelectors';
import type {
  ActionSpace,
  GameAction,
  GameState,
  PendingResolution,
  Player,
  PlayerId,
  ResolutionAnswer,
  Room,
} from '../types';

export type { Rng };

// ============================================================================
// Seeded RNG + board lookups.
// ============================================================================

/** A PRNG seeded from the state + a salt, so within-tier picks are reproducible. */
export function makeRng(state: GameState, salt: string): Rng {
  let h = (state.rngSeed | 0) ^ Math.imul(state.nextSequenceId + 1, 2654435761);
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 16777619);
  }
  return createRng(h);
}

export function pickRandom<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)] ?? arr[0]!;
}

export function findSpace(
  state: GameState,
  spaceId: string,
): { room: Room; space: ActionSpace } | null {
  for (const room of state.rooms) {
    const space = room.actionSpaces.find((s) => s.id === spaceId);
    if (space) return { room, space };
  }
  return null;
}

/** Unspent research currency in hand (INT + WIS pool, not yet placed on spells). */
export function unspentResearch(player: Player): number {
  return player.resources.intelligence + player.resources.wisdom;
}

/** The set of Mage ids owned by `playerId`. */
export function ownMageIds(state: GameState, playerId: PlayerId): Set<string> {
  const player = state.players.find((p) => p.id === playerId);
  return new Set(player?.mages.map((m) => m.id) ?? []);
}

// ============================================================================
// Merit-badge budgeting.
// ============================================================================

/** Merit / shadow-merit seats cost a Merit Badge to activate (paid at Resolution). */
export function isMeritSlot(space: ActionSpace): boolean {
  return space.slotType === 'merit' || space.slotType === 'shadow-merit';
}

/** Merit Badges already committed to merit seats this round (charged at Resolution). */
export function meritBadgesCommitted(state: GameState, playerId: PlayerId): number {
  let committed = 0;
  for (const room of state.rooms) {
    for (const sp of room.actionSpaces) {
      if (!isMeritSlot(sp)) continue;
      const cost = sp.costToActivate?.meritBadges ?? 1;
      if (sp.occupant?.ownerId === playerId) committed += cost;
      if (sp.shadowOccupant?.ownerId === playerId) committed += cost;
    }
  }
  return committed;
}

// ============================================================================
// Reward classification from a slot's human-readable summary.
// The ActionSpace `description` is the room file's reward summary (the same text
// a human reads off the slot), so bots classify seats by keyword.
// ============================================================================

export const RESEARCH_RE = /\bresearch\b/;
export const SUPPORTER_DRAFT_RE = /draft[^.]*supporter/;
export const INT_WIS_RE = /\bint\b|intelligence|\bwis\b|wisdom/;

export function providesResearch(desc: string): boolean {
  return RESEARCH_RE.test(desc);
}

/** Largest "<n> mana"/"<n> gold" amount named in the reward text (0 if none). */
export function maxAmount(desc: string, unit: 'mana' | 'gold'): number {
  let best = 0;
  for (const m of desc.matchAll(new RegExp(`(\\d+)\\s*${unit}`, 'g'))) {
    best = Math.max(best, Number(m[1]));
  }
  return best;
}

// ============================================================================
// Disruption detection — does an action wound / disrupt an OPPONENT?
// ============================================================================

/** Target-prompt labels that name a harmful effect. */
export const HARMFUL_LABEL_RE = /wound|banish|move|shadow|displace/i;
/** Card text describing a targeted disruption of a Mage. */
export const DISRUPT_VERB_RE = /\b(wound|banish|shadow|displace|move)\b/i;
/** Wound/banish target prompts — the negative effects only ever aimed at rivals. */
export const HARMFUL_TARGET_RE = /\b(wound|banish)\b/i;
/** Card text describing global control that disrupts opponents without a Mage target. */
export const GLOBAL_DISRUPT_RE = /\bsteal\b|lose (their|its) power|may not cast|more mana|extra mana/i;

/**
 * True when taking `action` would wound or disrupt an OPPONENT. Engine-truth:
 * dry-run the action and inspect the result —
 *   (a) a reaction window already records a harmful event on a rival's Mage,
 *   (b) the next prompt asks the bot to pick an opponent's Mage to hit, or
 *   (c) the source card's text is global control (Mesmerize / Silence / Energy
 *       Drain / steal) that hurts opponents without targeting a Mage.
 */
export function actionDisruptsOpponent(
  state: GameState,
  player: Player,
  action: GameAction,
  sourceText: string,
): boolean {
  let next: GameState;
  try {
    next = applyAction(state, action);
  } catch {
    return false;
  }
  const me = player.id;
  const ownIds = new Set(player.mages.map((m) => m.id));

  // (a) Already harmed an opponent's Mage (a reaction window just opened).
  for (const w of next.activeReactionWindows) {
    for (const e of w.triggerEvents) {
      if (
        (e.kind === 'mage-wounded' ||
          e.kind === 'mage-banished' ||
          e.kind === 'mage-moved' ||
          e.kind === 'mage-shadowed') &&
        e.byPlayerId === me &&
        e.ownerId !== me
      ) {
        return true;
      }
    }
  }

  // (b) About to choose an opponent's Mage to hit.
  const top = next.pendingResolutionStack[next.pendingResolutionStack.length - 1];
  if (top && top.responderId === me && top.prompt.kind === 'choose-target-mage') {
    const eligible = top.prompt.eligibleMageIds;
    const opponentEligible = eligible.some((id) => !ownIds.has(id));
    const opponentsOnly = eligible.length > 0 && eligible.every((id) => !ownIds.has(id));
    const harmful =
      opponentsOnly ||
      HARMFUL_LABEL_RE.test(top.prompt.label ?? '') ||
      DISRUPT_VERB_RE.test(sourceText);
    if (opponentEligible && harmful) return true;
  }

  // (c) Global control that disrupts opponents without a Mage target.
  return GLOBAL_DISRUPT_RE.test(sourceText);
}

/** Castable spells + playable items whose effect wounds or disrupts an opponent. */
export function disruptiveCardActions(state: GameState, player: Player): GameAction[] {
  const out: GameAction[] = [];
  for (const [spellCardId, levels] of castableSpellLevels(state, player.id)) {
    const def = lookupSpellCardDef(state, spellCardId);
    for (const level of levels) {
      const text = def?.levels.find((l) => l.level === level)?.description ?? '';
      const action: GameAction = { type: 'CAST_SPELL', playerId: player.id, spellCardId, level };
      if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
    }
  }
  for (const vaultCardId of playableVaultCards(state, player.id)) {
    const text = lookupVaultCardDef(state, vaultCardId)?.description ?? '';
    const action: GameAction = { type: 'PLAY_VAULT_CARD', playerId: player.id, vaultCardId };
    if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
  }
  for (const supporterCardId of playableSupporters(state, player.id)) {
    const text = lookupSupporterCardDef(state, supporterCardId)?.description ?? '';
    const action: GameAction = { type: 'PLAY_SUPPORTER', playerId: player.id, supporterCardId };
    if (actionDisruptsOpponent(state, player, action, text)) out.push(action);
  }
  return out;
}

/**
 * True when taking `action` would immediately force the bot into a harmful
 * (wound / banish) target pick whose only eligible Mages are its OWN, with no
 * way to pass — rather than turn the effect on itself, callers drop such
 * actions. Engine-truth: dry-run the action and inspect the prompt it leaves.
 */
export function forcesSelfWound(
  state: GameState,
  action: GameAction,
  botId: PlayerId,
): boolean {
  let next: GameState;
  try {
    next = applyAction(state, action);
  } catch {
    return false;
  }
  const top = next.pendingResolutionStack[next.pendingResolutionStack.length - 1];
  if (!top || top.responderId !== botId) return false;
  const prompt = top.prompt;
  if (prompt.kind !== 'choose-target-mage') return false;
  // An optional leg can simply be passed at prompt time, so it's not a dead end.
  if (!HARMFUL_TARGET_RE.test(prompt.label ?? '') || prompt.canPass) return false;
  const own = ownMageIds(next, botId);
  return prompt.eligibleMageIds.every((id) => own.has(id));
}

// ============================================================================
// Prompt-answer helpers shared across personalities.
// ============================================================================

/**
 * Option ids on a research menu that REARRANGE already placed Research (relocate
 * a WIS/INT token between Spells). Bots never do this, so they're filtered out —
 * leaving "Done moving Research" (`discard`) as the move-only menu's choice.
 */
export function isMoveResearchOption(id: string): boolean {
  return id === 'move-wis' || id === 'move-int';
}

/**
 * First eligible card whose pick is actually LEGAL, found by dry-running the
 * resolution (engine-truth — the same safeguard used for actions). A
 * `choose-vault-card` BUY prompt can list cards the bot can't afford; picking
 * the first blindly would throw an illegal-move error, so we skip any candidate
 * the engine rejects. Falls back to the first id if none dry-run cleanly.
 */
export function firstLegalCard(
  state: GameState,
  pending: PendingResolution,
  cardIds: readonly string[],
): string | undefined {
  for (const cardId of cardIds) {
    try {
      applyAction(state, {
        type: 'RESOLVE_PENDING',
        resolutionId: pending.id,
        answer: { kind: 'card-chosen', cardId },
      });
      return cardId;
    } catch {
      // Illegal (e.g. an unaffordable buy) — try the next candidate.
    }
  }
  return cardIds[0];
}

/**
 * Choose a LEGAL reaction answer for an open reaction window, verified by
 * dry-running each candidate (engine-truth). The engine only offers reactions
 * the bot owns and can pay, and every offered reaction protects one of the
 * bot's OWN Mages, so the bot reacts whenever it can. But a multi-Mage window
 * can still reject a naive play: e.g. Mystic Amulet over a window whose FIRST
 * event is an opponent's Mage — with no `forMageId` the engine matches event[0]
 * and the reaction throws "only protects your own Mage". So we try the option's
 * own forMageId, then each of the responder's affected Mages, and commit only to
 * an answer the engine accepts; if none do, we pass (always legal). A repeatable
 * option (Sacred Shield) is preferred so the bot keeps its slot and can save
 * several Mages. `reactionContext: {}` resolves a slot-pick reaction by keeping
 * the Mage on its original slot.
 *
 * `orderRest` lets a personality control the order in which the non-repeatable
 * options are tried (Thickhide shuffles; the others keep listing order).
 */
export function chooseReaction(
  state: GameState,
  pending: PendingResolution,
  orderRest?: (options: ReactionOptionLike[]) => ReactionOptionLike[],
): ResolutionAnswer {
  const prompt = pending.prompt;
  if (prompt.kind !== 'reaction-window' || prompt.reactionOptions.length === 0) {
    return { kind: 'reaction-passed' };
  }
  const ownAffected = prompt.triggerEvents
    .filter((e) => 'ownerId' in e && e.ownerId === pending.responderId && 'mageId' in e)
    .map((e) => (e as { mageId: string }).mageId);
  const legal = (answer: ResolutionAnswer): boolean => {
    try {
      applyAction(state, { type: 'RESOLVE_PENDING', resolutionId: pending.id, answer });
      return true;
    } catch {
      return false;
    }
  };
  // Repeatable options first (they save more than one Mage); the rest in the
  // order the personality chooses (default: listing order).
  const repeatables = prompt.reactionOptions.filter((o) => o.repeatable);
  const rest = prompt.reactionOptions.filter((o) => !o.repeatable);
  const ordered = [...repeatables, ...(orderRest ? orderRest(rest) : rest)];
  for (const o of ordered) {
    const targets = o.forMageId ? [o.forMageId] : [undefined, ...ownAffected];
    for (const forMageId of targets) {
      const answer: ResolutionAnswer = {
        kind: 'reaction-played',
        effectId: o.effectId,
        reactionContext: {},
        ...(forMageId ? { forMageId } : {}),
      };
      if (legal(answer)) return answer;
    }
  }
  return { kind: 'reaction-passed' };
}

/** Minimal shape of a reaction option needed by `chooseReaction`'s `orderRest`. */
export interface ReactionOptionLike {
  effectId: string;
  repeatable?: boolean;
  forMageId?: string;
}
