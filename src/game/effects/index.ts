// Re-exports the effect registry, then triggers per-pack effect registration
// via side-effect imports.
//
// The registry implementation lives in `./registry` to avoid an ESM circular
// dependency: pack files import `registerEffect` and call it at module load
// time, so the binding must be fully initialized before the side-effect
// imports below run. Splitting the registry into its own file accomplishes
// that — `./registry` evaluates fully before this module's side-effect
// imports begin.

export {
  registerEffect,
  getEffect,
  hasEffect,
  firesInstantReward,
  listEffectIds,
  _resetEffectRegistry,
} from './registry';
export type { Effect } from './registry';

// Side-effect imports — each pack file calls `registerEffect` at module load.
import './base';
import './mancers';
import './knights';
import './ascension';
import './promo';
import './archmage';
import './renovation';
