import { applyAction } from '../game/engine';
import {
  actsAsColor,
  colorAbilityActive,
  magesLosePowers,
  mysticismInPlaceDiscount,
  sideForColor,
  spellLevelBaseManaCost,
  spellManaDiscountFor,
} from '../game/effects/helpers';
import type {
  ActionSpace,
  ChoiceOption,
  GameState,
  OwnedMage,
  Player,
  PlayerColor,
  Room,
  SpellLevel,
} from '../game/types';
import type { MobileTab } from '../store/uiStore';

/**
 * Read-model helpers for the presentation layer. Eligibility is derived by
 * dry-running the engine (applyAction throws on illegal actions), so the UI
 * can never drift from the rules — see docs/UI_DESIGN.md §8.
 */

/** The player whose turn it is during Errands, else null. */
export function activePlayer(state: GameState): Player | null {
  if (state.phase.kind !== 'errands') return null;
  return state.players[state.phase.activePlayerIndex] ?? null;
}

/** True when the active Errands player is an AI-controlled (Klank) seat. */
export function activePlayerIsBot(state: GameState): boolean {
  return activePlayer(state)?.controlledByBot === true;
}

/** True when every seated player is AI-controlled (enables all-bot auto-run). */
export function allPlayersAreBots(state: GameState): boolean {
  return state.players.length > 0 && state.players.every((p) => p.controlledByBot === true);
}

/**
 * The seat this client controls — `localPlayerId` when set (single-player),
 * else a sensible fallback (the active Errands seat, then the first seat) so
 * legacy hot-seat play keeps working. This is "me" for the mobile shell.
 */
export function localPlayer(state: GameState, localPlayerId: string | null): Player | null {
  if (localPlayerId) {
    return state.players.find((p) => p.id === localPlayerId) ?? null;
  }
  return activePlayer(state) ?? state.players[0] ?? null;
}

/** True when it's the local (human) seat's Errands turn — i.e. they may act. */
export function isLocalPlayersTurn(state: GameState, localPlayerId: string | null): boolean {
  if (!localPlayerId) return activePlayer(state) !== null; // hot-seat: any active turn
  return activePlayer(state)?.id === localPlayerId;
}

/**
 * What, if anything, the AI driver (`useKlankDriver`) should do right now:
 *  - `'prompt'`  — the top pending resolution is owed by a bot seat → answer it.
 *  - `'errands'` — it's a bot seat's Errands turn with no pending prompt → act.
 *  - `'advance'` — an all-bot game is idle in a non-interactive phase → advance.
 *  - `null`      — nothing for the bot to do (a human owns the next decision).
 *
 * Only `'prompt'`/`'errands'` mean a bot "owns the current decision" (used to
 * gate human input). `'advance'` only fires when no human is seated, so it
 * never needs to block anyone. A bot's move that opens a reaction window for a
 * HUMAN yields `null` here (top responder isn't a bot, and there's a pending
 * prompt so the errands branch is skipped), so the human is correctly left to act.
 */
export type BotDecision =
  | { kind: 'prompt'; pending: GameState['pendingResolutionStack'][number] }
  | { kind: 'errands'; playerId: string }
  | { kind: 'advance' };

export function botDecisionContext(state: GameState): BotDecision | null {
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  if (top) {
    const responder = state.players.find((p) => p.id === top.responderId);
    return responder?.controlledByBot ? { kind: 'prompt', pending: top } : null;
  }
  if (state.phase.kind === 'errands') {
    const active = state.players[state.phase.activePlayerIndex];
    return active?.controlledByBot ? { kind: 'errands', playerId: active.id } : null;
  }
  // No pending prompt and not Errands → a non-interactive between-turns phase
  // (Nightfall/resolution, round setup, scoring). Auto-advance it in EVERY mode,
  // not just all-bot games, so a solo player never has to hand-crank the Night
  // phase. Any step that needs a human is a pending resolution, which is handled
  // by the `top` branch above (returns null there and leaves it to them), so
  // this only fires when there is genuinely nothing for anyone to decide.
  if (
    state.phase.kind === 'round-setup' ||
    state.phase.kind === 'resolution' ||
    state.phase.kind === 'mid-game-scoring' ||
    state.phase.kind === 'round-end-scenario' ||
    state.phase.kind === 'final-scoring'
  ) {
    return { kind: 'advance' };
  }
  return null;
}

/** True when a bot owns the current human-blocking decision (prompt or turn). */
export function botOwnsCurrentDecision(state: GameState): boolean {
  const ctx = botDecisionContext(state);
  return ctx?.kind === 'prompt' || ctx?.kind === 'errands';
}

/**
 * True when the LOCAL seat is the one who must act right now: it's owed the top
 * pending prompt, or (no prompt) it's their Errands turn. False while a bot is
 * acting, a bot is owed a prompt, or a between-turns phase (Nightfall, setup,
 * scoring) is auto-resolving with nothing for anyone to decide. The Smart
 * Camera uses this to know when it's safe to drop a drilled-in room sheet so the
 * board — and the follow animation — is visible during someone else's turn.
 */
export function localOwnsCurrentDecision(
  state: GameState,
  localPlayerId: string | null,
): boolean {
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  // Hot-seat (no bound seat): every human turn is "ours", so the camera never
  // force-closes a room the local players opened.
  if (!localPlayerId) return top ? true : activePlayer(state) !== null;
  if (top) return top.responderId === localPlayerId;
  return activePlayer(state)?.id === localPlayerId;
}

/**
 * "Smart Camera" target: the mobile tab the shell should rest on right now.
 * Mirrors the targeting read-model (`usePromptTargets`): a voter prompt lives on
 * the Council tab, a draftable-card prompt on the Offer/Tableau shelf, and
 * everything else on the Campus board.
 *
 * Campus is HOME: it's the default whenever no decision specifically needs
 * another tab — between turns, during a bot's Errands turn, and under any
 * self-contained overlay prompt (option / confirm / spell-level / reaction
 * sheet, which floats above whatever tab is showing). This is what resets the
 * player to the board to "follow the action" after a side-trip to mark a voter
 * or draft a card, instead of stranding them on Council / Tableau.
 *
 * `localPlayerId` makes the draft destination ownership-aware: a Supporter /
 * Vault draft owed to the LOCAL seat points at their own Tableau (where they
 * pick), but one owed to a BOT points at the Rivals tab (where that opponent's
 * growing tableau is visible) — otherwise the camera would jump to the human's
 * own, unchanging tableau while a rival drafts. Omit it to keep the local view.
 */
/** Option ids that mean "decline / take nothing" — never a board target. */
const PASS_OPTION_IDS = new Set(['pass', 'skip', 'none', 'decline', 'no', 'done']);

/** The first "pass / skip" option in a menu, if any (so a board-targeting
 *  banner can still offer a way to decline). */
export function findPassOption(options: ChoiceOption[]): ChoiceOption | undefined {
  return options.find((o) => PASS_OPTION_IDS.has(o.id.toLowerCase()));
}

/**
 * Classifies a `choose-from-options` menu whose every real (non-pass) option id
 * is a Room id or a Player id — those can be answered by clicking the room on
 * the board / the rival's portrait instead of reading a text list. Returns null
 * for any other menu (mixed, resource choices, card drafts, etc.), which keeps
 * the generic sheet. The option id already IS the room / player id, so a click
 * dispatches `option-chosen` with it directly.
 */
export function classifyOptionMenu(
  state: GameState,
  options: ChoiceOption[],
): 'rooms' | 'players' | null {
  // Card-bearing options are handled by the card picker, never here.
  if (options.some((o) => o.cardId)) return null;
  const picky = options.filter((o) => !PASS_OPTION_IDS.has(o.id.toLowerCase()));
  if (picky.length === 0) return null;
  const roomIds = new Set(state.rooms.map((r) => r.id));
  if (picky.every((o) => roomIds.has(o.id))) return 'rooms';
  const playerIds = new Set(state.players.map((p) => p.id));
  if (picky.every((o) => playerIds.has(o.id))) return 'players';
  return null;
}

export function smartCameraFocusTab(
  state: GameState,
  localPlayerId?: string | null,
): MobileTab {
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  if (top) {
    // A draft owed to someone other than the local seat → watch them on Rivals.
    const ownedByRival = localPlayerId != null && top.responderId !== localPlayerId;
    switch (top.prompt.kind) {
      case 'choose-voter':
        return 'council';
      case 'choose-supporter-card':
      case 'choose-peeked-supporter':
      case 'choose-vault-card':
        return ownedByRival ? 'rivals' : 'tableau';
      case 'choose-from-options':
        // Picking a rival (Steal Mana / Take from…) → watch the Rivals rail so
        // their portraits are the tap target. Room menus stay on the board.
        return classifyOptionMenu(state, top.prompt.options) === 'players'
          ? 'rivals'
          : 'campus';
      default:
        // Targeting prompts and self-contained overlays both resolve on / above
        // the board → Campus.
        return 'campus';
    }
  }
  // No pending decision (an Errands turn or a between-turns phase) → Campus.
  return 'campus';
}

/** Action-space ids where `mageId` may legally be placed right now. */
export function eligiblePlacementSlots(
  state: GameState,
  playerId: string,
  mageId: string,
): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  for (const room of state.rooms) {
    for (const space of room.actionSpaces) {
      try {
        applyAction(state, {
          type: 'PLACE_WORKER',
          playerId,
          mageId,
          actionSpaceId: space.id,
        });
        out.add(space.id);
      } catch {
        // Illegal placement — the engine said no; that's the whole check.
      }
    }
  }
  return out;
}

/**
 * Action-space ids where `mageId` may legally SHADOW-place right now — i.e.
 * drop into the slot's shadow position over the (opposing) base occupant.
 * Dry-runs `PLACE_WORKER` with `isShadowing: true`, so it covers Planar
 * Studies Side B ("pay 1 Mana to shadow an opponent on place") as well as any
 * active shadow-on-place buff (Zero Hour / Inversion). Mirrors
 * `eligiblePlacementSlots`; the engine is the source of truth for legality.
 */
export function eligibleShadowPlacementSlots(
  state: GameState,
  playerId: string,
  mageId: string,
): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  for (const room of state.rooms) {
    for (const space of room.actionSpaces) {
      try {
        applyAction(state, {
          type: 'PLACE_WORKER',
          playerId,
          mageId,
          actionSpaceId: space.id,
          isShadowing: true,
        });
        out.add(space.id);
      } catch {
        // Illegal shadow placement — engine said no.
      }
    }
  }
  return out;
}

/**
 * Room ids that contain at least one slot where `mageId` may legally be placed
 * right now (regular OR shadow). Used by the mobile Campus map to glow the
 * rooms a picked-up Mage can be dropped into, and to gate which tiles open.
 */
export function roomPlacementEligibility(
  state: GameState,
  playerId: string,
  mageId: string,
): Set<string> {
  const eligible = eligiblePlacementSlots(state, playerId, mageId);
  const shadow = eligibleShadowPlacementSlots(state, playerId, mageId);
  const rooms = new Set<string>();
  for (const room of state.rooms) {
    if (room.actionSpaces.some((s) => eligible.has(s.id) || shadow.has(s.id))) {
      rooms.add(room.id);
    }
  }
  return rooms;
}

/**
 * A "power placement" lets a Mage drop onto an OCCUPIED base slot (which a
 * normal placement can't): Sorcery Side A's Ars Magna (wound the occupant &
 * take the slot, costs 1 Mana) or Natural Magick Side B's displacement (shove
 * the opponent to another slot in the room & take its place, free). The board
 * uses this to give those occupied-slot targets a distinct border + cost label,
 * separate from ordinary empty-slot placement.
 *
 * Returns null when the mage has no occupied-slot power active. The engine
 * dry-run (`eligiblePlacementSlots`) is still the source of truth for WHICH
 * occupied slots are legal; this only labels the power + its Mana cost.
 */
export type OccupiedSlotPower = {
  /**
   * `ars-magna` — wound & take (1 Mana). `natural-b` — displace & take (free).
   * `choice` — the Archmage's Apprentice has BOTH powers, so taking the slot
   * pops a "wound vs displace" prompt (the engine decides the actual cost).
   */
  kind: 'ars-magna' | 'natural-b' | 'choice';
  manaCost: number;
};

export function selectedMageOccupiedSlotPower(
  state: GameState,
  mage: OwnedMage,
): OccupiedSlotPower | null {
  if (magesLosePowers(state)) return null;
  const arsMagna = colorAbilityActive(state, mage, 'red');
  const naturalB =
    actsAsColor(mage, 'green') && sideForColor(state, 'green') === 'B';
  // The Apprentice can hold both at once — the board flags the overlap so the
  // player knows the click will ask which power to spend (engine-driven).
  if (arsMagna && naturalB) return { kind: 'choice', manaCost: 1 };
  if (arsMagna) return { kind: 'ars-magna', manaCost: 1 };
  if (naturalB) return { kind: 'natural-b', manaCost: 0 };
  return null;
}

/**
 * The action spaces a room should RENDER. Pool rooms — many identical slots
 * pre-allocated by the engine (Great Hall's 10) — collapse to the occupied
 * slots plus EXACTLY ONE open spot, so the room reads as "always one open
 * seat; the next seat appears only once this one is filled." The slots are
 * interchangeable, so even when a prompt offers several open slots as targets
 * (`extraVisibleIds`) we still surface just one — preferring a targeted open
 * slot so targeting always has a visible, clickable seat. Targeted *occupied*
 * slots are shown regardless (they're occupied), so targeting never points at
 * a hidden slot either way.
 */
/**
 * True when a room is a "pool" of many interchangeable seats — the Great
 * Hall's 10 identical slots. These render as a growing tile row (occupied
 * seats + one open seat) rather than a labelled per-slot list, mirroring the
 * Infirmary ward. Rooms with a handful of distinct slots (e.g. the Golem
 * Lab's three) are NOT pools and keep their labelled rows.
 */
export function isPoolRoom(room: Room): boolean {
  const all = room.actionSpaces;
  if (all.length <= 5) return false;
  const sig = (s: ActionSpace) =>
    `${s.slotType}|${s.effectId}|${s.costToActivate?.gold ?? 0}|${s.costToActivate?.mana ?? 0}|${s.costToActivate?.meritBadges ?? 0}`;
  const first = all[0]!;
  return all.every((s) => sig(s) === sig(first));
}

export function visibleRoomSpaces(
  room: Room,
  extraVisibleIds?: Set<string>,
): ActionSpace[] {
  const all = room.actionSpaces;
  if (!isPoolRoom(room)) return all;

  // Occupied (base or shadow) seats always show.
  const occupied = all.filter((s) => s.occupant || s.shadowOccupant);
  // Exactly one open seat: the first targeted open slot if a prompt is
  // pointing at the pool, else the lowest-index open slot.
  const openSlots = all.filter((s) => !s.occupant && !s.shadowOccupant);
  const openToShow =
    openSlots.find((s) => extraVisibleIds?.has(s.id)) ?? openSlots[0];
  const visible = openToShow ? [...occupied, openToShow] : occupied;
  return visible.sort((a, b) => a.index - b.index);
}

/**
 * Research standing for a player: INT/WIS still unspent in the pool
 * ("remaining") versus that plus what's already been placed on spells
 * ("total"). One INT is placed per learned spell; one WIS per unlocked
 * level (L2, L3). Used by the dock and the rival rail.
 */
export function researchTotals(player: Player): {
  intRemaining: number;
  intTotal: number;
  wisRemaining: number;
  wisTotal: number;
} {
  const intRemaining = player.resources.intelligence;
  const wisRemaining = player.resources.wisdom;
  const intPlaced = player.ownedSpells.filter((s) => s.intPlaced).length;
  const wisPlaced = player.ownedSpells.reduce(
    (n, s) => n + (s.wisPlacedLevel2 ? 1 : 0) + (s.wisPlacedLevel3 ? 1 : 0),
    0,
  );
  return {
    intRemaining,
    intTotal: intRemaining + intPlaced,
    wisRemaining,
    wisTotal: wisRemaining + wisPlaced,
  };
}

/** Quick index from mage id → { mage, owner } across all players. */
export function buildMageIndex(
  state: GameState,
): Map<string, { mage: OwnedMage; owner: Player }> {
  const map = new Map<string, { mage: OwnedMage; owner: Player }>();
  for (const owner of state.players) {
    for (const mage of owner.mages) map.set(mage.id, { mage, owner });
  }
  return map;
}

/** Engine PlayerColor → design-system aura hex (docs/UI_DESIGN.md §3.3). */
export const PLAYER_AURA: Record<PlayerColor, string> = {
  red: '#ff6b6b',
  blue: '#4d96ff',
  green: '#6bcb77',
  yellow: '#ffd93d',
  purple: '#b388eb',
  orange: '#ff9f43',
};

/** Department → hue, following the engine's canonical color mapping
 *  (sorcery=red, mysticism=grey, natural-magick=green, planar-studies=purple,
 *  divinity=blue, technomancy=orange). */
export const DEPT_HUE: Record<string, string> = {
  sorcery: '#ff5d5d',
  mysticism: '#9aa0b4',
  'natural-magick': '#5fd068',
  'planar-studies': '#b16cea',
  divinity: '#5aa9e6',
  technomancy: '#ff9f43',
  students: '#e8e4da',
  wild: '#ffd93d',
};

/**
 * What `playerId` would actually pay to cast `level` right now: the printed
 * cost minus the always-on Mana discounts (Power / Inner Fire "spells cheaper"
 * buffs and the Mysticism Side B in-place discount, which floors at 1 per the
 * rulebook). Situational, opponent-imposed surcharges (Energy Drain) and
 * one-shot free-mana flags are deliberately excluded — this is for showing the
 * card's standing cost, highlighting it when a sustained power is shaving it
 * down. Returns `{ printed, effective }`; `effective < printed` means reduced.
 */
export function spellLevelManaDisplay(
  state: GameState,
  playerId: string,
  level: SpellLevel,
): { printed: number; effective: number } {
  const printed = spellLevelBaseManaCost(state, level);
  let effective = Math.max(0, printed - spellManaDiscountFor(state, playerId));
  const mysticism = mysticismInPlaceDiscount(state, playerId);
  if (mysticism > 0 && effective >= 1) {
    effective = Math.max(1, effective - mysticism);
  }
  return { printed, effective };
}

/** Spell levels castable right now, by spell card id (engine dry-run). */
export function castableSpellLevels(
  state: GameState,
  playerId: string,
): Map<string, Set<1 | 2 | 3>> {
  const out = new Map<string, Set<1 | 2 | 3>>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const owned of player.ownedSpells) {
    for (const level of [1, 2, 3] as const) {
      try {
        applyAction(state, {
          type: 'CAST_SPELL',
          playerId,
          spellCardId: owned.cardId,
          level,
        });
        const set = out.get(owned.cardId) ?? new Set<1 | 2 | 3>();
        set.add(level);
        out.set(owned.cardId, set);
      } catch {
        // not castable at this level right now
      }
    }
  }
  return out;
}

/** Vault cards playable right now (engine dry-run). */
export function playableVaultCards(state: GameState, playerId: string): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const v of player.vaultCards) {
    if (out.has(v.cardId)) continue;
    try {
      applyAction(state, { type: 'PLAY_VAULT_CARD', playerId, vaultCardId: v.cardId });
      out.add(v.cardId);
    } catch {
      // not playable right now
    }
  }
  return out;
}

/** Supporters playable right now (engine dry-run). */
export function playableSupporters(state: GameState, playerId: string): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const cardId of player.supporters) {
    if (out.has(cardId)) continue;
    try {
      applyAction(state, { type: 'PLAY_SUPPORTER', playerId, supporterCardId: cardId });
      out.add(cardId);
    } catch {
      // not playable right now
    }
  }
  return out;
}

/** Strips the leading "ACTION_NAME: " prefix from an engine error message. */
function cleanBlockReason(message: string): string {
  const i = message.indexOf(': ');
  return i >= 0 ? message.slice(i + 2).split('\n')[0]! : message.split('\n')[0]!;
}

/**
 * Per-vault-card playability with a reason (engine dry-run). Value is `null`
 * when the card is playable right now, or a short player-facing reason (the
 * engine's rejection message, prefix stripped) when playing it would be
 * illegal or fizzle. Powers the hand's grey-out + "why not?" flash.
 */
export function vaultCardPlayability(
  state: GameState,
  playerId: string,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const v of player.vaultCards) {
    if (out.has(v.cardId)) continue;
    try {
      applyAction(state, { type: 'PLAY_VAULT_CARD', playerId, vaultCardId: v.cardId });
      out.set(v.cardId, null);
    } catch (e) {
      out.set(v.cardId, cleanBlockReason((e as Error).message));
    }
  }
  return out;
}

/** Per-supporter playability with a reason (engine dry-run). See above. */
export function supporterPlayability(
  state: GameState,
  playerId: string,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return out;
  for (const cardId of player.supporters) {
    if (out.has(cardId)) continue;
    try {
      applyAction(state, { type: 'PLAY_SUPPORTER', playerId, supporterCardId: cardId });
      out.set(cardId, null);
    } catch (e) {
      out.set(cardId, cleanBlockReason((e as Error).message));
    }
  }
  return out;
}

/** Bell tower cards claimable right now (engine dry-run). */
export function claimableBellCards(state: GameState, playerId: string): Set<string> {
  const out = new Set<string>();
  if (state.phase.kind !== 'errands') return out;
  if (state.pendingResolutionStack.length > 0) return out;
  for (const card of state.bellTower.available) {
    try {
      applyAction(state, { type: 'CLAIM_BELL_TOWER', playerId, bellTowerCardId: card.id });
      out.add(card.id);
    } catch {
      // not claimable right now
    }
  }
  return out;
}
