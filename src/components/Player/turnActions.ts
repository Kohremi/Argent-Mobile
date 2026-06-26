import type { GameState, Player } from '../../game/types';
import { getScenario } from '../../content/scenarios';

/**
 * Derived turn budget + scenario-action flags for the active Errands player.
 * Extracted from PlayerDock so the desktop dock and the mobile dock derive the
 * action budget identically. Pure read-model — no dispatch.
 */
export interface TurnActions {
  errands: Extract<GameState['phase'], { kind: 'errands' }> | null;
  /** Regular Actions left: base Action (1 until used) + bonus grants. */
  regularActions: number;
  /** Fast Actions left this turn (usable only before the Regular Action). */
  fastActions: number;
  /** Dimensional Rift R5: the round runs on voluntary passes. */
  voluntaryPass: boolean;
  /** A Fast Action carries a Mana surcharge this round and may be skipped. */
  canSkipFast: boolean;
  fastSurcharge: number;
  /** Assassins R3: an extra Action that sends an office Mage to strike twice. */
  canInfirmaryStrike: boolean;
}

export function computeTurnActions(state: GameState, player: Player): TurnActions {
  const errands = state.phase.kind === 'errands' ? state.phase : null;
  const regularActions = errands
    ? (errands.actionUsed ? 0 : 1) + (errands.extraActions ?? 0)
    : 0;
  const scenarioRule =
    errands && state.scenarioId
      ? getScenario(state.scenarioId)?.rounds.find((r) => r.round === errands.round)
      : undefined;
  const fastActionLimit = scenarioRule?.maxFastActionsPerTurn ?? 1;
  const fastActions =
    errands && !errands.actionUsed
      ? Math.max(0, fastActionLimit - (errands.fastActionsUsed ?? 0))
      : 0;
  const voluntaryPass = !!(errands && scenarioRule?.voluntaryPassRound);
  const fastSurcharge = scenarioRule?.fastActionManaSurcharge ?? 0;
  const canSkipFast = !!(
    errands &&
    !errands.actionUsed &&
    fastActions > 0 &&
    fastSurcharge > 0
  );
  const canInfirmaryStrike = !!(
    errands &&
    scenarioRule?.infirmaryStrikeAction &&
    regularActions > 0 &&
    player.mages.some((m) => m.location.kind === 'office')
  );
  return {
    errands,
    regularActions,
    fastActions,
    voluntaryPass,
    canSkipFast,
    fastSurcharge,
    canInfirmaryStrike,
  };
}
