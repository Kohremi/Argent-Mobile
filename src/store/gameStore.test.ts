// gameStore.start auto-derives the local (human) seat from the config: exactly
// one human → single-player binding; zero or many humans → hot-seat (null).
import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';
import type { GameConfig } from '../game/types';

function config(controlledByBot: boolean[]): GameConfig {
  return {
    activePackIds: ['base'],
    playerNames: controlledByBot.map((_, i) => `P${i + 1}`),
    controlledByBot,
    botPersonalityIds: controlledByBot.map((b) => (b ? 'klank' : undefined)),
    rngSeed: 7,
    useCandidateDraft: true,
  };
}

afterEach(() => useGameStore.getState().reset());

describe('gameStore.start — local seat binding', () => {
  it('binds the lone human seat (single-player)', () => {
    useGameStore.getState().start(config([false, true, true]));
    const { state, localPlayerId } = useGameStore.getState();
    expect(localPlayerId).toBe(state!.players[0]!.id);
  });

  it('binds whichever single seat is human, not just seat 0', () => {
    useGameStore.getState().start(config([true, false, true]));
    const { state, localPlayerId } = useGameStore.getState();
    expect(localPlayerId).toBe(state!.players[1]!.id);
  });

  it('leaves no binding for multiple humans (hot-seat)', () => {
    useGameStore.getState().start(config([false, false]));
    expect(useGameStore.getState().localPlayerId).toBeNull();
  });

  it('leaves no binding for an all-bot table', () => {
    useGameStore.getState().start(config([true, true]));
    expect(useGameStore.getState().localPlayerId).toBeNull();
  });
});
