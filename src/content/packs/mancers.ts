import type { ContentPack } from '../types';
import type {
  ActionSpace,
  Candidate,
  Mage,
  Room,
  SpellCard,
} from '../../game/types';

const PACK_ID = 'mancers';

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

export const mancersPack: ContentPack = {
  id: PACK_ID,
  name: 'Mancers of the University',
  description: 'Adds the Technomancy department: Technomancer (orange) mage piece, the two Technomancy leader candidates, and the Laboratory + Research Archive + Golem Lab + University Tavern rooms.',
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
  ],
  spells: [],
  legendarySpells: leaderSpells,
  vaultCards: [],
  supporters: [],
  voters: [],
  bellTowerCards: [],
};
