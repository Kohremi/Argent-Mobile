import type {
  ActionSpace,
  EffectContext,
  EffectId,
  EffectResult,
  Room,
} from '../types';

/**
 * Registered effect signature. Effects are pure: same EffectContext in →
 * same EffectResult out. They never mutate state directly; they describe
 * either a complete patch (`done`), a paused player input (`pause`), or an
 * action that opens a reaction window (`open-reaction`). The engine applies
 * the result.
 */
export type Effect = (ctx: EffectContext) => EffectResult;

const registry = new Map<EffectId, Effect>();

export function registerEffect(id: EffectId, fn: Effect): void {
  if (registry.has(id)) {
    throw new Error(`Effect "${id}" is already registered`);
  }
  registry.set(id, fn);
}

export function getEffect(id: EffectId): Effect {
  const fn = registry.get(id);
  if (!fn) throw new Error(`Effect "${id}" is not registered`);
  return fn;
}

export function hasEffect(id: EffectId): boolean {
  return registry.has(id);
}

/**
 * Whether placing a mage onto `space` fires that slot's instant reward: the
 * room is an instant room AND the slot has a registered effect to resolve.
 * The single source of truth for the "PLACE into an instant room → resolve
 * the bonus now" rule, shared by the engine's PLACE_WORKER base/shadow tails
 * and `patchWithMaybeInstantReward` in `base.ts`. Lives here (next to
 * `hasEffect`) so both the engine and the effect packs can import it without
 * a circular dependency — `registry` imports nothing but types.
 */
export function firesInstantReward(room: Room, space: ActionSpace): boolean {
  return room.isInstantRoom && hasEffect(space.effectId);
}

export function listEffectIds(): EffectId[] {
  return Array.from(registry.keys());
}

/** Test-only helper to clear the registry between tests. */
export function _resetEffectRegistry(): void {
  registry.clear();
}
