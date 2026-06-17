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
      'When placing this mage, you may spend 1 Mana to wound a Mage and take its slot.',
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
    description: 'May place as a fast action',
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
    color: 'rainbow',
    department: null,
    description:
      "Special joker Mage gained from the Archmage's Study. Has ALL Mage Powers. Belongs to the claiming player for the current round only — cannot be traded, swapped, or otherwise transferred. Cleared at round-end.",
  },
];

// ============================================================================
// Spells
// ============================================================================
//
// Burn (Sorcery, L1–L3) was the Vertical Slice 2 placeholder spell. Its L1
// effect (wound a Mage) is fully wired up and referenced by many engine
// tests. It is kept alongside the 25 real spell books below; the closest
// data-sheet equivalent is "The Gift of Fire" (Firebolt = wound a Mage).

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
      description: 'Wound a Mage.',
    },
    {
      level: 2,
      title: 'Conflagration',
      manaCost: 2,
      effectId: 'base.spell.burn.l2',
      timing: 'action',
      description: 'Wound up to two Mages in the same room.',
    },
    {
      level: 3,
      title: 'Inferno',
      manaCost: 4,
      effectId: 'base.spell.burn.l3',
      timing: 'action',
      description: 'Wound all Mages in a room.',
    },
  ],
};

// ============================================================================
// Faction Leader spells — held in `legendarySpells`, never shuffled into the
// regular spell deck. Each leader's player owns their unique spell at game
// start; opponents can't acquire it through normal play.
//
// Each is a UNIQUE single-level spell — there is no L2 / L3 to research and
// `intPlaced` is set at candidate allocation so they're castable from turn 1.
// Exhaustion still applies: one cast per round, refreshed at round-setup.
// ============================================================================

function leaderSpell(args: {
  id: string;
  name: string;
  department: Department;
  manaCost: number;
  timing: 'action' | 'fast-action' | 'reaction';
  description: string;
}): SpellCard {
  return {
    id: args.id,
    name: args.name,
    sourcePackId: PACK_ID,
    department: args.department,
    unique: true,
    levels: [
      {
        level: 1,
        title: args.name,
        manaCost: args.manaCost,
        effectId: `${args.id}.l1`,
        timing: args.timing,
        description: args.description,
      },
    ],
  };
}

/** Larimore Burman — Sorcery faction leader. */
const flashOfLight: SpellCard = leaderSpell({
  id: 'base.spell.flash-of-light',
  name: 'Flash of Light',
  department: 'sorcery',
  manaCost: 1,
  timing: 'fast-action',
  description: 'Banish a Mage.',
});

/** Trias Blackwind — Students faction leader. */
const livingImage: SpellCard = leaderSpell({
  id: 'base.spell.living-image',
  name: 'Living Image',
  department: 'students',
  manaCost: 1,
  timing: 'action',
  description:
    'Place a Neutral Mage from the supply into an empty slot. Return this Mage to the supply at the end of the round.',
});

/** Byron Krane — Mysticism faction leader. */
const trance: SpellCard = leaderSpell({
  id: 'base.spell.trance',
  name: 'Trance',
  department: 'mysticism',
  manaCost: 0,
  timing: 'action',
  description: 'Gain 2 Mana.',
});

/** Exhufern Le Marigras — Natural Magick faction leader. */
const strengthOfEarth: SpellCard = leaderSpell({
  id: 'base.spell.strength-of-earth',
  name: 'Strength of Earth',
  department: 'natural-magick',
  manaCost: 1,
  timing: 'action',
  description: "Move an opponent's Mage to another open slot in the same room.",
});

/** Rheye Cal — Divinity faction leader. */
const bless: SpellCard = leaderSpell({
  id: 'base.spell.bless',
  name: 'Bless',
  department: 'divinity',
  manaCost: 1,
  timing: 'fast-action',
  description: 'Move a Mage from the Infirmary to an open slot of your choice.',
});

/** Xal Ezra — Planar Studies faction leader. */
const paralocation: SpellCard = leaderSpell({
  id: 'base.spell.paralocation',
  name: 'Paralocation',
  department: 'planar-studies',
  manaCost: 1,
  timing: 'action',
  description: "Shadow an opponent's Mage on its current slot.",
});

// ---------------------------------------------------------------------------
// Alternate leader spells (second leader per department).
//
// Effect wiring for these is deferred — for now CAST_SPELL on these will
// pay the cost + exhaust the spell with no further behavior. Each effect
// has a TODO ticket implied by the description.
// ---------------------------------------------------------------------------

/** Rihki Kanhamme — Sorcery alt leader. */
const burnout: SpellCard = leaderSpell({
  id: 'base.spell.burnout',
  name: 'Burnout',
  department: 'sorcery',
  manaCost: 0,
  timing: 'action',
  description:
    'Send one of your own Mages from your office to the Infirmary (no Infirmary bonus), then gain 3 Mana.',
});

/** Mannheim Wildern — Natural Magick alt leader. */
const gustOfWind: SpellCard = leaderSpell({
  id: 'base.spell.gust-of-wind',
  name: 'Gust of Wind',
  department: 'natural-magick',
  manaCost: 1,
  timing: 'action',
  description:
    'Move any Mage to an open slot in an adjacent room (excluding the Infirmary or Great Hall).',
});

/** Jesca Renetton — Mysticism alt leader. */
const darkPact: SpellCard = leaderSpell({
  id: 'base.spell.dark-pact',
  name: 'Dark Pact',
  department: 'mysticism',
  manaCost: 1,
  timing: 'action',
  description: 'Banish one of your own Mages, then Wound a Mage.',
});

/** Lavanina — Planar Studies alt leader. */
const shadowBolt: SpellCard = leaderSpell({
  id: 'base.spell.shadow-bolt',
  name: 'Shadow Bolt',
  department: 'planar-studies',
  manaCost: 0,
  timing: 'fast-action',
  description: "An opponent's Mage is now shadowing its slot.",
});

/** Divinity alt leader (name TBD by user). */
const holySmite: SpellCard = leaderSpell({
  id: 'base.spell.holy-smite',
  name: 'Holy Smite',
  department: 'divinity',
  manaCost: 1,
  timing: 'action',
  description: 'Wound a Mage and gain 1 IP.',
});

/** Students alt leader (name TBD by user). */
const tardy: SpellCard = leaderSpell({
  id: 'base.spell.tardy',
  name: 'Tardy',
  department: 'students',
  manaCost: 1,
  timing: 'reaction',
  description:
    'When an opponent takes the last Bell Tower card, place a Mage without using Mage powers.',
});

// ============================================================================
// Base spell books — 25 regular books + 5 legendary books from the data sheet.
//
// Spell effects (Wound a Mage, Banish, Refresh, Move-from-Infirmary, etc.)
// are not yet wired; CAST_SPELL on these throws "effect not registered".
// Burn (defined above) remains as the vertical-slice test spell — its L1
// effect is fully implemented and is referenced by many engine tests.
// ============================================================================

const baseSpellBooks: SpellCard[] = [
  {
    id: 'base.spell.wrath-of-heaven',
    name: 'Wrath of Heaven',
    sourcePackId: PACK_ID,
    department: 'divinity',
    levels: [
      { level: 1, title: 'Justice', manaCost: 1, timing: 'reaction', effectId: 'base.spell.wrath-of-heaven.l1', description: 'When one of your Mages is shadowed or moved by an opponent, wound any placed Mage belonging to that opponent.' },
      { level: 2, title: 'Recompense', manaCost: 1, timing: 'reaction', effectId: 'base.spell.wrath-of-heaven.l2', description: 'When one of your Mages is banished, banish a Mage belonging to the player who Banished it.' },
      { level: 3, title: 'Retribution', manaCost: 3, timing: 'reaction', effectId: 'base.spell.wrath-of-heaven.l3', description: 'After one of your Mages is wounded, choose and wound two Mages owned by the player who wounded yours.' },
    ],
  },
  {
    id: 'base.spell.will-of-the-divines',
    name: 'Will of the Divines',
    sourcePackId: PACK_ID,
    department: 'divinity',
    levels: [
      { level: 1, title: 'Concentration', manaCost: 0, timing: 'fast-action', effectId: 'base.spell.will-of-the-divines.l1', description: 'The next time you cast a Spell this turn, do not exhaust it.' },
      { level: 2, title: 'Silence', manaCost: 1, timing: 'action', effectId: 'base.spell.will-of-the-divines.l2', description: 'Until the start of your next turn, players may not cast Spells.' },
      { level: 3, title: 'Revival', manaCost: 1, timing: 'action', effectId: 'base.spell.will-of-the-divines.l3', description: 'For the rest of this round, you may move your wounded Mages after the action that wounded them. Still gain Infirmary Bonuses.' },
    ],
  },
  {
    id: 'base.spell.tome-of-protection',
    name: 'Tome of Protection',
    sourcePackId: PACK_ID,
    department: 'divinity',
    levels: [
      { level: 1, title: 'Spell Shield', manaCost: 1, timing: 'action', effectId: 'base.spell.tome-of-protection.l1', description: 'Until your next turn, all of your Mages are immune to all Spells.' },
      { level: 2, title: 'Wall', manaCost: 2, timing: 'action', effectId: 'base.spell.tome-of-protection.l2', description: 'Until your next turn, all your Mages are immune to all negative effects (Spells, Vault Cards, and other Mages).' },
      { level: 3, title: 'Absorb Mana', manaCost: 0, timing: 'reaction', effectId: 'base.spell.tome-of-protection.l3', description: 'After one of your Mages would be moved, wounded, or banished, by a spell, gain Mana equal to the cost of that spell.' },
    ],
  },
  {
    id: 'base.spell.rites-of-renewal',
    name: 'Rites of Renewal',
    sourcePackId: PACK_ID,
    department: 'divinity',
    levels: [
      { level: 1, title: 'Chain of Healing', manaCost: 1, timing: 'action', effectId: 'base.spell.rites-of-renewal.l1', description: 'Return up to two of your Mages from the Infirmary to your Office.' },
      { level: 2, title: 'Circle of Healing', manaCost: 2, timing: 'fast-action', effectId: 'base.spell.rites-of-renewal.l2', description: 'Return all of your Mages in the Infirmary to your Office.' },
      { level: 3, title: 'Well of Healing', manaCost: 3, timing: 'action', effectId: 'base.spell.rites-of-renewal.l3', description: "Return all Mages in the Infirmary to their Offices. Gain 2 IP if you returned at least one opponent's Mage to their Office." },
    ],
  },
  {
    id: 'base.spell.of-mortal-form',
    name: 'Of Mortal Form',
    sourcePackId: PACK_ID,
    department: 'divinity',
    levels: [
      { level: 1, title: 'Heal', manaCost: 0, timing: 'action', effectId: 'base.spell.of-mortal-form.l1', description: "Return a Mage from the Infirmary to its owner's Office." },
      { level: 2, title: 'Amelioration', manaCost: 1, timing: 'action', effectId: 'base.spell.of-mortal-form.l2', description: 'Move a Mage from the Infirmary to an open slot of your choice.' },
      { level: 3, title: 'Innervation', manaCost: 2, timing: 'action', effectId: 'base.spell.of-mortal-form.l3', description: "Move a Mage from the Infirmary to any slot. You may wound an opponent's Mage in order to place your own." },
    ],
  },
  {
    id: 'base.spell.the-grasping-darkness',
    name: 'The Grasping Darkness',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    levels: [
      { level: 1, title: 'Repeating Hex', manaCost: 2, timing: 'action', effectId: 'base.spell.the-grasping-darkness.l1', description: 'Swap this Spell for a (non-starter, non-legendary) level 1 Spell from another player and exhaust both Spells.' },
      { level: 2, title: 'Telepathy', manaCost: 3, timing: 'action', effectId: 'base.spell.the-grasping-darkness.l2', description: "Discard an opponent's (non-starter, non-legendary) level 1 Spell to the bottom of the Spell Deck. He keeps the INT on it." },
      { level: 3, title: 'Deathly Paling', manaCost: 3, timing: 'action', effectId: 'base.spell.the-grasping-darkness.l3', description: 'Steal 1 unspent INT from a player with more INT than you OR steal 1 unspent WIS from a player with more WIS than you.' },
    ],
  },
  {
    id: 'base.spell.the-darkness-within',
    name: 'The Darkness Within',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    levels: [
      { level: 1, title: 'Malaise', manaCost: 1, timing: 'action', effectId: 'base.spell.the-darkness-within.l1', description: 'Until your next turn, Mages cannot be placed.' },
      { level: 2, title: 'Haunt', manaCost: 2, timing: 'reaction', effectId: 'base.spell.the-darkness-within.l2', description: 'When one of your Mages is wounded, moved, or banished, it instead shadows the slot it previously occupied.' },
      { level: 3, title: 'Possession', manaCost: 4, timing: 'action', effectId: 'base.spell.the-darkness-within.l3', description: 'Swap ownership badges between two Mages on the board. Their ownership is permanently swapped.' },
    ],
  },
  {
    id: 'base.spell.tenets-of-dominance',
    name: 'Tenets of Dominance',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    levels: [
      { level: 1, title: 'Mesmerize', manaCost: 1, timing: 'action', effectId: 'base.spell.tenets-of-dominance.l1', description: 'Until your next turn, all Mages (except those immune to Spells) lose their powers.' },
      { level: 2, title: 'Mystic Link', manaCost: 2, timing: 'action', effectId: 'base.spell.tenets-of-dominance.l2', description: 'Cast another Spell. Then, place any Mage you control.' },
      { level: 3, title: 'Shadow Puppet', manaCost: 4, timing: 'action', effectId: 'base.spell.tenets-of-dominance.l3', description: 'Gain a Secret Supporter.' },
    ],
  },
  {
    id: 'base.spell.thirteen-greater-mysteries',
    name: 'Thirteen Greater Mysteries',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    levels: [
      { level: 1, title: 'Mana Drain', manaCost: 0, timing: 'action', effectId: 'base.spell.thirteen-greater-mysteries.l1', description: 'Steal 1 mana from a single opponent.' },
      { level: 2, title: 'Tap the Well', manaCost: 0, timing: 'action', effectId: 'base.spell.thirteen-greater-mysteries.l2', description: 'Cast a Level 1 Spell from the Spell Tableau, paying all costs.' },
      { level: 3, title: 'Energy Drain', manaCost: 0, manaCostKind: 'opponents', timing: 'action', effectId: 'base.spell.thirteen-greater-mysteries.l3', description: 'Costs X Mana, where X is the number of opponents in the game. During this round, opponents must pay you 1 extra mana in order to cast a Spell.' },
    ],
  },
  {
    id: 'base.spell.the-lamentations-of-sareth',
    name: 'The Lamentations of Sareth',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    levels: [
      { level: 1, title: 'Venom', manaCost: 1, timing: 'action', effectId: 'base.spell.the-lamentations-of-sareth.l1', description: 'Wound a Mage. Its owner gains no Infirmary bonus.' },
      { level: 2, title: 'Poison', manaCost: 3, timing: 'action', effectId: 'base.spell.the-lamentations-of-sareth.l2', description: 'Wound a Mage and place one of yours in its slot. Its owner gains no Infirmary Bonus.' },
      { level: 3, title: 'Nox', manaCost: 5, timing: 'action', effectId: 'base.spell.the-lamentations-of-sareth.l3', description: 'Wound all Mages in a room, and their owners receive no Infirmary bonuses.' },
    ],
  },
  {
    id: 'base.spell.songs-of-springtime',
    name: 'Songs of Springtime',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    levels: [
      { level: 1, title: 'Regeneration', manaCost: 0, timing: 'reaction', effectId: 'base.spell.songs-of-springtime.l1', description: 'When one of your Mages is wounded or moved, refresh an exhausted Spell or Treasure.' },
      { level: 2, title: 'Regrowth', manaCost: 1, timing: 'reaction', effectId: 'base.spell.songs-of-springtime.l2', description: 'When one of your Mages is wounded or moved, place it into an empty slot.' },
      { level: 3, title: 'Renewal', manaCost: 2, timing: 'reaction', effectId: 'base.spell.songs-of-springtime.l3', description: 'When one of your Mages is wounded or moved, place it into an empty slot, then refresh an exhausted Spell or Treasure.' },
    ],
  },
  {
    id: 'base.spell.book-of-one-hundred-seas',
    name: 'Book of One Hundred Seas',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    levels: [
      { level: 1, title: 'Wave', manaCost: 1, timing: 'action', effectId: 'base.spell.book-of-one-hundred-seas.l1', description: "Banish an opponent's Mage." },
      { level: 2, title: 'Tidal Wave', manaCost: 2, timing: 'action', effectId: 'base.spell.book-of-one-hundred-seas.l2', description: "Banish an opponent's Mage and place a Mage from your Office in its place." },
      { level: 3, title: 'Tsunami', manaCost: 4, timing: 'action', effectId: 'base.spell.book-of-one-hundred-seas.l3', description: 'Banish all Mages in a room.' },
    ],
  },
  {
    id: 'base.spell.heart-of-the-mountain',
    name: 'Heart of the Mountain',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    levels: [
      { level: 1, title: 'Oakskin', manaCost: 1, timing: 'action', effectId: 'base.spell.heart-of-the-mountain.l1', description: 'Until your next turn, your Mages are immune to being wounded and moved.' },
      { level: 2, title: 'Stoneskin', manaCost: 4, timing: 'action', effectId: 'base.spell.heart-of-the-mountain.l2', description: 'For the rest of the round, your mages are immune to being wounded and moved.' },
      { level: 3, title: 'Diamondskin', manaCost: 6, timing: 'action', effectId: 'base.spell.heart-of-the-mountain.l3', description: 'For the rest of the round, your Mages lose their innate powers, but become immune to all negative effects.' },
    ],
  },
  {
    id: 'base.spell.lightning-and-you',
    name: 'Lightning and You',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    levels: [
      { level: 1, title: 'Bolt', manaCost: 1, timing: 'action', effectId: 'base.spell.lightning-and-you.l1', description: "Wound an opponent's Mage." },
      { level: 2, title: 'Lightning', manaCost: 3, timing: 'action', effectId: 'base.spell.lightning-and-you.l2', description: "Wound an opponent's Mage, then place a Mage of your own." },
      { level: 3, title: 'Chain Lightning', manaCost: 5, timing: 'action', effectId: 'base.spell.lightning-and-you.l3', description: "Wound an opponent's Mage, then place a Mage of your own. You may then cast another Spell." },
    ],
  },
  {
    id: 'base.spell.taming-of-the-storm',
    name: 'Taming of the Storm',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    levels: [
      { level: 1, title: 'Zephyr', manaCost: 1, timing: 'action', effectId: 'base.spell.taming-of-the-storm.l1', description: "Move an opponent's Mage to another open slot in the same room." },
      { level: 2, title: 'Tornado', manaCost: 2, timing: 'action', effectId: 'base.spell.taming-of-the-storm.l2', description: 'Rearrange all Mages in a room.' },
      { level: 3, title: 'Hurricane', manaCost: 3, timing: 'action', effectId: 'base.spell.taming-of-the-storm.l3', description: 'Wound a Mage, then rearrange the rest of the Mages in that room.' },
    ],
  },
  {
    id: 'base.spell.indefinite-definitives',
    name: 'Indefinite Definitives',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    levels: [
      { level: 1, title: 'Cut Plane', manaCost: 1, timing: 'action', effectId: 'base.spell.indefinite-definitives.l1', description: "An opponent's Mage is now shadowing its slot. Place one of your Mages into the slot they were in." },
      { level: 2, title: 'Invisibility', manaCost: 1, timing: 'action', effectId: 'base.spell.indefinite-definitives.l2', description: 'Shadow an empty slot.' },
      { level: 3, title: 'Doppelganger', manaCost: 2, timing: 'action', effectId: 'base.spell.indefinite-definitives.l3', description: 'Shadow one of your own Mages.' },
    ],
  },
  {
    id: 'base.spell.everyday-paralocation',
    name: 'Everyday Paralocation',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    levels: [
      { level: 1, title: 'Celerity', manaCost: 1, timing: 'fast-action', effectId: 'base.spell.everyday-paralocation.l1', description: 'Place any Mage.' },
      { level: 2, title: 'Accelerate Time', manaCost: 2, timing: 'fast-action', effectId: 'base.spell.everyday-paralocation.l2', description: 'Cast another Spell.' },
      { level: 3, title: 'Teleport', manaCost: 3, timing: 'action', effectId: 'base.spell.everyday-paralocation.l3', description: 'Move up to 2 of your Mages to any open slots (you may move them out of the Infirmary).' },
    ],
  },
  {
    id: 'base.spell.temporal-calculus-6th-ed',
    name: 'Temporal Calculus, 6th Ed.',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    levels: [
      { level: 1, title: 'Slow Time', manaCost: 2, timing: 'action', effectId: 'base.spell.temporal-calculus-6th-ed.l1', description: 'Choose a room. Place up to two of your Mages into it.' },
      { level: 2, title: 'Stop Time', manaCost: 3, timing: 'reaction', effectId: 'base.spell.temporal-calculus-6th-ed.l2', description: "After the last Bell Tower Offering is taken by another player, take two more 'Place a Mage' actions, without using Mage Powers." },
      { level: 3, title: 'Bend Time', manaCost: 4, timing: 'action', effectId: 'base.spell.temporal-calculus-6th-ed.l3', description: 'Take up to 3 more actions. Each must be a different type of action (using a Vault Card, Supporter, and Spell are all different types).' },
    ],
  },
  {
    id: 'base.spell.memoirs-of-the-future-past',
    name: 'Memoirs of the Future-Past',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    levels: [
      { level: 1, title: 'Future Power', manaCost: 0, timing: 'action', effectId: 'base.spell.memoirs-of-the-future-past.l1', description: 'Cast a Spell that you have not yet researched from among your learned Spells (paying all mana costs).' },
      { level: 2, title: 'Past Power', manaCost: 3, timing: 'action', effectId: 'base.spell.memoirs-of-the-future-past.l2', description: "Cast one of your regular Action Spells at a level less than the highest level you've researched. Do not pay any additional mana or exhaust it." },
      { level: 3, title: 'Eternal Power', manaCost: 7, timing: 'action', effectId: 'base.spell.memoirs-of-the-future-past.l3', description: 'Cast one of your regular Action Spells of any level (it need not even be researched). Do not pay any additional mana or exhaust it.' },
    ],
  },
  {
    id: 'base.spell.parallel-synchronicity',
    name: 'Parallel Synchronicity',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    levels: [
      { level: 1, title: 'Flicker', manaCost: 1, timing: 'action', effectId: 'base.spell.parallel-synchronicity.l1', description: "Shadow an opponent's Mage with one of your Mages." },
      { level: 2, title: 'Fade', manaCost: 2, timing: 'action', effectId: 'base.spell.parallel-synchronicity.l2', description: "Move any number of Mages (yours or opponents') in a room into the shadow position." },
      { level: 3, title: 'Planar Disjunction', manaCost: 4, timing: 'action', effectId: 'base.spell.parallel-synchronicity.l3', description: 'Choose a room. All Mages in that room are banished. Any that were shadowing move into normal spaces.' },
    ],
  },
  {
    id: 'base.spell.sorcerous-inspiration',
    name: 'Sorcerous Inspiration',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    levels: [
      { level: 1, title: 'Luminosity', manaCost: 1, timing: 'action', effectId: 'base.spell.sorcerous-inspiration.l1', description: 'Gain a Mark.' },
      { level: 2, title: 'Brilliance', manaCost: 2, timing: 'action', effectId: 'base.spell.sorcerous-inspiration.l2', description: 'Gain two Research.' },
      { level: 3, title: 'Radiance', manaCost: 3, timing: 'action', effectId: 'base.spell.sorcerous-inspiration.l3', description: 'Gain a Research, refresh an exhausted Spell, then gain a Mark.' },
    ],
  },
  {
    id: 'base.spell.the-light-that-leads',
    name: 'The Light that Leads',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    levels: [
      { level: 1, title: 'Illuminate', manaCost: 2, timing: 'fast-action', effectId: 'base.spell.the-light-that-leads.l1', description: 'Gain a Mark.' },
      { level: 2, title: 'Flare', manaCost: 2, timing: 'fast-action', effectId: 'base.spell.the-light-that-leads.l2', description: 'Take a normal action.' },
      { level: 3, title: 'Dazzle', manaCost: 3, timing: 'fast-action', effectId: 'base.spell.the-light-that-leads.l3', description: 'Take two normal actions.' },
    ],
  },
  {
    id: 'base.spell.a-brighter-flame',
    name: 'A Brighter Flame',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    levels: [
      { level: 1, title: 'Inner Fire', manaCost: 1, timing: 'action', effectId: 'base.spell.a-brighter-flame.l1', description: 'For the rest of the round, your Spells cost 1 less mana.' },
      { level: 2, title: 'Kindle', manaCost: 2, timing: 'fast-action', effectId: 'base.spell.a-brighter-flame.l2', description: 'Refresh an exhausted Spell.' },
      { level: 3, title: 'Immolation', manaCost: 3, timing: 'fast-action', effectId: 'base.spell.a-brighter-flame.l3', description: 'Place a Mage into any slot. If the slot is occupied, wound the Mage there and take its place.' },
    ],
  },
  {
    id: 'base.spell.the-gift-of-fire',
    name: 'The Gift of Fire',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    levels: [
      { level: 1, title: 'Firebolt', manaCost: 1, timing: 'action', effectId: 'base.spell.the-gift-of-fire.l1', description: 'Wound a Mage.' },
      { level: 2, title: 'Fireball', manaCost: 3, timing: 'action', effectId: 'base.spell.the-gift-of-fire.l2', description: 'Choose two adjacent rooms, wound one Mage in each.' },
      { level: 3, title: 'Inferno', manaCost: 6, timing: 'action', effectId: 'base.spell.the-gift-of-fire.l3', description: 'Wound all Mages in two adjacent rooms.' },
    ],
  },
  {
    id: 'base.spell.the-pursuit-of-power',
    name: 'The Pursuit of Power',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    levels: [
      { level: 1, title: 'Warmth', manaCost: 0, timing: 'action', effectId: 'base.spell.the-pursuit-of-power.l1', description: 'Gain 2 Mana.' },
      { level: 2, title: 'Power', manaCost: 0, timing: 'action', effectId: 'base.spell.the-pursuit-of-power.l2', description: 'Gain 1 Mana and refresh a Spell.' },
      { level: 3, title: 'Intensity', manaCost: 1, timing: 'action', effectId: 'base.spell.the-pursuit-of-power.l3', description: 'Refresh a Spell and then gain a Research.' },
    ],
  },
];

// Base legendary spell books — researchable by anyone (e.g., via Sealed Scroll).
// These are distinct from the 6 candidate starter spells defined above.
const baseLegendarySpellBooks: SpellCard[] = [
  {
    id: 'base.spell.moste-holie-litanies',
    name: 'Moste Holie Litanies',
    sourcePackId: PACK_ID,
    department: 'divinity',
    levels: [
      { level: 1, title: 'Sanctification', manaCost: 1, timing: 'fast-action', effectId: 'base.spell.moste-holie-litanies.l1', description: 'Until the start of your next turn, your Mages are immune to wounding.' },
      { level: 2, title: 'Protective Aura', manaCost: 2, timing: 'action', effectId: 'base.spell.moste-holie-litanies.l2', description: 'For the rest of the round, your Mages are immune to wounding.' },
      { level: 3, title: 'Consecration', manaCost: 6, timing: 'action', effectId: 'base.spell.moste-holie-litanies.l3', description: 'Place as many Mages as you wish into a single room, then Lock that room.' },
    ],
  },
  {
    id: 'base.spell.on-the-weakness-of-flesh',
    name: 'On the Weakness of Flesh',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    levels: [
      { level: 1, title: 'Disease', manaCost: 0, timing: 'action', effectId: 'base.spell.on-the-weakness-of-flesh.l1', description: 'Wound a Mage OR banish a Mage.' },
      { level: 2, title: 'Plague', manaCost: 1, timing: 'action', effectId: 'base.spell.on-the-weakness-of-flesh.l2', description: 'Choose two adjacent rooms. Wound one Mage in each of them.' },
      { level: 3, title: 'Pestilence', manaCost: 4, timing: 'action', effectId: 'base.spell.on-the-weakness-of-flesh.l3', description: 'Choose up to four adjacent rooms. Wound one Mage in each of them.' },
    ],
  },
  {
    id: 'base.spell.master-book-of-starcalling',
    name: 'Master Book of Starcalling',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    levels: [
      { level: 1, title: 'Ice Comet', manaCost: 3, timing: 'action', effectId: 'base.spell.master-book-of-starcalling.l1', description: 'In a single room, wound a Mage, banish a Mage, and move a Mage to an open slot in the same room.' },
      { level: 2, title: 'Meteor', manaCost: 4, timing: 'action', effectId: 'base.spell.master-book-of-starcalling.l2', description: 'Place a Mage into a room, then lock that room for the rest of the round.' },
      { level: 3, title: 'Cataclysm', manaCost: 4, timing: 'action', effectId: 'base.spell.master-book-of-starcalling.l3', description: 'Banish all Mages in a room, then lock that room for the rest of the round.' },
    ],
  },
  {
    id: 'base.spell.infinite-universes-realized',
    name: 'Infinite Universes Realized',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    levels: [
      { level: 1, title: 'Event Horizon', manaCost: 2, timing: 'action', effectId: 'base.spell.infinite-universes-realized.l1', description: 'Shadow two Mages with two of your Mages.' },
      { level: 2, title: 'Zero Hour', manaCost: 3, timing: 'fast-action', effectId: 'base.spell.infinite-universes-realized.l2', description: "For the rest of the round, your Mages can shadow opponent's Mages when placed." },
      { level: 3, title: 'Inversion', manaCost: 3, timing: 'action', effectId: 'base.spell.infinite-universes-realized.l3', description: 'All of your placed Mages move to the Shadow position if able. For the rest of the round, you must Shadow opponents or empty slots.' },
    ],
  },
  {
    id: 'base.spell.calvals-deadliest-magicks',
    name: "Calval's Deadliest Magicks",
    sourcePackId: PACK_ID,
    department: 'sorcery',
    levels: [
      { level: 1, title: 'Pyre', manaCost: 2, timing: 'action', effectId: 'base.spell.calvals-deadliest-magicks.l1', description: 'Wound up to two Mages in the same room.' },
      { level: 2, title: 'Flamespout', manaCost: 4, timing: 'action', effectId: 'base.spell.calvals-deadliest-magicks.l2', description: 'Wound a Mage, then lock the room it previously occupied.' },
      { level: 3, title: 'Volcano', manaCost: 0, timing: 'fast-action', effectId: 'base.spell.calvals-deadliest-magicks.l3', description: 'Banish one Mage belonging to each opponent. X is the number of opponents.' },
    ],
  },
];

const legendarySpells: SpellCard[] = [
  // Candidate starter spells (one per faction leader; two per department).
  flashOfLight,
  livingImage,
  trance,
  strengthOfEarth,
  bless,
  paralocation,
  burnout,
  gustOfWind,
  darkPact,
  shadowBolt,
  holySmite,
  tardy,
  // Legendary books from the data sheet — research these via Sealed Scroll, etc.
  ...baseLegendarySpellBooks,
];

const spells: SpellCard[] = [
  // Burn is kept as the wired-up vertical-slice test spell; its L1 effect is
  // implemented and many engine tests depend on it. The data-sheet equivalent
  // is "The Gift of Fire" (Firebolt = wound a Mage).
  burnSpell,
  ...baseSpellBooks,
];

// ============================================================================
// Vault cards — the 26 base-game cards from the Argent data sheet.
//
// `effectId` always matches the card id; effects for the simple resource-gain
// cards (Mana Crystal, Gilded Chalice, The Arcane Eye, Spirits, Runestone)
// and the existing Phase Steppers reaction are registered in `effects/base.ts`.
// The rest (mage manipulation, swap loops, infirmary moves, secret-supporter
// peek, legendary research, multi-tap mana spend) remain unregistered;
// PLAY_VAULT_CARD on those throws "effect not registered" but the cards can
// still be bought / drafted and count for endgame scoring.
//
// Reaction-timing cards use a `.react` effect id suffix so the reaction-window
// builder in `effects/helpers.ts` can wire them in once the reactor logic is
// implemented.
//
// `copies` controls how many duplicates of a card go into the vault deck.
// ============================================================================

const vaultCards: VaultCard[] = [
  {
    id: 'base.vault.ancient-armor',
    name: 'Ancient Armor',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 5,
    timing: 'reaction',
    effectId: 'base.vault.ancient-armor.react',
    description:
      'After an opponent moves or wounds one of your Mages, you may move your Mage to any open slot on the board.',
    copies: 2,
  },
  {
    id: 'base.vault.the-arcane-eye',
    name: 'The Arcane Eye',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 4,
    timing: 'action',
    effectId: 'base.vault.the-arcane-eye',
    description: 'Gain a Mark.',
    copies: 2,
  },
  {
    id: 'base.vault.auric-catalyst',
    name: 'Auric Catalyst',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'reaction',
    effectId: 'base.vault.auric-catalyst.react',
    description:
      'Reduce any Gold cost (not a swap) you would pay to zero.',
    copies: 1,
  },
  {
    id: 'base.vault.bottled-memories',
    name: 'Bottled Memories',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'fast-action',
    effectId: 'base.vault.bottled-memories',
    description: 'Refresh an exhausted Spell.',
    copies: 1,
  },
  {
    id: 'base.vault.bottled-rage',
    name: 'Bottled Rage',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'action',
    effectId: 'base.vault.bottled-rage',
    description: 'Wound a Mage and place one of yours in its slot.',
    copies: 1,
  },
  {
    id: 'base.vault.the-contract',
    name: 'The Contract',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 2,
    timing: 'fast-action',
    effectId: 'base.vault.the-contract',
    description:
      'Gain 3 Research. Use this Research on spells of a single chosen type.',
    copies: 1,
  },
  {
    id: 'base.vault.endless-coin-purse',
    name: 'Endless Coin Purse',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'action',
    effectId: 'base.vault.endless-coin-purse',
    description: 'Gain 1 Gold. Gain a Buy.',
    copies: 2,
  },
  {
    id: 'base.vault.force-gloves',
    name: 'Force Gloves',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 5,
    timing: 'action',
    effectId: 'base.vault.force-gloves',
    description:
      'Spend 2 Mana to banish a Mage. Do this any number of times.',
    copies: 1,
  },
  {
    id: 'base.vault.gilded-chalice',
    name: 'Gilded Chalice',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 4,
    timing: 'action',
    effectId: 'base.vault.gilded-chalice',
    description: 'Gain 2 IP.',
    copies: 2,
  },
  {
    id: 'base.vault.healing-drops',
    name: 'Healing Drops',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'action',
    effectId: 'base.vault.healing-drops',
    description: 'Move a Mage from the Infirmary to an open slot of your choice.',
    copies: 1,
  },
  {
    id: 'base.vault.invisibility-cloak',
    name: 'Invisibility Cloak',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 4,
    timing: 'reaction',
    effectId: 'base.vault.invisibility-cloak.react',
    description:
      'When one of your Mages would be wounded, banished, or moved, it shadows the original slot instead.',
    copies: 1,
  },
  {
    id: 'base.vault.liquid-lightning',
    name: 'Liquid Lightning',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'fast-action',
    effectId: 'base.vault.liquid-lightning',
    description: 'Place a Mage.',
    copies: 1,
  },
  {
    id: 'base.vault.malefic-torch',
    name: 'Malefic Torch',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 5,
    timing: 'action',
    effectId: 'base.vault.malefic-torch',
    description:
      'Spend 2 Mana to wound a Mage. Repeat this any number of times.',
    copies: 1,
  },
  {
    id: 'base.vault.mana-crystal',
    name: 'Mana Crystal',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'action',
    effectId: 'base.vault.mana-crystal',
    description: 'Gain 2 Mana.',
    copies: 2,
  },
  {
    id: 'base.vault.mana-elixir',
    name: 'Mana Elixir',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 2,
    timing: 'fast-action',
    effectId: 'base.vault.mana-elixir',
    description: 'The next Spell you play this turn costs no Mana.',
    copies: 1,
  },
  {
    id: 'base.vault.mystic-amulet',
    name: 'Mystic Amulet',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 5,
    timing: 'reaction',
    effectId: 'base.vault.mystic-amulet.react',
    description:
      'After an opponent banishes or shadows one of your Mages, you may move your Mage to any open slot on the board.',
    copies: 2,
  },
  {
    id: 'base.vault.mystic-lantern',
    name: 'Mystic Lantern',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 3,
    timing: 'fast-action',
    effectId: 'base.vault.mystic-lantern',
    description:
      'Look at the top 3 cards of the Supporter Deck. Gain one as a Secret Supporter. Discard the others.',
    copies: 1,
  },
  {
    id: 'base.vault.phase-steppers',
    name: 'Phase Steppers',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'reaction',
    effectId: 'base.vault.phase-steppers.react',
    description:
      'When one of your Mages would be wounded, banished, or moved, it shadows its original slot instead.',
    copies: 1,
  },
  {
    id: 'base.vault.runestone',
    name: 'Runestone',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 4,
    timing: 'fast-action',
    effectId: 'base.vault.runestone',
    description: 'Gain 1 INT OR gain 1 WIS.',
    copies: 2,
  },
  {
    id: 'base.vault.sealed-jar',
    name: 'Sealed Jar',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'fast-action',
    effectId: 'base.vault.sealed-jar',
    description: 'Gain 7 Gold OR draw a Vault Card.',
    copies: 1,
  },
  {
    id: 'base.vault.sealed-scroll',
    name: 'Sealed Scroll',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 5,
    timing: 'fast-action',
    effectId: 'base.vault.sealed-scroll',
    description:
      'Research a Legendary Spell of your choice, then place this into your personal discard pile.',
    copies: 5,
  },
  {
    id: 'base.vault.shadow-potion',
    name: 'Shadow Potion',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'action',
    effectId: 'base.vault.shadow-potion',
    description: 'Shadow a slot with one of your Mages.',
    copies: 1,
  },
  {
    id: 'base.vault.shield-potion',
    name: 'Shield Potion',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'reaction',
    effectId: 'base.vault.shield-potion.react',
    description:
      'When one of your Mages would be wounded, banished, or moved, place it into any empty slot instead.',
    copies: 1,
  },
  {
    id: 'base.vault.spellblade',
    name: 'Spellblade',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 4,
    timing: 'action',
    effectId: 'base.vault.spellblade',
    description: 'Wound a Mage, then place one of yours into its slot.',
    copies: 1,
  },
  {
    id: 'base.vault.spirits',
    name: 'Spirits',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'fast-action',
    effectId: 'base.vault.spirits',
    description: 'Gain a Mark.',
    copies: 2,
  },
  {
    id: 'base.vault.unbreakable-box',
    name: 'Unbreakable Box',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 5,
    timing: 'action',
    effectId: 'base.vault.unbreakable-box',
    description: 'Spend 6 Mana to gain the top 3 cards of the Vault Deck.',
    copies: 1,
  },
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
      'Gain 2 Research. Use this research only on Natural Magick (Green) Spells.',
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
    description: 'Swap 3 Gold for a Natural Magick (Green) Mage from the supply.',
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
  // Alt leaders — second leader per department. Names TBD for Divinity and
  // Students; placeholders below.
  candidate({
    id: 'base.candidate.rihki-kanhamme',
    name: 'Rihki Kanhamme',
    title: 'Sorcery',
    department: 'sorcery',
    starterSpellId: 'base.spell.burnout',
    startingMageColor: 'red',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.mannheim-wildern',
    name: 'Mannheim Wildern',
    title: 'Natural Magick',
    department: 'natural-magick',
    starterSpellId: 'base.spell.gust-of-wind',
    startingMageColor: 'green',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.jesca-renetton',
    name: 'Jesca Renetton',
    title: 'Mysticism',
    department: 'mysticism',
    starterSpellId: 'base.spell.dark-pact',
    startingMageColor: 'grey',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.lavanina',
    name: 'Lavanina',
    title: 'Planar Studies',
    department: 'planar-studies',
    starterSpellId: 'base.spell.shadow-bolt',
    startingMageColor: 'purple',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.monad-riverime',
    name: 'Monad Riverime',
    title: 'Divinity',
    department: 'divinity',
    starterSpellId: 'base.spell.holy-smite',
    startingMageColor: 'blue',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'base.candidate.jion-erjon',
    name: 'Jion Erjon',
    title: 'Students — Body President',
    department: 'students',
    starterSpellId: 'base.spell.tardy',
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

// Council Chamber Side B — five slots, each pulling N of three "council
// options" (Draft a Supporter, Gain 1 IP, Gain a Mark). Per the room
// file, Side B drops the "1 mage per player per round" cap that Side A
// imposes — anyone can stack here.
//   Slot 1 (merit, 1 MB): Do all three
//   Slot 2 (regular):     Choose two
//   Slot 3 (regular):     Choose two
//   Slot 4 (regular):     Choose one
//   Slot 5 (regular):     Choose one

function councilSlotB(
  index: number,
  slotType: 'regular' | 'merit',
  totalPicks: 1 | 2 | 3,
): ActionSpace {
  const id = `base.room.council-chamber.b.slot-${index}`;
  const label =
    totalPicks === 3
      ? 'Do all three (Draft a Supporter, Gain 1 IP, Gain a Mark)'
      : totalPicks === 2
        ? 'Choose two of: Draft a Supporter / Gain 1 IP / Gain a Mark'
        : 'Choose one of: Draft a Supporter / Gain 1 IP / Gain a Mark';
  const base: ActionSpace = {
    id,
    roomId: 'base.room.council-chamber.b',
    index: index - 1,
    slotType,
    occupant: null,
    effectId: `base.room.council-chamber-b.do-${totalPicks}`,
    description: label,
  };
  if (slotType === 'merit') {
    return { ...base, costToActivate: { meritBadges: 1 } };
  }
  return base;
}

const councilChamberB: Room = {
  id: 'base.room.council-chamber.b',
  name: 'Council Chamber',
  sourcePackId: PACK_ID,
  isUniversityCentral: true,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [
    councilSlotB(1, 'merit', 3),
    councilSlotB(2, 'regular', 2),
    councilSlotB(3, 'regular', 2),
    councilSlotB(4, 'regular', 1),
    councilSlotB(5, 'regular', 1),
  ],
};

// Library Side A — per the room file:
//   Slot 1 (merit, 1 MB): Gain 1 WIS AND Draft a Vault Card
//   Slot 2 (merit, 1 MB): Gain 1 INT AND gain 1 Research
//   Slot 3 (regular):     Gain a Buy AND Gain 1 Research
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
  description: 'Gain a Buy and Gain 1 Research.',
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

// Library Side B — four slots per the room file:
//   Slot 1 (merit, 1 MB): Gain 1 Research AND draft a Vault Card
//   Slot 2 (merit, 1 MB): Gain 1 INT and 1 WIS OR gain 3 Research
//   Slot 3 (regular):     Gain 2 Buys OR gain 1 Buy and 1 Research
//                         (TODO: 2-Buys branch not wired; both options
//                         currently produce the simpler "1 Buy + 1
//                         Research" path inherited from Side A slot 3.)
//   Slot 4 (regular):     Gain 1 INT OR gain 1 WIS OR gain 1 Research

const libraryBSlot1: ActionSpace = {
  id: 'base.room.library.b.slot-1',
  roomId: 'base.room.library.b',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.library-b.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Gain 1 Research AND Draft a Vault Card.',
};

const libraryBSlot2: ActionSpace = {
  id: 'base.room.library.b.slot-2',
  roomId: 'base.room.library.b',
  index: 1,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.library-b.slot-2',
  costToActivate: { meritBadges: 1 },
  description: 'Gain 1 INT and 1 WIS OR gain 3 Research.',
};

const libraryBSlot3: ActionSpace = {
  ...regularSlot({
    id: 'base.room.library.b.slot-3',
    roomId: 'base.room.library.b',
    index: 2,
    effectId: 'base.room.library-b.slot-3',
  }),
  description: 'Gain a Buy AND Gain 1 Research.',
};

const libraryBSlot4: ActionSpace = {
  ...regularSlot({
    id: 'base.room.library.b.slot-4',
    roomId: 'base.room.library.b',
    index: 3,
    effectId: 'base.room.library-b.slot-4',
  }),
  description: 'Choose 1: Gain 1 INT / Gain 1 WIS / Gain 1 Research.',
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
  actionSpaces: [libraryBSlot1, libraryBSlot2, libraryBSlot3, libraryBSlot4],
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

// Infirmary Side B — same wound-arrival semantics as Side A, but with
// two "buffed bonus" slots above the standard wound-arrival reward:
//   Slot 1 (unique, no shadow): Immediately gain 4 Gold (vs. the
//                               standard 2 Gold).
//   Slot 2 (unique, no shadow): Immediately gain 2 Mana (vs. the
//                               standard 1 Mana).
// These slots can't be placed in directly (the room keeps
// `cannotBePlacedInDirectly: true`). They're "filled" via the wound
// bonus chain: when a wounded mage arrives, if the relevant buffed slot
// is empty, the corresponding bonus option is offered at the upgraded
// amount AND the wounded mage occupies that slot. Occupants are cleared
// when the round-setup heal sweep empties the Infirmary.
const infirmaryBSlot1: ActionSpace = {
  id: 'base.room.infirmary.b.slot-1',
  roomId: 'base.room.infirmary.b',
  index: 0,
  slotType: 'regular',
  occupant: null,
  // Slot effect runs via the wound-bonus chain rather than the
  // resolution pump (the Infirmary stays `cannotBePlacedInDirectly`).
  // A no-op effect id keeps the slot inert if anything ever walks it
  // by accident.
  effectId: 'base.system.noop',
  description: 'When wounded: gain 4 Gold and occupy this slot.',
};

const infirmaryBSlot2: ActionSpace = {
  id: 'base.room.infirmary.b.slot-2',
  roomId: 'base.room.infirmary.b',
  index: 1,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.system.noop',
  description: 'When wounded: gain 2 Mana and occupy this slot.',
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
  description:
    'Wounded mages move here automatically; you cannot place directly. Side B adds two buffed-bonus slots above the standard wound-arrival reward.',
  actionSpaces: [infirmaryBSlot1, infirmaryBSlot2],
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

// Training Fields Side B — three slots per the room file:
//   Slot 1 (merit, 1 MB): Gain 1 INT OR gain 1 WIS; gain 2 Research
//   Slot 2 (regular):     Gain 1 INT OR gain 1 WIS
//   Slot 3 (regular):     Gain 2 Mana OR gain 2 Research

const trainingFieldsBSlot1: ActionSpace = {
  id: 'base.room.training-fields.b.slot-1',
  roomId: 'base.room.training-fields.b',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.training-fields-b.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Choose Gain 1 INT or Gain 1 WIS; gain 2 Research.',
};

const trainingFieldsBSlot2: ActionSpace = {
  ...regularSlot({
    id: 'base.room.training-fields.b.slot-2',
    roomId: 'base.room.training-fields.b',
    index: 1,
    effectId: 'base.room.training-fields-b.slot-2',
  }),
  description: 'Choose 1: Gain 1 INT / Gain 1 WIS.',
};

const trainingFieldsBSlot3: ActionSpace = {
  ...regularSlot({
    id: 'base.room.training-fields.b.slot-3',
    roomId: 'base.room.training-fields.b',
    index: 2,
    effectId: 'base.room.training-fields-b.slot-3',
  }),
  description: 'Choose 1: Gain 2 Mana / Gain 2 Research.',
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
  actionSpaces: [
    trainingFieldsBSlot1,
    trainingFieldsBSlot2,
    trainingFieldsBSlot3,
  ],
};

// Guilds — Side B per the room file (this is the INSTANT face: slot
// effects resolve at placement). Rulebook Side A is a NON-instant
// version with bigger payouts (8/6/4 Gold or 4/3/2 Mana) — those slot
// effects aren't wired yet, so Side A sits below as a content stub.
//   Slot 1 (merit, 1 MB): Immediately gain either 6 Gold OR 3 Mana
//   Slot 2 (regular):     Immediately gain either 4 Gold OR 2 Mana
//   Slot 3 (regular):     Immediately gain either 2 Gold OR 1 Mana

const guildsB: Room = {
  id: 'base.room.guilds.b',
  name: 'Guilds',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description: 'Instant room — slot effects resolve at placement.',
  actionSpaces: [
    {
      id: 'base.room.guilds.b.slot-1',
      roomId: 'base.room.guilds.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.guilds-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Immediately gain either 6 Gold OR 3 Mana.',
    },
    {
      ...regularSlot({
        id: 'base.room.guilds.b.slot-2',
        roomId: 'base.room.guilds.b',
        index: 1,
        effectId: 'base.room.guilds-b.slot-2',
      }),
      description: 'Immediately gain either 4 Gold OR 2 Mana.',
    },
    {
      ...regularSlot({
        id: 'base.room.guilds.b.slot-3',
        roomId: 'base.room.guilds.b',
        index: 2,
        effectId: 'base.room.guilds-b.slot-3',
      }),
      description: 'Immediately gain either 2 Gold OR 1 Mana.',
    },
  ],
};

// Guilds Side A — NON-instant variant of the gold-or-mana room. Same OR
// shape as Side B but slot effects resolve at the resolution phase and
// pay out more:
//   Slot 1 (merit, 1 MB): Gain 8 Gold OR gain 4 Mana
//   Slot 2 (regular):     Gain 6 Gold OR gain 3 Mana
//   Slot 3 (regular):     Gain 4 Gold OR gain 2 Mana

const guildsA: Room = {
  id: 'base.room.guilds.a',
  name: 'Guilds',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  actionSpaces: [
    {
      id: 'base.room.guilds.a.slot-1',
      roomId: 'base.room.guilds.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.guilds-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain 8 Gold OR gain 4 Mana.',
    },
    {
      ...regularSlot({
        id: 'base.room.guilds.a.slot-2',
        roomId: 'base.room.guilds.a',
        index: 1,
        effectId: 'base.room.guilds-a.slot-2',
      }),
      description: 'Gain 6 Gold OR gain 3 Mana.',
    },
    {
      ...regularSlot({
        id: 'base.room.guilds.a.slot-3',
        roomId: 'base.room.guilds.a',
        index: 2,
        effectId: 'base.room.guilds-a.slot-3',
      }),
      description: 'Gain 4 Gold OR gain 2 Mana.',
    },
  ],
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

// Catacombs Side B — three slots per the room file:
//   Slot 1 (merit, 1 MB): Swap 1 IP for 10 Gold (one-shot Yes/No)
//   Slot 2 (regular):     Swap 2 Gold for 1 IP, up to 4 times
//   Slot 3 (regular):     Swap 1 Gold for 1 IP, up to 3 times

const catacombsBSlot1: ActionSpace = {
  id: 'base.room.catacombs.b.slot-1',
  roomId: 'base.room.catacombs.b',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.catacombs-b.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Swap 1 IP for 10 Gold.',
};

const catacombsBSlot2: ActionSpace = {
  ...regularSlot({
    id: 'base.room.catacombs.b.slot-2',
    roomId: 'base.room.catacombs.b',
    index: 1,
    effectId: 'base.room.catacombs-b.slot-2',
  }),
  description: 'Swap 2 Gold for 1 IP, up to 4 times.',
};

const catacombsBSlot3: ActionSpace = {
  ...regularSlot({
    id: 'base.room.catacombs.b.slot-3',
    roomId: 'base.room.catacombs.b',
    index: 2,
    effectId: 'base.room.catacombs-b.slot-3',
  }),
  description: 'Swap 1 Gold for 1 IP, up to 3 times.',
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
  actionSpaces: [catacombsBSlot1, catacombsBSlot2, catacombsBSlot3],
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

// Courtyard Side B — three slots per the room file:
//   Slot 1 (merit, 1 MB): Gain Mana equal to your WIS; gain 1 Research
//   Slot 2 (regular):     Gain Mana equal to your WIS
//   Slot 3 (regular):     Gain Mana equal to half your WIS (round up)

const courtyardBSlot1: ActionSpace = {
  id: 'base.room.courtyard.b.slot-1',
  roomId: 'base.room.courtyard.b',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.courtyard-b.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Gain Mana equal to your WIS; gain 1 Research.',
};

const courtyardBSlot2: ActionSpace = {
  ...regularSlot({
    id: 'base.room.courtyard.b.slot-2',
    roomId: 'base.room.courtyard.b',
    index: 1,
    effectId: 'base.room.courtyard-b.slot-2',
  }),
  description: 'Gain Mana equal to your WIS.',
};

const courtyardBSlot3: ActionSpace = {
  ...regularSlot({
    id: 'base.room.courtyard.b.slot-3',
    roomId: 'base.room.courtyard.b',
    index: 2,
    effectId: 'base.room.courtyard-b.slot-3',
  }),
  description: 'Gain Mana equal to half your WIS (round up).',
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
  actionSpaces: [courtyardBSlot1, courtyardBSlot2, courtyardBSlot3],
};

// Vault — Side B per the room file (this is the "draft / gain gold" room).
// Side A in the rulebook is a different mechanic ("reveal top 3 of the
// Vault Deck on resolution, each occupant picks one") that isn't wired
// yet; it sits below as a stub.
//   Slot 1 (merit, costs 1 MB to place): Draft a Vault Card AND Gain 4 Gold
//   Slot 2 (regular):                    Draft a Vault Card OR Gain 5 Gold
//   Slot 3 (regular):                    Gain 3 Gold

const vaultBSlot1: ActionSpace = {
  id: 'base.room.vault.b.slot-1',
  roomId: 'base.room.vault.b',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.vault-b.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Draft a Vault Card AND Gain 4 Gold.',
};

const vaultBSlot2: ActionSpace = {
  id: 'base.room.vault.b.slot-2',
  roomId: 'base.room.vault.b',
  index: 1,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.room.vault-b.slot-2',
  description: 'Draft a Vault Card OR Gain 5 Gold.',
};

const vaultBSlot3: ActionSpace = {
  id: 'base.room.vault.b.slot-3',
  roomId: 'base.room.vault.b',
  index: 2,
  slotType: 'regular',
  occupant: null,
  effectId: 'base.room.vault-b.slot-3',
  description: 'Gain 3 Gold.',
};

// Vault Side A — non-instant. When the room resolves, the top 3 cards of
// the Vault Deck are revealed; each occupant (in slot order) drafts one
// of the remaining revealed cards for free. Unclaimed cards return to
// the top of the deck in their original order once resolution leaves
// the room. All three slots share the same effect — the slot index
// only matters for the resolution-pump's draft order.
//   Slot 1 (merit, 1 MB): Select and gain one of the revealed cards.
//   Slot 2 (regular):     Same.
//   Slot 3 (regular):     Same.

const vaultASlot1: ActionSpace = {
  id: 'base.room.vault.a.slot-1',
  roomId: 'base.room.vault.a',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.vault-a.slot',
  costToActivate: { meritBadges: 1 },
  description: 'Select and gain one of the revealed Vault Cards.',
};

const vaultASlot2: ActionSpace = {
  ...regularSlot({
    id: 'base.room.vault.a.slot-2',
    roomId: 'base.room.vault.a',
    index: 1,
    effectId: 'base.room.vault-a.slot',
  }),
  description: 'Select and gain one of the revealed Vault Cards.',
};

const vaultASlot3: ActionSpace = {
  ...regularSlot({
    id: 'base.room.vault.a.slot-3',
    roomId: 'base.room.vault.a',
    index: 2,
    effectId: 'base.room.vault-a.slot',
  }),
  description: 'Select and gain one of the revealed Vault Cards.',
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
  description:
    'When this room resolves, reveal the top 3 cards of the Vault Deck. Each occupant drafts one in slot order; unclaimed cards return to the top of the deck.',
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
  actionSpaces: [vaultBSlot1, vaultBSlot2, vaultBSlot3],
};

// Adventuring Side A — stub. Per the room file: Slot 1 (merit) "Gain a
// Secret Supporter and 3 Gold"; Slot 2 "Draw a Vault Card OR Gain 2 IP
// OR Gain 1 INT"; Slot 3 "Draw a Spell Card OR Gain 2 IP OR Gain 1
// WIS". Not wired yet — sits alongside Side B as content TBD.
// Adventuring Side A — 1 merit + 2 regular slots.
//   Slot 1 (merit, 1 MB): Gain a Secret Supporter AND Gain 3 Gold
//   Slot 2 (regular):     Draw a Vault Card OR Gain 2 IP OR Gain 1 INT
//   Slot 3 (regular):     Draw a Spell Card OR Gain 2 IP OR Gain 1 WIS
// "Draw" here means top-of-deck (random, unseen) — different from
// Library/Council Chamber-style drafts which pull a visible tableau card.

const adventuringAMeritSlot: ActionSpace = {
  id: 'base.room.adventuring.a.slot-1',
  roomId: 'base.room.adventuring.a',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.adventuring-a.slot-1',
  costToActivate: { meritBadges: 1 },
  description: 'Gain a Secret Supporter AND Gain 3 Gold.',
};

function adventuringARegularSlot(
  index: number,
  effectId: string,
  description: string,
): ActionSpace {
  return {
    ...regularSlot({
      id: `base.room.adventuring.a.slot-${index + 1}`,
      roomId: 'base.room.adventuring.a',
      index,
      effectId,
    }),
    description,
  };
}

const adventuringA: Room = {
  id: 'base.room.adventuring.a',
  name: 'Adventuring',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    "Gain a Secret Supporter + 3 Gold (merit), or pick one OR option per regular slot (Vault draw / IP / INT — or Spell draw / IP / WIS).",
  actionSpaces: [
    adventuringAMeritSlot,
    adventuringARegularSlot(
      1,
      'base.room.adventuring-a.slot-2',
      'Draw a Vault Card OR Gain 2 IP OR Gain 1 INT.',
    ),
    adventuringARegularSlot(
      2,
      'base.room.adventuring-a.slot-3',
      'Draw a Spell Card (spend 1 INT to learn it) OR Gain 2 IP OR Gain 1 WIS.',
    ),
  ],
};

// Adventuring Side B — 1 merit + 4 regular slots. When a Mage is placed
// here (including via a shadow placement) the owner picks Spell / Vault
// / Supporter and the top of that deck is moved into the room's pool,
// face-up, capped at 3 per type. During resolution, each occupant
// drafts one card from the pool. Anything left when resolution leaves
// the room goes to the bottom of its deck.
//
// The slot effectId points at the shared draft handler; the placement
// hook lives in PLACE_WORKER (see `adventuringBPlacedHook` in engine.ts)
// so it also fires for shadow placements.

const adventuringBMeritSlot: ActionSpace = {
  id: 'base.room.adventuring.b.slot-1',
  roomId: 'base.room.adventuring.b',
  index: 0,
  slotType: 'merit',
  occupant: null,
  effectId: 'base.room.adventuring-b.draft',
  costToActivate: { meritBadges: 1 },
  description: 'Draft a card from the Adventuring pool.',
};

function adventuringBRegularSlot(index: number): ActionSpace {
  return {
    ...regularSlot({
      id: `base.room.adventuring.b.slot-${index + 1}`,
      roomId: 'base.room.adventuring.b',
      index,
      effectId: 'base.room.adventuring-b.draft',
    }),
    description: 'Draft a card from the Adventuring pool.',
  };
}

const adventuringB: Room = {
  id: 'base.room.adventuring.b',
  name: 'Adventuring',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'When you place a Mage here, add a Spell / Vault Card / Supporter (your choice) to this room, face-up. Cap: 3 per type. At resolution each occupant drafts one; leftovers return to the bottom of their deck.',
  actionSpaces: [
    adventuringBMeritSlot,
    adventuringBRegularSlot(1),
    adventuringBRegularSlot(2),
    adventuringBRegularSlot(3),
    adventuringBRegularSlot(4),
  ],
};

// Chapel Side A — 1 merit + 2 regular slots. Every slot grants a Mark on
// top of its primary reward.
//   Slot 1 (merit, 1 MB): Gain 1 INT, Gain 1 WIS, AND gain a Mark
//   Slot 2 (regular):     Gain 2 IP AND gain a Mark
//   Slot 3 (regular):     Gain 2 Gold OR Gain 2 Mana, then gain a Mark
//
// Side B is declared as an unwired stub (empty actionSpaces) so the setup
// sanity check that requires every room to publish both sides is satisfied.
// Re-wire here when Side B content lands.

const chapelA: Room = {
  id: 'base.room.chapel.a',
  name: 'Chapel',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    "Every Chapel slot gains a Mark in addition to its primary reward.",
  actionSpaces: [
    {
      id: 'base.room.chapel.a.slot-1',
      roomId: 'base.room.chapel.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.chapel-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain 1 INT, Gain 1 WIS, AND gain a Mark.',
    },
    {
      ...regularSlot({
        id: 'base.room.chapel.a.slot-2',
        roomId: 'base.room.chapel.a',
        index: 1,
        effectId: 'base.room.chapel-a.slot-2',
      }),
      description: 'Gain 2 IP AND gain a Mark.',
    },
    {
      ...regularSlot({
        id: 'base.room.chapel.a.slot-3',
        roomId: 'base.room.chapel.a',
        index: 2,
        effectId: 'base.room.chapel-a.slot-3',
      }),
      description: 'Gain 2 Gold OR Gain 2 Mana, then gain a Mark.',
    },
  ],
};

// Chapel Side B — INSTANT room. Each slot's reward resolves at placement
// (via the standard resolution-choice → inner effect chain). All three
// slots are Mark-flavoured:
//   Slot 1 (merit, 1 MB): Immediately gain 2 Marks (chain of 2 voter prompts)
//   Slot 2 (regular):     Immediately gain 1 IP AND gain a Mark
//   Slot 3 (regular):     Immediately gain a Mark
const chapelB: Room = {
  id: 'base.room.chapel.b',
  name: 'Chapel',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Instant room — slot rewards resolve at placement. Slot 1 grants two Marks; slots 2 and 3 each grant a single Mark (slot 2 also +1 IP).',
  actionSpaces: [
    {
      id: 'base.room.chapel.b.slot-1',
      roomId: 'base.room.chapel.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.chapel-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Immediately gain 2 Marks.',
    },
    {
      ...regularSlot({
        id: 'base.room.chapel.b.slot-2',
        roomId: 'base.room.chapel.b',
        index: 1,
        effectId: 'base.room.chapel-b.slot-2',
      }),
      description: 'Immediately gain 1 IP AND gain a Mark.',
    },
    {
      ...regularSlot({
        id: 'base.room.chapel.b.slot-3',
        roomId: 'base.room.chapel.b',
        index: 2,
        effectId: 'base.room.chapel-b.slot-3',
      }),
      description: 'Immediately gain a Mark.',
    },
  ],
};

// Dormitory — both sides have 1 merit + 1 regular slot. Every slot lets
// the player pick a Mage colour from the supply and add it to their
// office. Subject to the rulebook's 2-of-a-colour cap, except neutral
// (off-white) which is uncapped per the user spec.
//   Side A:
//     Slot 1 (merit, 1 MB):  Swap 2 Gold for a new Mage of any colour
//     Slot 2 (regular):      Swap 6 Gold for a new Mage of any colour
//   Side B:
//     Slot 1 (merit, 1 MB):  Gain a new Mage of any colour (free)
//     Slot 2 (regular):      Swap 2 IP for a new Mage of any colour

const dormitoryA: Room = {
  id: 'base.room.dormitory.a',
  name: 'Dormitory',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Pick a Mage colour from the supply. 2-per-colour cap (neutral uncapped).',
  actionSpaces: [
    {
      id: 'base.room.dormitory.a.slot-1',
      roomId: 'base.room.dormitory.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.dormitory-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Swap 2 Gold for a new Mage of any colour.',
    },
    {
      ...regularSlot({
        id: 'base.room.dormitory.a.slot-2',
        roomId: 'base.room.dormitory.a',
        index: 1,
        effectId: 'base.room.dormitory-a.slot-2',
      }),
      description: 'Swap 6 Gold for a new Mage of any colour.',
    },
  ],
};

const dormitoryB: Room = {
  id: 'base.room.dormitory.b',
  name: 'Dormitory',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Pick a Mage colour from the supply. 2-per-colour cap (neutral uncapped).',
  actionSpaces: [
    {
      id: 'base.room.dormitory.b.slot-1',
      roomId: 'base.room.dormitory.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.dormitory-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain a new Mage of any colour (free).',
    },
    {
      ...regularSlot({
        id: 'base.room.dormitory.b.slot-2',
        roomId: 'base.room.dormitory.b',
        index: 1,
        effectId: 'base.room.dormitory-b.slot-2',
      }),
      description: 'Swap 2 IP for a new Mage of any colour.',
    },
  ],
};

// Student Stores — both sides have 1 merit + 2 regular slots. Each slot
// grants a number of Buys. Per Buy, the player picks how to spend it.
//   Side A — per-Buy options: Vault Card, INT/4g, WIS/4g, Research/4g, Skip
//     Slot 1 (merit, 1 MB):  Gain 3 Buys
//     Slot 2 (regular):      Gain 2 Buys
//     Slot 3 (regular):      Gain a Buy
//   Side B — per-Buy options: Vault Card, Skip, (once) Pay 1 Gold to re-deal Vault Tableau
//     Slot 1 (merit, 1 MB):  Gain 2 Buys (each Vault buy gets a 2-Gold discount)
//     Slot 2 (regular):      Gain 2 Buys
//     Slot 3 (regular):      Gain a Buy

const studentStoresA: Room = {
  id: 'base.room.student-stores.a',
  name: 'Student Stores',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Per Buy: Vault Card, 1 INT (4 Gold), 1 WIS (4 Gold), 1 Research (4 Gold), or Skip.',
  actionSpaces: [
    {
      id: 'base.room.student-stores.a.slot-1',
      roomId: 'base.room.student-stores.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.student-stores-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain 3 Buys.',
    },
    {
      ...regularSlot({
        id: 'base.room.student-stores.a.slot-2',
        roomId: 'base.room.student-stores.a',
        index: 1,
        effectId: 'base.room.student-stores-a.slot-2',
      }),
      description: 'Gain 2 Buys.',
    },
    {
      ...regularSlot({
        id: 'base.room.student-stores.a.slot-3',
        roomId: 'base.room.student-stores.a',
        index: 2,
        effectId: 'base.room.student-stores-a.slot-3',
      }),
      description: 'Gain a Buy.',
    },
  ],
};

const studentStoresB: Room = {
  id: 'base.room.student-stores.b',
  name: 'Student Stores',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Per Buy: Vault Card or Skip. Once per resolution: pay 1 Gold to discard and re-deal the Vault Tableau.',
  actionSpaces: [
    {
      id: 'base.room.student-stores.b.slot-1',
      roomId: 'base.room.student-stores.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.student-stores-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain 2 Buys; each Vault buy is 2 Gold cheaper.',
    },
    {
      ...regularSlot({
        id: 'base.room.student-stores.b.slot-2',
        roomId: 'base.room.student-stores.b',
        index: 1,
        effectId: 'base.room.student-stores-b.slot-2',
      }),
      description: 'Gain 2 Buys.',
    },
    {
      ...regularSlot({
        id: 'base.room.student-stores.b.slot-3',
        roomId: 'base.room.student-stores.b',
        index: 2,
        effectId: 'base.room.student-stores-b.slot-3',
      }),
      description: 'Gain a Buy.',
    },
  ],
};

// Great Hall — both sides are INSTANT rooms with a "place up to 3 mages
// together" chain. Spec from docs/argent_data/rooms.tsv:
//   Side A: Immediately gain 1 IP
//   Side B: Immediately gain 2 Gold OR gain 1 Mana
// Both sides hold ANY number of mages — the engine carries 10
// pre-allocated slots per side (more than enough for normal play). The
// UI filters to show occupied slots + the first empty one, so the room
// reads as "always one open spot, slots appear as you fill them" to the
// player. The chain placement is wired via `pendingPlaceChain` with
// `restrictRoomId` + `allowStop`, set by the slot's effect when it's the
// first placement of this use.

function greatHallSlot(args: {
  roomId: string;
  index: number;
  effectId: string;
  description: string;
}): ActionSpace {
  return {
    id: `${args.roomId}.slot-${args.index + 1}`,
    roomId: args.roomId,
    index: args.index,
    slotType: 'regular',
    occupant: null,
    effectId: args.effectId,
    description: args.description,
  };
}

const GREAT_HALL_SLOT_CAPACITY = 10;

function makeGreatHallSlots(
  roomId: string,
  effectId: string,
  description: string,
): ActionSpace[] {
  return Array.from({ length: GREAT_HALL_SLOT_CAPACITY }, (_, i) =>
    greatHallSlot({ roomId, index: i, effectId, description }),
  );
}

const greatHallA: Room = {
  id: 'base.room.great-hall.a',
  name: 'Great Hall',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  noShadowSlots: true,
  description:
    'Holds any number of mages. Each placement: Immediately gain 1 IP. On a fresh use, may chain up to 2 more placements here together.',
  actionSpaces: makeGreatHallSlots(
    'base.room.great-hall.a',
    'base.room.great-hall-a.slot',
    'Immediately gain 1 IP. On a fresh use, may chain up to 2 more placements here together.',
  ),
};

const greatHallB: Room = {
  id: 'base.room.great-hall.b',
  name: 'Great Hall',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  noShadowSlots: true,
  description:
    'Holds any number of mages. Each placement: Immediately gain 2 Gold OR gain 1 Mana. On a fresh use, may chain up to 2 more placements here together.',
  actionSpaces: makeGreatHallSlots(
    'base.room.great-hall.b',
    'base.room.great-hall-b.slot',
    'Immediately gain 2 Gold OR gain 1 Mana. On a fresh use, may chain up to 2 more placements here together.',
  ),
};

// ============================================================================
// Archmage's Study Side A — INSTANT room. Spec from the spreadsheet:
//   Special: "The Archmage's Apprentice has all Mage Powers."
//   Slot 1 (merit, 1 MB): Immediately pay 1 Mana to gain the Archmage's
//                         Apprentice for this round.
//   Slot 2 (regular):     Immediately gain 1 IP and swap this Mage for
//                         another from the supply.
//   Slot 3 (regular):     Immediately swap this Mage for another from
//                         the supply.
// The Apprentice is a special "joker" mage tracked via
// `state.archmagesApprenticeOwner`. It cannot be traded / swapped /
// banished; the round-end cleanup hook removes it from the owner's
// office and clears the owner pointer.
// ============================================================================

const archmagesStudyA: Room = {
  id: 'base.room.archmages-study.a',
  name: "Archmage's Study",
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    "Instant room. The Archmage's Apprentice has all Mage Powers.",
  actionSpaces: [
    {
      id: 'base.room.archmages-study.a.slot-1',
      roomId: 'base.room.archmages-study.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.archmages-study-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        "Immediately pay 1 Mana to gain the Archmage's Apprentice for this round.",
    },
    {
      ...regularSlot({
        id: 'base.room.archmages-study.a.slot-2',
        roomId: 'base.room.archmages-study.a',
        index: 1,
        effectId: 'base.room.archmages-study-a.slot-2',
      }),
      description:
        'Immediately gain 1 IP and swap this Mage for another from the supply.',
    },
    {
      ...regularSlot({
        id: 'base.room.archmages-study.a.slot-3',
        roomId: 'base.room.archmages-study.a',
        index: 2,
        effectId: 'base.room.archmages-study-a.slot-3',
      }),
      description:
        'Immediately swap this Mage for another from the supply.',
    },
  ],
};

// Archmage's Study Side B — INSTANT room, mirrors Side A's shape.
//   Slot 1 (merit, 1 MB): Immediately pay 2 Gold to gain the
//                         Archmage's Apprentice for this round.
//   Slot 2 (regular):     Immediately gain 1 Mana and swap this Mage
//                         for another from the supply.
//   Slot 3 (regular):     Immediately swap this non-Neutral Mage for a
//                         Neutral Mage and gain 3 Marks.
const archmagesStudyB: Room = {
  id: 'base.room.archmages-study.b',
  name: "Archmage's Study",
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    "Instant room. The Archmage's Apprentice has all Mage Powers.",
  actionSpaces: [
    {
      id: 'base.room.archmages-study.b.slot-1',
      roomId: 'base.room.archmages-study.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.archmages-study-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        "Immediately pay 2 Gold to gain the Archmage's Apprentice for this round.",
    },
    {
      ...regularSlot({
        id: 'base.room.archmages-study.b.slot-2',
        roomId: 'base.room.archmages-study.b',
        index: 1,
        effectId: 'base.room.archmages-study-b.slot-2',
      }),
      description:
        'Immediately gain 1 Mana and swap this Mage for another from the supply.',
    },
    {
      ...regularSlot({
        id: 'base.room.archmages-study.b.slot-3',
        roomId: 'base.room.archmages-study.b',
        index: 2,
        effectId: 'base.room.archmages-study-b.slot-3',
      }),
      description:
        'Immediately swap this non-Neutral Mage for a Neutral Mage and gain 3 Marks. (No effect if a Neutral Mage or the Apprentice is placed here.)',
    },
  ],
};

// ============================================================================
// Astronomy Tower Side A — a marker tracks a position on a 6-space reward
// track. Each slot lets the player pay (per the slot's per-space cost) to
// move the marker; after moving at least 1 space they claim the reward
// the marker lands on. The marker wraps from the last space back to the
// first, and (unlike Side B) PERSISTS between rounds — it only moves when
// a player pays to move it. Slot effects fire during resolution.
//   Slot 1 (merit, 1 MB): move 1 space free, then 1 Gold per space.
//   Slot 2 (regular):     2 Gold per space.
//   Slot 3 (regular):     3 Gold per space.
//   Track: 1 WIS + 2 Mana / 2 Research / 8 Gold / 1 INT + 1 Research /
//          4 Mana / 2 Marks.
// ============================================================================

const astronomyTowerA: Room = {
  id: 'base.room.astronomy-tower.a',
  name: 'Astronomy Tower',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Pay to move the marker along the reward track, then claim the reward it lands on (move at least 1 space; wraps around). The marker persists between rounds.',
  actionSpaces: [
    {
      id: 'base.room.astronomy-tower.a.slot-1',
      roomId: 'base.room.astronomy-tower.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.astronomy-tower-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Move 1 space free, then pay 1 Gold per space.',
    },
    {
      ...regularSlot({
        id: 'base.room.astronomy-tower.a.slot-2',
        roomId: 'base.room.astronomy-tower.a',
        index: 1,
        effectId: 'base.room.astronomy-tower-a.slot-2',
      }),
      description: 'Pay 2 Gold per space moved.',
    },
    {
      ...regularSlot({
        id: 'base.room.astronomy-tower.a.slot-3',
        roomId: 'base.room.astronomy-tower.a',
        index: 2,
        effectId: 'base.room.astronomy-tower-a.slot-3',
      }),
      description: 'Pay 3 Gold per space moved.',
    },
  ],
};

// Astronomy Tower Side B — like Side A but the marker only moves RIGHT
// and CLAMPS at the final space (no wrap), and its position RESETS to
// the start at round-setup. The final space ("Choose any previous
// reward") can still be activated by paying once even though the marker
// can't advance further. Costs are paid in Mana. The merit slot is last
// (the cheapest, 1 Mana/space).
//   Slot 1 (regular):     2 Mana per space.
//   Slot 2 (regular):     2 Mana per space.
//   Slot 3 (merit, 1 MB): 1 Mana per space.
//   Track: Start (no reward) / 5 Mana / 8 Gold / 2 Marks /
//          1 INT + 1 WIS + 1 Research / Draft 2 Vault Cards /
//          Gain a Mage from the supply / Choose any previous reward.
const astronomyTowerB: Room = {
  id: 'base.room.astronomy-tower.b',
  name: 'Astronomy Tower',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Pay Mana to move the marker right along the reward track, then claim the reward it lands on (move at least 1 space; the marker stops at the end and resets each round).',
  actionSpaces: [
    {
      ...regularSlot({
        id: 'base.room.astronomy-tower.b.slot-1',
        roomId: 'base.room.astronomy-tower.b',
        index: 0,
        effectId: 'base.room.astronomy-tower-b.slot-1',
      }),
      description: 'Pay 2 Mana per space moved.',
    },
    {
      ...regularSlot({
        id: 'base.room.astronomy-tower.b.slot-2',
        roomId: 'base.room.astronomy-tower.b',
        index: 1,
        effectId: 'base.room.astronomy-tower-b.slot-2',
      }),
      description: 'Pay 2 Mana per space moved.',
    },
    {
      id: 'base.room.astronomy-tower.b.slot-3',
      roomId: 'base.room.astronomy-tower.b',
      index: 2,
      slotType: 'merit',
      occupant: null,
      effectId: 'base.room.astronomy-tower-b.slot-3',
      costToActivate: { meritBadges: 1 },
      description: 'Pay 1 Mana per space moved.',
    },
  ],
};

const rooms: Room[] = [
  // University Central — always present.
  councilChamberA,
  councilChamberB,
  libraryA,
  libraryB,
  infirmaryA,
  infirmaryB,

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
  adventuringA,
  adventuringB,
  chapelA,
  chapelB,
  dormitoryA,
  dormitoryB,
  studentStoresA,
  studentStoresB,
  greatHallA,
  greatHallB,
  archmagesStudyA,
  archmagesStudyB,
  astronomyTowerA,
  astronomyTowerB,
];

// ============================================================================
// Voters — 2 always-face-up + 16 in the face-down pool = 18 total
// ============================================================================

function voter(args: {
  id: string;
  name: string;
  title: string;
  description: string;
  criterion: ScoringCriterion;
  votes?: number;
  isAlwaysFaceUp?: boolean;
}): ConsortiumVoter {
  return {
    id: args.id,
    name: args.name,
    title: args.title,
    description: args.description,
    sourcePackId: PACK_ID,
    criterion: args.criterion,
    votes: args.votes ?? 1,
    isAlwaysFaceUp: args.isAlwaysFaceUp ?? false,
    revealed: args.isAlwaysFaceUp ?? false,
  };
}

// All 18 base voters, sourced from the Argent data sheet. The 2 required
// face-up voters (Nostros Calahan and Luna Van Kessel) are always revealed;
// the other 16 form the face-down pool from which `setup.ts` draws 10 (or
// fewer when 2nd-Most criteria are excluded by the 2-player variant).
const voters: ConsortiumVoter[] = [
  voter({
    id: 'base.voter.most-influence',
    name: 'Nostros Calahan',
    title: 'Departing Chancellor',
    criterion: 'most-influence',
    description: 'Awards a vote to the player with the most Influence Points (IP).',
    isAlwaysFaceUp: true,
  }),
  voter({
    id: 'base.voter.most-supporters',
    name: 'Luna Van Kessel',
    title: 'Dean of Students',
    criterion: 'most-supporters',
    description: 'Awards a vote to the player with the most Supporter Cards.',
    isAlwaysFaceUp: true,
  }),
  voter({
    id: 'base.voter.most-natural-magick',
    name: 'Abarene Unt Hallicris',
    title: 'Amalao Senate Majority Whip',
    criterion: 'most-natural-magick',
    description:
      'Awards a vote to the player with the most Natural Magick Spell Research and Supporter Cards.',
  }),
  voter({
    id: 'base.voter.most-mana',
    name: 'Adienna Callista',
    title: 'The "Crystal Witch"',
    criterion: 'most-mana',
    description: 'Awards a vote to the player with the most Mana.',
  }),
  voter({
    id: 'base.voter.most-intelligence',
    name: 'Ainos Lockehart',
    title: 'Professor Emeritus',
    criterion: 'most-intelligence',
    description: 'Awards a vote to the player with the most Intelligence Tokens.',
  }),
  voter({
    id: 'base.voter.most-treasures',
    name: 'Amon Elcela',
    title: 'Representative for the Reliquary',
    criterion: 'most-treasures',
    description:
      'Awards a vote to the player with the most Treasure Vault Cards.',
  }),
  voter({
    id: 'base.voter.most-marks',
    name: 'Cairngort Rexan',
    title: 'Overlord of Gesselheim',
    criterion: 'most-marks',
    description: 'Awards a vote to the player with the most Marks placed.',
  }),
  voter({
    id: 'base.voter.most-research',
    name: 'Candide Malephaise',
    title: 'Afterworld Emissary',
    criterion: 'most-research',
    description: 'Awards a vote to the player with the most Spell Research.',
  }),
  voter({
    id: 'base.voter.second-most-supporters',
    name: 'Colth Midlun',
    title: 'Keeper of the Keys',
    criterion: 'second-most-supporters',
    description:
      'Awards a vote to the player with the second-most Supporter Cards.',
  }),
  voter({
    id: 'base.voter.most-consumables',
    name: 'Dareios Kuel',
    title: 'Wandering Apothecarist',
    criterion: 'most-consumables',
    description:
      'Awards a vote to the player with the most Consumable Vault Cards.',
  }),
  voter({
    id: 'base.voter.most-gold',
    name: 'Gerard Matranga',
    title: 'The "Mercenary King"',
    criterion: 'most-gold',
    description: 'Awards a vote to the player with the most Gold.',
  }),
  voter({
    id: 'base.voter.most-mysticism',
    name: 'Hepzibah Culotre',
    title: 'Legendary Healer',
    criterion: 'most-mysticism',
    description:
      'Awards a vote to the player with the most Mysticism Spell Research and Supporter Cards.',
  }),
  voter({
    id: 'base.voter.most-planar-studies',
    name: 'Jeris Iyes',
    title: 'Magister of Willat',
    criterion: 'most-planar-studies',
    description:
      'Awards a vote to the player with the most Planar Studies Spell Research and Supporter Cards.',
  }),
  voter({
    id: 'base.voter.most-wisdom',
    name: 'Lord Eustace',
    title: 'Baron of Kherdoza',
    criterion: 'most-wisdom',
    description: 'Awards a vote to the player with the most Wisdom Tokens.',
  }),
  voter({
    id: 'base.voter.most-diversity',
    name: 'Marmelee Greyheart',
    title: 'Amalao National Historian',
    criterion: 'most-diversity',
    description:
      'Awards a vote to the player with the most different kinds of Supporter Cards and Spell Research.',
  }),
  voter({
    id: 'base.voter.second-most-influence',
    name: 'Melinda Marsellis',
    title: "Chancellor's Secretary",
    criterion: 'second-most-influence',
    description:
      'Awards a vote to the player with the second-most Influence Points (IP).',
  }),
  voter({
    id: 'base.voter.most-sorcery',
    name: 'Rufus Zane',
    title: 'The "Sorceror Baron"',
    criterion: 'most-sorcery',
    description:
      'Awards a vote to the player with the most Sorcery Spell Research and Supporter Cards.',
  }),
  voter({
    id: 'base.voter.most-divinity',
    name: 'St. Abdel Iyes',
    title: 'Archmage of Sanghalim',
    criterion: 'most-divinity',
    description:
      'Awards a vote to the player with the most Divinity Spell Research and Supporter Cards.',
  }),
];

// ============================================================================
// Bell Tower — 5 offerings, gated by player count
// ============================================================================
//
// Each round seats every offering whose minPlayers is met. Claiming the last
// available card drains the tower and ends the round.
//
//   2+ Initiative      — Become First Player next round.
//   2+ Popularity      — Gain 1 IP.
//   3+ Resourcefulness — Gain 2 Gold or 1 Mana.
//   4+ Strength        — Heal a Mage from the Infirmary.
//   5+ Power           — Your Spells cost 1 less Mana for the rest of the round.

const bellTowerCards: BellTowerCard[] = [
  {
    id: 'base.bell.first-player',
    name: 'Initiative',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.first-player',
    minPlayers: 2,
    description: 'You will be First Player during the next round.',
  },
  {
    id: 'base.bell.gain-ip',
    name: 'Popularity',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.gain-ip',
    minPlayers: 2,
    description: 'Gain 1 IP.',
  },
  {
    id: 'base.bell.gold-or-mana',
    name: 'Resourcefulness',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.gold-or-mana',
    minPlayers: 3,
    description: 'Gain 2 Gold or gain 1 Mana.',
  },
  {
    id: 'base.bell.heal-from-infirmary',
    name: 'Strength',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.heal-from-infirmary',
    minPlayers: 4,
    description: 'Heal a Mage in the Infirmary.',
  },
  {
    id: 'base.bell.cheap-spells',
    name: 'Power',
    sourcePackId: PACK_ID,
    effectId: 'base.bell.cheap-spells',
    minPlayers: 5,
    description: 'Your Spells cost 1 less Mana for the rest of the round.',
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
