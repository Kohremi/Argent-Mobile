import type { GameAction, GameState } from './types';

/**
 * Action validators. Each takes (state, action) and either returns void (legal)
 * or throws a descriptive Error (illegal). The engine calls these before
 * mutating state.
 *
 * TODO: implement per-action validators. For now `validateAction` is a no-op
 * to keep the engine API in place.
 */
export function validateAction(_state: GameState, _action: GameAction): void {
  // TODO: dispatch on action.type and check legality (correct phase, correct
  // player turn, sufficient resources, available action space, etc.).
}
