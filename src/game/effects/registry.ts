import type {
  ActionSpace,
  EffectContext,
  EffectId,
  EffectResult,
  GameState,
  PlayerId,
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

/**
 * A playability check for a hand-played card (supporter / vault card). Returns
 * `null` when the card can do something useful right now, or a short
 * player-facing reason (e.g. "Requires 1 Intelligence") when playing it would
 * fizzle. Consulted by PLAY_SUPPORTER / PLAY_VAULT_CARD before the card is
 * consumed, so the engine can reject a wasted play and the UI (which dry-runs
 * the engine) greys the card and can surface the reason.
 */
export type PlayabilityCheck = (
  state: GameState,
  playerId: PlayerId,
) => string | null;

const playabilityChecks = new Map<EffectId, PlayabilityCheck>();

export function registerPlayability(id: EffectId, fn: PlayabilityCheck): void {
  if (playabilityChecks.has(id)) {
    throw new Error(`Playability check "${id}" is already registered`);
  }
  playabilityChecks.set(id, fn);
}

/** The block reason for `effectId` right now, or null if it's playable. */
export function playabilityReason(
  effectId: EffectId,
  state: GameState,
  playerId: PlayerId,
): string | null {
  const fn = playabilityChecks.get(effectId);
  return fn ? fn(state, playerId) : null;
}

/** Test-only helper to clear the registry between tests. */
export function _resetEffectRegistry(): void {
  registry.clear();
  playabilityChecks.clear();
}
