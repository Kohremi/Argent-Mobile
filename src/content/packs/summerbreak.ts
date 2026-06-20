import type { ContentPack } from '../types';

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
// The 6 vault cards and 6 department supporters are intentionally deferred to a
// later pass (they need new engine mechanics: mid-game room insertion and a
// cast-time "discard instead of paying mana" reaction).

const PACK_ID = 'summerbreak';

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
  vaultCards: [],
  supporters: [],
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
