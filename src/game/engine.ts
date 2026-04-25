// Pure game engine. No React, no DOM, no I/O.
// Everything here must be deterministic given (state, action, rngSeed).

import { validateAction } from './actions';
import { buildInitialState } from './setup';
import type { GameAction, GameConfig, GameState } from './types';

// Side-effect import: triggers effect registration for all packs at app start.
// Engine code calls `getEffect(id)` from the registry; importing it here
// ensures registrations happen before any action resolution runs.
import './effects';

/**
 * Builds a fresh GameState from setup config. See `buildInitialState` for
 * details on what is and isn't wired up yet.
 */
export function initGame(config: GameConfig): GameState {
  return buildInitialState(config);
}

/**
 * Pure reducer. Validates the action, then dispatches to a per-action handler.
 * Most handlers throw `not implemented` for now — the dispatch shape is what
 * matters at this stage.
 */
export function applyAction(state: GameState, action: GameAction): GameState {
  validateAction(state, action);

  switch (action.type) {
    case 'PLACE_WORKER':
    case 'CAST_SPELL':
    case 'BUY_TREASURE':
    case 'PASS_TURN':
    case 'USE_ABILITY':
      throw new Error(
        `applyAction: action "${action.type}" not yet implemented (round=${state.round}, phase=${state.phase})`,
      );
    case 'ADVANCE_PHASE':
      // TODO: implement phase machine (refresh → action → resolution → scoring → next round / final).
      return state;
    default: {
      const exhaustive: never = action;
      throw new Error(`applyAction: unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}
