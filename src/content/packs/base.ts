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

// ============================================================================
// Faction Leader spells — held in `legendarySpells`, never shuffled into the
// regular spell deck. Each leader's player owns their unique spell at game
// start; opponents can't acquire it through normal play.
//
// Per the room file, the L1 effect is the "real" spell (use once per round —
// enforced by the OwnedSpell.exhausted flag, refreshed at round-setup).
// L2/L3 are stub upgrades; effects unregistered.
// ============================================================================

function leaderSpell(args: {
  id: string;
  name: string;
  department: Department;
  l1ManaCost: number;
  l1Timing: 'action' | 'fast-action';
}): SpellCard {
  return {
    id: args.id,
    name: args.name,
    sourcePackId: PACK_ID,
    department: args.department,
    levels: [
      {
        level: 1,
        title: args.name,
        manaCost: args.l1ManaCost,
        effectId: `${args.id}.l1`,
        timing: args.l1Timing,
      },
      {
        level: 2,
        title: `${args.name} II`,
        manaCost: args.l1ManaCost + 1,
        effectId: `${args.id}.l2`,
        timing: args.l1Timing,
      },
      {
        level: 3,
        title: `${args.name} III`,
        manaCost: args.l1ManaCost + 2,
        effectId: `${args.id}.l3`,
        timing: args.l1Timing,
      },
    ],
  };
}

/** Larimore Burman — 1 Mana, fast action: banish a Mage. */
const flashOfLight: SpellCard = leaderSpell({
  id: 'base.spell.flash-of-light',
  name: 'Flash of Light',
  department: 'sorcery',
  l1ManaCost: 1,
  l1Timing: 'fast-action',
});

/** Trias Blackwind — 1 Mana, action: place a neutral mage from supply. */
const livingImage: SpellCard = leaderSpell({
  id: 'base.spell.living-image',
  name: 'Living Image',
  department: 'students',
  l1ManaCost: 1,
  l1Timing: 'action',
});

/** Byron Krane — Free, action: gain 2 mana. */
const trance: SpellCard = leaderSpell({
  id: 'base.spell.trance',
  name: 'Trance',
  department: 'mysticism',
  l1ManaCost: 0,
  l1Timing: 'action',
});

/** Exhufern Le Marigras — 1 Mana, action: move opponent's mage in same room. */
const strengthOfEarth: SpellCard = leaderSpell({
  id: 'base.spell.strength-of-earth',
  name: 'Strength of Earth',
  department: 'natural-magick',
  l1ManaCost: 1,
  l1Timing: 'action',
});

/** Rheye Cal — 1 Mana, fast action: move a Mage from infirmary to a slot. */
const bless: SpellCard = leaderSpell({
  id: 'base.spell.bless',
  name: 'Bless',
  department: 'divinity',
  l1ManaCost: 1,
  l1Timing: 'fast-action',
});

/** Xal Ezra — 1 Mana, action: shadow an opponent's mage. */
const paralocation: SpellCard = leaderSpell({
  id: 'base.spell.paralocation',
  name: 'Paralocation',
  department: 'planar-studies',
  l1ManaCost: 1,
  l1Timing: 'action',
});

const legendarySpells: SpellCard[] = [
  flashOfLight,
  livingImage,
  trance,
  strengthOfEarth,
  bless,
  paralocation,
];

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
// Supporters — the 36 base-game cards from the Argent data sheet.
//
// `effectId` always matches the card id; effects for the simple resource-gain
// supporters are registered in `effects/base.ts`. The remainder (mage swaps,
// up-to-N swap loops, mage manipulation, scoring metaeffects) are not yet
// implemented; PLAY_SUPPORTER on those will throw "effect not registered".
// The cards still exist in the tableau / office so they're visible and can
// be drafted for endgame scoring.
// ============================================================================

const supporters: SupporterCard[] = [
  {
    id: 'base.supporter.adelaide-chivers',
    name: 'Adelaide Chivers',
    title: 'Professor of Correspondence',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'action',
    effectId: 'base.supporter.adelaide-chivers',
    description:
      'Gain 2 Research. Use this research only on Planar (Purple) Spells.',
  },
  {
    id: 'base.supporter.arec-russel-zane',
    name: 'Arec Russel Zane',
    title: 'Prodigal Sorceror',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'action',
    effectId: 'base.supporter.arec-russel-zane',
    description: 'Swap 3 Gold for a Sorcery (Red) Mage from the supply.',
  },
  {
    id: 'base.supporter.allys-mehrmus',
    name: 'Allys Mehrmus',
    title: 'Vice Dean of Sorcery',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'fast-action',
    effectId: 'base.supporter.allys-mehrmus',
    description: 'Gain 3 IP.',
  },
  {
    id: 'base.supporter.alumis',
    name: 'Alumis',
    title: 'Professor of Umbramancy',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'action',
    effectId: 'base.supporter.alumis',
    description: 'Gain 2 Marks.',
  },
  {
    id: 'base.supporter.andros-duvalt',
    name: 'Andros DuValt',
    title: 'Vice Dean of Natural Magick',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'fast-action',
    effectId: 'base.supporter.andros-duvalt',
    description: 'Banish a Mage.',
  },
  {
    id: 'base.supporter.andrus-dochartaigh',
    name: 'Andrus Dochartaigh',
    title: 'Associate Professor of Protection',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'fast-action',
    effectId: 'base.supporter.andrus-dochartaigh',
    description: 'Gain 2 Mana.',
  },
  {
    id: 'base.supporter.batrov-wargrave',
    name: 'Batrov Wargrave',
    title: 'Vice Dean of Planar Studies',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'action',
    effectId: 'base.supporter.batrov-wargrave',
    description: 'Gain 3 Research.',
  },
  {
    id: 'base.supporter.borneo',
    name: 'Borneo',
    title: 'Mystic Familiar',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'passive',
    effectId: 'base.supporter.borneo',
    description: 'Place this card in your discard pile.',
  },
  {
    id: 'base.supporter.wandering-calculus',
    name: 'Wandering Calculus',
    title: 'Planar Familiar',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'passive',
    effectId: 'base.supporter.wandering-calculus',
    description: 'Place this card in your discard pile.',
  },
  {
    id: 'base.supporter.hai-of-noirwood',
    name: 'Hai of Noirwood',
    title: "Librarian's Assistant",
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'action',
    effectId: 'base.supporter.hai-of-noirwood',
    description: 'Swap 2 Gold for a Mark, up to 3 times.',
  },
  {
    id: 'base.supporter.jaimes-kalin',
    name: 'Jaimes Kalin',
    title: 'Professor of Druidism',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'action',
    effectId: 'base.supporter.jaimes-kalin',
    description:
      'Gain 2 Research. Use this research only on Nature (Green) spells.',
  },
  {
    id: 'base.supporter.jance-eylon',
    name: 'Jance Eylon',
    title: 'Editor of the Student Newspaper "Seeing Eye"',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'action',
    effectId: 'base.supporter.jance-eylon',
    description:
      'Gain 2 Research. Use this research only on Mystic (Grey) Spells.',
  },
  {
    id: 'base.supporter.jasper-haekel',
    name: 'Jasper Haekel',
    title: 'Dark World Exchange Student',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'action',
    effectId: 'base.supporter.jasper-haekel',
    description: 'Gain a Mark.',
  },
  {
    id: 'base.supporter.juto',
    name: 'Juto',
    title: 'Divinity Familiar',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'passive',
    effectId: 'base.supporter.juto',
    description: 'Place this card in your discard pile.',
  },
  {
    id: 'base.supporter.kallistar-flarechild',
    name: 'Kallistar Flarechild',
    title: 'Dancing Club President',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'fast-action',
    effectId: 'base.supporter.kallistar-flarechild',
    description: 'Gain 1 IP.',
  },
  {
    id: 'base.supporter.kas-karrowary',
    name: 'Kas Karrowary',
    title: 'Professor of Spiritualism',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'action',
    effectId: 'base.supporter.kas-karrowary',
    description:
      'Gain 2 Research. Use this research only on Divinity (Blue) Spells.',
  },
  {
    id: 'base.supporter.kavri-shi-shorec',
    name: 'Kavri Shi Shorec',
    title: 'Divinity Department Receptionist',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'action',
    effectId: 'base.supporter.kavri-shi-shorec',
    description: 'Swap 3 Gold for a Divinity (Blue) Mage from the supply.',
  },
  {
    id: 'base.supporter.lesandra-machan',
    name: 'Lesandra Machan',
    title: "Vice Dean's Assistant",
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'action',
    effectId: 'base.supporter.lesandra-machan',
    description: 'Swap 3 Gold for a Mystic (Grey) Mage from the supply.',
  },
  {
    id: 'base.supporter.letum-conspicere',
    name: 'Letum Conspicere',
    title: 'Professor of Undertaking',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'fast-action',
    effectId: 'base.supporter.letum-conspicere',
    description: 'Wound a Mage.',
  },
  {
    id: 'base.supporter.luras-wythe-cariolis',
    name: 'Luras Wythe-Cariolis',
    title: 'Dean of Mysticism',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'action',
    effectId: 'base.supporter.luras-wythe-cariolis',
    description:
      'Choose a Voter. Each player may place a Mark on that Voter if they have not already done so.',
  },
  {
    id: 'base.supporter.lynssara-yuuno',
    name: 'Lynssara Yuuno',
    title: 'Vice Chair of Applied Sorcery',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'action',
    effectId: 'base.supporter.lynssara-yuuno',
    description: 'Swap 2 Gold for 1 IP, up to 4 times.',
  },
  {
    id: 'base.supporter.st-mikhail-isen',
    name: 'St. Mikhail Isen',
    title: 'Interim Dean of Divinity',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'fast-action',
    effectId: 'base.supporter.st-mikhail-isen',
    description: 'Gain 4 Mana.',
  },
  {
    id: 'base.supporter.pendros-schalla',
    name: 'Pendros Schalla',
    title: 'Graduate Student',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'action',
    effectId: 'base.supporter.pendros-schalla',
    description: 'Swap 3 Gold for a Natural (Green) Mage from the supply.',
  },
  {
    id: 'base.supporter.quan-gon-kall',
    name: 'Quan Gon Kall',
    title: 'Professor of Enchantment',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'fast-action',
    effectId: 'base.supporter.quan-gon-kall',
    description: 'Gain 2 IP.',
  },
  {
    id: 'base.supporter.raffique-van-anzel',
    name: 'Raffique Van Anzel',
    title: 'Professor of Dimensional Studies',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'action',
    effectId: 'base.supporter.raffique-van-anzel',
    description: 'Swap 2 Gold for 1 Research, up to 4 times.',
  },
  {
    id: 'base.supporter.rennel-pedrigor',
    name: 'Rennel Pedrigor',
    title: 'University Groundskeeper',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'fast-action',
    effectId: 'base.supporter.rennel-pedrigor',
    description: "Shadow an opponent's Mage.",
  },
  {
    id: 'base.supporter.rixia-van-sorrel',
    name: 'Rixia Van Sorrel',
    title: 'Prodigy Student',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'action',
    effectId: 'base.supporter.rixia-van-sorrel',
    description: 'Gain 1 Research.',
  },
  {
    id: 'base.supporter.salamander',
    name: 'Salamander',
    title: 'Sorcery Familiar',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'passive',
    effectId: 'base.supporter.salamander',
    description: 'Place this card in your discard pile.',
  },
  {
    id: 'base.supporter.salem-silver',
    name: 'Salem Silver',
    title: 'Professor of Exorcism',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'fast-action',
    effectId: 'base.supporter.salem-silver',
    description: 'Gain 3 Mana.',
  },
  {
    id: 'base.supporter.tanis-trilives',
    name: 'Tanis Trilives',
    title: 'University Drama Troupe Director',
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'action',
    effectId: 'base.supporter.tanis-trilives',
    description: 'Swap 1 Gold for 1 Mana, up to 5 times.',
  },
  {
    id: 'base.supporter.vellimoor-cantz',
    name: 'Vellimoor Cantz',
    title: 'Chief Librarian',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'action',
    effectId: 'base.supporter.vellimoor-cantz',
    description:
      'Gain 2 Research. Use this research only on Sorcery (Red) Spells.',
  },
  {
    id: 'base.supporter.welsie-acktern',
    name: 'Welsie Acktern',
    title: 'Professor of Chronomancy',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'action',
    effectId: 'base.supporter.welsie-acktern',
    description: 'Gain 2 Research.',
  },
  {
    id: 'base.supporter.white-ash',
    name: 'White Ash',
    title: 'Student Events Committee Chairwoman',
    sourcePackId: PACK_ID,
    department: 'wild',
    timing: 'endgame',
    effectId: 'base.supporter.white-ash',
    description:
      'Counts as a Supporter of any type. You must announce which department before Voters are revealed.',
  },
  {
    id: 'base.supporter.wilhelm-barts',
    name: 'Wilhelm Barts',
    title: 'Research Assistant',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'action',
    effectId: 'base.supporter.wilhelm-barts',
    description: 'Swap 3 Gold for a Planar (Purple) Mage from the supply.',
  },
  {
    id: 'base.supporter.wyvern',
    name: 'Wyvern',
    title: 'Nature Familiar',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'passive',
    effectId: 'base.supporter.wyvern',
    description: 'Place this card in your discard pile.',
  },
  {
    id: 'base.supporter.yinsei-arlington',
    name: 'Yinsei Arlington',
    title: 'Games Coordinator',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'fast-action',
    effectId: 'base.supporter.yinsei-arlington',
    description: 'Move a Mage into another slot in the same room.',
  },
];

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

// Each candidate is a faction leader. At game start they receive 2 Mages of
// their faction's color and their unique starter spell (held in
// `legendarySpells`).
const candidates: Candidate[] = [
  candidate({
    id: 'base.candidate.larimore-burman',
    name: 'Larimore Burman',
    title: 'Sorcery',
    department: 'sorcery',
    starterSpellId: 'base.spell.flash-of-light',
    startingMageColor: 'red',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.exhufern-le-marigras',
    name: 'Exhufern Le Marigras',
    title: 'Natural Magick',
    department: 'natural-magick',
    starterSpellId: 'base.spell.strength-of-earth',
    startingMageColor: 'green',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.rheye-cal',
    name: 'Rheye Cal',
    title: 'Divinity',
    department: 'divinity',
    starterSpellId: 'base.spell.bless',
    startingMageColor: 'blue',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.byron-krane',
    name: 'Byron Krane',
    title: 'Mysticism',
    department: 'mysticism',
    starterSpellId: 'base.spell.trance',
    startingMageColor: 'grey',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.xal-ezra',
    name: 'Xal Ezra',
    title: 'Planar Studies',
    department: 'planar-studies',
    starterSpellId: 'base.spell.paralocation',
    startingMageColor: 'purple',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.trias-blackwind',
    name: 'Trias Blackwind',
    title: 'Students — Body President',
    department: 'students',
    starterSpellId: 'base.spell.living-image',
    startingMageColor: 'neutral',
    // Students leaders receive an extra Merit Badge per the earlier
    // rulebook reading. Easy to flip if the room file revises this later.
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

// Council Chamber Side A — per the room file. Each player may only place a
// single mage in this room per round (`maxMagesPerPlayerPerRound: 1`).
//   Slot 1 (merit, 1 MB): Draft a supporter OR gain a Mark
//   Slots 2–5 (regular):  Draft a supporter OR gain a Mark

function councilSlot(index: number, slotType: 'regular' | 'merit'): ActionSpace {
  const id = `base.room.council-chamber.a.slot-${index}`;
  const base: ActionSpace = {
    id,
    roomId: 'base.room.council-chamber.a',
    index: index - 1,
    slotType,
    occupant: null,
    effectId: 'base.room.council-chamber-a.slot',
    description: 'Choose to Draft a Supporter or gain a Mark.',
  };
  if (slotType === 'merit') {
    return { ...base, costToActivate: { meritBadges: 1 } };
  }
  return base;
}

const councilChamberA: Room = {
  id: 'base.room.council-chamber.a',
  name: 'Council Chamber',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description: 'Each player may only place a single mage in this room per round.',
  actionSpaces: [
    councilSlot(1, 'merit'),
    councilSlot(2, 'regular'),
    councilSlot(3, 'regular'),
    councilSlot(4, 'regular'),
    councilSlot(5, 'regular'),
  ],
  maxMagesPerPlayerPerRound: 1,
};

const councilChamberB: Room = {
  id: 'base.room.council-chamber.b',
  name: 'Council Chamber',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [],
};

// Library Side A — per the room file:
//   Slot 1 (merit, 1 MB): Gain 1 WIS AND Draft a Vault Card
//   Slot 2 (merit, 1 MB): Gain 1 INT AND gain 1 Research
//   Slot 3 (regular):     Gain a Buy AND gain 1 Research
//   Slot 4 (regular):     Choose 1 of: 1 INT / 1 WIS / 1 Research

const librarySlot1: ActionSpace = {
  id: 'base.room.library.a.slot-1',
  roomId: 'base.room.library.a',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.library-a.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Gain 1 WIS AND Draft a Vault Card.',
};

const librarySlot2: ActionSpace = {
  id: 'base.room.library.a.slot-2',
  roomId: 'base.room.library.a',
  index: 1,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.library-a.slot-2',
  costToActivate: { meritBadges: 1 },
  description: 'Gain 1 INT and gain 1 Research.',
};

const librarySlot3: ActionSpace = {
  ...regularSlot({
    id: 'base.room.library.a.slot-3',
    roomId: 'base.room.library.a',
    index: 2,
    effectId: 'base.room.library-a.slot-3',
  }),
  description: 'Gain a Buy and gain 1 Research.',
};

const librarySlot4: ActionSpace = {
  ...regularSlot({
    id: 'base.room.library.a.slot-4',
    roomId: 'base.room.library.a',
    index: 3,
    effectId: 'base.room.library-a.slot-4',
  }),
  description: 'Choose 1: Gain 1 INT / Gain 1 WIS / Gain 1 Research.',
};

const libraryA: Room = {
  id: 'base.room.library.a',
  name: 'Library',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [librarySlot1, librarySlot2, librarySlot3, librarySlot4],
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

// Infirmary — single-slot UC room. Mages can't be placed directly; wounded
// mages move here automatically. When sent here BY AN OPPONENT, the wounded
// player chooses 2 Gold / 1 Mana / 1 IP (handled in the wound effect chain
// via `base.system.infirmary-bonus`).

const infirmaryA: Room = {
  id: 'base.room.infirmary.a',
  name: 'Infirmary',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'A',
  isInstantRoom: true,
  cannotBePlacedInDirectly: true,
  cannotBeLocked: true,
  description:
    'Wounded mages move here automatically; you cannot place directly. When sent here by an opponent, choose: gain 2 Gold, 1 Mana, or 1 IP.',
  actionSpaces: [],
};

const infirmaryB: Room = {
  id: 'base.room.infirmary.b',
  name: 'Infirmary',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'B',
  isInstantRoom: true,
  cannotBePlacedInDirectly: true,
  cannotBeLocked: true,
  actionSpaces: [],
};

// Training Fields Side A:
//   Slot 1 (merit, 1 MB): Gain 1 INT AND Gain 1 WIS
//   Slot 2 (regular):     Gain 1 INT
//   Slot 3 (regular):     Gain 1 WIS

const trainingFieldsA: Room = {
  id: 'base.room.training-fields.a',
  name: 'Training Fields',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [
    {
      id: 'base.room.training-fields.a.slot-1',
      roomId: 'base.room.training-fields.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.training-fields-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain 1 INT AND Gain 1 WIS.',
    },
    {
      ...regularSlot({
        id: 'base.room.training-fields.a.slot-2',
        roomId: 'base.room.training-fields.a',
        index: 1,
        effectId: 'base.room.training-fields-a.slot-2',
      }),
      description: 'Gain 1 INT.',
    },
    {
      ...regularSlot({
        id: 'base.room.training-fields.a.slot-3',
        roomId: 'base.room.training-fields.a',
        index: 2,
        effectId: 'base.room.training-fields-a.slot-3',
      }),
      description: 'Gain 1 WIS.',
    },
  ],
};

const trainingFieldsB: Room = {
  id: 'base.room.training-fields.b',
  name: 'Training Fields',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [],
};

// Guilds Side A — INSTANT room (effects resolve at placement, not resolution):
//   Slot 1 (merit, 1 MB): Immediately gain either 6 Gold OR 3 Mana
//   Slot 2 (regular):     Immediately gain either 4 Gold OR 2 Mana
//   Slot 3 (regular):     Immediately gain either 2 Gold OR 1 Mana

const guildsA: Room = {
  id: 'base.room.guilds.a',
  name: 'Guilds',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description: 'Instant room — slot effects resolve at placement.',
  actionSpaces: [
    {
      id: 'base.room.guilds.a.slot-1',
      roomId: 'base.room.guilds.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.guilds-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Immediately gain either 6 Gold OR 3 Mana.',
    },
    {
      ...regularSlot({
        id: 'base.room.guilds.a.slot-2',
        roomId: 'base.room.guilds.a',
        index: 1,
        effectId: 'base.room.guilds-a.slot-2',
      }),
      description: 'Immediately gain either 4 Gold OR 2 Mana.',
    },
    {
      ...regularSlot({
        id: 'base.room.guilds.a.slot-3',
        roomId: 'base.room.guilds.a',
        index: 2,
        effectId: 'base.room.guilds-a.slot-3',
      }),
      description: 'Immediately gain either 2 Gold OR 1 Mana.',
    },
  ],
};

const guildsB: Room = {
  id: 'base.room.guilds.b',
  name: 'Guilds',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [],
};

// Catacombs Side A:
//   Slot 1 (merit, 1 MB): Draw a Secret Supporter, then gain a Mark
//   Slot 2 (regular):     Gain 2 IP
//   Slot 3 (regular):     Gain 1 IP for each player with more IP than you

const catacombsA: Room = {
  id: 'base.room.catacombs.a',
  name: 'Catacombs',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [
    {
      id: 'base.room.catacombs.a.slot-1',
      roomId: 'base.room.catacombs.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.catacombs-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Draw a Secret Supporter, then gain a Mark.',
    },
    {
      ...regularSlot({
        id: 'base.room.catacombs.a.slot-2',
        roomId: 'base.room.catacombs.a',
        index: 1,
        effectId: 'base.room.catacombs-a.slot-2',
      }),
      description: 'Gain 2 IP.',
    },
    {
      ...regularSlot({
        id: 'base.room.catacombs.a.slot-3',
        roomId: 'base.room.catacombs.a',
        index: 2,
        effectId: 'base.room.catacombs-a.slot-3',
      }),
      description: 'Gain 1 IP for each player with more IP than you.',
    },
  ],
};

const catacombsB: Room = {
  id: 'base.room.catacombs.b',
  name: 'Catacombs',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [],
};

// Courtyard Side A:
//   Slot 1 (merit, 1 MB): Gain Mana equal to (your WIS + 2)
//   Slot 2 (regular):     Gain Mana equal to your WIS
//   Slot 3 (regular):     Gain 3 Mana

const courtyardA: Room = {
  id: 'base.room.courtyard.a',
  name: 'Courtyard',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [
    {
      id: 'base.room.courtyard.a.slot-1',
      roomId: 'base.room.courtyard.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.courtyard-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain Mana equal to your (WIS + 2).',
    },
    {
      ...regularSlot({
        id: 'base.room.courtyard.a.slot-2',
        roomId: 'base.room.courtyard.a',
        index: 1,
        effectId: 'base.room.courtyard-a.slot-2',
      }),
      description: 'Gain Mana equal to your WIS.',
    },
    {
      ...regularSlot({
        id: 'base.room.courtyard.a.slot-3',
        roomId: 'base.room.courtyard.a',
        index: 2,
        effectId: 'base.room.courtyard-a.slot-3',
      }),
      description: 'Gain 3 Mana.',
    },
  ],
};

const courtyardB: Room = {
  id: 'base.room.courtyard.b',
  name: 'Courtyard',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
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
  description: 'Draft a Vault Card AND Gain 4 Gold.',
};

const vaultASlot2: ActionSpace = {
  id: 'base.room.vault.a.slot-2',
  roomId: 'base.room.vault.a',
  index: 1,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.room.vault-a.slot-2',
  description: 'Draft a Vault Card OR Gain 5 Gold.',
};

const vaultASlot3: ActionSpace = {
  id: 'base.room.vault.a.slot-3',
  roomId: 'base.room.vault.a',
  index: 2,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.room.vault-a.slot-3',
  description: 'Gain 3 Gold.',
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

// (Helper for stub A/B room pairs removed — every room currently in the pack
// has explicit A and B definitions. Re-add a helper here when we expand back
// to placeholder rooms.)

const rooms: Room[] = [
  // University Central — always present.
  councilChamberA,
  councilChamberB,
  libraryA,
  libraryB,
  infirmaryA,
  infirmaryB,

  // Variable pool — five physical rooms per the room file. (Chapel,
  // Student Stores, Adventuring, Astronomy Tower, Great Hall, Archmage's
  // Study, and Dormitory are not yet specified by content and so are
  // omitted. Re-add them here when their slots are sourced.)
  trainingFieldsA,
  trainingFieldsB,
  courtyardA,
  courtyardB,
  catacombsA,
  catacombsB,
  guildsA,
  guildsB,
  vaultA,
  vaultB,
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
// Bell Tower — 3 offerings (2-player-game set per the room file)
// ============================================================================
//
// Each round refreshes the offering pool to 3. Claiming the last card drains
// the tower and ends the round (handled by `processErrandsAdvance`).
//
//   1. First-player Token: claimer becomes first player next round.
//   2. Gold or Mana:        claimer chooses 2 Gold OR 1 Mana.
//   3. IP:                  claimer gains 1 IP.

const bellTowerCards: BellTowerCard[] = [
  {
    id: 'base.bell.first-player',
    name: 'First Player Token',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.first-player',
    minPlayers: 2,
  },
  {
    id: 'base.bell.gold-or-mana',
    name: 'Gold or Mana',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.gold-or-mana',
    minPlayers: 2,
  },
  {
    id: 'base.bell.gain-ip',
    name: 'Influence Point',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.gain-ip',
    minPlayers: 2,
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
  legendarySpells,
  vaultCards,
  supporters,
  voters,
  bellTowerCards,
};
