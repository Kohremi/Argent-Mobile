import type { ContentPack } from '../types';
import type {
  ConsortiumVoter,
  GameState,
  PlayerId,
  Room,
  VaultCard,
} from '../../game/types';

// The Archmage's Staff expansion (tagged "Mancers/Archmage" in the source data,
// docs/argent_data/archmage-s-staff.tsv). Adds a single room whose center slot
// grants control of a legendary artifact — the Staff — at the end of the round.
// The Staff is modeled as a one-of-a-kind Treasure (copies: 0, never shuffled
// into the Vault deck); the only way to obtain it is the room. A Mage seated on
// the slot loses all of its Mage powers (see `stripsMagePowers`). The Staff's
// ability depends on which side of the room is in play; each side grants its own
// Staff Treasure card. Effects registered in src/game/effects/archmage.ts.

const PACK_ID = 'archmage';

/** Room ids for the two sides of the Archmage's Staff room tile. */
export const STAFF_A_ROOM_ID = 'archmage.room.archmages-staff.a';
export const STAFF_B_ROOM_ID = 'archmage.room.archmages-staff.b';

/** Shared card id for the Side A Staff Treasure ("The Will to Power"). */
export const STAFF_A_CARD_ID = 'archmage.vault.archmages-staff-a';
/** Shared card id for the Side B Staff Treasure ("The Force of Magic"). */
export const STAFF_B_CARD_ID = 'archmage.vault.archmages-staff-b';

/** Both Staff card ids — used by the UI to detect the current holder. */
export const STAFF_CARD_IDS: readonly string[] = [STAFF_A_CARD_ID, STAFF_B_CARD_ID];

/**
 * The player currently holding the Archmage's Staff, derived from Staff-card
 * ownership (no separate ownership field, so it can't desync). `null` when no
 * one holds it. Used by the UI to show who controls the Staff.
 */
export function staffHolderId(state: GameState): PlayerId | null {
  for (const p of state.players) {
    if (p.vaultCards.some((v) => STAFF_CARD_IDS.includes(v.cardId))) return p.id;
  }
  return null;
}

// ============================================================================
// Rooms — one center slot, no shadow, non-instant. Both sides share the same
// space effect (gain control at end of round + the occupant loses its powers);
// only the granted Staff Treasure differs by side.
// ============================================================================

const archmagesStaffA: Room = {
  id: 'archmage.room.archmages-staff.a',
  name: "The Archmage's Staff",
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  noShadowSlots: true,
  description:
    "Gain control of the Archmage's Staff at the end of the round. A Mage placed here loses all of its Mage powers. Staff (Action): gain your choice of 3 Mana, 2 Research, 1 INT, or 1 WIS.",
  actionSpaces: [
    {
      id: 'archmage.room.archmages-staff.a.slot-1',
      roomId: 'archmage.room.archmages-staff.a',
      index: 0,
      slotType: 'regular',
      occupant: null,
      effectId: 'archmage.room.staff-a.gain-control',
      stripsMagePowers: true,
      description:
        'Gain control of the Staff at the end of the round. A Mage here loses all Mage powers.',
    },
  ],
};

const archmagesStaffB: Room = {
  id: 'archmage.room.archmages-staff.b',
  name: "The Archmage's Staff",
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  noShadowSlots: true,
  description:
    "Gain control of the Archmage's Staff at the end of the round. A Mage placed here loses all of its Mage powers. Staff (Action): cast a Spell you own — even one you have not researched — without paying any Mana.",
  actionSpaces: [
    {
      id: 'archmage.room.archmages-staff.b.slot-1',
      roomId: 'archmage.room.archmages-staff.b',
      index: 0,
      slotType: 'regular',
      occupant: null,
      effectId: 'archmage.room.staff-b.gain-control',
      stripsMagePowers: true,
      description:
        'Gain control of the Staff at the end of the round. A Mage here loses all Mage powers.',
    },
  ],
};

// ============================================================================
// Staff Treasures — never in the Vault deck (copies: 0). Granted only by the
// matching room side's gain-control effect. Both exhaust on use and re-ready at
// round-setup like any Treasure.
// ============================================================================

const staffA: VaultCard = {
  id: STAFF_A_CARD_ID,
  name: "The Archmage's Staff — The Will to Power",
  sourcePackId: PACK_ID,
  type: 'treasure',
  goldCost: 0,
  copies: 0,
  timing: 'action',
  effectId: 'archmage.vault.staff-a.use',
  description:
    'Action: gain your choice of 3 Mana, 2 Research, 1 INT, or 1 WIS. Exhausts on use.',
};

const staffB: VaultCard = {
  id: STAFF_B_CARD_ID,
  name: "The Archmage's Staff — The Force of Magic",
  sourcePackId: PACK_ID,
  type: 'treasure',
  goldCost: 0,
  copies: 0,
  timing: 'action',
  effectId: 'archmage.vault.staff-b.use',
  description:
    'Action: cast a Spell you own — even one you have not researched — at any level, without paying any Mana. Exhausts on use.',
};

// ============================================================================
// Voter — Uleyle Kimbhe awards a vote to whoever holds the Archmage's Staff.
// A 'custom' criterion: the per-player score (1 for the holder, else 0) is
// computed by the scoring function registered under `customScoringEffectId` in
// src/game/effects/archmage.ts.
// ============================================================================

/** Effect id of the custom scoring function for Uleyle Kimbhe's voter. */
export const STAFF_VOTER_SCORING_ID = 'archmage.scoring.holds-staff';

const voters: ConsortiumVoter[] = [
  {
    id: 'archmage.voter.uleyle-kimbhe',
    name: 'Uleyle Kimbhe',
    title: 'Archmage of Relecour',
    sourcePackId: PACK_ID,
    criterion: 'custom',
    customScoringEffectId: STAFF_VOTER_SCORING_ID,
    description: "Awards a vote to the player who holds the Archmage's Staff.",
    votes: 1,
    isAlwaysFaceUp: false,
    revealed: false,
    // Only enters the voter pool when the Staff room (either side) is in play.
    requiresRoomIds: [STAFF_A_ROOM_ID, STAFF_B_ROOM_ID],
  },
];

export const archmagePack: ContentPack = {
  id: PACK_ID,
  name: "The Archmage's Staff",
  description:
    "Adds the Archmage's Staff room — its center slot grants control of the legendary Staff (a one-of-a-kind Treasure) at the end of the round, and a Mage placed there loses all of its powers.",
  mages: [],
  candidates: [],
  rooms: [archmagesStaffA, archmagesStaffB],
  spells: [],
  legendarySpells: [],
  vaultCards: [staffA, staffB],
  supporters: [],
  voters,
  bellTowerCards: [],
};
