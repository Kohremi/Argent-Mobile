import type { ContentPack } from '../types';
import type {
  BellTowerCard,
  Candidate,
  ConsortiumVoter,
  Mage,
  Room,
  SpellCard,
  ScoringCriterion,
  Department,
  MageColor,
} from '../../game/types';

const PACK_ID = 'base';

// ============================================================================
// Mages — 6 by color + the Archmage's Apprentice
// ============================================================================
//
// Per rulebook, each Mage color has a department-flavored ability. Effect IDs
// reference unimplemented effects (TODO). Off-white mages have no department
// ability.

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
    description: 'May place after casting a spell.',
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
  // Special: gained only via the Archmage's Study room.
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
// Spells — 5 placeholders, real names TBD from the spell deck images
// ============================================================================
//
// TODO: replace placeholder names/levels with real Argent spell cards once we
// have them sourced from card images. Effect IDs are unregistered.

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

const spells: SpellCard[] = [
  placeholderSpell({ id: 'base.spell.placeholder.1', name: 'Placeholder Spell 1', department: 'sorcery' }),
  placeholderSpell({ id: 'base.spell.placeholder.2', name: 'Placeholder Spell 2', department: 'mysticism' }),
  placeholderSpell({ id: 'base.spell.placeholder.3', name: 'Placeholder Spell 3', department: 'natural-magick' }),
  placeholderSpell({ id: 'base.spell.placeholder.4', name: 'Placeholder Spell 4', department: 'divinity' }),
  placeholderSpell({ id: 'base.spell.placeholder.5', name: 'Placeholder Spell 5', department: 'planar-studies' }),
];

// ============================================================================
// Candidates
// ============================================================================
//
// NOTE: The prompt directed us to put all 12 candidates here, but per the real
// rulebook only 6 candidates ship with the base game; the other 6 belong to
// Mancers. Flagged in Open Questions — the planner should confirm where each
// candidate actually belongs and we'll relocate later.
//
// Each candidate's `starterSpellId` cycles through the 5 placeholder spells
// (TODO: each candidate has a unique starting spell in the real game).

function candidate(args: {
  id: string;
  name: string;
  title: string;
  department: Department;
  starterSpellIndex: 0 | 1 | 2 | 3 | 4;
  startingMageColor: MageColor;
}): Candidate {
  return {
    id: args.id,
    name: args.name,
    title: args.title,
    sourcePackId: PACK_ID,
    department: args.department,
    starterSpellId: spells[args.starterSpellIndex]!.id,
    startingMageColor: args.startingMageColor,
  };
}

const candidates: Candidate[] = [
  candidate({ id: 'base.candidate.larimore-burman', name: 'Larimore Burman', title: 'Sorcery', department: 'sorcery', starterSpellIndex: 0, startingMageColor: 'red' }),
  candidate({ id: 'base.candidate.exhufern-le-marigras', name: 'Exhufern Le Marigras', title: 'Natural Magick', department: 'natural-magick', starterSpellIndex: 2, startingMageColor: 'green' }),
  candidate({ id: 'base.candidate.rikhi-kanhamme', name: 'Rikhi Kanhamme', title: 'Sorcery — Applied', department: 'sorcery', starterSpellIndex: 0, startingMageColor: 'red' }),
  candidate({ id: 'base.candidate.mannheim-wildern', name: 'Mannheim Wildern', title: 'Natural Magick — Development', department: 'natural-magick', starterSpellIndex: 2, startingMageColor: 'green' }),
  candidate({ id: 'base.candidate.rheye-cal', name: 'Rheye Cal', title: 'Divinity', department: 'divinity', starterSpellIndex: 3, startingMageColor: 'blue' }),
  candidate({ id: 'base.candidate.byron-krane', name: 'Byron Krane', title: 'Mysticism', department: 'mysticism', starterSpellIndex: 1, startingMageColor: 'grey' }),
  candidate({ id: 'base.candidate.monad-riverime', name: 'Monad Riverime', title: 'Auditor — Students', department: 'students', starterSpellIndex: 0, startingMageColor: 'off-white' }),
  candidate({ id: 'base.candidate.jesca-renetton', name: 'Jesca Renetton', title: 'Curriculum — Students', department: 'students', starterSpellIndex: 1, startingMageColor: 'off-white' }),
  candidate({ id: 'base.candidate.lavanina', name: 'Lavanina', title: 'Planar Studies', department: 'planar-studies', starterSpellIndex: 4, startingMageColor: 'purple' }),
  candidate({ id: 'base.candidate.jion-erjon', name: 'Jion Erjon', title: 'Divinity — Honor Court', department: 'divinity', starterSpellIndex: 3, startingMageColor: 'blue' }),
  candidate({ id: 'base.candidate.xal-ezra', name: 'Xal Ezra', title: 'Planar Studies — Senior Researcher', department: 'planar-studies', starterSpellIndex: 4, startingMageColor: 'purple' }),
  candidate({ id: 'base.candidate.trias-blackwind', name: 'Trias Blackwind', title: 'Students — Body President', department: 'students', starterSpellIndex: 2, startingMageColor: 'off-white' }),
];

// ============================================================================
// Rooms — 15 physical rooms × 2 sides = 30 Room records
// ============================================================================
//
// Action spaces are stubbed (empty arrays). Setup picks one side per physical
// room when assembling the play set.

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
  ...roomPair({ baseId: 'base.room.council-chamber', name: 'Council Chamber', isUniversityCentral: true }),
  ...roomPair({ baseId: 'base.room.library', name: 'Library', isUniversityCentral: true }),
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
  ...roomPair({ baseId: 'base.room.vault', name: 'Vault' }),
  ...roomPair({ baseId: 'base.room.chapel', name: 'Chapel' }),
  ...roomPair({ baseId: 'base.room.student-stores', name: 'Student Stores' }),
  ...roomPair({ baseId: 'base.room.adventuring', name: 'Adventuring' }),
  ...roomPair({ baseId: 'base.room.astronomy-tower', name: 'Astronomy Tower' }),
  ...roomPair({ baseId: 'base.room.great-hall', name: 'Great Hall' }),
  ...roomPair({ baseId: 'base.room.archmages-study', name: "Archmage's Study" }),
  ...roomPair({ baseId: 'base.room.dormitory', name: 'Dormitory' }),
];

// ============================================================================
// Voters — 2 always-face-up + 16 in the face-down pool = 18 total
// ============================================================================
//
// TODO: real vote counts from the voter cards (rulebook specifies each tile's
// printed value). Stubbed at 1 vote per voter for now.

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
    votes: args.votes ?? 1, // TODO: real values
    isAlwaysFaceUp: args.isAlwaysFaceUp ?? false,
    revealed: args.isAlwaysFaceUp ?? false,
  };
}

const voters: ConsortiumVoter[] = [
  // Always face-up.
  voter({ id: 'base.voter.most-supporters', name: 'Most Supporters', criterion: 'most-supporters', isAlwaysFaceUp: true }),
  voter({ id: 'base.voter.most-influence', name: 'Most Influence', criterion: 'most-influence', isAlwaysFaceUp: true }),

  // Face-down pool of 16.
  voter({ id: 'base.voter.most-mana', name: 'Most Mana', criterion: 'most-mana' }),
  voter({ id: 'base.voter.most-gold', name: 'Most Gold', criterion: 'most-gold' }),
  voter({ id: 'base.voter.most-marks', name: 'Most Marks', criterion: 'most-marks' }),
  voter({ id: 'base.voter.most-intelligence', name: 'Most Intelligence', criterion: 'most-intelligence' }),
  voter({ id: 'base.voter.most-wisdom', name: 'Most Wisdom', criterion: 'most-wisdom' }),
  voter({ id: 'base.voter.most-research', name: 'Most Research', criterion: 'most-research' }),
  voter({ id: 'base.voter.most-treasures', name: 'Most Treasures', criterion: 'most-treasures' }),
  voter({ id: 'base.voter.most-consumables', name: 'Most Consumables', criterion: 'most-consumables' }),
  voter({ id: 'base.voter.most-diversity', name: 'Most Diversity', criterion: 'most-diversity' }),
  voter({ id: 'base.voter.most-sorcery', name: 'Most Sorcery', criterion: 'most-sorcery' }),
  voter({ id: 'base.voter.most-mysticism', name: 'Most Mysticism', criterion: 'most-mysticism' }),
  voter({ id: 'base.voter.most-natural-magick', name: 'Most Natural Magick', criterion: 'most-natural-magick' }),
  voter({ id: 'base.voter.most-planar-studies', name: 'Most Planar Studies', criterion: 'most-planar-studies' }),
  voter({ id: 'base.voter.most-divinity', name: 'Most Divinity', criterion: 'most-divinity' }),
  voter({ id: 'base.voter.second-most-influence', name: '2nd Most Influence', criterion: 'second-most-influence' }),
  voter({ id: 'base.voter.second-most-supporters', name: '2nd Most Supporters', criterion: 'second-most-supporters' }),
];

// ============================================================================
// Bell Tower — 5 offerings with player-count thresholds
// ============================================================================
//
// minPlayers thresholds [2, 2, 3, 4, 5] mean 2 cards are always present, with
// additional cards activating at 3p, 4p, and 5p. Real card names TBD (rulebook
// references "Popularity" at minimum); placeholders for now.

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
  vaultCards: [],
  supporters: [],
  voters,
  bellTowerCards,
};
