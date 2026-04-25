// Seeded PRNG (mulberry32). Tiny, deterministic, fine for shuffling cards.
// Determinism is non-negotiable: replays, tests, and bug reports all depend on
// reproducible randomness, so EVERY shuffle/draw in the engine must route here.

export type Rng = () => number;

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

/** Fisher–Yates shuffle. Returns a new array; does not mutate input. */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Generates a non-deterministic seed for new games. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
