import type { Scenario, ScenarioId } from '../game/types';

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
