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
  HarmfulEffectKind,
  MageColor,
  OwnedMage,
  OwnedMageId,
  Player,
  PlayerId,
  ReactionTriggerEvent,
  ResolutionSource,
  Room,
  RoomId,
  SerializableContext,
  SpellCard,
  SpellCardId,
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
 * Crossing a multiple of 7 IP grants 1 Merit Badge per multiple crossed
 * (rulebook: 7/14/21/...). The check is on the post-increase IP value, so
 * a +14 bump from 0 grants 2 MBs.
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
  const player = state.players.find((p) => p.id === playerId);
  const before = player?.resources.influence ?? 0;
  const after = before + amount;
  const meritBonus =
    amount > 0 ? Math.floor(after / 7) - Math.floor(before / 7) : 0;
  return {
    nextSequenceId: newSeq,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              influence: p.resources.influence + amount,
              meritBadges: p.resources.meritBadges + meritBonus,
            },
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
 * Targeting filter for harmful effects (wound / banish / move / shadow).
 *
 * Per the rulebook (as confirmed by the user):
 *  - Green (Natural Magick) Mages CANNOT BE WOUNDED — that's the only
 *    protection. Green mages can still be banished, moved, and shadowed.
 *    While shadowing, a green mage loses its colour ability anyway.
 *  - Blue (Divinity) Mages owned by an opponent are immune to RIVAL
 *    SPELLS — full stop, regardless of the effect kind (wound, banish,
 *    move, shadow). Blue mages are NOT immune to supporters, vault cards,
 *    or mage abilities. A caster can target their own blue mages with
 *    spells. While shadowing, a blue mage loses its colour ability.
 *  - Shadowing mages are not targetable by default; an effect must opt
 *    in via `includesShadows` to reach them. When included, the shadow's
 *    colour protection no longer applies.
 */
export function buildHarmfulMageTargets(
  state: GameState,
  casterId: PlayerId,
  opts: {
    source: 'spell' | 'non-spell';
    effect: HarmfulEffectKind;
    includesShadows?: boolean;
  },
): OwnedMageId[] {
  const targets: OwnedMageId[] = [];
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind !== 'action-space') continue;
      if (m.isWounded) continue;
      // A locked room prevents any mage inside it from being affected
      // (wounded, banished, moved, shadowed). Mages in locked rooms still
      // perform their Errands at Resolution per the rulebook.
      if (isMageInLockedRoom(state, m.id)) continue;
      // Sustained immunity buffs (Sanctification / Stoneskin / Spell Shield
      // / Wall / Diamondskin) protect the owner's mages.
      if (isMageImmuneByBuff(state, p.id, opts.effect, opts.source)) continue;
      if (m.isShadowing) {
        if (!opts.includesShadows) continue;
        // Shadowing mage loses its colour ability — no protections apply.
        targets.push(m.id);
        continue;
      }
      // Green: wound-immune only. Banish/move/shadow can still target a
      // green mage.
      if (opts.effect === 'wound' && m.color === 'green') continue;
      // Blue: immune to rival spells across all effect kinds.
      if (
        m.color === 'blue' &&
        opts.source === 'spell' &&
        p.id !== casterId
      ) {
        continue;
      }
      targets.push(m.id);
    }
  }
  return targets;
}

/** Returns true when `roomId` is currently locked. */
export function isRoomLocked(state: GameState, roomId: RoomId): boolean {
  return state.roomLocks.some((l) => l.roomId === roomId);
}

/**
 * Returns true when an active immunity buff on `ownerId` protects against
 * `effect` from the given `source`. Used by target builders (Burn, Banish,
 * Move, Shadow) to skip protected mages and by reaction options where
 * applicable.
 *
 * - `'spell'` source: buffs with `source: 'spell'` OR `source: 'any'` apply.
 * - `'non-spell'` source: only buffs with `source: 'any'` apply.
 */
export function isMageImmuneByBuff(
  state: GameState,
  ownerId: PlayerId,
  effect: HarmfulEffectKind,
  source: 'spell' | 'non-spell',
): boolean {
  for (const buff of state.activeBuffs) {
    if (buff.ownerId !== ownerId) continue;
    if (!buff.immuneTo.includes(effect)) continue;
    if (buff.source === 'spell' && source !== 'spell') continue;
    return true;
  }
  return false;
}

/** Returns true when the given action-space sits inside a locked room. */
export function isSpaceInLockedRoom(
  state: GameState,
  spaceId: ActionSpaceId,
): boolean {
  for (const r of state.rooms) {
    if (!r.actionSpaces.some((s) => s.id === spaceId)) continue;
    return isRoomLocked(state, r.id);
  }
  return false;
}

/** Returns true when the mage is currently on a slot in a locked room. */
export function isMageInLockedRoom(
  state: GameState,
  mageId: OwnedMageId,
): boolean {
  const lookup = findMageSlotPosition(state, mageId);
  if (!lookup) return false;
  return isSpaceInLockedRoom(state, lookup.spaceId);
}

/**
 * Patch that adds a room to `state.roomLocks` (no-op if already locked).
 * Locks clear at the start of the Resolution phase.
 */
export function applyRoomLockPatch(
  state: GameState,
  roomId: RoomId,
): GameStatePatch {
  if (state.roomLocks.some((l) => l.roomId === roomId)) return {};
  return { roomLocks: [...state.roomLocks, { roomId }] };
}

/**
 * Wound-targets via a spell. Green mages are wound-immune, opposing blue
 * mages are spell-immune. Used by Burn, Lightning, Gift of Fire, etc.
 */
export function buildBurnTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  return buildHarmfulMageTargets(state, casterId, {
    source: 'spell',
    effect: 'wound',
  });
}

/**
 * Move-targets via a spell (Gust of Wind, Strength of Earth, Zephyr, etc.).
 * Green mages CAN be moved (green is only wound-immune); opposing blue
 * remains spell-immune.
 */
export function buildSpellMoveTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  return buildHarmfulMageTargets(state, casterId, {
    source: 'spell',
    effect: 'move',
  });
}

/**
 * Shadow-targets via a spell (Paralocation, Parallel Synchronicity L1,
 * Shadow Bolt, etc.). Green is shadow-able (green is only wound-immune).
 */
export function buildSpellShadowTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  return buildHarmfulMageTargets(state, casterId, {
    source: 'spell',
    effect: 'shadow',
  });
}

/**
 * Looks up a mage's slot position (base vs shadow) given its current
 * spaceId. Returns null if the mage isn't on a slot. Used by wound /
 * banish / move helpers so they clear the right occupant slot.
 */
export function findMageSlotPosition(
  state: GameState,
  mageId: OwnedMageId,
): { spaceId: ActionSpaceId; position: 'base' | 'shadow' } | null {
  for (const r of state.rooms) {
    for (const s of r.actionSpaces) {
      if (s.occupant?.mageId === mageId) {
        return { spaceId: s.id, position: 'base' };
      }
      if (s.shadowOccupant?.mageId === mageId) {
        return { spaceId: s.id, position: 'shadow' };
      }
    }
  }
  return null;
}

/** Clears the specified position on the matching space. */
function clearSpaceOccupant(
  rooms: Room[],
  spaceId: ActionSpaceId,
  position: 'base' | 'shadow',
): Room[] {
  return rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) =>
      s.id !== spaceId
        ? s
        : position === 'base'
          ? { ...s, occupant: null }
          : { ...s, shadowOccupant: null },
    ),
  }));
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

  const slotLookup = findMageSlotPosition(state, targetMageId);
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

  const rooms: Room[] = slotLookup
    ? clearSpaceOccupant(state.rooms, slotLookup.spaceId, slotLookup.position)
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
 * Banishes a mage: clears its slot (if placed) or its Infirmary entry (if
 * wounded), returns it to its owner's office, and produces a
 * `mage-banished` reaction trigger. Per rulebook, banished mages go back
 * to their owner's mage pool and may be placed again that round. No
 * Infirmary bonus fires (banish never grants the bonus).
 */
export function banishMage(
  state: GameState,
  targetMageId: OwnedMageId,
  byPlayerId: PlayerId,
): { patch: GameStatePatch; triggerEvent: ReactionTriggerEvent } {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) throw new Error(`banishMage: mage ${targetMageId} not found`);
  const { player: owner, mage } = lookup;
  const slotLookup = findMageSlotPosition(state, targetMageId);
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
                  location: { kind: 'office' as const, playerId: owner.id },
                },
          ),
        },
  );
  const rooms: Room[] = slotLookup
    ? clearSpaceOccupant(state.rooms, slotLookup.spaceId, slotLookup.position)
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
 * Banish-targets list. Banish reaches green mages (green is only wound-
 * immune), and reaches into the Infirmary — per rulebook, banish returns
 * the mage to its owner's office regardless of whether they were placed
 * or wounded. Opposing blue mages remain spell-immune.
 */
export function buildBanishTargets(
  state: GameState,
  casterId: PlayerId,
): OwnedMageId[] {
  const targets = buildHarmfulMageTargets(state, casterId, {
    source: 'spell',
    effect: 'banish',
  });
  // Add wounded mages from the Infirmary (only opposing-blue immunity
  // applies; green is wound-immune, not banish-immune, so it can be
  // banished out of the Infirmary too).
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind !== 'infirmary') continue;
      if (m.color === 'blue' && p.id !== casterId) continue;
      targets.push(m.id);
    }
  }
  return targets;
}

/**
 * Non-spell-source targets (supporter cards, vault cards, mage abilities).
 * Defaults to the WOUND effect kind because that's where the bulk of
 * non-spell harmful effects live (Sorcery Ars Magna, Bottled Rage, etc.).
 * Pass an explicit effect kind for non-spell move / banish / shadow.
 */
export function buildNonSpellHarmfulTargets(
  state: GameState,
  casterId: PlayerId,
  effect: HarmfulEffectKind = 'wound',
): OwnedMageId[] {
  return buildHarmfulMageTargets(state, casterId, {
    source: 'non-spell',
    effect,
  });
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
  const fromLookup = findMageSlotPosition(state, targetMageId);
  if (!fromLookup) {
    throw new Error(`moveMageToSpace: ${targetMageId} not found in any slot`);
  }
  const fromSpaceId = fromLookup.spaceId;
  // Moved mages drop their shadowing state — they land in the base position
  // of the target slot.
  const occupancy: WorkerOccupancy = {
    mageId: targetMageId,
    ownerId: owner.id,
    isShadowing: false,
  };
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
                  isShadowing: false,
                  location: { kind: 'action-space' as const, spaceId: toSpaceId },
                },
          ),
        },
  );
  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) => {
      if (s.id === fromSpaceId) {
        return fromLookup.position === 'base'
          ? { ...s, occupant: null }
          : { ...s, shadowOccupant: null };
      }
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
 * Returns a wounded mage from the Infirmary to its owner's Office. Clears
 * `isWounded`. No reaction trigger fires for heals (mirrors `healMageToSpace`).
 */
export function returnMageToOfficePatch(
  state: GameState,
  mageId: OwnedMageId,
): GameStatePatch {
  const lookup = findMageOwner(state, mageId);
  if (!lookup) {
    throw new Error(`returnMageToOfficePatch: mage ${mageId} not found`);
  }
  const { player: owner, mage } = lookup;
  if (mage.location.kind !== 'infirmary') {
    throw new Error(
      `returnMageToOfficePatch: ${mageId} is not in the infirmary`,
    );
  }
  return {
    players: state.players.map((p) =>
      p.id !== owner.id
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : {
                    ...m,
                    isWounded: false,
                    isShadowing: false,
                    location: { kind: 'office' as const, playerId: owner.id },
                  },
            ),
          },
    ),
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
 * Builds a `mage-shadowed` trigger event for the slot of `targetMageId`
 * without mutating any state. Callers use this in conjunction with
 * `placeOfficeMageAsShadow` to actually place the shadowing mage; the
 * target itself is never moved or flagged — per the shadow-system rules,
 * the original (base) mage is unaffected by being shadowed.
 */
export function buildMageShadowedEvent(
  state: GameState,
  targetMageId: OwnedMageId,
  byPlayerId: PlayerId,
): ReactionTriggerEvent {
  const lookup = findMageOwner(state, targetMageId);
  if (!lookup) {
    throw new Error(`buildMageShadowedEvent: mage ${targetMageId} not found`);
  }
  const { player: owner, mage } = lookup;
  if (mage.location.kind !== 'action-space') {
    throw new Error(
      `buildMageShadowedEvent: ${targetMageId} is not on a slot`,
    );
  }
  return {
    kind: 'mage-shadowed',
    mageId: targetMageId,
    ownerId: owner.id,
    byPlayerId,
    spaceId: mage.location.spaceId,
  };
}

/**
 * Places one of a player's office mages into a slot's SHADOW position.
 * Used by Shadow Potion and Phase Steppers / Invisibility Cloak reactions.
 * Throws if the mage isn't in the player's office or the shadow slot is
 * already occupied. Pre-existing base occupant is left alone — the slot
 * now has both positions filled.
 */
export function placeOfficeMageAsShadow(
  state: GameState,
  ownerId: PlayerId,
  mageId: OwnedMageId,
  spaceId: ActionSpaceId,
): GameStatePatch {
  const player = findPlayer(state, ownerId);
  if (!player) throw new Error(`placeOfficeMageAsShadow: player ${ownerId} not found`);
  const mage = player.mages.find((m) => m.id === mageId);
  if (!mage) throw new Error(`placeOfficeMageAsShadow: mage ${mageId} not in owner`);
  if (mage.location.kind !== 'office') {
    throw new Error(`placeOfficeMageAsShadow: mage ${mageId} not in office`);
  }
  const targetRoom = state.rooms.find((r) =>
    r.actionSpaces.some((s) => s.id === spaceId),
  );
  if (!targetRoom) {
    throw new Error(`placeOfficeMageAsShadow: space ${spaceId} not found`);
  }
  const targetSpace = targetRoom.actionSpaces.find((s) => s.id === spaceId)!;
  if (targetSpace.shadowOccupant) {
    throw new Error(`placeOfficeMageAsShadow: shadow slot already occupied`);
  }
  // Shadow placement counts as "placing a mage" — refuse if the room is
  // already at this player's cap. Callers should pre-filter via
  // `isRoomAtPlayerCap` so the user never sees an ineligible option in
  // the prompt; this throw is a safety net.
  if (isRoomAtPlayerCap(state, ownerId, targetRoom.id)) {
    throw new Error(
      `placeOfficeMageAsShadow: ${ownerId} already at per-room cap in ${targetRoom.name}`,
    );
  }
  const occupancy: WorkerOccupancy = {
    mageId,
    ownerId,
    isShadowing: true,
  };
  return {
    players: state.players.map((p) =>
      p.id !== ownerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : {
                    ...m,
                    isShadowing: true,
                    location: { kind: 'action-space' as const, spaceId },
                  },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId ? s : { ...s, shadowOccupant: occupancy },
      ),
    })),
  };
}

/**
 * True if `playerId` has already placed their per-room limit of mages in
 * `roomId` this round. Used to filter eligibility for placement prompts
 * (both base placement and shadow placement) so the player never sees an
 * option that would break the cap. The cap is enforced as well at the
 * placement helpers; this is the eligibility-side filter.
 */
export function isRoomAtPlayerCap(
  state: GameState,
  playerId: PlayerId,
  roomId: string,
): boolean {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  const cap = room.maxMagesPerPlayerPerRound ?? Infinity;
  if (!Number.isFinite(cap)) return false;
  return countPlayerMagesInRoom(state, playerId, roomId) >= cap;
}

/**
 * Counts how many of `playerId`'s mages currently occupy slots inside
 * `roomId` (both base and shadow positions). The per-room cap (e.g.
 * Council Chamber's "1 mage per player per round") is based on this
 * live count, NOT historical placement count: if a mage is wounded or
 * banished out of a capped room, the player may re-place that turn.
 */
export function countPlayerMagesInRoom(
  state: GameState,
  playerId: PlayerId,
  roomId: string,
): number {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return 0;
  let count = 0;
  for (const s of room.actionSpaces) {
    if (s.occupant?.ownerId === playerId) count++;
    if (s.shadowOccupant?.ownerId === playerId) count++;
  }
  return count;
}

/**
 * Places an arbitrary mage (sourced from anywhere — usually post-wound) into
 * a slot's shadow position. Used by Phase Steppers / Invisibility Cloak when
 * reverting a wound to a "shadow at original slot" state. Clears the mage's
 * `isWounded` flag along the way.
 */
export function placeAnyMageAsShadow(
  state: GameState,
  mageId: OwnedMageId,
  ownerId: PlayerId,
  spaceId: ActionSpaceId,
): GameStatePatch {
  const occupancy: WorkerOccupancy = {
    mageId,
    ownerId,
    isShadowing: true,
  };
  return {
    players: state.players.map((p) =>
      p.id !== ownerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : {
                    ...m,
                    isWounded: false,
                    isShadowing: true,
                    location: { kind: 'action-space' as const, spaceId },
                  },
            ),
          },
    ),
    rooms: state.rooms.map((r) => ({
      ...r,
      actionSpaces: r.actionSpaces.map((s) =>
        s.id !== spaceId ? s : { ...s, shadowOccupant: occupancy },
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

type ReactionOptionShape = {
  sourceKind: 'vault-card' | 'supporter' | 'spell' | 'mage-power';
  sourceId: string;
  effectId: string;
  label: string;
  requiresSlotPick?: boolean;
  forMageId?: OwnedMageId;
};

/**
 * Builds reaction options the engine should offer to a responder for a given
 * set of trigger events.
 *
 * For single-event windows (Burn, Lightning, etc.) pass `[event]`. For
 * batch wound/banish spells (Plague, Fireball, Tsunami, Nox, Pestilence,
 * Inferno) pass every affected mage's event — the function returns one
 * option per (reaction card × affected-mage) pair, tagged with `forMageId`
 * so the engine can route the chosen reaction to the chosen target.
 *
 * `gold-payment-pending` doesn't reference a mage, so its options never
 * carry `forMageId`.
 */
export function buildReactionOptionsFor(
  state: GameState,
  responderId: PlayerId,
  events: ReactionTriggerEvent[],
): ReactionOptionShape[] {
  const responder = findPlayer(state, responderId);
  if (!responder) return [];
  const options: ReactionOptionShape[] = [];

  // Auric Catalyst is global to the responder; not a per-mage option.
  for (const event of events) {
    if (
      event.kind === 'gold-payment-pending' &&
      event.payingPlayerId === responderId &&
      playerHasAuricCatalyst(responder)
    ) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.auric-catalyst',
        effectId: 'base.vault.auric-catalyst.react',
        label: 'Play Auric Catalyst (reduce cost to 0)',
      });
      break; // Only one Auric Catalyst option even with multiple events.
    }
  }

  // Bell-tower-last-claimed → Tardy (leader L1) and Stop Time (Temporal
  // Calculus L2). Each is a researched spell on the responder, not exhausted,
  // and affordable. The responder must NOT be the player who claimed.
  for (const event of events) {
    if (event.kind !== 'bell-tower-last-claimed') continue;
    if (event.byPlayerId === responderId) continue;
    const tardy = responder.ownedSpells.find(
      (s) => s.cardId === 'base.spell.tardy',
    );
    if (tardy && !tardy.exhausted && responder.resources.mana >= 1) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.tardy',
        effectId: 'base.spell.tardy.l1.react',
        label: 'Cast Tardy (place a Mage)',
      });
    }
    const stopTime = responder.ownedSpells.find(
      (s) => s.cardId === 'base.spell.temporal-calculus-6th-ed',
    );
    if (
      stopTime &&
      stopTime.intPlaced &&
      stopTime.wisPlacedLevel2 &&
      !stopTime.exhausted &&
      responder.resources.mana >= 3
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.temporal-calculus-6th-ed',
        effectId: 'base.spell.temporal-calculus-6th-ed.l2.react',
        label: 'Cast Stop Time (place 2 Mages)',
      });
    }
    break; // single bell-tower-last-claimed event per window
  }

  // Per-mage harm reactions. For each event that targets one of the
  // responder's mages, attach options labeled with the mage id (so the
  // multi-mage prompt can display "Phase Steppers on alice-mage-2").
  const ownMageEvents = events.filter(
    (event) =>
      (event.kind === 'mage-wounded' ||
        event.kind === 'mage-banished' ||
        event.kind === 'mage-moved' ||
        event.kind === 'mage-shadowed') &&
      event.ownerId === responderId,
  );
  if (ownMageEvents.length === 0) return options;

  const has = (cardId: string, requireRefreshed = false) =>
    responder.vaultCards.some(
      (v) => v.cardId === cardId && (!requireRefreshed || !v.exhausted),
    );
  const hasPhaseSteppers = has('base.vault.phase-steppers');
  const hasInvisibilityCloak = has('base.vault.invisibility-cloak', true);
  const hasShieldPotion = has('base.vault.shield-potion');
  const hasAncientArmor = has('base.vault.ancient-armor', true);
  const hasMysticAmulet = has('base.vault.mystic-amulet', true);

  // When this is a single-mage window we omit `forMageId` so the existing
  // single-event prompt continues to render with unadorned labels.
  const multi = ownMageEvents.length > 1;
  const labelSuffix = (mageId: string) => (multi ? ` on ${mageId}` : '');

  for (const event of ownMageEvents) {
    if (
      event.kind !== 'mage-wounded' &&
      event.kind !== 'mage-banished' &&
      event.kind !== 'mage-moved' &&
      event.kind !== 'mage-shadowed'
    ) {
      continue;
    }
    const isWoundBanishOrMove =
      event.kind === 'mage-wounded' ||
      event.kind === 'mage-banished' ||
      event.kind === 'mage-moved';
    const triggeredByOpponent =
      'byPlayerId' in event && event.byPlayerId !== event.ownerId;
    const mageId = event.mageId;

    // Phase Steppers / Invisibility Cloak send the mage back to its original
    // slot. That's always allowed — even if the room is now locked, the mage
    // was already there before being affected (the lock applies *after* the
    // wound), so the reaction effectively undoes the wound rather than
    // crossing the lock.
    if (isWoundBanishOrMove && hasPhaseSteppers) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.phase-steppers',
        effectId: 'base.vault.phase-steppers.react',
        label: `Play Phase Steppers${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (isWoundBanishOrMove && hasInvisibilityCloak) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.invisibility-cloak',
        effectId: 'base.vault.invisibility-cloak.react',
        label: `Use Invisibility Cloak${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (isWoundBanishOrMove && hasShieldPotion) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.shield-potion',
        effectId: 'base.vault.shield-potion.react',
        label: `Play Shield Potion${labelSuffix(mageId)}`,
        requiresSlotPick: true,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (
      triggeredByOpponent &&
      (event.kind === 'mage-wounded' || event.kind === 'mage-moved') &&
      hasAncientArmor
    ) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.ancient-armor',
        effectId: 'base.vault.ancient-armor.react',
        label: `Use Ancient Armor${labelSuffix(mageId)}`,
        requiresSlotPick: true,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (
      triggeredByOpponent &&
      (event.kind === 'mage-banished' || event.kind === 'mage-shadowed') &&
      hasMysticAmulet
    ) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.mystic-amulet',
        effectId: 'base.vault.mystic-amulet.react',
        label: `Use Mystic Amulet${labelSuffix(mageId)}`,
        requiresSlotPick: true,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }

    // ----- Spell-based reactions -----
    //
    // Wrath of Heaven L1 "Justice": when your mage is moved or shadowed by
    //   an opponent, wound any placed Mage belonging to that opponent.
    //   Cost: 1 Mana. Researched at L1, unexhausted.
    const wrath = responder.ownedSpells.find(
      (s) => s.cardId === 'base.spell.wrath-of-heaven',
    );
    const wrathReady = wrath && wrath.intPlaced && !wrath.exhausted;
    if (
      wrathReady &&
      triggeredByOpponent &&
      (event.kind === 'mage-moved' || event.kind === 'mage-shadowed') &&
      responder.resources.mana >= 1
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.wrath-of-heaven',
        effectId: 'base.spell.wrath-of-heaven.l1.react',
        label: `Cast Justice (wound a mage of the attacker)${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    // Wrath of Heaven L2 "Recompense": when your mage is banished, banish a
    //   Mage of the player who banished it. Cost: 1 Mana. Researched at L2.
    if (
      wrathReady &&
      wrath?.wisPlacedLevel2 &&
      triggeredByOpponent &&
      event.kind === 'mage-banished' &&
      responder.resources.mana >= 1
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.wrath-of-heaven',
        effectId: 'base.spell.wrath-of-heaven.l2.react',
        label: `Cast Recompense (banish a mage of the attacker)${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }

    // Songs of Springtime L1 "Regeneration": when your mage is wounded or
    //   moved, refresh an exhausted Spell or Treasure. Cost: 0 Mana.
    const songs = responder.ownedSpells.find(
      (s) => s.cardId === 'base.spell.songs-of-springtime',
    );
    const songsReady = songs && songs.intPlaced && !songs.exhausted;
    if (
      songsReady &&
      (event.kind === 'mage-wounded' || event.kind === 'mage-moved')
    ) {
      // Only offer if the responder has at least one exhausted spell or treasure.
      const hasExhaustedSpell = responder.ownedSpells.some((sp) => sp.exhausted);
      const hasExhaustedTreasure = responder.vaultCards.some(
        (v) => v.exhausted,
      );
      if (hasExhaustedSpell || hasExhaustedTreasure) {
        options.push({
          sourceKind: 'spell',
          sourceId: 'base.spell.songs-of-springtime',
          effectId: 'base.spell.songs-of-springtime.l1.react',
          label: `Cast Regeneration (refresh a Spell or Treasure)${labelSuffix(mageId)}`,
          ...(multi ? { forMageId: mageId } : {}),
        });
      }
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

/** Returns the card name for a spell id, or the id itself as a fallback. */
export function spellLabel(state: GameState, spellCardId: SpellCardId): string {
  return lookupSpellCardDef(state, spellCardId)?.name ?? spellCardId;
}

/** Returns the SpellCard definition (across active packs) for a spell id, or
 *  `null` if no active pack ships that spell. */
export function lookupSpellCardDef(
  state: GameState,
  spellCardId: SpellCardId,
): SpellCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found =
      pack.spells.find((s) => s.id === spellCardId) ??
      pack.legendarySpells.find((s) => s.id === spellCardId);
    if (found) return found;
  }
  return null;
}

/** Returns true when `spellCardId` is in any active pack's
 *  `legendarySpells` list (covers leader/unique spells AND data-sheet
 *  legendary books). Used by Repeating Hex / Telepathy to filter out
 *  spells that aren't swappable / discardable. */
export function isLegendarySpell(
  state: GameState,
  spellCardId: SpellCardId,
): boolean {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    if (pack.legendarySpells.some((s) => s.id === spellCardId)) return true;
  }
  return false;
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
 * Tableau slots auto-refill from the top of `vaultDeck` whenever a card
 * leaves the tableau (mirroring `spellTableau`'s behavior), so the
 * available offerings stay at 3 until the deck runs dry.
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
  const { tableau, deck } = removeFromVaultTableauWithRefill(state, idx);
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            vaultCards: [...p.vaultCards, { cardId, exhausted: false }],
          },
    ),
    vaultTableau: tableau,
    vaultDeck: deck,
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

  const { tableau, deck } = removeFromVaultTableauWithRefill(state, idx);
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
    vaultTableau: tableau,
    vaultDeck: deck,
  };
}

/**
 * Removes the card at `idx` from the vault tableau and backfills the slot
 * from the top of the vault deck if one's available. Mirrors the
 * spell-tableau auto-refill behavior so vault offerings stay at 3 until
 * the deck is empty (at which point the slot is dropped entirely).
 */
function removeFromVaultTableauWithRefill(
  state: GameState,
  idx: number,
): { tableau: VaultCardId[]; deck: VaultCardId[] } {
  const top = state.vaultDeck[0];
  const deck =
    top !== undefined ? state.vaultDeck.slice(1) : state.vaultDeck;
  const tableau =
    top !== undefined
      ? state.vaultTableau.map((c, i) => (i === idx ? top : c))
      : state.vaultTableau.filter((_, i) => i !== idx);
  return { tableau, deck };
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
  // If the player can play Auric Catalyst, every tableau card is
  // effectively affordable (the catalyst waives gold cost to zero).
  const hasCatalyst = playerHasAuricCatalyst(player);
  const result: VaultCardId[] = [];
  for (const cardId of state.vaultTableau) {
    const def = lookupVaultCardDef(state, cardId);
    if (def && (hasCatalyst || def.goldCost <= player.resources.gold)) {
      result.push(cardId);
    }
  }
  return result;
}

/** True if the player has a non-exhausted Auric Catalyst in their office. */
export function playerHasAuricCatalyst(player: Player): boolean {
  return player.vaultCards.some(
    (v) => v.cardId === 'base.vault.auric-catalyst' && !v.exhausted,
  );
}

/**
 * Applies a vault buy, honoring the buyer's `nextGoldCostWaived` flag if
 * set: in that case 0 gold is deducted (the card is gained for free) and
 * the flag is cleared. Otherwise the regular `applyVaultPurchase` is used.
 */
export function applyVaultPurchaseMaybeWaived(
  state: GameState,
  buyerId: PlayerId,
  vaultCardId: VaultCardId,
): GameStatePatch {
  const buyer = findPlayer(state, buyerId);
  if (!buyer) {
    throw new Error(`applyVaultPurchaseMaybeWaived: buyer ${buyerId} not found`);
  }
  if (!buyer.nextGoldCostWaived) {
    return applyVaultPurchase(state, buyerId, vaultCardId);
  }
  // Waived: clear the flag, skip gold deduction, add the card.
  const card = lookupVaultCardDef(state, vaultCardId);
  if (!card) {
    throw new Error(`applyVaultPurchaseMaybeWaived: ${vaultCardId} not in active packs`);
  }
  const idx = state.vaultTableau.indexOf(vaultCardId);
  if (idx === -1) {
    throw new Error(
      `applyVaultPurchaseMaybeWaived: ${vaultCardId} not in vault tableau`,
    );
  }
  const { tableau, deck } = removeFromVaultTableauWithRefill(state, idx);
  return {
    players: state.players.map((p) =>
      p.id !== buyerId
        ? p
        : {
            ...p,
            nextGoldCostWaived: false,
            vaultCards: [...p.vaultCards, { cardId: vaultCardId, exhausted: false }],
          },
    ),
    vaultTableau: tableau,
    vaultDeck: deck,
  };
}

// ============================================================================
// Spell research — spend 1 Research to draft / move-INT / add-WIS / move-WIS.
// Each helper does the data-model mutation; the prompt-chain plumbing lives
// in `effects/base.ts` under `spawnResearchPrompt` + `spend-research`.
// ============================================================================

/**
 * Builds the "pick an exhausted spell to refresh" prompt. Returns null if
 * the player has no exhausted spells (caller should treat as no-op).
 *
 * Callers supply the resume continuation so they can chain follow-up steps
 * (e.g. "refresh then gain mana"). The chosen optionId is the spell card id,
 * which the caller threads into `refreshOwnedSpellPatch` on resume.
 */
export function buildRefreshOwnedSpellPrompt(
  state: GameState,
  playerId: PlayerId,
  resume: { effectId: string; context: SerializableContext },
  source: ResolutionSource,
): {
  responderId: PlayerId;
  prompt: {
    kind: 'choose-from-options';
    options: { id: string; label: string; payload: Record<string, never> }[];
  };
  resume: { effectId: string; context: SerializableContext };
  source: ResolutionSource;
} | null {
  const player = findPlayer(state, playerId);
  if (!player) return null;
  const exhausted = player.ownedSpells
    .filter((s) => s.exhausted)
    .map((s) => s.cardId);
  if (exhausted.length === 0) return null;
  return {
    responderId: playerId,
    prompt: {
      kind: 'choose-from-options' as const,
      options: exhausted.map((cid) => ({
        id: cid,
        label: `Refresh ${cid}`,
        payload: {},
      })),
    },
    resume,
    source,
  };
}

/**
 * Marks the chosen owned spell as refreshed (`exhausted: false`). No-op if
 * the player doesn't own that spell.
 */
export function refreshOwnedSpellPatch(
  state: GameState,
  playerId: PlayerId,
  spellCardId: SpellCardId,
): GameStatePatch {
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            ownedSpells: p.ownedSpells.map((s) =>
              s.cardId !== spellCardId ? s : { ...s, exhausted: false },
            ),
          },
    ),
  };
}

/**
 * Drafts a spell from the tableau into the player's office: removes it from
 * the tableau (refilling from the top of the spell deck), adds it to the
 * player's ownedSpells with `intPlaced=true`, and deducts 1 INT from their
 * pool. Throws if the card isn't in the tableau or the player has no INT.
 */
export function applyDraftSpell(
  state: GameState,
  playerId: PlayerId,
  spellCardId: SpellCardId,
): GameStatePatch {
  const player = findPlayer(state, playerId);
  if (!player) throw new Error(`applyDraftSpell: player ${playerId} not found`);
  if (player.resources.intelligence < 1) {
    throw new Error('applyDraftSpell: player has no INT available');
  }
  const idx = state.spellTableau.indexOf(spellCardId);
  if (idx === -1) {
    throw new Error(`applyDraftSpell: ${spellCardId} not in spell tableau`);
  }
  // Refill the tableau slot from the top of the deck if possible.
  const top = state.spellDeck[0];
  const nextDeck = top !== undefined ? state.spellDeck.slice(1) : state.spellDeck;
  const nextTableau =
    top !== undefined
      ? state.spellTableau.map((c, i) => (i === idx ? top : c))
      : state.spellTableau.filter((_, i) => i !== idx);
  return {
    spellDeck: nextDeck,
    spellTableau: nextTableau,
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              intelligence: p.resources.intelligence - 1,
            },
            ownedSpells: [
              ...p.ownedSpells,
              {
                cardId: spellCardId,
                intPlaced: true,
                wisPlacedLevel2: false,
                wisPlacedLevel3: false,
                exhausted: false,
              },
            ],
          },
    ),
  };
}

/**
 * Returns a learned spell from the player's office to the bottom of the
 * spell deck and refunds any placed WIS to the player's pool. Used by the
 * "move INT from learned spell to a new spell" research action — the
 * caller is expected to follow up with `applyDraftSpell` for the new card
 * (the moved INT is the new spell's L1 INT). Throws if the spell isn't
 * owned or isn't learned (no INT placed).
 */
export function applyDiscardOwnedSpell(
  state: GameState,
  playerId: PlayerId,
  spellCardId: SpellCardId,
): GameStatePatch {
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new Error(`applyDiscardOwnedSpell: player ${playerId} not found`);
  }
  const owned = player.ownedSpells.find((s) => s.cardId === spellCardId);
  if (!owned) {
    throw new Error(
      `applyDiscardOwnedSpell: ${spellCardId} not in player ownedSpells`,
    );
  }
  if (!owned.intPlaced) {
    throw new Error(`applyDiscardOwnedSpell: ${spellCardId} has no INT placed`);
  }
  const wisRefund =
    (owned.wisPlacedLevel2 ? 1 : 0) + (owned.wisPlacedLevel3 ? 1 : 0);
  return {
    // Card cycles to the BOTTOM of the deck (matches Mystic Lantern policy
    // — no separate spell discard pile).
    spellDeck: [...state.spellDeck, spellCardId],
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: {
              ...p.resources,
              // Both INT and WIS return to the pool. The follow-up draft
              // re-spends 1 INT on the new spell; net INT change is 0.
              // WIS refund is net positive (player keeps any L2/L3 WIS).
              intelligence: p.resources.intelligence + 1,
              wisdom: p.resources.wisdom + wisRefund,
            },
            ownedSpells: p.ownedSpells.filter((s) => s.cardId !== spellCardId),
          },
    ),
  };
}

/**
 * Places 1 WIS from the player's pool onto a learned spell: L2 if the L2
 * slot is empty, else L3. Throws if the player has no WIS, the spell
 * isn't owned, the spell isn't learned, or both L2 and L3 are already
 * filled.
 */
export function applyAddWisToSpell(
  state: GameState,
  playerId: PlayerId,
  spellCardId: SpellCardId,
): GameStatePatch {
  const player = findPlayer(state, playerId);
  if (!player) throw new Error(`applyAddWisToSpell: player ${playerId} not found`);
  if (player.resources.wisdom < 1) {
    throw new Error('applyAddWisToSpell: player has no WIS available');
  }
  const owned = player.ownedSpells.find((s) => s.cardId === spellCardId);
  if (!owned) {
    throw new Error(`applyAddWisToSpell: ${spellCardId} not owned`);
  }
  if (!owned.intPlaced) {
    throw new Error(`applyAddWisToSpell: ${spellCardId} not yet learned (no INT)`);
  }
  if (owned.wisPlacedLevel2 && owned.wisPlacedLevel3) {
    throw new Error(`applyAddWisToSpell: ${spellCardId} already at L3`);
  }
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            resources: { ...p.resources, wisdom: p.resources.wisdom - 1 },
            ownedSpells: p.ownedSpells.map((s) =>
              s.cardId !== spellCardId
                ? s
                : s.wisPlacedLevel2
                  ? { ...s, wisPlacedLevel3: true }
                  : { ...s, wisPlacedLevel2: true },
            ),
          },
    ),
  };
}

/**
 * Moves 1 WIS from the source owned spell (taking the L3 placement first
 * if both L2 and L3 are placed; otherwise L2) to the destination owned
 * spell (placing on L2 if empty, else L3). No pool change. Throws if
 * either side is invalid.
 */
export function applyMoveWisBetweenSpells(
  state: GameState,
  playerId: PlayerId,
  sourceSpellId: SpellCardId,
  destSpellId: SpellCardId,
): GameStatePatch {
  if (sourceSpellId === destSpellId) {
    throw new Error('applyMoveWisBetweenSpells: source and destination match');
  }
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new Error(`applyMoveWisBetweenSpells: player ${playerId} not found`);
  }
  const src = player.ownedSpells.find((s) => s.cardId === sourceSpellId);
  const dst = player.ownedSpells.find((s) => s.cardId === destSpellId);
  if (!src) {
    throw new Error(`applyMoveWisBetweenSpells: source ${sourceSpellId} not owned`);
  }
  if (!dst) {
    throw new Error(`applyMoveWisBetweenSpells: dest ${destSpellId} not owned`);
  }
  if (!src.wisPlacedLevel2 && !src.wisPlacedLevel3) {
    throw new Error('applyMoveWisBetweenSpells: source has no WIS to move');
  }
  if (!dst.intPlaced) {
    throw new Error('applyMoveWisBetweenSpells: dest not yet learned');
  }
  if (dst.wisPlacedLevel2 && dst.wisPlacedLevel3) {
    throw new Error('applyMoveWisBetweenSpells: dest already at L3');
  }
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            ownedSpells: p.ownedSpells.map((s) => {
              if (s.cardId === sourceSpellId) {
                // Take L3 first if present, else L2.
                return s.wisPlacedLevel3
                  ? { ...s, wisPlacedLevel3: false }
                  : { ...s, wisPlacedLevel2: false };
              }
              if (s.cardId === destSpellId) {
                return s.wisPlacedLevel2
                  ? { ...s, wisPlacedLevel3: true }
                  : { ...s, wisPlacedLevel2: true };
              }
              return s;
            }),
          },
    ),
  };
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
      // Locked rooms prevent any mage inside from being affected.
      if (isMageInLockedRoom(state, m.id)) continue;
      // Ars Magna is a non-spell mage power. Buffs with `source: 'any'`
      // block it (Tome of Protection L2 / Heart of the Mountain L3);
      // spell-only buffs don't.
      if (isMageImmuneByBuff(state, p.id, 'wound', 'non-spell')) continue;
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
