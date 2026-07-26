import { useLayoutEffect, useState } from 'react';
import type { PendingResolution, ReactionTriggerEvent } from '../../game/types';

/**
 * A reaction window is opened in the SAME dispatch as the board change that
 * triggered it, so its full-screen cut-in would otherwise drop over the board
 * the instant the wound/move/etc. happens — hiding the very thing the player
 * needs to see before deciding. This hook holds the cut-in for a short beat so
 * the diff-driven board FX (see useStateDiffFx) plays on an uncovered board
 * first, then reveals the popup.
 */

/** Trigger kinds that produce a visible board flourish worth pausing on. */
const IMPACT_KINDS: ReadonlySet<ReactionTriggerEvent['kind']> = new Set([
  'mage-wounded',
  'mage-banished',
  'mage-moved',
  'mage-shadowed',
]);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * How long to hold a reaction window before revealing it. Zero for windows
 * opened by non-board triggers (spell-cast / buy) and when the viewer prefers
 * reduced motion. Scales a little with the number of simultaneous impacts (a
 * room-wide wound has several flashes to take in), capped so it never drags.
 */
export function reactionRevealDelayMs(events: readonly ReactionTriggerEvent[]): number {
  const impacts = events.filter((e) => IMPACT_KINDS.has(e.kind)).length;
  if (impacts === 0 || prefersReducedMotion()) return 0;
  return Math.min(900, 450 + (impacts - 1) * 130);
}

/**
 * Returns `false` for a beat after an impact reaction window first appears (so
 * the board FX is visible), then `true`. Keyed on the pending id, so the hold
 * fires once per window and survives re-renders; a new window restarts it, and
 * a non-reaction / non-impact / resolved prompt reveals immediately. Uses a
 * layout effect so the cut-in never flashes for a frame before being held.
 */
export function useReactionRevealDelay(pending: PendingResolution | null): boolean {
  const events =
    pending?.prompt.kind === 'reaction-window' ? pending.prompt.triggerEvents : null;
  const id = pending?.id ?? null;
  const delay = events ? reactionRevealDelayMs(events) : 0;
  const [revealed, setRevealed] = useState(true);

  useLayoutEffect(() => {
    if (id == null || delay <= 0) {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), delay);
    return () => clearTimeout(t);
  }, [id, delay]);

  return revealed;
}
