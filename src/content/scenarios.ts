import type { Scenario, ScenarioId } from '../game/types';
import { SYNTHESIS_BY_DEPARTMENT, ALL_SYNTHESIS_IDS } from './packs/mancers';

/**
 * Scenario registry. Scenarios are alternate game modes selected independently
 * of content packs (via `GameConfig.scenarioId`). They layer a persistent rule
 * change plus per-round rules onto the normal 5-round game. The engine reads
 * the behavior flags off the active scenario's round rules at fixed hook
 * points — it never switches on a scenario id.
 */
const scenarios = new Map<ScenarioId, Scenario>();

export function registerScenario(scenario: Scenario): void {
  if (scenarios.has(scenario.id)) {
    throw new Error(`Scenario "${scenario.id}" is already registered`);
  }
  scenarios.set(scenario.id, scenario);
}

export function getScenario(id: ScenarioId): Scenario | undefined {
  return scenarios.get(id);
}

export function listScenarios(): Scenario[] {
  return Array.from(scenarios.values());
}

/**
 * Scenario 1 — Dimensional Rift.
 *
 * Persistent rule: at the end of each round's errands, every room tile with no
 * mages flips to its other side (A↔B). Each round then applies a time-themed
 * twist.
 */
export const dimensionalRift: Scenario = {
  id: 'dimensional-rift',
  name: 'Dimensional Rift',
  description:
    'After each round, every room with no mages in it flips to its other side. ' +
    'Each round warps time in a different way.',
  flipEmptyRoomsEachRound: true,
  rounds: [
    {
      round: 1,
      name: 'Temporal Breakdown',
      description:
        'Round end: each player takes one more Action (no Fast Action), in ' +
        'turn order. The player who took the last bell-tower offering acts last.',
      extraActionRoundEnd: true,
    },
    {
      round: 2,
      name: 'Time Races',
      description: 'Taking a Fast Action costs 1 additional Mana this round.',
      fastActionManaSurcharge: 1,
    },
    {
      round: 3,
      name: 'Time Stands Still',
      description:
        'You may take up to 2 Fast Actions each turn (before your normal Action).',
      maxFastActionsPerTurn: 2,
    },
    {
      round: 4,
      name: 'Reality Inversion',
      description:
        'Shadowing mages resolve before normal mages this round (shadow slot, ' +
        'then base slot, per space).',
      shadowResolvesFirst: true,
    },
    {
      round: 5,
      name: 'Time Flux',
      description:
        'No bell-tower cards this round. The round continues until every ' +
        'player passes for the round; passing opts you out of all future turns.',
      voluntaryPassRound: true,
    },
  ],
};

registerScenario(dimensionalRift);

/**
 * Scenario 2 — Talismans of Magic.
 *
 * Requires the Mancers pack: every player begins with the Synthesis Treasure
 * matching their school, the Synthesis Workshop is banned (Student Stores is
 * always in play instead), and the round-end rewards revolve around Vault cards
 * and research.
 */
export const talismansOfMagic: Scenario = {
  id: 'talismans-of-magic',
  name: 'Talismans of Magic',
  description:
    'Every mage begins with the Synthesis Treasure of their school. The ' +
    'Synthesis Workshop is banned (Student Stores is always in play). Each ' +
    'round rewards research and the Vault.',
  requiresPackIds: ['mancers'],
  bannedRoomNames: ['Synthesis Workshop'],
  guaranteedRoomNames: ['Student Stores'],
  startingItemsByDepartment: SYNTHESIS_BY_DEPARTMENT,
  startingItemPool: ALL_SYNTHESIS_IDS,
  rounds: [
    {
      round: 1,
      name: 'Research Grants',
      description: 'Round end: every player receives 5 Gold.',
      roundEndEffectId: 'talismans.scenario.research-grants',
      roundEndName: 'Research Grants',
    },
    {
      round: 2,
      name: 'Opening the Vaults',
      description: 'Round end: each player draws two Vault cards and keeps one.',
      roundEndEffectId: 'talismans.scenario.opening-vaults',
      roundEndName: 'Opening the Vaults',
    },
    {
      round: 3,
      name: 'Research and Merit',
      description: 'Each time you use a Vault card this round, gain 1 IP.',
      vaultUseGrantsIp: true,
    },
    {
      round: 4,
      name: 'Student Testing Incentives',
      description:
        'Round end: each player may retrieve one Consumable from their discard ' +
        'into their vault.',
      roundEndEffectId: 'talismans.scenario.testing-incentives',
      roundEndName: 'Student Testing Incentives',
    },
    {
      round: 5,
      name: 'Research Review Committee',
      description: 'Each time you use a Vault card this round, gain 1 IP.',
      vaultUseGrantsIp: true,
    },
  ],
};

registerScenario(talismansOfMagic);

/**
 * Scenario 3 — The Well of Souls.
 *
 * A death/sacrifice + research theme. Persistent rule: when casting a Spell, the
 * caster may send one office Mage to the Infirmary (no bonus) to reduce that
 * Spell's cost by up to 3 — which also lets them cast a Spell up to 3 Mana over
 * their pool. Each round adds research rewards or loosens casting.
 */
export const wellOfSouls: Scenario = {
  id: 'well-of-souls',
  name: 'The Well of Souls',
  description:
    'When casting a Spell you may sacrifice an office Mage to the Infirmary (no ' +
    'bonus) to reduce its cost by up to 3. Each round the dead whisper new power.',
  sacrificeMageForSpellDiscount: 3,
  rounds: [
    {
      round: 1,
      name: 'Rumours of Hauntings',
      description: 'Round end: each player gains 2 Research.',
      roundEndEffectId: 'wellofsouls.scenario.research-2',
      roundEndName: 'Rumours of Hauntings',
    },
    {
      round: 2,
      name: 'Visions in the Night',
      description: 'Round end: each player gains 1 Intelligence or 1 Wisdom.',
      roundEndEffectId: 'wellofsouls.scenario.int-or-wis',
      roundEndName: 'Visions in the Night',
    },
    {
      round: 3,
      name: 'Whispers in the Shadows',
      description: 'Round end: each player gains 1 Research.',
      roundEndEffectId: 'wellofsouls.scenario.research-1',
      roundEndName: 'Whispers in the Shadows',
    },
    {
      round: 4,
      name: 'Power Unleashed',
      description:
        'You may cast any level of the Spells in your office this round, even ' +
        'ones you have not researched.',
      castAnyLevel: true,
    },
    {
      round: 5,
      name: 'All Mysteries Revealed',
      description:
        'All Spell cost is reduced by 1 (minimum 0), and you may cast any level ' +
        'of the Spells in your office, even un-researched ones.',
      castAnyLevel: true,
      spellCostReduction: 1,
    },
  ],
};

registerScenario(wellOfSouls);

/**
 * Scenario 4 — Key to the University.
 *
 * A victory-point game: whoever has the most total Influence at the end wins.
 * The Most Influence and Second-Most Influence voters are removed (replaced by
 * an extra face-down voter) so the IP leader isn't rewarded with more IP. At the
 * election, each voter grants Influence instead of votes — 7 IP to its sole
 * criterion-winner, or 4 IP to each of several tied players (no marks/influence
 * tiebreak). Each round adds an IP-based recognition award.
 */
export const keyToTheUniversity: Scenario = {
  id: 'key-to-the-university',
  name: 'Key to the University',
  description:
    'A race for Influence — most IP at the end wins. The Influence voters are ' +
    'removed, and at the election every voter grants 7 IP to its winner (4 IP ' +
    'each when tied) instead of a vote.',
  excludedVoterCriteria: ['most-influence', 'second-most-influence'],
  influenceVictory: { soleVoterIp: 7, tiedVoterIp: 4 },
  rounds: [
    {
      round: 1,
      name: 'Recognition for Merit',
      description: 'Round end: gain 1 IP for each unused Merit Badge.',
      roundEndEffectId: 'key.scenario.merit-recognition',
      roundEndName: 'Recognition for Merit',
    },
    {
      round: 2,
      name: 'Recognition for Merit',
      description: 'Round end: gain 1 IP for each unused Merit Badge.',
      roundEndEffectId: 'key.scenario.merit-recognition',
      roundEndName: 'Recognition for Merit',
    },
    {
      round: 3,
      name: 'Recognition for Research',
      description:
        'Round end: the player(s) with the most total Research gain 3 IP.',
      roundEndEffectId: 'key.scenario.research-recognition',
      roundEndName: 'Recognition for Research',
    },
    {
      round: 4,
      name: 'Recognition for Involvement',
      description:
        'Round end: the player(s) with the most total Marks gain 3 IP.',
      roundEndEffectId: 'key.scenario.involvement-recognition',
      roundEndName: 'Recognition for Involvement',
    },
    {
      round: 5,
      name: 'Awards Ceremony',
      description: 'No effect — the game ends and the most-Influence player wins.',
    },
  ],
};

registerScenario(keyToTheUniversity);
