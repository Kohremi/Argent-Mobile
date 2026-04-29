import type { EffectContext, EffectId, EffectResult } from '../types';

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

export function listEffectIds(): EffectId[] {
  return Array.from(registry.keys());
}

/** Test-only helper to clear the registry between tests. */
export function _resetEffectRegistry(): void {
  registry.clear();
}
