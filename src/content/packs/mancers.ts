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

const spells: SpellCard[] = [arcaneSurge, arcaneInvestigation];

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

export const mancersPack: ContentPack = {
  id: PACK_ID,
  name: 'Mancers of the University',
  description: 'Adds the Technomancy department: Technomancer (orange) mage piece, the two Technomancy leader candidates, and the Laboratory room (Sides A and B).',
  mages,
  candidates,
  rooms: [laboratoryA, laboratoryB],
  spells,
  legendarySpells: [],
  vaultCards: [],
  supporters: [],
  voters: [],
  bellTowerCards: [],
};
