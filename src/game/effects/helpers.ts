// Effect-side utility helpers. Used by registered effects to produce patches
// without having to reach into engine internals.

import { getPack } from '../../content/registry';
import { getScenario } from '../../content/scenarios';
import type {
  ActionSpace,
  ActionSpaceId,
  Candidate,
  CandidateId,
  ChoiceOption,
  ConsortiumVoter,
  ConsortiumVoterId,
  Department,
  GameState,
  GameStatePatch,
  HarmfulEffectKind,
  InfirmaryBedId,
  MageAbilitySide,
  MageColor,
  MarkSupportOption,
  VoterHitOption,
  OwnedMage,
  OwnedMageId,
  OwnedSpell,
  PendingPrompt,
  PendingResolution,
  PendingResolutionInput,
  Player,
  PlayerId,
  ReactionTriggerEvent,
  ResolutionAnswer,
  ResolutionSource,
  Room,
  RoomId,
  SerializableContext,
  SerializableValue,
  SpellCard,
  SpellCardId,
  SpellLevel,
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
    /**
     * When true, colour-based Mage powers (green wound-immunity, blue
     * spell-immunity) are ignored, so those mages are still targetable.
     * Sustained buff immunities (Sanctification etc.) and locked rooms are
     * still respected — those aren't Mage powers. Used by Devastation Now L3
     * ("ignoring Mage powers").
     */
    ignorePowers?: boolean;
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
      // Shadow effects need an open shadow position above the target's base.
      // Rooms flagged `noShadowSlots` (Great Hall, Golem Lab) have none, so
      // their occupants can never be shadowed.
      if (opts.effect === 'shadow') {
        const sid = m.location.spaceId;
        const room = state.rooms.find((r) =>
          r.actionSpaces.some((s) => s.id === sid),
        );
        if (room?.noShadowSlots) continue;
      }
      // Sustained immunity buffs (Sanctification / Stoneskin / Spell Shield
      // / Wall / Diamondskin) protect the owner's mages.
      if (isMageImmuneByBuff(state, p.id, opts.effect, opts.source)) continue;
      if (m.isShadowing) {
        if (!opts.includesShadows) continue;
        // Shadowing mage loses its colour ability — no protections apply.
        targets.push(m.id);
        continue;
      }
      // "Ignoring Mage powers" (Devastation Now L3) drops every colour-based
      // protection — green and blue are both targetable.
      if (opts.ignorePowers) {
        targets.push(m.id);
        continue;
      }
      // Under Mesmerize ("all mages lose their powers"), colour-based
      // protections drop EXCEPT for blue's spell-immunity. Otherwise:
      //   Green is wound-immune only.
      //   Blue is immune to opposing spells across all effect kinds.
      const powersLost = magesLosePowers(state);
      // The Archmage's Apprentice acts as every colour, so it picks up
      // green's wound-immunity and blue's spell-immunity too.
      if (
        !powersLost &&
        opts.effect === 'wound' &&
        colorAbilityActive(state, m, 'green')
      ) {
        continue;
      }
      if (
        colorAbilityActive(state, m, 'blue') &&
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
    if (buff.kind !== 'mage-immunity') continue;
    if (buff.ownerId !== ownerId) continue;
    if (!buff.immuneTo.includes(effect)) continue;
    if (buff.source === 'spell' && source !== 'spell') continue;
    return true;
  }
  return false;
}

/**
 * Returns true when a Mesmerize-style global buff is active. While true,
 * every mage colour except Divinity (blue) acts as a neutral mage:
 *   - Green loses its wound-immunity
 *   - Purple loses fast-action placement
 *   - Red cannot trigger Ars Magna
 *   - Grey loses post-cast Mysticism placement
 *
 * Blue mages keep their opposing-spell immunity per the spell's
 * "except those immune to Spells" clause.
 */
export function magesLosePowers(state: GameState): boolean {
  return state.activeBuffs.some((b) => b.kind === 'mages-lose-powers');
}

/**
 * Returns true when a Malaise-style global buff is active. While true,
 * NO player may execute a PLACE_WORKER action (base or shadow) — Malaise
 * affects the caster too. The grey Mysticism post-cast placement prompt
 * is also suppressed because it would have no legal slot to target.
 */
export function placementsBlocked(state: GameState): boolean {
  return state.activeBuffs.some((b) => b.kind === 'placements-blocked');
}

/**
 * Returns true when a Silence-style global buff is active. While true, NO
 * player may execute a CAST_SPELL action — Silence affects the caster too.
 * Reaction-timing spells fired from a reaction window remain allowed.
 */
export function spellsBlocked(state: GameState): boolean {
  return state.activeBuffs.some((b) => b.kind === 'spells-blocked');
}

/**
 * Returns the total mana-cost discount on spells cast by `playerId`,
 * summing every active `spells-cheaper` buff scoped to that player.
 */
export function spellManaDiscountFor(
  state: GameState,
  playerId: PlayerId,
): number {
  let total = 0;
  for (const b of state.activeBuffs) {
    if (b.kind !== 'spells-cheaper') continue;
    if (b.casterPlayerId !== playerId) continue;
    total += b.discount;
  }
  return total;
}

/**
 * Mysticism Side B ("In-Place"): while one of the player's grey Mages sits in
 * a University slot other than the Infirmary, that player's Spells cost 1 less
 * Mana (the engine applies the rulebook "minimum of one" floor at the cost
 * site). Returns the flat 1-Mana discount (it does not stack across multiple
 * placed grey Mages), or 0 when Mysticism is on Side A, the power is suppressed
 * (Mesmerize), or no qualifying grey Mage is placed. Shadowing grey Mages lose
 * their colour ability, so they don't qualify.
 */
export function mysticismInPlaceDiscount(
  state: GameState,
  playerId: PlayerId,
): number {
  if (sideForColor(state, 'grey') !== 'B') return 0;
  if (magesLosePowers(state)) return 0;
  const player = findPlayer(state, playerId);
  if (!player) return 0;
  const hasPlacedGrey = player.mages.some(
    (m) =>
      actsAsColor(m, 'grey') &&
      m.location.kind === 'action-space' &&
      !m.isShadowing,
  );
  return hasPlacedGrey ? 1 : 0;
}

/**
 * Base printed Mana cost of a spell level BEFORE discounts/surcharges. Most
 * levels are a fixed number; a level with `manaCostKind: 'opponents'` costs X,
 * the number of opponents in the game (total players − 1) — e.g. Energy Drain
 * (Thirteen Greater Mysteries L3).
 */
export function spellLevelBaseManaCost(
  state: GameState,
  level: SpellLevel,
): number {
  if (level.manaCostKind === 'opponents') {
    return Math.max(0, state.players.length - 1);
  }
  return level.manaCost;
}

/**
 * Returns the active Energy Drain buffs owned by OPPONENTS of `playerId` —
 * each one adds its `surcharge` to the player's spell costs and routes
 * that mana to its `casterPlayerId`. Caster's own buff doesn't apply to
 * themselves.
 */
export function spellManaSurchargesAgainst(
  state: GameState,
  playerId: PlayerId,
): { casterPlayerId: PlayerId; amount: number }[] {
  const out: { casterPlayerId: PlayerId; amount: number }[] = [];
  for (const b of state.activeBuffs) {
    if (b.kind !== 'energy-drain') continue;
    if (b.casterPlayerId === playerId) continue;
    out.push({ casterPlayerId: b.casterPlayerId, amount: b.surcharge });
  }
  return out;
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

/**
 * THE canonical "put a mage on a slot" primitive — every place / move /
 * reposition routes through it so a mage's `location` and the slot
 * `occupant` / `shadowOccupant` can never desync:
 *   - clears the mage's CURRENT slot, if any (a reposition leaves no stale
 *     reference and never lands on two slots);
 *   - sets `location` + `isShadowing` and clears `isWounded` (a slotted mage is
 *     never wounded — its infirmary bed frees automatically, being derived from
 *     `location`);
 *   - fills the destination base/shadow position.
 *
 * Throws if the destination position is already held by a DIFFERENT mage — that
 * would orphan the previous occupant (the bug class this primitive prevents).
 * Callers that might target an occupied position (reaction repositions) must
 * check `slotPositionHeldBy` first and fizzle.
 *
 * The **Technomancy "upon placement"** Mage power is the one hook centralised
 * here, via `firesTechnomancy` (opt-in, since this primitive also backs MOVE /
 * reposition / re-shadow, which are NOT placements). Set it for a genuine PLACE —
 * a mage entering a slot from off the board — and it fires for BOTH base and
 * shadow placements: a shadowing mage keeps its colour power (only green's
 * wound-immunity and blue's spell-immunity drop in a shadow slot). It is skipped
 * when `suppressMagePowers` is set (Stop / Slow Time, Great Hall). Other
 * side-effects (instant-room reward, Adventuring-B draft prompt, per-room caps,
 * card disposal) still live in the wrappers — the engine orders the Adventuring-B
 * prompt relative to the instant-room prompt, so it can't move in here.
 */
export function placeMageOnSlot(
  state: GameState,
  args: {
    mageId: OwnedMageId;
    ownerId: PlayerId;
    spaceId: ActionSpaceId;
    asShadow: boolean;
    /** Fire the Technomancy on-place trigger (genuine PLACE, base or shadow). */
    firesTechnomancy?: boolean;
    /** A "place without Mage powers" placement — skips Technomancy even when
     *  `firesTechnomancy` is set (Stop / Slow Time, Great Hall). */
    suppressMagePowers?: boolean;
  },
): GameStatePatch {
  const { mageId, ownerId, spaceId, asShadow } = args;
  const target = state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.id === spaceId);
  if (!target) throw new Error(`placeMageOnSlot: space ${spaceId} not found`);
  const existing = asShadow ? target.shadowOccupant : target.occupant;
  if (existing && existing.mageId !== mageId) {
    throw new Error(
      `placeMageOnSlot: ${spaceId} ${asShadow ? 'shadow' : 'base'} position already held by ${existing.mageId}`,
    );
  }
  // Clear the mage's current slot (if any) so a reposition leaves no stale ref.
  const origin = findMageSlotPosition(state, mageId);
  let rooms = state.rooms;
  const targetPos: 'base' | 'shadow' = asShadow ? 'shadow' : 'base';
  if (origin && !(origin.spaceId === spaceId && origin.position === targetPos)) {
    rooms = clearSpaceOccupant(rooms, origin.spaceId, origin.position);
  }
  const occupancy: WorkerOccupancy = { mageId, ownerId, isShadowing: asShadow };
  rooms = rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) =>
      s.id !== spaceId
        ? s
        : asShadow
          ? { ...s, shadowOccupant: occupancy }
          : { ...s, occupant: occupancy },
    ),
  }));
  const players = state.players.map((p) =>
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
                  isShadowing: asShadow,
                  location: { kind: 'action-space' as const, spaceId },
                },
          ),
        },
  );
  // Technomancy "upon placement" — fired for genuine places only (base OR
  // shadow), and never when this placement suppresses Mage powers. Computed
  // against the PRE-placement `state` (the mage is still findable and owned by
  // `ownerId`, and the opponent-in-room check excludes the placing mage either
  // way), so it matches the wrappers that previously called it post-placement.
  if (args.firesTechnomancy && !args.suppressMagePowers) {
    return {
      players,
      rooms,
      ...technomancyOnPlacePatch(state, ownerId, mageId, spaceId),
    };
  }
  return { players, rooms };
}

/**
 * The mage id currently holding the given position on a slot, or null. Lets a
 * reposition check whether its destination is free before calling
 * `placeMageOnSlot` (which throws on an occupied destination).
 */
export function slotPositionHeldBy(
  state: GameState,
  spaceId: ActionSpaceId,
  position: 'base' | 'shadow',
): OwnedMageId | null {
  const space = state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.id === spaceId);
  if (!space) return null;
  const occ = position === 'shadow' ? space.shadowOccupant : space.occupant;
  return occ ? occ.mageId : null;
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
 * Batch sibling of {@link placeMageOnSlot} for operations that relocate several
 * Mages *simultaneously* — mage↔mage swaps (Beyond the Beyonds L2) and room
 * rearranges (Tornado / Hurricane / Flux). Doing these one Mage at a time with
 * `placeMageOnSlot` is impossible because the intermediate states double-book a
 * slot (in an A↔B swap, A's destination still holds B), and `placeMageOnSlot`
 * throws on an occupied destination.
 *
 * So this clears **every** involved position first — each moved Mage's current
 * slot AND every destination — then seats all the Mages, then syncs each Mage's
 * `location` / `isShadowing` / clears `isWounded`. Like `placeMageOnSlot`, it is
 * the single source of truth for board↔mage occupancy; callers build any
 * trigger events (`mage-moved`, etc.) themselves.
 *
 * Throws if two ops target the same position or a destination space is unknown.
 * Ops carry the Mage's existing `ownerId` — this never changes ownership (that
 * is Possession's `applyOwnershipSwap`, which moves no Mage between slots).
 */
export function placeMagesOnSlots(
  state: GameState,
  ops: {
    mageId: OwnedMageId;
    ownerId: PlayerId;
    spaceId: ActionSpaceId;
    asShadow: boolean;
  }[],
): GameStatePatch {
  if (ops.length === 0) return {};

  const targeted = new Set<string>();
  for (const op of ops) {
    const key = `${op.spaceId}|${op.asShadow ? 'shadow' : 'base'}`;
    if (targeted.has(key)) {
      throw new Error(`placeMagesOnSlots: two ops target ${key}`);
    }
    targeted.add(key);
    const exists = state.rooms.some((r) =>
      r.actionSpaces.some((s) => s.id === op.spaceId),
    );
    if (!exists) {
      throw new Error(`placeMagesOnSlots: space ${op.spaceId} not found`);
    }
  }

  // Positions to clear up front: every moved Mage's origin + every destination.
  // Clearing destinations is what lets a swap/rearrange pass through a transient
  // state without ever double-booking a slot.
  const clearBase = new Set<ActionSpaceId>();
  const clearShadow = new Set<ActionSpaceId>();
  const baseSeat = new Map<ActionSpaceId, WorkerOccupancy>();
  const shadowSeat = new Map<ActionSpaceId, WorkerOccupancy>();
  for (const op of ops) {
    const origin = findMageSlotPosition(state, op.mageId);
    if (origin) {
      (origin.position === 'base' ? clearBase : clearShadow).add(origin.spaceId);
    }
    (op.asShadow ? clearShadow : clearBase).add(op.spaceId);
    const occ: WorkerOccupancy = {
      mageId: op.mageId,
      ownerId: op.ownerId,
      isShadowing: op.asShadow,
    };
    (op.asShadow ? shadowSeat : baseSeat).set(op.spaceId, occ);
  }

  const rooms = state.rooms.map((r) => ({
    ...r,
    actionSpaces: r.actionSpaces.map((s) => {
      let occupant = s.occupant;
      let shadowOccupant: WorkerOccupancy | null = s.shadowOccupant ?? null;
      if (clearBase.has(s.id)) occupant = null;
      if (clearShadow.has(s.id)) shadowOccupant = null;
      if (baseSeat.has(s.id)) occupant = baseSeat.get(s.id)!;
      if (shadowSeat.has(s.id)) shadowOccupant = shadowSeat.get(s.id)!;
      return { ...s, occupant, shadowOccupant };
    }),
  }));

  const byMage = new Map(ops.map((o) => [o.mageId, o]));
  const players = state.players.map((p) => ({
    ...p,
    mages: p.mages.map((m) => {
      const op = byMage.get(m.id);
      if (!op) return m;
      return {
        ...m,
        isWounded: false,
        isShadowing: op.asShadow,
        location: { kind: 'action-space' as const, spaceId: op.spaceId },
      };
    }),
  }));

  return { players, rooms };
}

/**
 * The inverse of {@link placeMageOnSlot}: lift a placed mage OFF its slot back
 * to its owner's office, clearing BOTH the slot occupancy and the mage's
 * `location` (and `isShadowing`) in one step so they can never desync. This is
 * the single source of truth for a plain board→office removal — the
 * Resolution-phase "errand done → office" return and any other non-banish exit.
 *
 * No reaction event fires (use `banishMage` when a `mage-banished` trigger is
 * needed). No-op if the mage isn't currently on a slot.
 */
export function removeMageFromSlot(
  state: GameState,
  mageId: OwnedMageId,
): GameStatePatch {
  const origin = findMageSlotPosition(state, mageId);
  if (!origin) return {};
  const lookup = findMageOwner(state, mageId);
  if (!lookup) return {};
  const { player: owner } = lookup;
  const rooms = clearSpaceOccupant(state.rooms, origin.spaceId, origin.position);
  const players = state.players.map((p) =>
    p.id !== owner.id
      ? p
      : {
          ...p,
          mages: p.mages.map((m) =>
            m.id !== mageId
              ? m
              : {
                  ...m,
                  isShadowing: false,
                  location: { kind: 'office' as const, playerId: owner.id },
                },
          ),
        },
  );
  return { players, rooms };
}

// ============================================================================
// Infirmary beds (shared ward)
// ============================================================================
//
// Every wounded mage gets an identifiable bed. Numbered beds form a shared
// ward across all players; the two Side B reward beds have fixed ids. The
// mage's `location.bed` is the single source of truth — bed occupancy and
// reward-bed availability are both derived from it, so nothing else needs to
// be cleared when a mage heals, banishes, or the round resets.

export const INFIRMARY_GOLD_BED: InfirmaryBedId = '4goldbed';
export const INFIRMARY_MANA_BED: InfirmaryBedId = '2manabed';

/** Side B reward-bed action-space ids → their bed ids (UI + bonus apply). */
export const INFIRMARY_REWARD_BEDS: Readonly<Record<string, InfirmaryBedId>> = {
  'base.room.infirmary.b.slot-1': INFIRMARY_GOLD_BED,
  'base.room.infirmary.b.slot-2': INFIRMARY_MANA_BED,
};

/** Bed ids currently held by wounded mages, across the shared ward. */
function occupiedInfirmaryBeds(state: GameState): Set<InfirmaryBedId> {
  const used = new Set<InfirmaryBedId>();
  for (const p of state.players) {
    for (const m of p.mages) {
      if (m.location.kind === 'infirmary' && m.location.bed) used.add(m.location.bed);
    }
  }
  return used;
}

/** Whether a given bed (e.g. a Side B reward bed) is currently claimed. */
export function infirmaryBedTaken(state: GameState, bedId: InfirmaryBedId): boolean {
  return occupiedInfirmaryBeds(state).has(bedId);
}

/**
 * The bed a newly wounded mage lies in: the lowest-numbered free ward bed
 * (`'bed-1'`, `'bed-2'`, …). A bed freed by a mid-round heal is reused
 * before a higher-numbered bed is created.
 */
export function allocateInfirmaryBed(state: GameState): InfirmaryBedId {
  const used = occupiedInfirmaryBeds(state);
  let n = 1;
  while (used.has(`bed-${n}`)) n++;
  return `bed-${n}`;
}

/**
 * Computes a Burn L1 wound: returns the patch (mage moved to infirmary, slot
 * cleared, isWounded set, a ward bed allocated) and the ReactionTriggerEvent
 * to attach to the window the engine will open.
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
  const bed = allocateInfirmaryBed(state);

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
                  location: { kind: 'infirmary' as const, bed },
                },
          ),
        },
  );

  const rooms: Room[] = slotLookup
    ? clearSpaceOccupant(state.rooms, slotLookup.spaceId, slotLookup.position)
    : state.rooms;

  // Revival (Will of the Divines L3) enqueues a post-wound prompt for this
  // mage's owner when the buff is active and the wounder is an opponent. The
  // engine's drain pump surfaces the prompt once the wound's reaction window
  // and infirmary-bonus chain are idle.
  const ownerHasRevival =
    byPlayerId !== owner.id &&
    state.activeBuffs.some(
      (b) => b.kind === 'revival' && b.casterPlayerId === owner.id,
    );
  const patch: GameStatePatch = ownerHasRevival
    ? {
        players,
        rooms,
        pendingRevivalChecks: [
          ...state.pendingRevivalChecks,
          { ownerId: owner.id, mageId: targetMageId },
        ],
      }
    : { players, rooms };

  return {
    patch,
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
  // Banish can pull a wounded mage out of the Infirmary; its bed frees
  // automatically once its `location` leaves the ward (bed occupancy is
  // derived from mage location), so only a placed mage's slot needs clearing.
  const rooms: readonly Room[] = slotLookup
    ? clearSpaceOccupant(state.rooms, slotLookup.spaceId, slotLookup.position)
    : state.rooms;
  return {
    patch: { players, rooms: rooms as Room[] },
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
      // Apprentice acts as blue too — gets the same opposing-spell immunity.
      // (Only when Divinity is on Side A.)
      if (colorAbilityActive(state, m, 'blue') && p.id !== casterId) continue;
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
 *
 * RULE: moving a mage NEVER claims an instant-room reward — only a fresh
 * placement does (a worker placed from the office, via the engine's
 * PLACE_WORKER reward prompt or `patchWithMaybeInstantReward`). This primitive
 * is the canonical chokepoint for relocations precisely so that invariant
 * holds by construction: it produces no reward prompt. Effects that relocate a
 * mage (Gust of Wind, Paralocation, Cut Plane / Fade, the Infirmary-move
 * spells, Natural Magick Side B's displacement, …) route through here and so
 * inherit the rule for free.
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
  // Leaving the ward (location → office) frees this mage's bed implicitly.
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
  // Moving to an action space frees this mage's ward bed implicitly (bed
  // occupancy is derived from mage location), so we only seat the occupant.
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

// ============================================================================
// Adventuring B on-place hook helpers. Moved here so the shared placement
// helpers (`placeOfficeMageOnSpace` / `placeOfficeMageAsShadow`) can bake
// the pick-card-type prompt push directly into their output — every
// placement source (Mysticism, Paralocation, Shadow Potion, Slow Time
// chain placements, etc.) then picks up the trigger automatically.
// ============================================================================

export const ADVENTURING_B_CAP = 3;

const EMPTY_ADVENTURING_POOL: NonNullable<GameState['adventuringBPool']> = {
  spells: [],
  vaultCards: [],
  supporters: [],
};

export function adventuringPoolOrEmpty(
  state: GameState,
): NonNullable<GameState['adventuringBPool']> {
  return state.adventuringBPool ?? EMPTY_ADVENTURING_POOL;
}

/**
 * Returns the on-place "pick a Spell / Vault / Supporter" prompt that
 * fires when a Mage is placed at Adventuring B. The exposed options
 * exclude types whose deck is empty OR whose pool slice is already
 * capped at 3. A "Skip" option is always offered.
 */
export function buildAdventuringBPickPrompt(
  state: GameState,
  playerId: PlayerId,
): PendingResolutionInput {
  const pool = adventuringPoolOrEmpty(state);
  const options: ChoiceOption[] = [];
  if (state.spellDeck.length > 0 && pool.spells.length < ADVENTURING_B_CAP) {
    options.push({ id: 'spell', label: 'Add a Spell card', payload: {} });
  }
  if (
    state.vaultDeck.length > 0 &&
    pool.vaultCards.length < ADVENTURING_B_CAP
  ) {
    options.push({ id: 'vault', label: 'Add a Vault card', payload: {} });
  }
  if (
    state.supporterDeck.length > 0 &&
    pool.supporters.length < ADVENTURING_B_CAP
  ) {
    options.push({
      id: 'supporter',
      label: 'Add a Supporter card',
      payload: {},
    });
  }
  options.push({ id: 'skip', label: 'Skip (add nothing)', payload: {} });
  return {
    responderId: playerId,
    prompt: { kind: 'choose-from-options', options },
    resume: {
      effectId: 'base.system.adventuring-b.pick-card-type',
      context: {},
    },
    source: {
      kind: 'room-action',
      id: 'base.room.adventuring.b',
      triggeringPlayerId: playerId,
      description: 'Adventuring: pick a card type to add to the room',
    },
  };
}

/**
 * Returns a patch that pushes the Adventuring B pick-card-type prompt
 * onto `pendingResolutionStack` (and bumps `nextSequenceId`) if the
 * given space lives in Adventuring B. Otherwise returns `{}`. The
 * placement helpers below merge this into their normal placement patch
 * so every placement source — regardless of how it builds its
 * EffectResult — picks up the trigger.
 */
export function adventuringBPlacementHookPatch(
  state: GameState,
  spaceId: ActionSpaceId,
  ownerId: PlayerId,
): GameStatePatch {
  const room = state.rooms.find((r) =>
    r.actionSpaces.some((s) => s.id === spaceId),
  );
  if (room?.id !== 'base.room.adventuring.b') return {};
  // Idempotent: a single placement can route through more than one helper that
  // applies this hook (e.g. `placeOfficeMageOnSpace` baked it in AND a wrapping
  // `patchWithMaybeInstantReward`). If the on-place prompt is already queued on
  // top, don't stack a duplicate.
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  if (top?.resume.effectId === 'base.system.adventuring-b.pick-card-type') {
    return {};
  }
  const promptInput = buildAdventuringBPickPrompt(state, ownerId);
  const seq = state.nextSequenceId;
  const fullPrompt: PendingResolution = {
    ...promptInput,
    id: `r-${seq}`,
  };
  return {
    pendingResolutionStack: [...state.pendingResolutionStack, fullPrompt],
    nextSequenceId: seq + 1,
  };
}

/**
 * Places one of a player's office mages into a slot's SHADOW position.
 * Used by Shadow Potion and Phase Steppers / Invisibility Cloak reactions.
 * Throws if the mage isn't in the player's office or the shadow slot is
 * already occupied. Pre-existing base occupant is left alone — the slot
 * now has both positions filled.
 *
 * When the target slot is in Adventuring B, the returned patch ALSO
 * pushes the room's on-place pick-card-type prompt onto the resolution
 * stack so the placing player can add to the draft pool.
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
  const placePatch = placeMageOnSlot(state, {
    mageId,
    ownerId,
    spaceId,
    asShadow: true,
    // A shadow placement is still a PLACE — fire Technomancy (the office mage
    // keeps its colour power while shadowing).
    firesTechnomancy: true,
  });
  return {
    ...placePatch,
    ...adventuringBPlacementHookPatch(state, spaceId, ownerId),
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
 * Empty base slots a player may be placed into "without Mage powers": regular
 * or merit slots, in placeable rooms that are neither locked nor at this
 * player's per-round cap. Shared by the place-without-powers chain (Tardy,
 * Stop Time, golems), Regrowth / Renewal's reposition step, and
 * `buildReactionOptionsFor`'s landing gate. Lives here (not in `base.ts`) so
 * it can gate reaction options without a `helpers → base` import cycle.
 */
export function listPlaceWithoutPowersSlots(
  state: GameState,
  playerId: string,
  restrictRoomId?: string,
): string[] {
  const slots: string[] = [];
  for (const r of state.rooms) {
    if (restrictRoomId && r.id !== restrictRoomId) continue;
    if (r.cannotBePlacedInDirectly) continue;
    if (state.roomLocks.some((l) => l.roomId === r.id)) continue;
    if (isRoomAtPlayerCap(state, playerId, r.id)) continue;
    for (const s of r.actionSpaces) {
      if (s.occupant) continue;
      if (s.slotType !== 'regular' && s.slotType !== 'merit') continue;
      slots.push(s.id);
    }
  }
  return slots;
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
  // Wound reverts (Phase Steppers / Invisibility Cloak) pull the mage out of
  // the infirmary into a shadow slot; its ward bed frees implicitly once its
  // location leaves the ward.
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
  repeatable?: boolean;
  disabled?: boolean;
};

/**
 * Mages owned by `attackerId` that a Wrath of Heaven reaction cast by
 * `responderId` may legally hit with `effect`. Runs the attacker's mages
 * through the spell-target gate — the retaliation is itself a Spell, so an
 * opposing Divinity (blue) mage is spell-immune, a green mage is wound-immune
 * (for `wound`), and immunity buffs + locked rooms still protect.
 * `includesShadows: true` keeps shadowing mages targetable (they've shed their
 * colour powers). Shared by the Wrath reaction effects (base.ts) and the
 * reaction-window builder below so the *offered* target count always matches
 * what the effect will actually wound/banish.
 */
export function wrathSpellTargets(
  state: GameState,
  responderId: PlayerId,
  attackerId: PlayerId,
  effect: 'wound' | 'banish',
): OwnedMageId[] {
  const eligible = new Set(
    buildHarmfulMageTargets(state, responderId, {
      source: 'spell',
      effect,
      includesShadows: true,
    }),
  );
  const attacker = findPlayer(state, attackerId);
  return attacker?.mages.filter((m) => eligible.has(m.id)).map((m) => m.id) ?? [];
}

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
  triggerSource?: ResolutionSource,
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
    // Hourglass of Fate (Mancers synthesis Treasure) — place a Mage WITH its
    // Mage powers (unlike Tardy / Stop Time). Only offered when the responder
    // owns an unexhausted copy AND has an office Mage to place — otherwise
    // playing it would strand the player on a prompt with nothing to choose.
    const hourglass = responder.vaultCards.find(
      (v) => v.cardId === 'mancers.vault.hourglass-of-fate' && !v.exhausted,
    );
    if (hourglass && responder.mages.some((m) => m.location.kind === 'office')) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'mancers.vault.hourglass-of-fate',
        effectId: 'mancers.vault.hourglass-of-fate.react',
        label: 'Play Hourglass of Fate (place a Mage with powers)',
      });
    }
    // Artificier's Companion, 4th Ed. (Technomancy legendary) — each researched
    // level offers a "place a Mage" reaction into a different slot type. Gated
    // like Hourglass on having an office Mage to place. L1/L2 are Free; L3 costs
    // 1 Mana.
    const artificier = responder.ownedSpells.find(
      (s) => s.cardId === 'mancers.spell.artificiers-companion-4th-ed',
    );
    const hasOfficeMage = responder.mages.some(
      (m) => m.location.kind === 'office',
    );
    if (artificier && !artificier.exhausted && hasOfficeMage) {
      if (artificier.intPlaced) {
        options.push({
          sourceKind: 'spell',
          sourceId: 'mancers.spell.artificiers-companion-4th-ed',
          effectId: 'mancers.spell.artificiers-companion-4th-ed.l1.react',
          label: 'Cast Iron Golem (place a Mage in a non-merit slot)',
        });
      }
      if (artificier.wisPlacedLevel2) {
        options.push({
          sourceKind: 'spell',
          sourceId: 'mancers.spell.artificiers-companion-4th-ed',
          effectId: 'mancers.spell.artificiers-companion-4th-ed.l2.react',
          label: 'Cast Gilded Golem (place a Mage in a merit slot)',
        });
      }
      if (artificier.wisPlacedLevel3 && responder.resources.mana >= 1) {
        options.push({
          sourceKind: 'spell',
          sourceId: 'mancers.spell.artificiers-companion-4th-ed',
          effectId: 'mancers.spell.artificiers-companion-4th-ed.l3.react',
          label: 'Cast Ehrlite Golem (place a Mage in an empty shadow slot)',
        });
      }
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
  // Sacred Shield (Mancers synthesis Treasure) never exhausts, so it's offered
  // whether or not it's been used this round — gated only by 1 Mana.
  const hasSacredShield = has('mancers.vault.sacred-shield');
  // Diviner's Mitre (Mancers Treasure) — only vs. SPELL-source harm.
  const hasDivinersMitre =
    has('mancers.vault.diviners-mitre', true) && triggerSource?.kind === 'spell';

  // When this is a single-mage window we omit `forMageId` so the existing
  // single-event prompt continues to render with unadorned labels.
  const multi = ownMageEvents.length > 1;
  const labelSuffix = (mageId: string) => (multi ? ` on ${mageId}` : '');

  // Regrowth / Renewal place the Mage into an empty regular/merit slot (the
  // exact same set as the place-without-powers chain). They pay + exhaust
  // BEFORE checking for a landing, so don't offer them when none exists.
  const hasPlaceWithoutPowersLanding =
    listPlaceWithoutPowersSlots(state, responderId).length > 0;

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

    // Phase Steppers / Invisibility Cloak re-shadow the mage at its original
    // slot. Rooms flagged `noShadowSlots` (Great Hall, Golem Lab) have no
    // shadow position, so those two reactions have nowhere to land and are
    // not offered for a mage affected there.
    const originalSpaceId =
      event.kind === 'mage-moved'
        ? event.fromSpaceId
        : event.kind === 'mage-wounded' || event.kind === 'mage-banished'
          ? event.originalSpaceId
          : null;
    const originalRoomHasNoShadow =
      originalSpaceId != null &&
      (state.rooms.find((r) =>
        r.actionSpaces.some((s) => s.id === originalSpaceId),
      )?.noShadowSlots ??
        false);

    // Landing-availability gates — don't offer a reposition reaction that has
    // nowhere to land (it would fizzle, and the spell-based ones would still
    // pay/exhaust). Two destination shapes:
    //
    //  (a) Re-shadow the ORIGINAL slot (Phase Steppers, Invisibility Cloak,
    //      Haunt): the room must have shadow positions AND the original slot's
    //      shadow must be free (or already this Mage's).
    //  (b) Reposition to ANY open base slot (Shield Potion, Ancient Armor,
    //      Mystic Amulet, Sacred Shield, Diviner's Mitre): some placeable room
    //      must have an empty base slot, or the original base slot is free.
    const originalShadowFree =
      originalSpaceId != null &&
      (() => {
        const held = slotPositionHeldBy(state, originalSpaceId, 'shadow');
        return held === null || held === mageId;
      })();
    const canReShadowOriginal =
      originalSpaceId != null && !originalRoomHasNoShadow && originalShadowFree;
    const hasOpenBaseLanding =
      state.rooms.some(
        (r) =>
          !r.cannotBePlacedInDirectly &&
          r.actionSpaces.some((s) => !s.occupant),
      ) ||
      (originalSpaceId != null &&
        (() => {
          const held = slotPositionHeldBy(state, originalSpaceId, 'base');
          return held === null || held === mageId;
        })());

    // Phase Steppers / Invisibility Cloak send the mage back to its original
    // slot. That's always allowed — even if the room is now locked, the mage
    // was already there before being affected (the lock applies *after* the
    // wound), so the reaction effectively undoes the wound rather than
    // crossing the lock.
    if (isWoundBanishOrMove && hasPhaseSteppers && canReShadowOriginal) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.phase-steppers',
        effectId: 'base.vault.phase-steppers.react',
        label: `Play Phase Steppers${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    // Sacred Shield: after one of YOUR Mages is wounded (any source), pay 1
    // Mana to move it to any open slot. Doesn't exhaust, so it's offered for
    // each still-wounded Mage in a multi-wound window (`repeatable`).
    if (
      event.kind === 'mage-wounded' &&
      hasSacredShield &&
      responder.resources.mana >= 1 &&
      hasOpenBaseLanding &&
      responder.mages.find((m) => m.id === mageId)?.isWounded === true
    ) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'mancers.vault.sacred-shield',
        effectId: 'mancers.vault.sacred-shield.react',
        label: `Play Sacred Shield${labelSuffix(mageId)} (1 Mana)`,
        requiresSlotPick: true,
        repeatable: true,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (isWoundBanishOrMove && hasInvisibilityCloak && canReShadowOriginal) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'base.vault.invisibility-cloak',
        effectId: 'base.vault.invisibility-cloak.react',
        label: `Use Invisibility Cloak${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (isWoundBanishOrMove && hasShieldPotion && hasOpenBaseLanding) {
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
      hasAncientArmor &&
      hasOpenBaseLanding
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
    // Diviner's Mitre — when a SPELL would wound/banish/move your Mage, place
    // it in any open slot. Exhausts on use.
    if (isWoundBanishOrMove && hasDivinersMitre && hasOpenBaseLanding) {
      options.push({
        sourceKind: 'vault-card',
        sourceId: 'mancers.vault.diviners-mitre',
        effectId: 'mancers.vault.diviners-mitre.react',
        label: `Play Diviner's Mitre${labelSuffix(mageId)}`,
        requiresSlotPick: true,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    if (
      triggeredByOpponent &&
      (event.kind === 'mage-banished' || event.kind === 'mage-shadowed') &&
      hasMysticAmulet &&
      hasOpenBaseLanding
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
      const n = wrathSpellTargets(state, responderId, event.byPlayerId, 'wound').length;
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.wrath-of-heaven',
        effectId: 'base.spell.wrath-of-heaven.l1.react',
        label:
          n === 0
            ? `Cast Justice (0 targets available)${labelSuffix(mageId)}`
            : `Cast Justice (wound a mage of the attacker)${labelSuffix(mageId)}`,
        ...(n === 0 ? { disabled: true } : {}),
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
      const n = wrathSpellTargets(state, responderId, event.byPlayerId, 'banish').length;
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.wrath-of-heaven',
        effectId: 'base.spell.wrath-of-heaven.l2.react',
        label:
          n === 0
            ? `Cast Recompense (0 targets available)${labelSuffix(mageId)}`
            : `Cast Recompense (banish a mage of the attacker)${labelSuffix(mageId)}`,
        ...(n === 0 ? { disabled: true } : {}),
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    // Wrath of Heaven L3 "Retribution": when your mage is wounded by an
    //   opponent, choose and wound TWO Mages owned by the attacker. Cost:
    //   3 Mana. Researched at L3.
    if (
      wrathReady &&
      wrath?.wisPlacedLevel3 &&
      triggeredByOpponent &&
      event.kind === 'mage-wounded' &&
      responder.resources.mana >= 3
    ) {
      // Retribution wounds up to TWO of the attacker's Mages. Show how many it
      // can actually hit: 0 (disabled — no legal targets), 1 (it will wound a
      // single Mage, not two), or 2+ (the full effect).
      const n = wrathSpellTargets(state, responderId, event.byPlayerId, 'wound').length;
      const label =
        n === 0
          ? `Cast Retribution (0 targets available)`
          : n === 1
            ? `Cast Retribution (1 target available — wounds 1)`
            : `Cast Retribution (wound two of the attacker's mages)`;
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.wrath-of-heaven',
        effectId: 'base.spell.wrath-of-heaven.l3.react',
        label: `${label}${labelSuffix(mageId)}`,
        ...(n === 0 ? { disabled: true } : {}),
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
    // Songs of Springtime L2 "Regrowth": when your mage is wounded or moved,
    //   place it into an empty slot. Cost: 1 Mana. Researched at L2.
    if (
      songsReady &&
      songs?.wisPlacedLevel2 &&
      responder.resources.mana >= 1 &&
      hasPlaceWithoutPowersLanding &&
      (event.kind === 'mage-wounded' || event.kind === 'mage-moved')
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.songs-of-springtime',
        effectId: 'base.spell.songs-of-springtime.l2.react',
        label: `Cast Regrowth (place into an empty slot)${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    // Songs of Springtime L3 "Renewal": when your mage is wounded or moved,
    //   place it into an empty slot + refresh an exhausted Spell or Treasure.
    //   Cost: 2 Mana. Researched at L3.
    if (
      songsReady &&
      songs?.wisPlacedLevel3 &&
      responder.resources.mana >= 2 &&
      hasPlaceWithoutPowersLanding &&
      (event.kind === 'mage-wounded' || event.kind === 'mage-moved')
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.songs-of-springtime',
        effectId: 'base.spell.songs-of-springtime.l3.react',
        label: `Cast Renewal (place + refresh a Spell or Treasure)${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }
    // Tome of Protection L3 "Absorb Mana": when one of your mages is moved /
    //   wounded / banished BY A SPELL, gain Mana equal to that spell's cost.
    //   Cost: 0 Mana. Researched at L3. Only surfaced when the trigger's
    //   source is a spell — physical effects (mage powers / vault cards)
    //   don't satisfy the "by a spell" clause.
    const tomeOfProtection = responder.ownedSpells.find(
      (s) => s.cardId === 'base.spell.tome-of-protection',
    );
    if (
      tomeOfProtection &&
      tomeOfProtection.intPlaced &&
      tomeOfProtection.wisPlacedLevel2 &&
      tomeOfProtection.wisPlacedLevel3 &&
      !tomeOfProtection.exhausted &&
      triggerSource?.kind === 'spell' &&
      isWoundBanishOrMove
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.tome-of-protection',
        effectId: 'base.spell.tome-of-protection.l3.react',
        label: `Cast Absorb Mana (gain Mana = spell's cost)${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
      });
    }

    // The Darkness Within L2 "Haunt": when your mage is wounded, moved, or
    //   banished, it instead shadows the slot it previously occupied.
    //   Researched at L2 (intPlaced + wisPlacedLevel2), unexhausted, cost 2 Mana.
    const darknessWithin = responder.ownedSpells.find(
      (s) => s.cardId === 'base.spell.the-darkness-within',
    );
    if (
      darknessWithin &&
      darknessWithin.intPlaced &&
      darknessWithin.wisPlacedLevel2 &&
      !darknessWithin.exhausted &&
      responder.resources.mana >= 2 &&
      isWoundBanishOrMove &&
      canReShadowOriginal
    ) {
      options.push({
        sourceKind: 'spell',
        sourceId: 'base.spell.the-darkness-within',
        effectId: 'base.spell.the-darkness-within.l2.react',
        label: `Cast Haunt (shadow original slot)${labelSuffix(mageId)}`,
        ...(multi ? { forMageId: mageId } : {}),
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

/**
 * The next level a WIS token could unlock on an owned, learned spell — `2`,
 * `3`, or `undefined` when there's nothing to advance. Crucially this checks
 * the spell's DEFINITION: single-level "leader"/unique spells (no L2/L3) and
 * already-maxed spells return `undefined`, so research never wastes a WIS on
 * a spell that can't be levelled. Shared by the engine's research prompts and
 * the research UI so both agree on what's advanceable.
 */
export function nextResearchLevel(
  state: GameState,
  owned: OwnedSpell,
): 2 | 3 | undefined {
  if (!owned.intPlaced) return undefined;
  const def = lookupSpellCardDef(state, owned.cardId);
  if (!def) return undefined;
  const has = (n: number) => def.levels.some((l) => l.level === n);
  if (!owned.wisPlacedLevel2) return has(2) ? 2 : undefined;
  if (!owned.wisPlacedLevel3) return has(3) ? 3 : undefined;
  return undefined;
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

/** Returns the IDs of legendary spell books (the "set-aside" pool drafted via
 *  Sealed Scroll) that are not yet owned by any player. Distinguished from
 *  candidate starter spells by `unique` being falsy — leader spells set
 *  `unique: true` and start in their candidate's office. */
export function unclaimedLegendaryBooks(state: GameState): SpellCardId[] {
  const owned = new Set<SpellCardId>();
  for (const p of state.players) {
    for (const s of p.ownedSpells) owned.add(s.cardId);
  }
  const out: SpellCardId[] = [];
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    for (const s of pack.legendarySpells) {
      if (s.unique) continue;
      if (owned.has(s.id)) continue;
      out.push(s.id);
    }
  }
  return out;
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
 * Drafts a legendary spell book from the Sealed Scroll pool: deducts 1 INT
 * and adds the book to the player's ownedSpells with `intPlaced=true`. The
 * book lives in `pack.legendarySpells` (not `spellDeck`/`spellTableau`),
 * so there is no tableau slot to clear or refill. Throws if the spell is
 * already owned by anyone, isn't a legendary book, or the player has no
 * INT.
 */
export function applyDraftLegendarySpell(
  state: GameState,
  playerId: PlayerId,
  spellCardId: SpellCardId,
): GameStatePatch {
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new Error(`applyDraftLegendarySpell: player ${playerId} not found`);
  }
  if (player.resources.intelligence < 1) {
    throw new Error('applyDraftLegendarySpell: player has no INT available');
  }
  if (!unclaimedLegendaryBooks(state).includes(spellCardId)) {
    throw new Error(
      `applyDraftLegendarySpell: ${spellCardId} not in the unclaimed legendary pool`,
    );
  }
  return {
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

/**
 * Swaps an owned Spell with one from the Spell Tableau, transferring ALL of
 * the owned Spell's Research (its placed INT + WIS levels) to the new Spell.
 * The owned Spell returns to the Tableau in the drafted Spell's slot — so the
 * Tableau size is unchanged and the deck is untouched — and the new Spell
 * joins the player's spellbook at the same research level (and unexhausted).
 * Used by the Mancers Research Archive Side B slot 3. Throws if the source
 * isn't owned, the source is a unique (leader) Spell, or the destination
 * isn't in the Tableau.
 */
export function applySwapOwnedSpellWithTableau(
  state: GameState,
  playerId: PlayerId,
  sourceSpellId: SpellCardId,
  destSpellId: SpellCardId,
): GameStatePatch {
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new Error(`applySwapOwnedSpellWithTableau: player ${playerId} not found`);
  }
  const owned = player.ownedSpells.find((s) => s.cardId === sourceSpellId);
  if (!owned) {
    throw new Error(`applySwapOwnedSpellWithTableau: ${sourceSpellId} not owned`);
  }
  if (lookupSpellCardDef(state, sourceSpellId)?.unique) {
    throw new Error('applySwapOwnedSpellWithTableau: cannot swap a unique Spell');
  }
  const destIdx = state.spellTableau.indexOf(destSpellId);
  if (destIdx === -1) {
    throw new Error(`applySwapOwnedSpellWithTableau: ${destSpellId} not in tableau`);
  }
  return {
    // The outgoing Spell takes the drafted Spell's tableau slot (no refill).
    spellTableau: state.spellTableau.map((c, i) =>
      i === destIdx ? sourceSpellId : c,
    ),
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            ownedSpells: p.ownedSpells.map((s) =>
              s.cardId !== sourceSpellId
                ? s
                : {
                    cardId: destSpellId,
                    intPlaced: owned.intPlaced,
                    wisPlacedLevel2: owned.wisPlacedLevel2,
                    wisPlacedLevel3: owned.wisPlacedLevel3,
                    exhausted: false,
                  },
            ),
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

/** Synthetic `choose-voter` target prefix for "place a Support Marker" picks
 *  (Political Struggle). The suffix is the faction id. */
export const SUPPORT_TARGET_PREFIX = 'support:';

/** Builds the synthetic gain-mark target id that places support in `groupId`. */
export function supportTargetId(groupId: string): string {
  return `${SUPPORT_TARGET_PREFIX}${groupId}`;
}

/** Returns the faction id if `id` is a Support-Marker target, else null. */
export function parseSupportTarget(id: string): string | null {
  return id.startsWith(SUPPORT_TARGET_PREFIX)
    ? id.slice(SUPPORT_TARGET_PREFIX.length)
    : null;
}

/**
 * The "place a Support Marker in this faction" options for a gain-mark prompt,
 * or undefined when the active scenario has no factions (Political Struggle is
 * the only one today). Each option resolves through the normal `voter-chosen`
 * answer; `applyGainMark` intercepts the synthetic id.
 */
export function supportOptionsFor(
  state: GameState,
): MarkSupportOption[] | undefined {
  const sc = state.scenarioId ? getScenario(state.scenarioId) : undefined;
  if (!sc?.supportGroups) return undefined;
  return sc.supportGroups.groups.map((g) => ({
    id: supportTargetId(g.id),
    groupId: g.id,
    label: `Support ${g.name}`,
  }));
}

/** Synthetic `choose-voter` target prefix for "place a Hit" picks (Assassins).
 *  The suffix is the voter id. */
export const HIT_TARGET_PREFIX = 'hit:';

/** Builds the synthetic gain-mark target id that places a Hit on `voterId`. */
export function hitTargetId(voterId: ConsortiumVoterId): string {
  return `${HIT_TARGET_PREFIX}${voterId}`;
}

/** Returns the voter id if `id` is a Hit target, else null. */
export function parseHitTarget(id: string): string | null {
  return id.startsWith(HIT_TARGET_PREFIX)
    ? id.slice(HIT_TARGET_PREFIX.length)
    : null;
}

/** Current round number if the phase carries one (errands / round-setup /
 *  round-end-scenario / mid-game-scoring), else null. */
function currentRoundOf(state: GameState): number | null {
  return 'round' in state.phase ? state.phase.round : null;
}

/**
 * The "place a Hit on this voter" options for a gain-mark prompt (Assassins), or
 * undefined when the scenario has no hit mechanic, the round is outside 1–4, or
 * there is nothing hittable. Targets face-down voters (face-up leaders can't be
 * hit) not in `exclude` (the same voter can't be hit twice in one action).
 */
export function hitOptionsFor(
  state: GameState,
  exclude: readonly string[] = [],
): VoterHitOption[] | undefined {
  const sc = state.scenarioId ? getScenario(state.scenarioId) : undefined;
  if (!sc?.hitMechanic) return undefined;
  const round = currentRoundOf(state);
  if (round === null || round < 1 || round > 4) return undefined;
  const ex = new Set(exclude);
  const targets = state.voters.filter(
    (v) => !v.isAlwaysFaceUp && !v.revealed && !ex.has(v.id),
  );
  if (targets.length === 0) return undefined;
  return targets.map((v) => ({ id: hitTargetId(v.id), voterId: v.id }));
}

/**
 * Builds the `choose-voter` prompt for a "Gain a Mark" effect — the eligible
 * (un-marked) voters plus any scenario alternatives (Political Struggle's
 * Support-Marker options, Assassins' Hit options). Returns null only when there
 * is nothing to offer at all (the effect fizzles).
 *
 * `markMode` controls Assassins' per-source variants: `'mark-only'` (R1) omits
 * Hits, `'hit-only'` (R2) omits normal voter marks. `excludeHitVoterIds` hides
 * voters already hit earlier in the same multi-hit action.
 */
export function buildGainMarkChooseVoterPrompt(
  state: GameState,
  playerId: PlayerId,
  opts: {
    markMode?: 'either' | 'mark-only' | 'hit-only';
    excludeHitVoterIds?: readonly string[];
  } = {},
): Extract<PendingPrompt, { kind: 'choose-voter' }> | null {
  const markMode = opts.markMode ?? 'either';
  const eligible =
    markMode === 'hit-only' ? [] : eligibleVotersForMark(state, playerId);
  const supportOptions = supportOptionsFor(state);
  const hitOptions =
    markMode === 'mark-only'
      ? undefined
      : hitOptionsFor(state, opts.excludeHitVoterIds ?? []);
  if (eligible.length === 0 && !supportOptions && !hitOptions) return null;
  return {
    kind: 'choose-voter',
    eligibleVoterIds: eligible.map((v) => v.id),
    ...(supportOptions ? { supportOptions } : {}),
    ...(hitOptions ? { hitOptions } : {}),
  };
}

/**
 * Places a Mark for a player on a Voter. Records the placement in
 * `voterMarks` and bumps the player's `marks` resource (which is what the
 * "Most Marks" voter scores).
 *
 * Per the rulebook, a player can hold at most one Mark on any given Voter.
 * Throws if the player already has a mark on this voter.
 *
 * Political Struggle: a synthetic `support:<faction>` target places a Support
 * Marker into that faction instead — no `voterMarks` entry and no `marks` bump
 * (so converting a mark to support forgoes Most-Marks progress).
 *
 * Assassins: a synthetic `hit:<voterId>` target places a Hit on that voter
 * (`voterHits`) instead — and in a round with `loseIpPerHit` (R4) also costs the
 * placer that much Influence (floored at 0).
 */
export function applyGainMark(
  state: GameState,
  playerId: PlayerId,
  voterId: ConsortiumVoterId,
): GameStatePatch {
  const supportGroup = parseSupportTarget(voterId);
  if (supportGroup !== null) {
    const current = state.supportMarkers ?? {};
    return {
      supportMarkers: {
        ...current,
        [supportGroup]: (current[supportGroup] ?? 0) + 1,
      },
    };
  }
  const hitVoter = parseHitTarget(voterId);
  if (hitVoter !== null) {
    const current = state.voterHits ?? {};
    const patch: GameStatePatch = {
      voterHits: { ...current, [hitVoter]: (current[hitVoter] ?? 0) + 1 },
    };
    const round = currentRoundOf(state);
    const sc = state.scenarioId ? getScenario(state.scenarioId) : undefined;
    const ipLoss =
      round !== null
        ? sc?.rounds.find((r) => r.round === round)?.loseIpPerHit ?? 0
        : 0;
    if (ipLoss > 0) {
      patch.players = state.players.map((p) =>
        p.id !== playerId
          ? p
          : {
              ...p,
              resources: {
                ...p.resources,
                influence: Math.max(0, p.resources.influence - ipLoss),
              },
            },
      );
    }
    return patch;
  }
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
 * Performs a "Swap N Gold for a {color} Mage from the supply" trade.
 *
 * Returns the patch on success, or `null` if the trade can't happen:
 *   - player can't pay the gold cost, OR
 *   - the requested color is unavailable (pool empty OR player at 2-per-
 *     color cap) AND the off-white fallback also can't fire (off-white
 *     pool empty OR player at 2-neutral cap).
 *
 * Fallback: when the requested color is unavailable — either because the
 * supply for that color is empty OR because the player already owns the
 * 2-per-color cap of it — they receive an off-white neutral mage instead
 * (same gold cost). The neutral path has its own pool/cap checks. This
 * mirrors the rulebook's "if the specific color is unavailable, substitute
 * a neutral" guidance for paid-mage cards.
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

  const requestedPool = state.mageDraftPool[color] ?? 0;
  const ownedOfColor = player.mages.filter((m) => m.color === color).length;
  const canTakeColor = requestedPool > 0 && ownedOfColor < 2;

  let givenColor: MageColor = color;
  if (!canTakeColor) {
    // Fall back to neutral when the specific color is unavailable —
    // either the supply is empty OR the player is already at the
    // per-color cap of 2. Same off-white substitution applies in both
    // cases; the neutral path has its own supply/cap checks.
    const neutralPool = state.mageDraftPool['off-white'] ?? 0;
    const ownedNeutral = player.mages.filter(
      (m) => m.color === 'off-white',
    ).length;
    if (neutralPool <= 0) return null;
    if (ownedNeutral >= 2) return null;
    givenColor = 'off-white';
  }

  const givenPool = state.mageDraftPool[givenColor] ?? 0;
  const seq = state.nextSequenceId;
  return {
    nextSequenceId: seq + 1,
    mageDraftPool: { ...state.mageDraftPool, [givenColor]: givenPool - 1 },
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
                cardId: MAGE_CARD_BY_COLOR[givenColor],
                color: givenColor,
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
 *
 * Infirmary Side B buffs the gold / mana options when the corresponding
 * "buffed bonus" slot is empty: gold → 4 instead of 2, mana → 2 instead
 * of 1. The opts.payload (echoed back from the prompt's option) carries
 * `buffed: true` when that branch fires; the wounded mage is then
 * recorded as the slot occupant so subsequent wounds this round see the
 * slot as taken and fall back to the standard reward.
 */
export function applyInfirmaryBonusPatch(
  state: GameState,
  recipientId: PlayerId,
  optionId: string,
  opts?: {
    payload?: SerializableValue;
    woundedMageId?: OwnedMageId;
  },
): GameStatePatch {
  const buffedAsked =
    opts?.payload != null &&
    typeof opts.payload === 'object' &&
    !Array.isArray(opts.payload) &&
    (opts.payload as { buffed?: unknown }).buffed === true;
  // The buffed rate is re-checked against the CURRENT state: prompt options
  // are snapshotted when the prompt is built, but with simultaneous wounds
  // (Plague) an earlier resolver may have claimed the bed in the meantime.
  // First into the reward bed wins; everyone after gets the standard rate.
  const claimBed = (bedId: InfirmaryBedId): boolean =>
    buffedAsked && !!opts?.woundedMageId && !infirmaryBedTaken(state, bedId);
  switch (optionId) {
    case 'gold': {
      const buffed = claimBed(INFIRMARY_GOLD_BED);
      const resPatch = gainResourcePatch(state, recipientId, 'gold', buffed ? 4 : 2);
      if (!buffed) return resPatch;
      // Move the wounded mage from its ward bed into the reward bed; this
      // both records the claim and frees the numbered bed it vacated.
      const bedPatch = moveMageToInfirmaryBedPatch(
        { ...state, ...resPatch },
        recipientId,
        opts!.woundedMageId!,
        INFIRMARY_GOLD_BED,
      );
      return { ...resPatch, ...bedPatch };
    }
    case 'mana': {
      const buffed = claimBed(INFIRMARY_MANA_BED);
      const resPatch = gainResourcePatch(state, recipientId, 'mana', buffed ? 2 : 1);
      if (!buffed) return resPatch;
      const bedPatch = moveMageToInfirmaryBedPatch(
        { ...state, ...resPatch },
        recipientId,
        opts!.woundedMageId!,
        INFIRMARY_MANA_BED,
      );
      return { ...resPatch, ...bedPatch };
    }
    case 'ip':
      return bumpInfluencePatch(state, recipientId, 1);
    default:
      throw new Error(`Infirmary bonus: unknown option "${optionId}"`);
  }
}

/** Reassigns a wounded mage to a specific Infirmary bed (e.g. a reward bed). */
function moveMageToInfirmaryBedPatch(
  state: GameState,
  ownerId: PlayerId,
  mageId: OwnedMageId,
  bedId: InfirmaryBedId,
): GameStatePatch {
  return {
    players: state.players.map((p) =>
      p.id !== ownerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : { ...m, location: { kind: 'infirmary' as const, bed: bedId } },
            ),
          },
    ),
  };
}

/**
 * Convenience wrapper around `applyInfirmaryBonusPatch` for resume
 * effects that receive an `option-chosen` answer + a context that may
 * carry `woundedMageId` (planted there by `bonusPromptFor`). Lets every
 * wound source honor Infirmary B's buffed slots without each caller
 * re-doing the same context extraction.
 */
export function applyInfirmaryBonusFromCtx(
  state: GameState,
  recipientId: PlayerId,
  resumeAnswer: ResolutionAnswer | undefined,
  resumeContext: SerializableContext | undefined,
): GameStatePatch {
  if (resumeAnswer?.kind !== 'option-chosen') {
    throw new Error(
      `applyInfirmaryBonusFromCtx: expected option-chosen, got ${resumeAnswer?.kind}`,
    );
  }
  const woundedMageRaw = resumeContext?.['woundedMageId'];
  const woundedMageId =
    typeof woundedMageRaw === 'string'
      ? (woundedMageRaw as OwnedMageId)
      : undefined;
  return applyInfirmaryBonusPatch(
    state,
    recipientId,
    resumeAnswer.optionId,
    {
      payload: resumeAnswer.payload,
      ...(woundedMageId ? { woundedMageId } : {}),
    },
  );
}

/**
 * Returns the standard 3-option Infirmary bonus choice, buffed when Side B
 * is in play and the relevant reward bed is unclaimed. The picked option's
 * `payload` carries `buffed: true` when it's the upgraded variant so the
 * apply step can credit the extra reward + park the mage in the reward bed.
 */
export function buildInfirmaryBonusOptions(state: GameState): Array<{
  id: string;
  label: string;
  payload: SerializableValue;
}> {
  const infirmary = state.rooms.find((r) => r.name === 'Infirmary');
  const isSideB = infirmary?.side === 'B';
  const goldBuffed = isSideB && !infirmaryBedTaken(state, INFIRMARY_GOLD_BED);
  const manaBuffed = isSideB && !infirmaryBedTaken(state, INFIRMARY_MANA_BED);
  return [
    {
      id: 'gold',
      label: goldBuffed ? 'Gain 4 Gold' : 'Gain 2 Gold',
      payload: goldBuffed ? { buffed: true } : {},
    },
    {
      id: 'mana',
      label: manaBuffed ? 'Gain 2 Mana' : 'Gain 1 Mana',
      payload: manaBuffed ? { buffed: true } : {},
    },
    { id: 'ip', label: 'Gain 1 IP', payload: {} },
  ];
}

// ============================================================================
// Candidate / Mage allocation helpers
// ============================================================================

/**
 * Maps each Mage piece colour to its Mage *card* id. Base-pack colours
 * resolve to base cards; orange (Technomancy) lives in the Mancers
 * expansion, so its card id is `mancers.mage.technomancy`. Callers that
 * spawn orange mages must verify Mancers is in `state.activePackIds`
 * before using the entry. Rainbow maps to the Archmage's Apprentice
 * — a one-of-one mage gained via the Archmage's Study, never from a
 * supply pool or draft.
 */
/**
 * The Archmage's Apprentice — a unique "joker" mage gained from the
 * Archmage's Study. Per the rulebook it has ALL Mage Powers, so every
 * per-colour gate (Ars Magna eligibility, wound / spell immunity,
 * fast-action placement, post-cast triggers, Technomancy on-place)
 * routes through `actsAsColor(mage, color)` which returns true for an
 * exact colour match OR for the apprentice piece.
 */
export const ARCHMAGES_APPRENTICE_CARD_ID =
  'base.mage.archmages-apprentice' as const;

export function isArchmagesApprentice(m: OwnedMage): boolean {
  return m.cardId === ARCHMAGES_APPRENTICE_CARD_ID;
}

/**
 * True iff `m` should be treated as a `color` mage for power purposes.
 * Apprentice piece counts as every department colour (excluding
 * `off-white` / `rainbow` themselves — there's no apprentice-of-an-
 * apprentice case to worry about).
 */
export function actsAsColor(m: OwnedMage, color: MageColor): boolean {
  if (m.color === color) return true;
  if (isArchmagesApprentice(m)) {
    return (
      color === 'red' ||
      color === 'blue' ||
      color === 'green' ||
      color === 'purple' ||
      color === 'grey' ||
      color === 'orange'
    );
  }
  return false;
}

/**
 * Each ability-bearing Mage colour maps 1:1 to a Department. The two
 * department-less colours (neutral off-white, rainbow apprentice) map to
 * `null` — they carry no department-scoped power side of their own (the
 * apprentice instead picks up each department's active side via `actsAsColor`).
 */
export const COLOR_TO_DEPARTMENT: Record<MageColor, Department | null> = {
  red: 'sorcery',
  grey: 'mysticism',
  green: 'natural-magick',
  purple: 'planar-studies',
  blue: 'divinity',
  orange: 'technomancy',
  rainbow: null,
  'off-white': null,
};

/**
 * Which ability side (A or B) is in play for `color`'s department this game.
 * Chosen before the game on the setup screen (`state.mageAbilitySides`).
 * Department-less colours and any unset department default to `'A'`.
 */
export function sideForColor(state: GameState, color: MageColor): MageAbilitySide {
  const dept = COLOR_TO_DEPARTMENT[color];
  if (!dept) return 'A';
  return state.mageAbilitySides[dept] ?? 'A';
}

/**
 * True iff `mage` has the **Side A** power of `color` active — i.e. it acts as
 * that colour AND that department is set to Side A this game. This is the gate
 * every Side A power checks; flipping a department to Side B disables its Side A
 * behaviour (wound/spell immunity, Ars Magna, fast-action, post-cast placement,
 * Technomancy on-place). The apprentice follows each department's chosen side
 * because `actsAsColor` already returns true for every colour.
 *
 * NOTE: this gates *abilities* only. Plain `actsAsColor` is still correct for
 * colour-identity uses (scoring, diversity, apprentice colour matching) that
 * are not modal powers.
 *
 * SHADOW RULE: a mage occupying a shadow slot loses exactly its defensive
 * colour immunities — green's wound-immunity and blue's spell-immunity — and
 * nothing else (Technomancy on-place, red's Ars Magna, etc. all still fire from
 * a shadow). Since green-A and blue-A have no colour power OTHER than those
 * immunities, gating them here is the single source of truth for the rule; the
 * other colours are unaffected by `isShadowing`.
 */
export function colorAbilityActive(
  state: GameState,
  mage: OwnedMage,
  color: MageColor,
): boolean {
  if (!actsAsColor(mage, color) || sideForColor(state, color) !== 'A') {
    return false;
  }
  // A Mage seated on a power-stripping slot (the Archmage's Staff) loses ALL
  // of its colour powers, including green's wound-immunity and blue's
  // spell-immunity — the same chokepoint the shadow rule below uses.
  if (mageOnPowerStrippingSlot(state, mage)) {
    return false;
  }
  if (mage.isShadowing && (color === 'green' || color === 'blue')) {
    return false;
  }
  return true;
}

/**
 * True when `mage` currently occupies an action-space slot flagged
 * `stripsMagePowers` (the Archmage's Staff center slot). Such a Mage loses all
 * of its powers while seated there. Shadow occupants of the slot count too —
 * the staff slot has no shadow position anyway, but the lookup checks both
 * positions defensively.
 */
export function mageOnPowerStrippingSlot(
  state: GameState,
  mage: OwnedMage,
): boolean {
  if (mage.location.kind !== 'action-space') return false;
  const spaceId = mage.location.spaceId;
  for (const room of state.rooms) {
    for (const space of room.actionSpaces) {
      if (space.id === spaceId) return space.stripsMagePowers === true;
    }
  }
  return false;
}

/** Gold cost of the Divinity Side B "pay to activate a Merit Slot" option. */
export const DIVINITY_B_MERIT_GOLD = 4;

/**
 * Builds the shared "forfeit-or-reward" option list for an occupied slot's
 * resolution (used at the resolution-phase pump AND at instant-room placement,
 * by both the engine and the effect-side prompt builders — the single source
 * of truth so the two never drift).
 *
 * Returns the option list plus the resolved `meritCost` / `goldCost` to thread
 * into the resume context. Options:
 *   - `reward` — take the slot's reward, paying any Merit cost with Badges.
 *   - `reward-gold` — Divinity Side B: pay 4 Gold instead of a Merit Badge to
 *     activate a Merit Slot whose base occupant acts as blue. Only present when
 *     applicable.
 *   - `forfeit` — skip the reward for 1 IP.
 *
 * The slot occupant is read from live `state` by slot id, NOT from the passed
 * `space` snapshot — instant-room callers pass the pre-placement slot (whose
 * `occupant` is still null), so reading `space.occupant` directly would miss
 * the just-seated Mage.
 */
/**
 * The first readied (unexhausted) Merit-slot-waiver Vault card the player holds
 * (Beach Brew), or null. Used to surface the "discard to skip the Merit Badge"
 * resolution option.
 */
export function findMeritSlotWaiverCard(
  state: GameState,
  playerId: PlayerId,
): { cardId: VaultCardId; name: string } | null {
  const player = findPlayer(state, playerId);
  if (!player) return null;
  for (const v of player.vaultCards) {
    if (v.exhausted) continue;
    const def = lookupVaultCardDef(state, v.cardId);
    if (def?.meritSlotWaiver) return { cardId: v.cardId, name: def.name };
  }
  return null;
}

export function buildResolutionChoiceOptions(
  state: GameState,
  space: ActionSpace,
  playerId: PlayerId,
  position: 'base' | 'shadow',
): { options: ChoiceOption[]; meritCost: number; goldCost: number } {
  const player = findPlayer(state, playerId);
  // Shadow occupants didn't arrive via merit placement, so they pay no cost.
  const meritCost =
    position === 'base' && space.slotType === 'merit'
      ? (space.costToActivate?.meritBadges ?? 0)
      : 0;
  const meritBadges = player?.resources.meritBadges ?? 0;
  // Greed's temporary Merit Badges (Renovation) cover a merit cost AFTER normal
  // badges, at the price of 1 IP each.
  const tempBadges = player?.temporaryMeritBadges ?? 0;
  const gold = player?.resources.gold ?? 0;
  const canAffordReward =
    meritCost === 0 || meritBadges + tempBadges >= meritCost;
  // How many temporary badges the "reward" option would have to spend (and thus
  // the IP it would cost) — used only for the option label.
  const tempBadgesUsed = Math.max(0, Math.min(tempBadges, meritCost - meritBadges));

  const liveSpace = state.rooms
    .flatMap((r) => r.actionSpaces)
    .find((s) => s.id === space.id);
  const baseOccupantId =
    position === 'base' ? liveSpace?.occupant?.mageId : undefined;
  const occupantMage = baseOccupantId
    ? player?.mages.find((m) => m.id === baseOccupantId)
    : undefined;
  const divinityGoldOption =
    meritCost > 0 &&
    occupantMage !== undefined &&
    actsAsColor(occupantMage, 'blue') &&
    sideForColor(state, 'blue') === 'B';
  const goldCost = divinityGoldOption ? DIVINITY_B_MERIT_GOLD : 0;

  const options: ChoiceOption[] = [
    canAffordReward
      ? {
          id: 'reward',
          label:
            meritCost > 0
              ? `Take reward (spend ${meritCost} MB${tempBadgesUsed > 0 ? `, ${tempBadgesUsed} temporary = −${tempBadgesUsed} IP` : ''})`
              : 'Take reward',
          payload: {},
          available: true,
        }
      : {
          id: 'reward',
          label: `Take reward (spend ${meritCost} MB)`,
          payload: {},
          available: false,
          unavailableReason: `requires ${meritCost} Merit Badge${meritCost === 1 ? '' : 's'} (you have ${meritBadges}${tempBadges > 0 ? ` + ${tempBadges} temporary` : ''})`,
        },
  ];
  if (divinityGoldOption) {
    const canAffordGold = gold >= goldCost;
    options.push({
      id: 'reward-gold',
      label: `Take reward (pay ${goldCost} Gold — Divinity)`,
      payload: {},
      available: canAffordGold,
      ...(canAffordGold
        ? {}
        : {
            unavailableReason: `requires ${goldCost} Gold (you have ${gold})`,
          }),
    });
  }
  // Beach Brew (Summer Break) — discard a readied Merit-slot-waiver Vault card
  // to take the reward without spending a Merit Badge. Always available when
  // the slot has a Merit cost and such a card is held (even if Badges are short).
  if (meritCost > 0) {
    const waiver = findMeritSlotWaiverCard(state, playerId);
    if (waiver) {
      options.push({
        id: `reward-waiver::${waiver.cardId}`,
        label: `Take reward (discard ${waiver.name} — no Merit Badge)`,
        payload: {},
        available: true,
      });
    }
  }
  options.push({ id: 'forfeit', label: 'Forfeit for 1 IP', payload: {} });

  return { options, meritCost, goldCost };
}

/**
 * Technomancy (orange) "upon placement" hook. Whenever an orange Mage — or
 * the Archmage's Apprentice, which acts as every department colour — is
 * placed onto a slot by its owner while the Mancers pack is active, queue
 * the "pay 3 Gold → gain a Research" trigger. Centralised here so EVERY
 * placement path fires the ability uniformly: the normal PLACE_WORKER
 * action, the generic place-mage-without-powers primitive (Stop Time, Slow
 * Time, Planar Scouter, Technomancer's Top Hat, Mystic's Cowl …), the
 * office/infirmary slot helpers (Elixir of Life, Sorceror's Hat, Nature
 * Mage's Cap), and Summon Golem.
 *
 * Pass a `state` in which the placed Mage is findable (pre-placement for
 * office/infirmary helpers; post-placement for freshly-minted golems) — the
 * trigger is appended onto that state's `pendingTechnomancyTrigger`. The
 * drain (`drainTechnomancyTriggerIfIdle`) applies the Mesmerize / can't-pay
 * gates, so this hook only needs the colour + Mancers-active check. Returns
 * `{}` when not applicable, so it merges cleanly into any placement patch.
 */
export function technomancyOnPlacePatch(
  state: GameState,
  playerId: PlayerId,
  mageId: string,
  spaceId: ActionSpaceId,
): GameStatePatch {
  if (!state.activePackIds.includes('mancers')) return {};
  const player = state.players.find((p) => p.id === playerId);
  const mage = player?.mages.find((m) => m.id === mageId);
  if (!mage || !actsAsColor(mage, 'orange')) return {};
  const room = state.rooms.find((r) =>
    r.actionSpaces.some((s) => s.id === spaceId),
  );
  if (!room) return {};

  const side = sideForColor(state, 'orange');
  if (side === 'A') {
    // Side A: "Pay 3 Gold → gain a Research."
    return {
      pendingTechnomancyTrigger: [
        ...state.pendingTechnomancyTrigger,
        { playerId, roomId: room.id, side: 'A' },
      ],
    };
  }

  // Side B: "When you place into a room with another player's Mage, you may
  // pay 3 Gold to Mark a Voter that player has marked." Only queue when the
  // room actually holds an opposing Mage (base or shadow) — `state` here is
  // pre-placement, so the placing Mage isn't counted.
  const hasOpponentInRoom = room.actionSpaces.some(
    (s) =>
      (s.occupant && s.occupant.ownerId !== playerId) ||
      (s.shadowOccupant && s.shadowOccupant.ownerId !== playerId),
  );
  if (!hasOpponentInRoom) return {};
  return {
    pendingTechnomancyTrigger: [
      ...state.pendingTechnomancyTrigger,
      { playerId, roomId: room.id, side: 'B' },
    ],
  };
}

export const MAGE_CARD_BY_COLOR: Record<MageColor, string> = {
  red: 'base.mage.sorcery',
  grey: 'base.mage.mysticism',
  green: 'base.mage.natural-magick',
  purple: 'base.mage.planar-studies',
  blue: 'base.mage.divinity',
  orange: 'mancers.mage.technomancy',
  rainbow: 'base.mage.archmages-apprentice',
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
  // Under Mesmerize the caster's red mage has lost its Ars Magna power
  // — no eligible targets at all.
  if (magesLosePowers(state)) return [];
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
      // Green wound-immunity / opposing-blue spell-immunity also pick
      // up the apprentice via `actsAsColor` — only while that department
      // is on Side A.
      if (colorAbilityActive(state, m, 'green')) continue;
      if (colorAbilityActive(state, m, 'blue')) continue; // Always opposing here.
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
  // Mesmerize disables red's Ars Magna power.
  if (magesLosePowers(state)) return false;
  if (!space.occupant) return false;
  if (space.occupant.ownerId === casterId) return false;
  const caster = findPlayer(state, casterId);
  if (!caster) return false;
  if (caster.resources.mana < 1) return false;
  const targetLookup = findMageOwner(state, space.occupant.mageId);
  if (!targetLookup) return false;
  const { mage: target } = targetLookup;
  if (target.isWounded) return false;
  // Green wound-immunity and opposing-blue spell-immunity protect the
  // target — including when the target IS the apprentice (acts as
  // both green and blue) — but only while that department is on Side A.
  if (colorAbilityActive(state, target, 'green')) return false;
  if (colorAbilityActive(state, target, 'blue')) return false;
  return true;
}
