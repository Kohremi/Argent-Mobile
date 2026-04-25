import type { EffectContext, EffectId, GameStatePatch } from '../types';

export type Effect = (ctx: EffectContext) => GameStatePatch;

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

/**
 * Test-only helper to clear the registry between tests. Avoid in production.
 */
export function _resetEffectRegistry(): void {
  registry.clear();
}

// Side-effect imports: each pack file calls `registerEffect` at module load.
// Note: pack effect files import from this module, so the imports below run
// AFTER `registerEffect` is defined — and since current pack files don't
// register anything yet (they're stubs), there's no init-time access to the
// `registry` const. Once real registrations land, watch for the cycle: if a
// pack file calls `registerEffect` at top level, ensure the registry is
// initialized first (it is, because const declarations precede these imports
// in source order — but if you ever extract registry to a file, do it cleanly
// rather than relying on this ordering).
import './base';
import './mancers';
import './knights';
import './ascension';
import './promo';
