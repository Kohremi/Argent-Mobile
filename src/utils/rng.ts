// Seeded PRNG (mulberry32). Tiny, deterministic, fine for shuffling cards.
//
// Two APIs are exported:
//   1. Stateful (`createRng`, `shuffle`) — closure-based; convenient for
//      one-shot use where serialization doesn't matter.
//   2. Pure (`nextRandom`, `shuffleWithState`) — takes and returns RngState
//      explicitly so the engine can keep RNG state inside GameState and
//      restore mid-game.
//
// Engine code MUST use the pure API so games are saveable / replayable.
// EVERY shuffle/draw must route through here — no `Math.random` in engine code.

import type { RngState } from '../game/types';

export type Rng = () => number;

// ---------- Stateful (closure) API ----------

export function createRng(seed: number): Rng {
  let state = seed | 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

// ---------- Pure (state-passing) API ----------

export function createRngState(seed: number): RngState {
  return { seed: seed | 0, counter: seed | 0 };
}

export interface RngStep<T> {
  value: T;
  state: RngState;
}

export function nextRandom(state: RngState): RngStep<number> {
  let s = state.counter | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return {
    value: ((t ^ (t >>> 14)) >>> 0) / 4294967296,
    state: { seed: state.seed, counter: s },
  };
}

export function shuffleWithState<T>(
  arr: readonly T[],
  state: RngState,
): RngStep<T[]> {
  let s = state;
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const r = nextRandom(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return { value: result, state: s };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
