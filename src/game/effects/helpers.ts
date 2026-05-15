// Effect-side utility helpers. Used by registered effects to produce patches
// without having to reach into engine internals.

import { getPack } from '../../content/registry';
import type {
  ActionSpace,
  ActionSpaceId,
  Candidate,
  CandidateId,
  ConsortiumVoter,
  ConsortiumVoterId,
  GameState,
  GameStatePatch,
  MageColor,
  OwnedMage,
  OwnedMageId,
  Player,
  PlayerId,
  ReactionTriggerEvent,
  ResolutionSource,
  Room,
  SupporterCard,
  SupporterCardId,
  VaultCard,
  VaultCardId,
  WorkerOccupancy,
} from '../types';

export function findPlayer(state: GameState, playerId: PlayerId): Player | null {
  return state.players.find((p) => p.id === playerId) ?? null;
}

export function findMageOwner(
  state: GameState,
  mageId: OwnedMageId,
): { player: Player; mage: OwnedMage } | null {
  for (const p of state.players) {
    const m = p.mages.find((x) => x.id === mageId);
    if (m) return { player: p, mage: m };
  }
  return null;
}

/**
 * Builds a patch that adds `amount` to one of a player's storable resources.
 * For influence specifically, prefer `bumpInfluencePatch` so the arrival
 * sequence updates correctly.
 */
export function gainResourcePatch(
  state: GameState,
  playerId: PlayerId,
  resource: 'gold' | 'mana' | 'intelligence' | 'wisdom' | 'marks' | 'meritBadges',
  amount: number,
): GameStatePatch {
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, [resource]: p.resources[resource] + amount },
          },
    ),
  };
}

/**
 * Builds a patch that applies multiple resource gains to a single player in
 * one pass. Convenient for slot effects that grant several resources at once
 * (e.g., Training Fields slot 1 — Gain 1 INT AND Gain 1 WIS).
 */
export function gainResourcesPatch(
  state: GameState,
  playerId: PlayerId,
  gains: Partial<{
    gold: number;
    mana: number;
    intelligence: number;
    wisdom: number;
    marks: number;
    meritBadges: number;
  }>,
): GameStatePatch {
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              gold: p.resources.gold + (gains.gold ?? 0),
              mana: p.resources.mana + (gains.mana ?? 0),
              intelligence: p.resources.intelligence + (gains.intelligence ?? 0),
              wisdom: p.resources.wisdom + (gains.wisdom ?? 0),
              marks: p.resources.marks + (gains.marks ?? 0),
              meritBadges: p.resources.meritBadges + (gains.meritBadges ?? 0),
            },
          },
    ),
  };
}

/**
 * Builds a patch that increases a player's influence and updates their
 * `influenceArrivalSeq` to the next sequence value (so they "arrive" at the
 * new IP last, losing tiebreakers to anyone already there).
 *
 * Returns the patch only — it intentionally does NOT bump
 * `state.nextSequenceId`. The caller (engine) does that on apply.
 */
export function bumpInfluencePatch(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): GameStatePatch {
  const newSeq = state.nextSequenceId + 1;
  return {
    nextSequenceId: newSeq,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, influence: p.resources.influence + amount },
            influenceArrivalSeq: newSeq,
          },
    ),
  };
}

/**
 * Builds the reaction responder queue: every player except the trigger
 * source, in clockwise turn order starting from the trigger player + 1.
 */
export function buildReactionQueue(
  state: GameState,
  triggeringPlayerId: PlayerId,
): PlayerId[] {
  const order = state.players.map((p) => p.id);
  const startIdx = order.indexOf(triggeringPlayerId);
  if (startIdx === -1) {
    throw new Error(`buildReactionQueue: triggering player ${triggeringPlayerId} not in state`);
  }
  const queue: PlayerId[] = [];
  for (let i = 1; i < order.length; i++) {
    const id = order[(startIdx + i) % order.length];
    if (id !== undefined) queue.push(id);
  }
  return queue;
}

/**
 * Returns the ids of every Mage that can legally be wounded by Burn L1
 * cast by `casterId`. Filters per rulebook:
 *   - Mage must be on an action space (can't wound a Mage in office / infirmary / banished).
 *   - Already-wounded Mages are skipped.
 *   - Green (Natural Magick) Mages cannot be wounded.
 *   - Blue (Divinity) Mages owned by an opponent are immune to rival spells.
 *     Blue Mages owned by the caster are NOT immune (you can target your own).
 */
export function buildBurnTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  const targets: OwnedMageId[] = [];
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind !== 'action-space') continue;
      if (m.isWounded) continue;
      if (m.color === 'green') continue;
      if (m.color === 'blue' && p.id !== casterId) continue;
      targets.push(m.id);
    }
  }
  return targets;
}

/**
 * Computes a Burn L1 wound: returns the patch (mage moved to infirmary, slot
 * cleared, isWounded set) and the ReactionTriggerEvent to attach to the
 * window the engine will open.
 */
export function woundMage(
  state: GameState,
  targetMageId: OwnedMageId,
  byPlayerId: PlayerId,
): { patch: GameStatePatch; triggerEvent: ReactionTriggerEvent } {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) throw new Error(`woundMage: mage ${targetMageId} not found`);
  const { player: owner, mage } = lookup;

  const originalSpaceId =
    mage.location.kind === 'action-space' ? mage.location.spaceId : null;

  const players = state.players.map((p) =>
    p.id !== owner.id
      ? p
      : {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== targetMageId
              ? m
              : {
                  ...m,
                  isWounded: true,
                  isShadowing: false,
                  location: { kind: 'infirmary' as const },
                },
          ),
        },
  );

  const rooms: Room[] = originalSpaceId
    ? state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== originalSpaceId ? s : { ...s, occupant: null },
        ),
      }))
    : state.rooms;

  return {
    patch: { players, rooms },
    triggerEvent: {
      kind: 'mage-wounded',
      mageId: targetMageId,
      ownerId: owner.id,
      byPlayerId,
      originalSpaceId,
    },
  };
}

/**
 * Banishes a mage: moves it to `{ kind: 'banished' }`, clears the slot it
 * was on, and produces a `mage-banished` reaction trigger. Unlike wounding,
 * banished mages do NOT go to the Infirmary and do NOT grant an Infirmary
 * bonus to their owner.
 */
export function banishMage(
  state: GameState,
  targetMageId: OwnedMageId,
  byPlayerId: PlayerId,
): { patch: GameStatePatch; triggerEvent: ReactionTriggerEvent } {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) throw new Error(`banishMage: mage ${targetMageId} not found`);
  const { player: owner, mage } = lookup;
  const originalSpaceId =
    mage.location.kind === 'action-space' ? mage.location.spaceId : null;
  const players = state.players.map((p) =>
    p.id !== owner.id
      ? p
      : {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== targetMageId
              ? m
              : {
                  ...m,
                  isWounded: false,
                  isShadowing: false,
                  location: { kind: 'banished' as const },
                },
          ),
        },
  );
  const rooms: Room[] = originalSpaceId
    ? state.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((s) =>
          s.id !== originalSpaceId ? s : { ...s, occupant: null },
        ),
      }))
    : state.rooms;
  return {
    patch: { players, rooms },
    triggerEvent: {
      kind: 'mage-banished',
      mageId: targetMageId,
      ownerId: owner.id,
      byPlayerId,
      originalSpaceId,
    },
  };
}

/**
 * Banish-targets list — same filter as Burn (target on a slot, not wounded,
 * not green, opposing blues are immune to rival spells).
 */
export function buildBanishTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  return buildBurnTargets(state, casterId);
}

/**
 * Moves a placed mage from its current action space to another action space.
 * Returns the patch + a `mage-moved` reaction trigger. The caller must
 * validate that the target space is empty and (for in-room moves) that the
 * rooms match. Throws if the mage is not on a slot.
 */
export function moveMageToSpace(
  state: GameState,
  targetMageId: OwnedMageId,
  toSpaceId: ActionSpaceId,
  byPlayerId: PlayerId,
): { patch: GameStatePatch; triggerEvent: ReactionTriggerEvent } {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) throw new Error(`moveMageToSpace: mage ${targetMageId} not found`);
  const { player: owner, mage } = lookup;
  if (mage.location.kind !== 'action-space') {
    throw new Error(`moveMageToSpace: ${targetMageId} is not on a slot`);
  }
  const fromSpaceId = mage.location.spaceId;
  const occupancy: WorkerOccupancy = {
    mageId: targetMageId,
    ownerId: owner.id,
    isShadowing: mage.isShadowing,
  };
  const players = state.players.map((p) =>
    p.id !== owner.id
      ? p
      : {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== targetMageId
              ? m
              : { ...m, location: { kind: 'action-space' as const, spaceId: toSpaceId } },
          ),
        },
  );
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) => {
      if (s.id === fromSpaceId) return { ...s, occupant: null };
      if (s.id === toSpaceId) return { ...s, occupant: occupancy };
      return s;
    }),
  }));
  return {
    patch: { players, rooms },
    triggerEvent: {
      kind: 'mage-moved',
      mageId: targetMageId,
      ownerId: owner.id,
      fromSpaceId,
      toSpaceId,
      byPlayerId,
    },
  };
}

/**
 * Moves a wounded mage from the Infirmary to an empty action space. Clears
 * `isWounded`. No reaction trigger fires for heals.
 */
export function healMageToSpace(
  state: GameState,
  targetMageId: OwnedMageId,
  toSpaceId: ActionSpaceId,
): GameStatePatch {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) throw new Error(`healMageToSpace: mage ${targetMageId} not found`);
  const { player: owner, mage } = lookup;
  if (mage.location.kind !== 'infirmary') {
    throw new Error(`healMageToSpace: ${targetMageId} is not in the infirmary`);
  }
  const occupancy: WorkerOccupancy = {
    mageId: targetMageId,
    ownerId: owner.id,
    isShadowing: false,
  };
  return {
    players: state.players.map((p) =>
      p.id !== owner.id
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== targetMageId
                ? m
                : {
                    ...m,
                    isWounded: false,
                    isShadowing: false,
                    location: { kind: 'action-space' as const, spaceId: toSpaceId },
                  },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id === toSpaceId ? { ...s, occupant: occupancy } : s,
      ),
    })),
  };
}

/**
 * Flags a placed mage as shadowing its current slot (and the slot occupant
 * follows). Used by Paralocation. Does NOT vacate the slot — the mage stays
 * put, just marked as shadowing.
 */
export function shadowMageInPlace(
  state: GameState,
  targetMageId: OwnedMageId,
): GameStatePatch {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) throw new Error(`shadowMageInPlace: mage ${targetMageId} not found`);
  const { player: owner, mage } = lookup;
  if (mage.location.kind !== 'action-space') {
    throw new Error(`shadowMageInPlace: ${targetMageId} is not on a slot`);
  }
  const spaceId = mage.location.spaceId;
  return {
    players: state.players.map((p) =>
      p.id !== owner.id
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== targetMageId ? m : { ...m, isShadowing: true },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId || !s.occupant
          ? s
          : { ...s, occupant: { ...s.occupant, isShadowing: true } },
      ),
    })),
  };
}

/**
 * Finds the room (and the specific space inside it) for a given space id.
 * Used by spell effects that need to constrain a follow-up choice to the
 * same room (e.g., Strength of Earth: move-in-same-room).
 */
export function findRoomBySpaceId(
  state: GameState,
  spaceId: ActionSpaceId,
): Room | null {
  for (const r of state.rooms) {
    if (r.actionSpaces.some((s) => s.id === spaceId)) return r;
  }
  return null;
}

/**
 * Builds reaction options the engine should offer to a responder for a given
 * trigger event. Today the only base-game reactor is Phase Steppers; expansions
 * will extend this list.
 */
export function buildReactionOptionsFor(
  state: GameState,
  responderId: PlayerId,
  event: ReactionTriggerEvent,
): {
  sourceKind: 'vault-card' | 'supporter' | 'spell' | 'mage-power';
  sourceId: string;
  effectId: string;
  label: string;
}[] {
  const responder = findPlayer(state, responderId);
  if (!responder) return [];
  const options: ReturnType<typeof buildReactionOptionsFor> = [];

  // Phase Steppers reacts to your own Mage being wounded / banished / moved.
  const isMageEvent =
    event.kind === 'mage-wounded' ||
    event.kind === 'mage-banished' ||
    event.kind === 'mage-moved';
  if (isMageEvent && event.ownerId === responderId) {
    const hasPhaseSteppers = responder.vaultCards.some(
      (v) => v.cardId === 'base.vault.phase-steppers',
    );
    if (hasPhaseSteppers) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.phase-steppers',
        effectId: 'base.vault.phase-steppers.react',
        label: 'Play Phase Steppers',
      });
    }
  }

  return options;
}

export function describeSpaceSource(
  spaceId: string,
  roomName: string,
  side: 'A' | 'B',
  spaceIndex: number,
  ownerId: PlayerId,
): ResolutionSource {
  return {
    kind: 'room-action',
    id: spaceId,
    triggeringPlayerId: ownerId,
    description: `${roomName} (${side}) — slot ${spaceIndex + 1}`,
  };
}

// ============================================================================
// Vault helpers
// ============================================================================

export function lookupVaultCardDef(
  state: GameState,
  cardId: VaultCardId,
): VaultCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.vaultCards.find((c) => c.id === cardId);
    if (found) return found;
  }
  return null;
}

export function lookupSupporterCardDef(
  state: GameState,
  cardId: SupporterCardId,
): SupporterCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.supporters.find((s) => s.id === cardId);
    if (found) return found;
  }
  return null;
}

export function findActionSpace(
  state: GameState,
  spaceId: ActionSpaceId,
): { room: Room; space: ActionSpace } | null {
  for (const r of state.rooms) {
    const s = r.actionSpaces.find((sp) => sp.id === spaceId);
    if (s) return { room: r, space: s };
  }
  return null;
}

/**
 * Builds the patch to apply when a player buys a Vault card from the tableau:
 * deduct gold, add the card to the player's vault cards, remove the card
 * from the tableau. Throws if the player can't afford or the card is missing
 * from the tableau.
 *
 * Tableau slots are NOT auto-refilled here — Argent's tableau is refreshed
 * during round-setup, not after every purchase.
 */
/**
 * Drafts a Vault card from the tableau into a player's office. Same as a
 * purchase but with no gold cost — used by Vault A slot 1 ("Draft a Vault
 * Card AND Gain 4 Gold") and Vault A slot 2's draft branch.
 *
 * Tableau slots are NOT auto-refilled — refresh happens at round-setup.
 */
export function applyVaultDraft(
  state: GameState,
  playerId: PlayerId,
  cardId: VaultCardId,
): GameStatePatch {
  const idx = state.vaultTableau.indexOf(cardId);
  if (idx === -1) {
    throw new Error(`vault draft: ${cardId} not in vault tableau`);
  }
  if (!lookupVaultCardDef(state, cardId)) {
    throw new Error(`vault draft: ${cardId} not in active packs`);
  }
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
          },
    ),
    vaultTableau: [
      ...state.vaultTableau.slice(0, idx),
      ...state.vaultTableau.slice(idx + 1),
    ],
  };
}

export function applyVaultPurchase(
  state: GameState,
  playerId: PlayerId,
  cardId: VaultCardId,
): GameStatePatch {
  const card = lookupVaultCardDef(state, cardId);
  if (!card) throw new Error(`vault purchase: ${cardId} not in active packs`);
  const player = findPlayer(state, playerId);
  if (!player) throw new Error(`vault purchase: player ${playerId} not found`);
  const idx = state.vaultTableau.indexOf(cardId);
  if (idx === -1) {
    throw new Error(`vault purchase: ${cardId} not in vault tableau`);
  }
  if (player.resources.gold < card.goldCost) {
    throw new Error(
      `vault purchase: insufficient gold (need ${card.goldCost}, have ${player.resources.gold})`,
    );
  }

  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, gold: p.resources.gold - card.goldCost },
            vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
          },
    ),
    vaultTableau: [
      ...state.vaultTableau.slice(0, idx),
      ...state.vaultTableau.slice(idx + 1),
    ],
  };
}

/**
 * Returns vault tableau cards the given player can currently afford. Used to
 * filter the `choose-vault-card` prompt at "Gain a Buy" slots — the player
 * must pay the card's gold cost, so insolvent options are filtered out.
 */
export function affordableVaultCards(
  state: GameState,
  playerId: PlayerId,
): VaultCardId[] {
  const player = findPlayer(state, playerId);
  if (!player) return [];
  const result: VaultCardId[] = [];
  for (const cardId of state.vaultTableau) {
    const def = lookupVaultCardDef(state, cardId);
    if (def && def.goldCost <= player.resources.gold) result.push(cardId);
  }
  return result;
}

// ============================================================================
// Marks, Supporters, Secret Supporters
// ============================================================================

/**
 * Returns voters the player is still allowed to place a Mark on — i.e., the
 * subset of `state.voters` they haven't already marked. Used to filter the
 * `choose-voter` prompt presented for every "Gain a Mark" effect.
 */
export function eligibleVotersForMark(
  state: GameState,
  playerId: PlayerId,
): ConsortiumVoter[] {
  return state.voters.filter(
    (v) =>
      !state.voterMarks.some(
        (m) => m.voterId === v.id && m.playerId === playerId,
      ),
  );
}

/**
 * Places a Mark for a player on a Voter. Records the placement in
 * `voterMarks` and bumps the player's `marks` resource (which is what the
 * "Most Marks" voter scores).
 *
 * Per the rulebook, a player can hold at most one Mark on any given Voter.
 * Throws if the player already has a mark on this voter.
 */
export function applyGainMark(
  state: GameState,
  playerId: PlayerId,
  voterId: ConsortiumVoterId,
): GameStatePatch {
  if (
    state.voterMarks.some((m) => m.voterId === voterId && m.playerId === playerId)
  ) {
    throw new Error(
      `applyGainMark: ${playerId} already has a mark on ${voterId}`,
    );
  }
  return {
    voterMarks: [...state.voterMarks, { voterId, playerId }],
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, marks: p.resources.marks + 1 },
          },
    ),
  };
}

/**
 * Drafts a supporter card from the tableau into a player's office. Returns a
 * patch that moves the card and pulls it from the tableau (no payment, like
 * vault drafts). Throws if the card isn't in the tableau.
 */
/**
 * Performs a "Swap N Gold for a {color} Mage from the supply" trade. Returns
 * the patch on success, or `null` if any precondition fails (insufficient gold,
 * empty pool of that color, or the player is already at the 2-per-color cap).
 *
 * The cap matches the DRAFT_MAGE rule in `handleDraftMage` — no player may
 * own more than 2 of a single color, including leader color.
 */
export function applyGoldForMageSwap(
  state: GameState,
  playerId: PlayerId,
  color: MageColor,
  goldCost: number,
): GameStatePatch | null {
  const player = findPlayer(state, playerId);
  if (!player) return null;
  if (player.resources.gold < goldCost) return null;
  const pool = state.mageDraftPool[color] ?? 0;
  if (pool <= 0) return null;
  const ownedOfColor = player.mages.filter((m) => m.color === color).length;
  if (ownedOfColor >= 2) return null;
  const seq = state.nextSequenceId;
  return {
    nextSequenceId: seq + 1,
    mageDraftPool: { ...state.mageDraftPool, [color]: pool - 1 },
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              gold: p.resources.gold - goldCost,
            },
            mages: [
              ...p.mages,
              {
                id: `m-${seq}`,
                cardId: MAGE_CARD_BY_COLOR[color],
                color,
                location: { kind: 'office' as const, playerId },
                isShadowing: false,
                isWounded: false,
              },
            ],
          },
    ),
  };
}

export function applySupporterDraft(
  state: GameState,
  playerId: PlayerId,
  cardId: SupporterCardId,
): GameStatePatch {
  if (!state.supporterTableau.includes(cardId)) {
    throw new Error(`supporter draft: ${cardId} not in supporter tableau`);
  }
  // Familiars (passive timing) can't be played as actions — they go straight
  // to the discard pile, where they still count for endgame scoring.
  const card = lookupSupporterCardDef(state, cardId);
  const isPassive = card?.timing === 'passive';
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : isPassive
          ? {
              ...p,
              personalDiscard: [
                ...p.personalDiscard,
                { kind: 'supporter' as const, cardId },
              ],
            }
          : { ...p, supporters: [...p.supporters, cardId] },
    ),
    supporterTableau: state.supporterTableau.filter((c) => c !== cardId),
  };
}

/**
 * Draws the top card of the supporter deck into the player's personal
 * discard as a Secret Supporter (face-down — opponents may not peek). Returns
 * an empty patch if the deck is empty.
 *
 * Per rulebook: secret supporters still count toward "Most Supporters" voter
 * scoring; `Player.personalDiscard` already includes them in `countSupporters`.
 */
export function applySecretSupporterDraw(
  state: GameState,
  playerId: PlayerId,
): GameStatePatch {
  if (state.supporterDeck.length === 0) return {};
  const top = state.supporterDeck[0];
  if (top === undefined) return {};
  return {
    supporterDeck: state.supporterDeck.slice(1),
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            personalDiscard: [
              ...p.personalDiscard,
              { kind: 'secret-supporter', cardId: top },
            ],
          },
    ),
  };
}

// ============================================================================
// Infirmary on-wound bonus (per the room file)
// ============================================================================
//
// "Gain a bonus when one of your mages is sent here by an opponent. Choose
// one of: 2 Gold / 1 Mana / 1 IP."
//
// Critical timing: this bonus fires AFTER the reaction window resolves, so
// Phase Steppers (which un-wounds) suppresses it. The check runs against the
// post-reaction state — if the mage is no longer wounded / no longer in the
// infirmary, no bonus.

type WoundEvent = Extract<ReactionTriggerEvent, { kind: 'mage-wounded' }>;

/** Whether the wounded player should be prompted for the Infirmary bonus. */
export function checkInfirmaryBonusApplies(
  state: GameState,
  event: ReactionTriggerEvent,
): event is WoundEvent {
  if (event.kind !== 'mage-wounded') return false;
  if (event.byPlayerId === event.ownerId) return false; // self-inflicted: no bonus
  const lookup = findMageOwner(state, event.mageId);
  if (!lookup) return false;
  if (!lookup.mage.isWounded) return false;
  if (lookup.mage.location.kind !== 'infirmary') return false;
  return true;
}

/**
 * Applies the chosen bonus to the recipient. Called by both the system
 * resume effect (Burn L1's case) and inline from chained resumes that need
 * to compose with follow-up steps (Ars Magna's case).
 */
export function applyInfirmaryBonusPatch(
  state: GameState,
  recipientId: PlayerId,
  optionId: string,
): GameStatePatch {
  switch (optionId) {
    case 'gold':
      return gainResourcePatch(state, recipientId, 'gold', 2);
    case 'mana':
      return gainResourcePatch(state, recipientId, 'mana', 1);
    case 'ip':
      return bumpInfluencePatch(state, recipientId, 1);
    default:
      throw new Error(`Infirmary bonus: unknown option "${optionId}"`);
  }
}

// ============================================================================
// Candidate / Mage allocation helpers
// ============================================================================

/** Maps each Mage piece color to the Mage *card* id in the base pack. */
export const MAGE_CARD_BY_COLOR: Record<MageColor, string> = {
  red: 'base.mage.sorcery',
  grey: 'base.mage.mysticism',
  green: 'base.mage.natural-magick',
  purple: 'base.mage.planar-studies',
  blue: 'base.mage.divinity',
  'off-white': 'base.mage.neutral',
};

export function lookupCandidate(
  state: GameState,
  candidateId: CandidateId,
): Candidate | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.candidates.find((c) => c.id === candidateId);
    if (found) return found;
  }
  return null;
}

/**
 * Builds a new GameState that applies the candidate's starting allocation
 * to the given player:
 *   - 2 Mages of the leader's color (or 2 neutral for Students leaders).
 *     These Mages come out of the shared `mageDraftPool` — the leader's
 *     color count is decremented by 2.
 *   - The candidate's unique starter Spell as a fully-researched OwnedSpell
 *     (intPlaced: true, exhausted: false).
 *   - +1 Merit Badge if `startingExtraMeritBadge` is set.
 *
 * Additional Mages are NOT allocated here — they come from the mage draft
 * phase that runs after every player has chosen their candidate.
 *
 * Mints fresh OwnedMage ids from `state.nextSequenceId`, which is bumped to
 * stay deterministic across replays.
 */
export function applyCandidateAllocation(
  state: GameState,
  playerId: PlayerId,
  candidate: Candidate,
): GameState {
  const leaderColor: MageColor =
    candidate.startingMageColor === 'neutral'
      ? 'off-white'
      : candidate.startingMageColor;
  const leaderCardId = MAGE_CARD_BY_COLOR[leaderColor];

  const poolNow = state.mageDraftPool[leaderColor] ?? 0;
  if (poolNow < 2) {
    throw new Error(
      `applyCandidateAllocation: not enough ${leaderColor} mages in pool ` +
        `(have ${poolNow}, need 2)`,
    );
  }

  let seq = state.nextSequenceId;
  const newMages: OwnedMage[] = [];
  for (let i = 0; i < 2; i++) {
    newMages.push({
      id: `m-${seq++}`,
      cardId: leaderCardId,
      color: leaderColor,
      location: { kind: 'office', playerId },
      isShadowing: false,
      isWounded: false,
    });
  }

  return {
    ...state,
    nextSequenceId: seq,
    mageDraftPool: { ...state.mageDraftPool, [leaderColor]: poolNow - 2 },
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            candidateId: candidate.id,
            candidateStartingSpellId: candidate.starterSpellId,
            mages: newMages,
            ownedSpells: [
              {
                cardId: candidate.starterSpellId,
                intPlaced: true,
                wisPlacedLevel2: false,
                wisPlacedLevel3: false,
                exhausted: false,
              },
            ],
            resources: candidate.startingExtraMeritBadge
              ? {
                  ...p.resources,
                  meritBadges: p.resources.meritBadges + 1,
                }
              : p.resources,
          },
    ),
  };
}

/**
 * Builds a snake-style draft order: each player picks 3 times total, going
 * forward in round 1, reverse in round 2, forward in round 3.
 *
 *   2p, firstPickerIdx=0:  [0, 1, 1, 0, 0, 1]
 *   4p, firstPickerIdx=2:  [2, 3, 0, 1, 1, 0, 3, 2, 2, 3, 0, 1]
 *
 * Round 2 reversing the round-1 order is what makes it a "snake".
 */
export function buildSnakeDraftOrder(
  playerCount: number,
  firstPickerIdx: number,
): number[] {
  const order: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < playerCount; i++) {
      const offset = r % 2 === 0 ? i : playerCount - 1 - i;
      order.push((firstPickerIdx + offset) % playerCount);
    }
  }
  return order;
}

// ============================================================================
// Ars Magna (Red Mage power) helpers
// ============================================================================

/**
 * Eligible targets for the Sorcery Mage's Ars Magna ability. Filters per
 * rulebook: target must be on an action space (you're taking that slot),
 * not green (immune), not an opposing blue (Divinity immunity), not the
 * caster's own mage, not already wounded.
 */
export function buildArsMagnaTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  const targets: OwnedMageId[] = [];
  for (const p of state.players) {
    if (p.id === casterId) continue; // Can't target your own mages.
    for (const m of p.mages) {
      if (m.location.kind !== 'action-space') continue;
      if (m.isWounded) continue;
      if (m.color === 'green') continue;
      if (m.color === 'blue') continue; // Always opposing here.
      targets.push(m.id);
    }
  }
  return targets;
}

/**
 * Whether a red (Sorcery) mage can use Ars Magna to take the given space
 * by wounding its current occupant. The data-sheet rule is:
 *   "Spend 1 Mana when placing this Mage to Wound an opponent's Mage and
 *    take its place."
 *
 * Returns true when:
 *   - the caster owns at least 1 Mana,
 *   - the space is currently occupied,
 *   - the occupant belongs to a different player,
 *   - the occupant's mage isn't green (immune), blue (Divinity immunity),
 *     or already wounded.
 */
export function canArsMagnaTakeSpace(
  state: GameState,
  casterId: PlayerId,
  space: ActionSpace,
): boolean {
  if (!space.occupant) return false;
  if (space.occupant.ownerId === casterId) return false;
  const caster = findPlayer(state, casterId);
  if (!caster) return false;
  if (caster.resources.mana < 1) return false;
  const targetLookup = findMageOwner(state, space.occupant.mageId);
  if (!targetLookup) return false;
  const { mage: target } = targetLookup;
  if (target.isWounded) return false;
  if (target.color === 'green') return false;
  if (target.color === 'blue') return false;
  return true;
}
