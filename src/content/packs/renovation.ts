import type { ContentPack } from '../types';
import type { BellTowerCard } from '../../game/types';

// Bell Tower Renovation expansion (the "Mancers/Renovation" Bell Tower
// offerings, docs/argent_data/bell-tower-offerings.tsv). When this pack is
// active, its 16 offerings are pooled together with the normal base Bell Tower
// cards and each round a fresh random hand equal to the player count is dealt —
// see the per-round deal in src/game/setup.ts + src/game/engine.ts. Effects are
// registered in src/game/effects/renovation.ts.

const PACK_ID = 'renovation';

// All Renovation offerings are available at any player count (blank "Players" in
// the source data), so they ship with minPlayers 2 to clear the eligibility
// filter for every legal game size. Each card's effectId is `renovation.bell.<id>`.
const bellTowerCards: BellTowerCard[] = [
  {
    id: 'renovation.bell.adaptability',
    name: 'Adaptability',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.adaptability',
    minPlayers: 2,
    description:
      "Take an extra 'place a Mage' action after the last Bell Tower Offering is taken.",
  },
  {
    id: 'renovation.bell.distraction',
    name: 'Distraction',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.distraction',
    minPlayers: 2,
    description: 'Banish a Mage.',
  },
  {
    id: 'renovation.bell.wrath',
    name: 'Wrath',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.wrath',
    minPlayers: 2,
    description: 'Wound a Mage.',
  },
  {
    id: 'renovation.bell.training',
    name: 'Training',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.training',
    minPlayers: 2,
    description: 'Swap a Mage you control for another from the supply.',
  },
  {
    id: 'renovation.bell.wisdom',
    name: 'Wisdom',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.wisdom',
    minPlayers: 2,
    description: 'Gain 1 WIS.',
  },
  {
    id: 'renovation.bell.gluttony',
    name: 'Gluttony',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.gluttony',
    minPlayers: 2,
    description: 'Return a Consumable from your discard to your office, or gain 1 Gold.',
  },
  {
    id: 'renovation.bell.pride',
    name: 'Pride',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.pride',
    minPlayers: 2,
    description:
      'Gain a temporary Merit Badge (discard it after resolution this round). Lose 1 IP if you use it.',
  },
  {
    id: 'renovation.bell.lust',
    name: 'Lust',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.lust',
    minPlayers: 2,
    description: 'Draw a Secret Supporter.',
  },
  {
    id: 'renovation.bell.sloth',
    name: 'Sloth',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.sloth',
    minPlayers: 2,
    description: 'Move a Mage to any slot in an adjacent room.',
  },
  {
    id: 'renovation.bell.secrecy',
    name: 'Secrecy',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.secrecy',
    minPlayers: 2,
    description: 'Gain 1 Mark.',
  },
  {
    id: 'renovation.bell.connections',
    name: 'Connections',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.connections',
    minPlayers: 2,
    description: 'Return a Supporter from your discard pile to your office, or gain 1 Gold.',
  },
  {
    id: 'renovation.bell.envy',
    name: 'Envy',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.envy',
    minPlayers: 2,
    description: 'Swap two Mages in the same room.',
  },
  {
    id: 'renovation.bell.preparation',
    name: 'Preparation',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.preparation',
    minPlayers: 2,
    description: 'Draw a Vault Card.',
  },
  {
    id: 'renovation.bell.intelligence',
    name: 'Intelligence',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.intelligence',
    minPlayers: 2,
    description: 'Gain 1 INT.',
  },
  {
    id: 'renovation.bell.greed',
    name: 'Greed',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.greed',
    minPlayers: 2,
    description: 'Take 2 Gold from a player of your choice.',
  },
  {
    id: 'renovation.bell.ambition',
    name: 'Ambition',
    sourcePackId: PACK_ID,
    effectId: 'renovation.bell.ambition',
    minPlayers: 2,
    description: 'Gain 1 Mana and 1 Research.',
  },
];

export const renovationPack: ContentPack = {
  id: PACK_ID,
  name: 'Bell Tower Renovation',
  description:
    'Adds 16 more powerful Bell Tower offerings to the pool. Each round a random hand equal to the number of players is dealt out, so the offerings change every round.',
  mages: [],
  candidates: [],
  rooms: [],
  spells: [],
  legendarySpells: [],
  vaultCards: [],
  supporters: [],
  voters: [],
  bellTowerCards,
};
