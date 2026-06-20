import type { ContentPack } from '../types';
import type { Department, SupporterCard, VaultCard } from '../../game/types';

// Summer Break expansion. This first pass ships the rule changes the expansion
// makes between rounds (docs/summer break.md):
//   1. Players begin with only their two candidate Mages — the extra mage
//      draft is skipped (`skipInitialMageDraft`). The "Students Return"
//      scenarios hand Mages out over the first rounds instead.
//   2. The Dormitory is guaranteed in play under random layout
//      (`guaranteedRandomRoomIds`).
//   3. A 6th round (`totalRounds: 6`), and a round-end scenario at the end of
//      rounds 1-5 (`roundEndScenarios`) — see src/game/effects/summerbreak.ts.
//
// 4 of the 6 vault cards ship here. Deferred (new engine mechanics): Planar Ice
// Cream (insert a random room mid-game) and Beach Brew (a Merit-slot payment
// reaction).
//
// The 6 department-discard supporters ship here too: each may be discarded to
// cast a Spell of its department for free (cast-time waiver in handleCastSpell).

const PACK_ID = 'summerbreak';

// Vault cards (subset). Planar Ice Cream (insert a random room mid-game) and
// Beach Brew (a Merit-slot payment reaction) are deferred — they need new
// engine mechanics. Effects live in src/game/effects/summerbreak.ts.
const vaultCards: VaultCard[] = [
  {
    id: 'summerbreak.vault.yacht-keys',
    name: "Chancellor's Yacht Keys",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 6,
    timing: 'action',
    effectId: 'summerbreak.vault.yacht-keys',
    description: 'Gain a secret Supporter.',
    copies: 1,
  },
  {
    id: 'summerbreak.vault.magic-sunblock',
    name: 'Magic Sunblock',
    sourcePackId: PACK_ID,
    type: 'consumable',
    goldCost: 2,
    timing: 'fast-action',
    effectId: 'summerbreak.vault.magic-sunblock',
    description: 'Your Mages are immune to wounding for the rest of the round.',
    copies: 1,
  },
  {
    id: 'summerbreak.vault.beach-towel',
    name: "Sorcerer's Beach Towel",
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 4,
    timing: 'action',
    effectId: 'summerbreak.vault.beach-towel',
    description:
      'Spend 2 Mana to make your Mages immune to wounding for the rest of the round.',
    copies: 1,
  },
  {
    id: 'summerbreak.vault.divine-beach-hat',
    name: 'Divine Beach Hat',
    sourcePackId: PACK_ID,
    type: 'treasure',
    goldCost: 6,
    timing: 'action',
    effectId: 'summerbreak.vault.divine-beach-hat',
    description: 'Gain 1 Mana and then cast a Spell.',
    copies: 1,
  },
];

// Department-discard supporters. Each may be DISCARDED to cast a Spell of its
// department for free, instead of paying the Mana cost (resolved at cast time
// by handleCastSpell via `spellManaWaiverDepartment`). They sit in the office
// until used, so they ship as `passive` (never played as a normal action). Eloi
// Claus covers Technomancy and only enters the deck with the Mancers expansion.
function waiverSupporter(
  id: string,
  name: string,
  department: Department,
  extra?: Partial<SupporterCard>,
): SupporterCard {
  return {
    id,
    name,
    sourcePackId: PACK_ID,
    department,
    timing: 'passive',
    effectId: id,
    description:
      'Discard this card instead of paying the Mana cost to cast a Spell of its department.',
    spellManaWaiverDepartment: department,
    ...extra,
  };
}

const supporters: SupporterCard[] = [
  waiverSupporter('summerbreak.supporter.sami-rekar', 'Sami Rekar', 'sorcery'),
  waiverSupporter('summerbreak.supporter.lucca-turlotte', 'Lucca Turlotte', 'mysticism'),
  waiverSupporter('summerbreak.supporter.irion-juiz', 'Irion Juiz', 'natural-magick'),
  waiverSupporter('summerbreak.supporter.mindra-dirac', 'Mindra Dirac', 'planar-studies'),
  waiverSupporter('summerbreak.supporter.irini-grenhart', 'Irini Grenhart', 'divinity'),
  waiverSupporter('summerbreak.supporter.eloi-claus', 'Eloi Claus', 'technomancy', {
    requiresPackIds: ['mancers'],
  }),
];

export const summerBreakPack: ContentPack = {
  id: PACK_ID,
  name: 'Summer Break',
  description:
    'Changes the rules as rounds go on: start with two Mages, a guaranteed Dormitory, a 6th round, and a new round-end scenario each round (Students Return / Summer Study Credits / Opening Ceremony).',
  mages: [],
  candidates: [],
  rooms: [],
  spells: [],
  legendarySpells: [],
  vaultCards,
  supporters,
  voters: [],
  bellTowerCards: [],

  totalRounds: 6,
  skipInitialMageDraft: true,
  guaranteedRandomRoomIds: ['base.room.dormitory.a'],

  roundEndScenarios: [
    { round: 1, name: 'Students Return', effectId: 'summerbreak.scenario.draft-mage' },
    { round: 2, name: 'Students Return', effectId: 'summerbreak.scenario.draft-mage' },
    { round: 3, name: 'Students Return', effectId: 'summerbreak.scenario.draft-mage' },
    { round: 4, name: 'Summer Study Credits', effectId: 'summerbreak.scenario.swap-mage' },
    { round: 5, name: 'Opening Ceremony', effectId: 'summerbreak.scenario.reward-draft' },
    // Round 6 (Semester Begins) is the final round and has no round-end effect.
  ],
};
