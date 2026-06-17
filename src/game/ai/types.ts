import type {
  GameAction,
  GameState,
  PendingResolution,
  PlayerId,
  ResolutionAnswer,
} from '../types';

/**
 * A bot "personality" — the decision policy for an AI-controlled seat. Pure
 * functions of engine truth: they enumerate legality with the same dry-run
 * selectors the human UI uses, so a bot can never attempt an illegal move.
 *
 * Multiple personalities can coexist (Klank, Thickhide, …); a seat picks one
 * via `Player.botPersonalityId`. Keep this in its own module so personality
 * files and the registry can import the type without a cycle.
 */
export interface BotPersonality {
  id: string;
  /** Display name shown in the UI (badge / "… is taking its turn"). */
  name: string;
  /** Pick the next Errands action for `playerId` (whose turn it is). */
  chooseErrandsAction: (state: GameState, playerId: PlayerId) => GameAction;
  /** Answer a pending resolution whose `responderId` is this bot. */
  answerPendingResolution: (
    state: GameState,
    pending: PendingResolution,
  ) => ResolutionAnswer;
}
