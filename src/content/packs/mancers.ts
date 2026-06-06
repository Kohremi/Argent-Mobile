import type { ContentPack } from '../types';
import type {
  ActionSpace,
  Candidate,
  ConsortiumVoter,
  Department,
  Mage,
  Room,
  SpellCard,
  SupporterCard,
  VaultCard,
} from '../../game/types';

const PACK_ID = 'mancers';

// ============================================================================
// Synthesis Treasures — one per magic department. They are NOT shuffled into
// the Vault Deck (`copies: 0`); the only way to obtain one is the Synthesis
// Workshop room, which converts a Treasure + Supporter into the synthesis
// item matching the Supporter's department. All are Treasures.
// ============================================================================

const synthesisTreasures: VaultCard[] = [
  {
    id: 'mancers.vault.sacred-shield',
    name: 'Sacred Shield',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 0,
    copies: 0,
    timing: 'reaction',
    effectId: 'mancers.vault.sacred-shield.react',
    description:
      'Reaction (does not exhaust): after one of your Mages is wounded, spend 1 Mana to move it to any open slot. May react to each Mage wounded by the same effect.',
  },
  {
    id: 'mancers.vault.vanishing-staff',
    name: 'Vanishing Staff',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 0,
    copies: 0,
    timing: 'action',
    effectId: 'mancers.vault.vanishing-staff',
    description:
      'Action: spend 1 Mana to shadow any space (including your own Mage or an empty slot).',
  },
  {
    id: 'mancers.vault.lightning-totem',
    name: 'Lightning Totem',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 0,
    copies: 0,
    timing: 'fast-action',
    effectId: 'mancers.vault.lightning-totem',
    description:
      'Fast Action: spend 1 Mana to wound up to 2 Mages in the same room.',
  },
  {
    id: 'mancers.vault.hourglass-of-fate',
    name: 'Hourglass of Fate',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 0,
    copies: 0,
    timing: 'reaction',
    effectId: 'mancers.vault.hourglass-of-fate.react',
    description:
      'Reaction: when the last Bell Tower Offering is taken by another player, place a Mage (using Mage powers).',
  },
  {
    id: 'mancers.vault.sword-of-flame',
    name: 'Sword of Flame',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 0,
    copies: 0,
    timing: 'fast-action',
    effectId: 'mancers.vault.sword-of-flame',
    description:
      'Fast Action: spend 1 Mana to wound a Mage and place one of yours in its slot.',
  },
  {
    id: 'mancers.vault.endless-well-of-mana',
    name: 'Endless Well of Mana',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 0,
    copies: 0,
    timing: 'fast-action',
    effectId: 'mancers.vault.endless-well-of-mana',
    description: 'Fast Action: gain 2 Mana.',
  },
];

/** Department → its synthesis Treasure id. A 'wild' (all-department) Supporter
 *  lets the player pick any. Used by the Synthesis Workshop. */
export const SYNTHESIS_BY_DEPARTMENT: Partial<Record<Department, string>> = {
  divinity: 'mancers.vault.sacred-shield',
  mysticism: 'mancers.vault.vanishing-staff',
  'natural-magick': 'mancers.vault.lightning-totem',
  'planar-studies': 'mancers.vault.hourglass-of-fate',
  sorcery: 'mancers.vault.sword-of-flame',
  technomancy: 'mancers.vault.endless-well-of-mana',
};

export const ALL_SYNTHESIS_IDS: string[] = synthesisTreasures.map((v) => v.id);

// ============================================================================
// Mancers Vault cards — the expansion's regular Treasures/Consumables (the
// "Mancers/Stuff" set). Shuffled into the Vault deck like any base card.
// Effects registered in game/effects/mancers.ts; unwired ones are graceful
// no-ops when played.
// ============================================================================

const stuffVaultCards: VaultCard[] = [
  {
    id: 'mancers.vault.philosophers-stone',
    name: "Philosopher's Stone",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 4,
    timing: 'action',
    effectId: 'mancers.vault.philosophers-stone',
    description: 'Gain 4 Gold.',
  },
  {
    id: 'mancers.vault.chrysopoeia-potion',
    name: 'Chrysopoeia Potion',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 2,
    timing: 'action',
    copies: 2,
    effectId: 'mancers.vault.chrysopoeia-potion',
    description: 'Swap 1 Mana for 3 Gold, up to 4 times.',
  },
  {
    id: 'mancers.vault.sorcerors-hat',
    name: "Sorceror's Hat",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'action',
    effectId: 'mancers.vault.sorcerors-hat',
    description: 'Wound a Mage and place one of yours in its slot.',
  },
  {
    id: 'mancers.vault.planar-scouter',
    name: 'Planar Scouter',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'fast-action',
    effectId: 'mancers.vault.planar-scouter',
    description: 'Place a Mage.',
  },
  {
    id: 'mancers.vault.technomancers-top-hat',
    name: "Technomancer's Top Hat",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'action',
    effectId: 'mancers.vault.technomancers-top-hat',
    description: 'Place a Mage, then gain a Research.',
  },
  {
    id: 'mancers.vault.tonic-of-panacea',
    name: 'Tonic of Panacea',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 2,
    timing: 'fast-action',
    copies: 2,
    effectId: 'mancers.vault.tonic-of-panacea',
    description: 'Return all of your Mages in the Infirmary to your office.',
  },
  {
    id: 'mancers.vault.shadow-salve',
    name: 'Shadow Salve',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 1,
    timing: 'action',
    copies: 2,
    effectId: 'mancers.vault.shadow-salve',
    description: 'Shadow one of your own Mages.',
  },
  {
    id: 'mancers.vault.tricksters-cape',
    name: "Trickster's Cape",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'action',
    effectId: 'mancers.vault.tricksters-cape',
    description: 'Shadow with one of your Mages.',
  },
  {
    id: 'mancers.vault.elixir-of-life',
    name: 'Elixir of Life',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 3,
    timing: 'fast-action',
    copies: 2,
    effectId: 'mancers.vault.elixir-of-life',
    description: 'Move all of your Mages in the Infirmary to open slots of your choice.',
  },
  {
    id: 'mancers.vault.time-prism',
    name: 'Time Prism',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 6,
    timing: 'action',
    effectId: 'mancers.vault.time-prism',
    description: 'Lock or Unlock a room.',
  },
  {
    id: 'mancers.vault.potion-of-vigor',
    name: 'Potion of Vigor',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 3,
    timing: 'action',
    copies: 2,
    effectId: 'mancers.vault.potion-of-vigor',
    description: 'Take a Supporter from your discard and place it in your office.',
  },
  {
    id: 'mancers.vault.diviners-mitre',
    name: "Diviner's Mitre",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'reaction',
    effectId: 'mancers.vault.diviners-mitre.react',
    description:
      'When one of your Mages would be wounded, banished, or moved by a Spell, place it in any empty slot.',
  },
  {
    id: 'mancers.vault.nature-mages-cap',
    name: "Nature Mage's Cap",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'action',
    effectId: 'mancers.vault.nature-mages-cap',
    description:
      "Move an opponent's Mage to another slot in the same room and put one of your Mages in its place.",
  },
  {
    id: 'mancers.vault.mystics-cowl',
    name: "Mystic's Cowl",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 3,
    timing: 'fast-action',
    effectId: 'mancers.vault.mystics-cowl',
    description: 'The next time you cast a Spell this turn, place a Mage immediately after.',
  },
  {
    id: 'mancers.vault.clockwerk-replicator',
    name: 'Clockwerk Replicator',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 5,
    timing: 'fast-action',
    effectId: 'mancers.vault.clockwerk-replicator',
    description:
      'The next time you would discard a Vault Card this turn, keep it in your office or readied instead.',
  },
  {
    id: 'mancers.vault.alkahest-potion',
    name: 'Alkahest Potion',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 2,
    timing: 'action',
    copies: 2,
    effectId: 'mancers.vault.alkahest-potion',
    description:
      'Discard another Vault Card to your discard. Gain its cost in Gold and gain 2 Mana.',
  },
];

// Mancers of the University expansion.
// Holds the Technomancer (orange) mage piece, the two Technomancy
// candidate leaders (Sophica Sentavra + Riflam Lenshear), their
// unique starter "leader" spells (Arcane Surge + Arcane Investigation),
// and the Laboratory room (Sides A and B). TODO: supporters, vault
// cards, and the rest of the expansion's rooms.

// ============================================================================
// Mages — Technomancer (orange) is the Mancers expansion's added Mage
// type. Without Mancers seated, the orange mage card and pool entries
// are absent from the game.
// ============================================================================

const mages: Mage[] = [
  {
    id: 'mancers.mage.technomancy',
    name: 'Technomancer',
    sourcePackId: PACK_ID,
    color: 'orange',
    department: 'technomancy',
    description:
      'Place: Spend 3 Gold when placing this mage to gain a Research.',
    aPowerEffectId: 'mancers.mage.technomancy.a',
    bPowerEffectId: 'mancers.mage.technomancy.b',
  },
];

// ============================================================================
// Leader spells — unique single-level starter spells bound to the two
// Technomancy leaders. Effects are registered in game/effects/mancers.ts.
// ============================================================================

const arcaneSurge: SpellCard = {
  id: 'mancers.spell.arcane-surge',
  name: 'Arcane Surge',
  sourcePackId: PACK_ID,
  department: 'technomancy',
  unique: true,
  levels: [
    {
      level: 1,
      title: 'Arcane Surge',
      manaCost: 0,
      timing: 'fast-action',
      effectId: 'mancers.spell.arcane-surge.l1',
      description: 'Give an opponent 1 Mana and wound one of their Mages.',
    },
  ],
};

const arcaneInvestigation: SpellCard = {
  id: 'mancers.spell.arcane-investigation',
  name: 'Arcane Investigation',
  sourcePackId: PACK_ID,
  department: 'technomancy',
  unique: true,
  levels: [
    {
      level: 1,
      title: 'Arcane Investigation',
      manaCost: 1,
      timing: 'action',
      effectId: 'mancers.spell.arcane-investigation.l1',
      description: 'Gain a Research OR gain a Mark.',
    },
  ],
};

// Leader (unique) spells live in `legendarySpells`, NOT `spells` — the
// `spells` array is the draftable spell-deck pool, and unique starter
// spells must never be shuffled into it (they belong to their leader's
// player only, set up at candidate allocation). This matches the base
// pack's convention. `unclaimedLegendaryBooks` skips `unique` entries,
// so these aren't draftable via Sealed Scroll either.
const leaderSpells: SpellCard[] = [arcaneSurge, arcaneInvestigation];

// ============================================================================
// Candidates — Mancers introduces ONLY the two Technomancy leaders.
// Both are selectable in candidate-draft when the Mancers pack is seated.
// Each grants its unique Technomancy starter spell + 2 orange Mages.
// ============================================================================

const candidates: Candidate[] = [
  {
    id: 'mancers.candidate.sophica-sentavra',
    name: 'Sophica Sentavra',
    title: 'Interim Dean of Technomancy',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    starterSpellId: 'mancers.spell.arcane-surge',
    startingMageColor: 'orange',
    startingExtraMeritBadge: false,
  },
  {
    id: 'mancers.candidate.riflam-lenshear',
    name: 'Riflam Lenshear',
    title: 'Admissions Coordinator',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    starterSpellId: 'mancers.spell.arcane-investigation',
    startingMageColor: 'orange',
    startingExtraMeritBadge: false,
  },
];

// ============================================================================
// Laboratory Side A — INSTANT room (slot effects resolve at placement). The
// reward depends on the colour of the placed Mage:
//   Divinity (blue)     → Heal + Move a Mage from the Infirmary
//   Mysticism (grey)    → Gain a Mark
//   Natural Magick      → Gain 4 Gold
//   Planar Studies      → Gain 1 Research
//   Sorcery (red)       → Gain 2 Mana
//   Technomancy (orange)→ Gain a Buy
// Slot 1 (merit) doubles the reward; slots 2 + 3 give it once. Shadows
// follow the standard "occupant resolves the slot" rule.
// ============================================================================

function laboratorySlot(opts: {
  index: number;
  effectId: string;
  slotType: 'merit' | 'regular';
  description: string;
}): ActionSpace {
  const base: ActionSpace = {
    id: `mancers.room.laboratory.a.slot-${opts.index + 1}`,
    roomId: 'mancers.room.laboratory.a',
    index: opts.index,
    slotType: opts.slotType,
    occupant: null,
    effectId: opts.effectId,
    description: opts.description,
  };
  if (opts.slotType === 'merit') {
    return { ...base, costToActivate: { meritBadges: 1 } };
  }
  return base;
}

const laboratoryA: Room = {
  id: 'mancers.room.laboratory.a',
  name: 'Laboratory',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Instant room — slot effects resolve at placement based on the placed Mage\'s type. Slot 1 doubles the reward.',
  actionSpaces: [
    laboratorySlot({
      index: 0,
      effectId: 'mancers.room.laboratory-a.slot-double',
      slotType: 'merit',
      description:
        'Immediately gain a DOUBLE reward based on the placed Mage\'s type.',
    }),
    laboratorySlot({
      index: 1,
      effectId: 'mancers.room.laboratory-a.slot-single',
      slotType: 'regular',
      description:
        'Immediately gain a reward based on the placed Mage\'s type.',
    }),
    laboratorySlot({
      index: 2,
      effectId: 'mancers.room.laboratory-a.slot-single',
      slotType: 'regular',
      description:
        'Immediately gain a reward based on the placed Mage\'s type.',
    }),
  ],
};

// ============================================================================
// Laboratory Side B — non-instant. Slot effects resolve during the normal
// resolution phase. The reward also depends on the placed Mage's colour:
//   Divinity (blue)     → Gain 3 Mana
//   Mysticism (grey)    → Gain a Mark
//   Natural Magick      → Gain 1 INT
//   Planar Studies      → Gain 1 WIS
//   Sorcery (red)       → Gain a Research
//   Technomancy (orange)→ Gain 2 Buys
// Slot 1 (merit) doubles the reward; slots 2 + 3 give it once.
// ============================================================================

function laboratoryBSlot(opts: {
  index: number;
  effectId: string;
  slotType: 'merit' | 'regular';
  description: string;
}): ActionSpace {
  const base: ActionSpace = {
    id: `mancers.room.laboratory.b.slot-${opts.index + 1}`,
    roomId: 'mancers.room.laboratory.b',
    index: opts.index,
    slotType: opts.slotType,
    occupant: null,
    effectId: opts.effectId,
    description: opts.description,
  };
  if (opts.slotType === 'merit') {
    return { ...base, costToActivate: { meritBadges: 1 } };
  }
  return base;
}

const laboratoryB: Room = {
  id: 'mancers.room.laboratory.b',
  name: 'Laboratory',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Slot effects resolve at resolution based on the placed Mage\'s type. Slot 1 doubles the reward.',
  actionSpaces: [
    laboratoryBSlot({
      index: 0,
      effectId: 'mancers.room.laboratory-b.slot-double',
      slotType: 'merit',
      description:
        'Gain a DOUBLE reward based on the placed Mage\'s type.',
    }),
    laboratoryBSlot({
      index: 1,
      effectId: 'mancers.room.laboratory-b.slot-single',
      slotType: 'regular',
      description:
        'Gain a reward based on the placed Mage\'s type.',
    }),
    laboratoryBSlot({
      index: 2,
      effectId: 'mancers.room.laboratory-b.slot-single',
      slotType: 'regular',
      description:
        'Gain a reward based on the placed Mage\'s type.',
    }),
  ],
};

// ============================================================================
// Research Archive Side A — non-instant. Each slot gains some Research
// and/or lets the player "move Research" — relocating a WIS token from a
// learned spell (taking its top token: L3 first, else L2; reducing that
// spell's level) onto another learned spell to unlock its next level.
//   Slot 1 (merit, 1 MB): Gain 1 INT, Gain 1 WIS, and rearrange your
//                         Research freely (unlimited moves until done).
//   Slot 2 (regular):     Gain 2 Research, then move up to 3 Research.
//   Slot 3 (regular):     Gain 1 Research, then move up to 2 Research.
// Side B is a stub for now (declared so the setup sanity check passes).
// ============================================================================

const researchArchiveA: Room = {
  id: 'mancers.room.research-archive.a',
  name: 'Research Archive',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Gain Research and rearrange the WIS tokens on your learned Spells (move a token from one Spell to raise another).',
  actionSpaces: [
    {
      id: 'mancers.room.research-archive.a.slot-1',
      roomId: 'mancers.room.research-archive.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.research-archive-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        'Gain 1 INT, Gain 1 WIS, and rearrange your Research freely.',
    },
    {
      id: 'mancers.room.research-archive.a.slot-2',
      roomId: 'mancers.room.research-archive.a',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.research-archive-a.slot-2',
      description: 'Gain 2 Research, then move up to 3 Research.',
    },
    {
      id: 'mancers.room.research-archive.a.slot-3',
      roomId: 'mancers.room.research-archive.a',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.research-archive-a.slot-3',
      description: 'Gain a Research, then move up to 2 Research.',
    },
  ],
};

// ============================================================================
// Research Archive Side B — non-instant.
//   Slot 1 (merit, 1 MB): Gain 1 INT + 1 Research, OR Gain 2 WIS (a choice).
//   Slot 2 (regular):     Gain 2 Research, then move up to 3 Research (== A.2).
//   Slot 3 (regular):     Swap one of your (non-leader) Spells with one from
//                         the Tableau, transferring ALL of its Research to the
//                         new Spell. Driven by the board UI: click your own
//                         Spell, then click the Tableau Spell to swap to.
// ============================================================================

const researchArchiveB: Room = {
  id: 'mancers.room.research-archive.b',
  name: 'Research Archive',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Gain Research, rearrange WIS tokens, or swap one of your Spells with the Tableau (its Research transfers to the new Spell).',
  actionSpaces: [
    {
      id: 'mancers.room.research-archive.b.slot-1',
      roomId: 'mancers.room.research-archive.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.research-archive-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Gain 1 INT and 1 Research, OR gain 2 WIS.',
    },
    {
      id: 'mancers.room.research-archive.b.slot-2',
      roomId: 'mancers.room.research-archive.b',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.research-archive-b.slot-2',
      description: 'Gain 2 Research, then move up to 3 Research.',
    },
    {
      id: 'mancers.room.research-archive.b.slot-3',
      roomId: 'mancers.room.research-archive.b',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.research-archive-b.slot-3',
      description:
        'Swap one of your Spells with one from the Tableau; transfer all its Research to the new Spell.',
    },
  ],
};

// ============================================================================
// Golem Lab Side A — INSTANT room. Each slot conjures a TEMPORARY Mage (a
// golem): a board piece that ignores placement limits, has no powers, can be
// wounded / healed / moved like a normal Mage, and vanishes at the end of the
// round it was deployed (see `isTemporary` + round-setup cleanup).
//   Slot 1 (merit): Pay 1 Mana to place a golem, then LOCK the room it lands in.
//   Slot 2:         Place a golem into any open shadow slot (free).
//   Slot 3:         Pay 3 Mana to place a golem, then take another action.
// Side B (wired later) adds a golem that may take a single Mage power.
// ============================================================================

const golemLabA: Room = {
  id: 'mancers.room.golem-lab.a',
  name: 'Golem Lab',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Instant room — conjure a temporary golem Mage that ignores limits and vanishes at end of round.',
  actionSpaces: [
    {
      id: 'mancers.room.golem-lab.a.slot-1',
      roomId: 'mancers.room.golem-lab.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.golem-lab-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        'Immediately pay 1 Mana to place a temporary golem Mage and lock the room it is placed in.',
    },
    {
      id: 'mancers.room.golem-lab.a.slot-2',
      roomId: 'mancers.room.golem-lab.a',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.golem-lab-a.slot-2',
      description: 'Immediately place a temporary golem Mage into any shadow slot.',
    },
    {
      id: 'mancers.room.golem-lab.a.slot-3',
      roomId: 'mancers.room.golem-lab.a',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.golem-lab-a.slot-3',
      description:
        'Immediately pay 3 Mana to place a temporary golem Mage and take another action.',
    },
  ],
};

// ============================================================================
// Golem Lab Side B — INSTANT room. Conjures temporary golem Mages, but with
// more aggressive options than Side A.
//   Slot 1 (merit): Place a golem that takes a chosen Mage power (any type) —
//                   so its on-place ability (e.g. Technomancy Research, Sorcery
//                   Ars Magna wound) is available when conjured.
//   Slot 2:         Pay 2 Mana to BANISH a Mage and drop a golem into its slot.
//   Slot 3:         Pay 2 Mana to WOUND a Mage and drop a golem into its slot.
// ============================================================================

const golemLabB: Room = {
  id: 'mancers.room.golem-lab.b',
  name: 'Golem Lab',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: true,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Instant room — conjure a powered golem, or banish / wound a Mage and seize its slot with a golem.',
  actionSpaces: [
    {
      id: 'mancers.room.golem-lab.b.slot-1',
      roomId: 'mancers.room.golem-lab.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.golem-lab-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        'Immediately place a temporary golem Mage that takes a Mage power of your choice (any type).',
    },
    {
      id: 'mancers.room.golem-lab.b.slot-2',
      roomId: 'mancers.room.golem-lab.b',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.golem-lab-b.slot-2',
      description:
        'Immediately pay 2 Mana to banish a Mage and put a temporary golem Mage into its slot.',
    },
    {
      id: 'mancers.room.golem-lab.b.slot-3',
      roomId: 'mancers.room.golem-lab.b',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.golem-lab-b.slot-3',
      description:
        'Immediately pay 2 Mana to wound a Mage and put a temporary golem Mage into its slot.',
    },
  ],
};

// ============================================================================
// University Tavern Side A — non-instant. When the room resolves, the top 3
// Supporters of the deck are revealed into a temporary pool; each occupant (in
// slot order) selects and gains one. Unclaimed cards return to the top of the
// Supporter Deck once resolution leaves the room. Mirrors Vault Side A. All
// three slots share one effect; slot order is set by the resolution pump.
//   Slot 1 (merit, 1 MB): Select and gain one of the revealed Supporters.
//   Slot 2 (regular):     Same.
//   Slot 3 (regular):     Same.
// Side B (wired later) is a stub.
// ============================================================================

function universityTavernSlot(index: number, slotType: 'merit' | 'regular'): ActionSpace {
  const base: ActionSpace = {
    id: `mancers.room.university-tavern.a.slot-${index + 1}`,
    roomId: 'mancers.room.university-tavern.a',
    index,
    slotType,
    occupant: null,
    effectId: 'mancers.room.university-tavern-a.slot',
    description: 'Select and gain one of the revealed Supporters.',
  };
  return slotType === 'merit'
    ? { ...base, costToActivate: { meritBadges: 1 } }
    : base;
}

const universityTavernA: Room = {
  id: 'mancers.room.university-tavern.a',
  name: 'University Tavern',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'When this room resolves, reveal the top 3 Supporters. Each occupant selects and gains one in slot order; unclaimed cards return to the top of the deck.',
  actionSpaces: [
    universityTavernSlot(0, 'merit'),
    universityTavernSlot(1, 'regular'),
    universityTavernSlot(2, 'regular'),
  ],
};

// ============================================================================
// University Tavern Side B — non-instant. Unlike Side A's shared pool, each
// slot peeks fresh off the top of the Supporter Deck, the occupant keeps one,
// and any unchosen cards go to the BOTTOM of the deck (the Mystic Lantern
// pattern, but the kept card is a normal Supporter).
//   Slot 1 (merit, 1 MB): Reveal 3, keep one, return the rest to the bottom.
//   Slot 2 (regular):     Reveal 2, keep one, return the other to the bottom.
//   Slot 3 (regular):     Draw 1 Supporter and keep it.
// ============================================================================

const universityTavernB: Room = {
  id: 'mancers.room.university-tavern.b',
  name: 'University Tavern',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Each occupant peeks the top of the Supporter Deck and keeps one; unchosen cards go to the bottom of the deck.',
  actionSpaces: [
    {
      id: 'mancers.room.university-tavern.b.slot-1',
      roomId: 'mancers.room.university-tavern.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.university-tavern-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        'Reveal the top 3 Supporters, keep one, and return the others to the bottom of the deck.',
    },
    {
      id: 'mancers.room.university-tavern.b.slot-2',
      roomId: 'mancers.room.university-tavern.b',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.university-tavern-b.slot-2',
      description:
        'Reveal the top 2 Supporters, keep one, and return the other to the bottom of the deck.',
    },
    {
      id: 'mancers.room.university-tavern.b.slot-3',
      roomId: 'mancers.room.university-tavern.b',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.university-tavern-b.slot-3',
      description: 'Draw a Supporter Card and keep it.',
    },
  ],
};

// ============================================================================
// Atelier Side A — non-instant. Gold/Mana exchange + a free Consumable draft.
//   Slot 1 (merit, 1 MB): Swap 1 Gold → 3 Mana up to 3×, OR 1 Mana → 4 Gold
//                         up to 3× (one direction only — no back-and-forth).
//   Slot 2 (regular):     Swap 1 Gold → 2 Mana up to 4×, OR 1 Mana → 3 Gold
//                         up to 4×.
//   Slot 3 (regular):     Draft a Consumable from the Vault tableau; if none
//                         are present, draw a Consumable from the Vault deck
//                         at random.
// Side B (wired later) is a stub.
// ============================================================================

const atelierA: Room = {
  id: 'mancers.room.atelier.a',
  name: 'Atelier',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Exchange Gold and Mana (one direction only), or draft a Consumable from the Vault.',
  actionSpaces: [
    {
      id: 'mancers.room.atelier.a.slot-1',
      roomId: 'mancers.room.atelier.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.atelier-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description:
        'Swap 1 Gold for 3 Mana up to 3 times, OR 1 Mana for 4 Gold up to 3 times.',
    },
    {
      id: 'mancers.room.atelier.a.slot-2',
      roomId: 'mancers.room.atelier.a',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.atelier-a.slot-2',
      description:
        'Swap 1 Gold for 2 Mana up to 4 times, OR 1 Mana for 3 Gold up to 4 times.',
    },
    {
      id: 'mancers.room.atelier.a.slot-3',
      roomId: 'mancers.room.atelier.a',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.atelier-a.slot-3',
      description:
        'Draft a Consumable from the Vault tableau (or draw one from the deck at random if none are shown).',
    },
  ],
};

// ============================================================================
// Atelier Side B — non-instant. Trade in a Consumable (unused from your office
// OR a used one from your discard pile) plus optional Mana for a reward.
//   Slot 1 (merit, 1 MB): Swap a Consumable for 6 Mana.
//   Slot 2 (regular):     Swap a Consumable + 2 Mana for 4 IP.
//   Slot 3 (regular):     Swap a Consumable + 4 Mana for 12 Gold.
// ============================================================================

const atelierB: Room = {
  id: 'mancers.room.atelier.b',
  name: 'Atelier',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Trade in a Consumable (used or unused) plus Mana for Mana, IP, or Gold.',
  actionSpaces: [
    {
      id: 'mancers.room.atelier.b.slot-1',
      roomId: 'mancers.room.atelier.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.atelier-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Swap a Consumable for 6 Mana.',
    },
    {
      id: 'mancers.room.atelier.b.slot-2',
      roomId: 'mancers.room.atelier.b',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.atelier-b.slot-2',
      description: 'Swap a Consumable and 2 Mana for 4 IP.',
    },
    {
      id: 'mancers.room.atelier.b.slot-3',
      roomId: 'mancers.room.atelier.b',
      index: 2,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.atelier-b.slot-3',
      description: 'Swap a Consumable and 4 Mana for 12 Gold.',
    },
  ],
};

// ============================================================================
// Synthesis Workshop Side A — non-instant. Convert an unused Treasure + an
// unused Supporter (and Mana for slot 2) into a Synthesis Treasure matching
// the Supporter's department (a 'wild' Supporter lets the player pick any).
// Only TWO slots.
//   Slot 1 (merit, 1 MB): Swap a Treasure + a Supporter for a Synthesis item.
//   Slot 2 (regular):     Swap a Treasure + a Supporter + 2 Mana for one.
// Side B (wired later) is a stub.
// ============================================================================

const synthesisWorkshopA: Room = {
  id: 'mancers.room.synthesis-workshop.a',
  name: 'Synthesis Workshop',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'A',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Trade in an unused Treasure and Supporter for a Synthesis Treasure matching the Supporter\'s department.',
  actionSpaces: [
    {
      id: 'mancers.room.synthesis-workshop.a.slot-1',
      roomId: 'mancers.room.synthesis-workshop.a',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.synthesis-workshop-a.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Swap a Treasure and a Supporter for a Synthesis item.',
    },
    {
      id: 'mancers.room.synthesis-workshop.a.slot-2',
      roomId: 'mancers.room.synthesis-workshop.a',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.synthesis-workshop-a.slot-2',
      description:
        'Swap a Treasure, a Supporter, and 2 Mana for a Synthesis item.',
    },
  ],
};

// ============================================================================
// Synthesis Workshop Side B — like Side A, but trade in a Spell (not a
// Supporter) alongside a Treasure. The Spell's department picks the Synthesis
// item; turning the Spell in refunds its placed INT + WIS and removes it from
// the game. Leader (candidate starter) Spells can't be traded; legendary books
// can. Only TWO slots.
//   Slot 1 (merit, 1 MB): Swap a Treasure + a Spell for a Synthesis item.
//   Slot 2 (regular):     Swap a Treasure + a Spell + 3 Mana for one.
// ============================================================================

const synthesisWorkshopB: Room = {
  id: 'mancers.room.synthesis-workshop.b',
  name: 'Synthesis Workshop',
  sourcePackId: PACK_ID,
  isUniversityCentral: false,
  side: 'B',
  isInstantRoom: false,
  cannotBePlacedInDirectly: false,
  cannotBeLocked: false,
  description:
    'Trade in an unused Treasure and a Spell (its INT/WIS refunded) for a Synthesis Treasure matching the Spell\'s department.',
  actionSpaces: [
    {
      id: 'mancers.room.synthesis-workshop.b.slot-1',
      roomId: 'mancers.room.synthesis-workshop.b',
      index: 0,
      slotType: 'merit',
      occupant: null,
      effectId: 'mancers.room.synthesis-workshop-b.slot-1',
      costToActivate: { meritBadges: 1 },
      description: 'Swap a Treasure and a Spell for a Synthesis item.',
    },
    {
      id: 'mancers.room.synthesis-workshop.b.slot-2',
      roomId: 'mancers.room.synthesis-workshop.b',
      index: 1,
      slotType: 'regular',
      occupant: null,
      effectId: 'mancers.room.synthesis-workshop-b.slot-2',
      description:
        'Swap a Treasure, a Spell, and 3 Mana for a Synthesis item.',
    },
  ],
};

// ============================================================================
// Mancers Supporters. The Technomancy (orange) set is the department's own
// supporters (seven active + the passive Rune Knight Familiar). The five
// "department-swap" Supporters belong to the five base departments — each lets
// you swap one of your Mages for a Mage of that department from the supply.
// Effects registered in game/effects/mancers.ts.
// ============================================================================

const supporters: SupporterCard[] = [
  // -- Department-swap Supporters (one per base department) --
  {
    id: 'mancers.supporter.viona-larone',
    name: 'Viona Larone',
    title: 'University Radio DJ',
    sourcePackId: PACK_ID,
    department: 'sorcery',
    timing: 'fast-action',
    effectId: 'mancers.supporter.viona-larone',
    description: 'Swap one of your Mages for a Sorcery Mage from the supply.',
  },
  {
    id: 'mancers.supporter.xenitia-zook',
    name: 'Xenitia Zook',
    title: 'Infirmary Overseer',
    sourcePackId: PACK_ID,
    department: 'mysticism',
    timing: 'fast-action',
    effectId: 'mancers.supporter.xenitia-zook',
    description: 'Swap one of your Mages for a Mysticism Mage from the supply.',
  },
  {
    id: 'mancers.supporter.hikaru-sorayama',
    name: 'Hikaru Sorayama',
    title: 'Graduate Student',
    sourcePackId: PACK_ID,
    department: 'natural-magick',
    timing: 'fast-action',
    effectId: 'mancers.supporter.hikaru-sorayama',
    description: 'Swap one of your Mages for a Natural Magick Mage from the supply.',
  },
  {
    id: 'mancers.supporter.khadath-ahemusei',
    name: 'Khadath Ahemusei',
    title: 'Planar Department Alumnus',
    sourcePackId: PACK_ID,
    department: 'planar-studies',
    timing: 'fast-action',
    effectId: 'mancers.supporter.khadath-ahemusei',
    description: 'Swap one of your Mages for a Planar Studies Mage from the supply.',
  },
  {
    id: 'mancers.supporter.cindra-flama',
    name: 'Cindra Flama',
    title: "Vice Dean's Ward",
    sourcePackId: PACK_ID,
    department: 'divinity',
    timing: 'fast-action',
    effectId: 'mancers.supporter.cindra-flama',
    description: 'Swap one of your Mages for a Divinity Mage from the supply.',
  },
  // -- Technomancy (orange) Supporters --
  {
    id: 'mancers.supporter.cin-atalar',
    name: 'Cin Atalar',
    title: 'Debate Team Captain',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'fast-action',
    effectId: 'mancers.supporter.cin-atalar',
    description: 'Swap one of your Mages for a Technomancy Mage from the supply.',
  },
  {
    id: 'mancers.supporter.garek-tesias',
    name: 'Garek Tesias',
    title: 'Leader of the Mad Manticores',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'action',
    effectId: 'mancers.supporter.garek-tesias',
    description: 'Swap 3 Gold for a Technomancy (Orange) Mage from the supply.',
  },
  {
    id: 'mancers.supporter.lixis-ran-kanda',
    name: 'Lixis Ran Kanda',
    title: 'Visiting Alchemy Lecturer',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'action',
    effectId: 'mancers.supporter.lixis-ran-kanda',
    description: 'Swap 3 Gold for the top card of the Vault Deck, up to 2 times.',
  },
  {
    id: 'mancers.supporter.orman-kasper',
    name: 'Orman Kasper',
    title: 'Research Assistant',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'action',
    effectId: 'mancers.supporter.orman-kasper',
    description: 'Swap 3 Gold for the top card of the Vault Deck.',
  },
  {
    id: 'mancers.supporter.rokan',
    name: 'Rokan',
    title: 'Professor of Mechanics',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'action',
    effectId: 'mancers.supporter.rokan',
    description: 'Gain 2 Research. Use this Research only on Technomancy (Orange) Spells.',
  },
  {
    id: 'mancers.supporter.rune-knight',
    name: 'Rune Knight',
    title: 'Technomagic Familiar',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'passive',
    effectId: 'mancers.supporter.rune-knight',
    description: 'Place this card in your discard pile.',
  },
  {
    id: 'mancers.supporter.runika-zenanen',
    name: 'Runika Zenanen',
    title: 'Renowned Artificer',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'action',
    effectId: 'mancers.supporter.runika-zenanen',
    description: 'Gain a Treasure from the Vault Tableau.',
  },
  {
    id: 'mancers.supporter.tegusgan',
    name: 'Tegusgan',
    title: 'University Chef',
    sourcePackId: PACK_ID,
    department: 'technomancy',
    timing: 'action',
    effectId: 'mancers.supporter.tegusgan',
    description: 'Gain a Consumable from the Vault Tableau.',
  },
];

// ============================================================================
// Consortium Voter — Welsie Acktern awards a vote for the most Technomancy
// Spell Research + Supporter Cards (the 'most-technomancy' scoring criterion).
// ============================================================================

const voters: ConsortiumVoter[] = [
  {
    id: 'mancers.voter.most-technomancy',
    name: 'Welsie Acktern',
    title: 'Magister of Willat',
    sourcePackId: PACK_ID,
    criterion: 'most-technomancy',
    description:
      'Awards a vote to the player with the most Technomancy Spell Research and Supporter Cards.',
    votes: 1,
    isAlwaysFaceUp: false,
    revealed: false,
  },
];

export const mancersPack: ContentPack = {
  id: PACK_ID,
  name: 'Mancers of the University',
  description: 'Adds the Technomancy department: Technomancer (orange) mage piece, the two Technomancy leader candidates, the Laboratory + Research Archive + Golem Lab + University Tavern + Atelier + Synthesis Workshop rooms, the Technomancy supporters, and a Technomancy voter.',
  mages,
  candidates,
  rooms: [
    laboratoryA,
    laboratoryB,
    researchArchiveA,
    researchArchiveB,
    golemLabA,
    golemLabB,
    universityTavernA,
    universityTavernB,
    atelierA,
    atelierB,
    synthesisWorkshopA,
    synthesisWorkshopB,
  ],
  spells: [],
  legendarySpells: leaderSpells,
  vaultCards: [...stuffVaultCards, ...synthesisTreasures],
  supporters,
  voters,
  bellTowerCards: [],
};
