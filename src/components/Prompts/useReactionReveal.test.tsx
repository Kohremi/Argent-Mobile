// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { reactionRevealDelayMs, useReactionRevealDelay } from './useReactionReveal';
import type { PendingResolution, ReactionTriggerEvent } from '../../game/types';

beforeEach(() => {
  // Deterministic: not reduced motion unless a test overrides it.
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wound: ReactionTriggerEvent = {
  kind: 'mage-wounded',
  mageId: 'm',
  ownerId: 'p1',
  byPlayerId: 'p2',
  originalSpaceId: null,
};
const cast: ReactionTriggerEvent = {
  kind: 'spell-cast',
  spellId: 'base.spell.burn',
  level: 1,
  byPlayerId: 'p2',
};

function reactionPending(id: number, events: ReactionTriggerEvent[]): PendingResolution {
  return {
    id,
    responderId: 'p1',
    prompt: { kind: 'reaction-window', triggerEvents: events, reactionOptions: [], canPass: true },
    resume: { effectId: 'x', context: {} },
    source: { triggeringPlayerId: 'p2', description: 'test' },
  } as unknown as PendingResolution;
}

describe('reactionRevealDelayMs', () => {
  it('is 0 with no board impact (spell-cast only)', () => {
    expect(reactionRevealDelayMs([cast])).toBe(0);
  });

  it('is a positive beat for one impact and scales (capped) for batches', () => {
    expect(reactionRevealDelayMs([wound])).toBe(750);
    expect(reactionRevealDelayMs([wound, wound, wound])).toBe(750 + 2 * 150);
    expect(reactionRevealDelayMs(Array(20).fill(wound))).toBe(1250);
  });

  it('is 0 when the viewer prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(reactionRevealDelayMs([wound])).toBe(0);
  });
});

describe('useReactionRevealDelay', () => {
  it('holds an impact reaction window, then reveals after the beat', () => {
    vi.useFakeTimers();
    const p = reactionPending(1, [wound]);
    const { result } = renderHook(() => useReactionRevealDelay(p));
    expect(result.current).toBe(false); // held while the board FX plays
    act(() => {
      vi.advanceTimersByTime(reactionRevealDelayMs([wound]));
    });
    expect(result.current).toBe(true);
  });

  it('reveals a non-impact reaction window immediately', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReactionRevealDelay(reactionPending(2, [cast])));
    expect(result.current).toBe(true);
  });

  it('reveals immediately when there is no reaction window', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReactionRevealDelay(null));
    expect(result.current).toBe(true);
  });

  it('restarts the hold when a new impact window appears', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ p }: { p: PendingResolution }) => useReactionRevealDelay(p),
      { initialProps: { p: reactionPending(1, [wound]) } },
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(true);
    rerender({ p: reactionPending(2, [wound]) }); // new id → hold again
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(reactionRevealDelayMs([wound]));
    });
    expect(result.current).toBe(true);
  });
});
