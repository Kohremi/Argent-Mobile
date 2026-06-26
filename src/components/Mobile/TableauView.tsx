import type { GameState } from '../../game/types';
import { MobileTableau } from './MobileTableau';

/**
 * The "On Offer" tab: the round's standing tableaus (spells / vault / allies)
 * plus any temporary tableaus the engine has revealed (Adventuring pool, Vault A
 * / University Tavern draft piles), rendered as touch-native card chips that
 * open a detail sheet on tap (MobileTableau).
 */
export function TableauView({ state }: { state: GameState }) {
  return <MobileTableau state={state} />;
}
