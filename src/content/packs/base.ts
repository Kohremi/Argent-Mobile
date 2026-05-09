import type { ContentPack } from '../types';
import type {
  ActionSpace,
  BellTowerCard,
  Candidate,
  ConsortiumVoter,
  Department,
  Mage,
  MageColor,
  Room,
  ScoringCriterion,
  SpellCard,
  SupporterCard,
  VaultCard,
} from '../../game/types';

const PACK_ID = 'base';

// ============================================================================
// Mages — 6 by color + the Archmage's Apprentice
// ============================================================================

const mages: Mage[] = [
  {
    id: 'base.mage.sorcery',
    name: 'Sorcery Mage',
    sourcePackId: PACK_ID,
    color: 'red',
    department: 'sorcery',
    description:
      'Ars Magna: as a fast action, spend 1 Mana to wound a Mage and take its slot.',
    aPowerEffectId: 'base.mage.sorcery.a',
    bPowerEffectId: 'base.mage.sorcery.b',
  },
  {
    id: 'base.mage.mysticism',
    name: 'Mysticism Mage',
    sourcePackId: PACK_ID,
    color: 'grey',
    department: 'mysticism',
    description: 'May place after casting a spell (and after reactions resolve).',
    aPowerEffectId: 'base.mage.mysticism.a',
    bPowerEffectId: 'base.mage.mysticism.b',
  },
  {
    id: 'base.mage.natural-magick',
    name: 'Natural Magick Mage',
    sourcePackId: PACK_ID,
    color: 'green',
    department: 'natural-magick',
    description: 'Cannot be wounded.',
    aPowerEffectId: 'base.mage.natural-magick.a',
    bPowerEffectId: 'base.mage.natural-magick.b',
  },
  {
    id: 'base.mage.planar-studies',
    name: 'Planar Studies Mage',
    sourcePackId: PACK_ID,
    color: 'purple',
    department: 'planar-studies',
    description: 'Place as a fast action.',
    aPowerEffectId: 'base.mage.planar-studies.a',
    bPowerEffectId: 'base.mage.planar-studies.b',
  },
  {
    id: 'base.mage.divinity',
    name: 'Divinity Mage',
    sourcePackId: PACK_ID,
    color: 'blue',
    department: 'divinity',
    description: 'Immune to spells cast by rival mages.',
    aPowerEffectId: 'base.mage.divinity.a',
    bPowerEffectId: 'base.mage.divinity.b',
  },
  {
    id: 'base.mage.neutral',
    name: 'Neutral Mage',
    sourcePackId: PACK_ID,
    color: 'off-white',
    department: null,
    description: 'No department ability.',
  },
  {
    id: 'base.mage.archmages-apprentice',
    name: "Archmage's Apprentice",
    sourcePackId: PACK_ID,
    color: 'off-white',
    department: null,
    description:
      "Special Mage gained from the Archmage's Study; not in the starting Mage allocation.",
  },
];

// ============================================================================
// Spells
// ============================================================================
//
// Burn (Sorcery, L1–L3) is wired up as the Vertical Slice 2 spell. The other
// four are placeholders pending real names from card images.

function placeholderSpell(args: {
  id: string;
  name: string;
  department: Department;
}): SpellCard {
  return {
    id: args.id,
    name: args.name,
    sourcePackId: PACK_ID,
    department: args.department,
    levels: [
      {
        level: 1,
        title: `${args.name} I`,
        manaCost: 1,
        effectId: `${args.id}.l1`,
        timing: 'action',
      },
      {
        level: 2,
        title: `${args.name} II`,
        manaCost: 2,
        effectId: `${args.id}.l2`,
        timing: 'action',
      },
      {
        level: 3,
        title: `${args.name} III`,
        manaCost: 3,
        effectId: `${args.id}.l3`,
        timing: 'action',
      },
    ],
  };
}

const burnSpell: SpellCard = {
  id: 'base.spell.burn',
  name: 'Burn',
  sourcePackId: PACK_ID,
  department: 'sorcery',
  levels: [
    {
      level: 1,
      title: 'Burn',
      manaCost: 1,
      effectId: 'base.spell.burn.l1',
      timing: 'action',
    },
    {
      level: 2,
      title: 'Conflagration',
      manaCost: 2,
      effectId: 'base.spell.burn.l2',
      timing: 'action',
    },
    {
      level: 3,
      title: 'Inferno',
      manaCost: 4,
      effectId: 'base.spell.burn.l3',
      timing: 'action',
    },
  ],
};

const spells: SpellCard[] = [
  burnSpell,
  placeholderSpell({
    id: 'base.spell.placeholder.2',
    name: 'Placeholder Spell 2',
    department: 'mysticism',
  }),
  placeholderSpell({
    id: 'base.spell.placeholder.3',
    name: 'Placeholder Spell 3',
    department: 'natural-magick',
  }),
  placeholderSpell({
    id: 'base.spell.placeholder.4',
    name: 'Placeholder Spell 4',
    department: 'divinity',
  }),
  placeholderSpell({
    id: 'base.spell.placeholder.5',
    name: 'Placeholder Spell 5',
    department: 'planar-studies',
  }),
];

// ============================================================================
// Vault cards — Phase Steppers wired up; rest deferred
// ============================================================================

const phaseSteppers: VaultCard = {
  id: 'base.vault.phase-steppers',
  name: 'Phase Steppers',
  sourcePackId: PACK_ID,
  type: 'consumable',
  goldCost: 3,
  effectId: 'base.vault.phase-steppers.react',
  timing: 'reaction',
};

// Two placeholder Treasures so the Vault tableau has cards a player can
// actually buy. Effect IDs are unregistered (treasures are passive in real
// Argent; their effect-on-use behavior comes later).
const placeholderTreasure1: VaultCard = {
  id: 'base.vault.placeholder-treasure-1',
  name: 'Placeholder Treasure 1',
  sourcePackId: PACK_ID,
  type: 'treasure',
  goldCost: 2,
  effectId: 'base.vault.placeholder-treasure-1',
};

const placeholderTreasure2: VaultCard = {
  id: 'base.vault.placeholder-treasure-2',
  name: 'Placeholder Treasure 2',
  sourcePackId: PACK_ID,
  type: 'treasure',
  goldCost: 4,
  effectId: 'base.vault.placeholder-treasure-2',
};

const vaultCards: VaultCard[] = [
  phaseSteppers,
  placeholderTreasure1,
  placeholderTreasure2,
];

// ============================================================================
// Supporters — TODO
// ============================================================================

const supporters: SupporterCard[] = [];

// ============================================================================
// Candidates — base game keeps 6 (per rulebook); other 6 live in Mancers
// ============================================================================

function candidate(args: {
  id: string;
  name: string;
  title: string;
  department: Department;
  starterSpellId: string;
  startingMageColor: MageColor | 'neutral';
  startingExtraMeritBadge: boolean;
}): Candidate {
  return {
    id: args.id,
    name: args.name,
    title: args.title,
    sourcePackId: PACK_ID,
    department: args.department,
    starterSpellId: args.starterSpellId,
    startingMageColor: args.startingMageColor,
    startingExtraMeritBadge: args.startingExtraMeritBadge,
  };
}

const candidates: Candidate[] = [
  candidate({
    id: 'base.candidate.larimore-burman',
    name: 'Larimore Burman',
    title: 'Sorcery',
    department: 'sorcery',
    starterSpellId: 'base.spell.burn',
    startingMageColor: 'red',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.exhufern-le-marigras',
    name: 'Exhufern Le Marigras',
    title: 'Natural Magick',
    department: 'natural-magick',
    starterSpellId: 'base.spell.placeholder.3',
    startingMageColor: 'green',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.rheye-cal',
    name: 'Rheye Cal',
    title: 'Divinity',
    department: 'divinity',
    starterSpellId: 'base.spell.placeholder.4',
    startingMageColor: 'blue',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.byron-krane',
    name: 'Byron Krane',
    title: 'Mysticism',
    department: 'mysticism',
    starterSpellId: 'base.spell.placeholder.2',
    startingMageColor: 'grey',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.lavanina',
    name: 'Lavanina',
    title: 'Planar Studies',
    department: 'planar-studies',
    starterSpellId: 'base.spell.placeholder.5',
    startingMageColor: 'purple',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.trias-blackwind',
    name: 'Trias Blackwind',
    title: 'Students — Body President',
    department: 'students',
    // Students-department candidates start with neutral mages + 1 extra
    // Merit Badge instead of department-color bonus mages.
    starterSpellId: 'base.spell.placeholder.2',
    startingMageColor: 'neutral',
    startingExtraMeritBadge: true,
  }),
];

// ============================================================================
// Rooms — 15 physical rooms × 2 sides = 30 Room records
// ============================================================================
//
// Library side A is wired up with slot 1 ("Gain 1 INT OR 1 WIS OR 1 Research")
// for Vertical Slice 1; everything else stays stubbed (empty action spaces).

function regularSlot(args: {
  id: string;
  roomId: string;
  index: number;
  effectId: string;
}): ActionSpace {
  return {
    id: args.id,
    roomId: args.roomId,
    index: args.index,
    slotType: 'regular',
    occupant: null,
    effectId: args.effectId,
  };
}

const libraryASlot1: ActionSpace = regularSlot({
  id: 'base.room.library.a.slot-1',
  roomId: 'base.room.library.a',
  index: 0,
  effectId: 'base.room.library-a.slot-1',
});

const libraryA: Room = {
  id: 'base.room.library.a',
  name: 'Library',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [libraryASlot1],
};

const libraryB: Room = {
  id: 'base.room.library.b',
  name: 'Library',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [],
};

// Vault A — three distinct slot effects per the room file:
//   Slot 1 (merit, costs 1 MB to place): Draft a Vault Card AND Gain 4 Gold
//   Slot 2 (regular):                    Draft a Vault Card OR Gain 5 Gold
//   Slot 3 (regular):                    Gain 3 Gold

const vaultASlot1: ActionSpace = {
  id: 'base.room.vault.a.slot-1',
  roomId: 'base.room.vault.a',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.vault-a.slot-1',
  costToActivate: { meritBadges: 1 },
};

const vaultASlot2: ActionSpace = {
  id: 'base.room.vault.a.slot-2',
  roomId: 'base.room.vault.a',
  index: 1,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.room.vault-a.slot-2',
};

const vaultASlot3: ActionSpace = {
  id: 'base.room.vault.a.slot-3',
  roomId: 'base.room.vault.a',
  index: 2,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.room.vault-a.slot-3',
};

const vaultA: Room = {
  id: 'base.room.vault.a',
  name: 'Vault',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [vaultASlot1, vaultASlot2, vaultASlot3],
};

const vaultB: Room = {
  id: 'base.room.vault.b',
  name: 'Vault',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [],
};

interface RoomPairOpts {
  baseId: string;
  name: string;
  isUniversityCentral?: boolean;
  isInstantRoom?: { a?: boolean; b?: boolean };
  cannotBePlacedInDirectly?: boolean;
  cannotBeLocked?: boolean;
}

function roomPair(opts: RoomPairOpts): Room[] {
  const {
    baseId,
    name,
    isUniversityCentral = false,
    isInstantRoom = {},
    cannotBePlacedInDirectly = false,
    cannotBeLocked = false,
  } = opts;
  return [
    {
      id: `${baseId}.a`,
      name,
      sourcePackId: PACK_ID,
      isUniversityCentral,
      side: 'A',
      isInstantRoom: isInstantRoom.a ?? false,
      cannotBePlacedInDirectly,
      cannotBeLocked,
      actionSpaces: [],
    },
    {
      id: `${baseId}.b`,
      name,
      sourcePackId: PACK_ID,
      isUniversityCentral,
      side: 'B',
      isInstantRoom: isInstantRoom.b ?? false,
      cannotBePlacedInDirectly,
      cannotBeLocked,
      actionSpaces: [],
    },
  ];
}

const rooms: Room[] = [
  // University Central — always present.
  ...roomPair({
    baseId: 'base.room.council-chamber',
    name: 'Council Chamber',
    isUniversityCentral: true,
  }),
  libraryA,
  libraryB,
  ...roomPair({
    baseId: 'base.room.infirmary',
    name: 'Infirmary',
    isUniversityCentral: true,
    cannotBePlacedInDirectly: true,
    cannotBeLocked: true,
    isInstantRoom: { a: true, b: true },
  }),

  // Variable pool — 12 physical rooms.
  ...roomPair({ baseId: 'base.room.training-fields', name: 'Training Fields' }),
  ...roomPair({ baseId: 'base.room.courtyard', name: 'Courtyard' }),
  ...roomPair({ baseId: 'base.room.catacombs', name: 'Catacombs' }),
  ...roomPair({ baseId: 'base.room.guilds', name: 'Guilds' }),
  vaultA,
  vaultB,
  ...roomPair({ baseId: 'base.room.chapel', name: 'Chapel' }),
  ...roomPair({ baseId: 'base.room.student-stores', name: 'Student Stores' }),
  ...roomPair({ baseId: 'base.room.adventuring', name: 'Adventuring' }),
  ...roomPair({ baseId: 'base.room.astronomy-tower', name: 'Astronomy Tower' }),
  ...roomPair({ baseId: 'base.room.great-hall', name: 'Great Hall' }),
  ...roomPair({
    baseId: 'base.room.archmages-study',
    name: "Archmage's Study",
  }),
  ...roomPair({ baseId: 'base.room.dormitory', name: 'Dormitory' }),
];

// ============================================================================
// Voters — 2 always-face-up + 16 in the face-down pool = 18 total
// ============================================================================

function voter(args: {
  id: string;
  name: string;
  criterion: ScoringCriterion;
  votes?: number;
  isAlwaysFaceUp?: boolean;
}): ConsortiumVoter {
  return {
    id: args.id,
    name: args.name,
    sourcePackId: PACK_ID,
    criterion: args.criterion,
    votes: args.votes ?? 1,
    isAlwaysFaceUp: args.isAlwaysFaceUp ?? false,
    revealed: args.isAlwaysFaceUp ?? false,
  };
}

const voters: ConsortiumVoter[] = [
  voter({
    id: 'base.voter.most-supporters',
    name: 'Most Supporters',
    criterion: 'most-supporters',
    isAlwaysFaceUp: true,
  }),
  voter({
    id: 'base.voter.most-influence',
    name: 'Most Influence',
    criterion: 'most-influence',
    isAlwaysFaceUp: true,
  }),
  voter({ id: 'base.voter.most-mana', name: 'Most Mana', criterion: 'most-mana' }),
  voter({ id: 'base.voter.most-gold', name: 'Most Gold', criterion: 'most-gold' }),
  voter({ id: 'base.voter.most-marks', name: 'Most Marks', criterion: 'most-marks' }),
  voter({
    id: 'base.voter.most-intelligence',
    name: 'Most Intelligence',
    criterion: 'most-intelligence',
  }),
  voter({ id: 'base.voter.most-wisdom', name: 'Most Wisdom', criterion: 'most-wisdom' }),
  voter({
    id: 'base.voter.most-research',
    name: 'Most Research',
    criterion: 'most-research',
  }),
  voter({
    id: 'base.voter.most-treasures',
    name: 'Most Treasures',
    criterion: 'most-treasures',
  }),
  voter({
    id: 'base.voter.most-consumables',
    name: 'Most Consumables',
    criterion: 'most-consumables',
  }),
  voter({
    id: 'base.voter.most-diversity',
    name: 'Most Diversity',
    criterion: 'most-diversity',
  }),
  voter({
    id: 'base.voter.most-sorcery',
    name: 'Most Sorcery',
    criterion: 'most-sorcery',
  }),
  voter({
    id: 'base.voter.most-mysticism',
    name: 'Most Mysticism',
    criterion: 'most-mysticism',
  }),
  voter({
    id: 'base.voter.most-natural-magick',
    name: 'Most Natural Magick',
    criterion: 'most-natural-magick',
  }),
  voter({
    id: 'base.voter.most-planar-studies',
    name: 'Most Planar Studies',
    criterion: 'most-planar-studies',
  }),
  voter({
    id: 'base.voter.most-divinity',
    name: 'Most Divinity',
    criterion: 'most-divinity',
  }),
  voter({
    id: 'base.voter.second-most-influence',
    name: '2nd Most Influence',
    criterion: 'second-most-influence',
  }),
  voter({
    id: 'base.voter.second-most-supporters',
    name: '2nd Most Supporters',
    criterion: 'second-most-supporters',
  }),
];

// ============================================================================
// Bell Tower — 5 placeholder offerings with player-count thresholds
// ============================================================================

const bellTowerCards: BellTowerCard[] = [
  {
    id: 'base.bell.placeholder.1',
    name: 'Bell Tower Offering 1',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.placeholder.1',
    minPlayers: 2,
  },
  {
    id: 'base.bell.placeholder.2',
    name: 'Bell Tower Offering 2',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.placeholder.2',
    minPlayers: 2,
  },
  {
    id: 'base.bell.placeholder.3',
    name: 'Bell Tower Offering 3',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.placeholder.3',
    minPlayers: 3,
  },
  {
    id: 'base.bell.placeholder.4',
    name: 'Bell Tower Offering 4',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.placeholder.4',
    minPlayers: 4,
  },
  {
    id: 'base.bell.placeholder.5',
    name: 'Bell Tower Offering 5',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.placeholder.5',
    minPlayers: 5,
  },
];

// ============================================================================
// Pack
// ============================================================================

export const baseGamePack: ContentPack = {
  id: PACK_ID,
  name: 'Argent: The Consortium',
  description: 'Core mages, candidates, rooms, spells, voters, and bell tower.',
  mages,
  candidates,
  rooms,
  spells,
  legendarySpells: [],
  vaultCards,
  supporters,
  voters,
  bellTowerCards,
};
