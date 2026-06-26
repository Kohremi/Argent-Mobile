// botDraftAction auto-plays BOT seats during the pre-game draft phases and
// leaves human seats alone — the seam that lets a single-player table draft
// itself while the human still makes their own picks.
import { describe, expect, it } from 'vitest';
import { initGame } from '../engine';
import { botDraftAction } from './draft';
import type { GameState } from '../types';

function candidateDraft(): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['You', 'Bot'],
    controlledByBot: [false, true],
    botPersonalityIds: [undefined, 'klank'],
    rngSeed: 7,
    useCandidateDraft: true,
  });
  expect(s.phase.kind).toBe('candidate-draft');
  return s;
}

describe('botDraftAction', () => {
  it('returns a legal CHOOSE_CANDIDATE for a bot drafter', () => {
    const base = candidateDraft();
    // Force the bot seat (index 1) to be the active drafter.
    const s: GameState = { ...base, phase: { ...base.phase, activePlayerIndex: 1 } as GameState['phase'] };
    const action = botDraftAction(s);
    expect(action?.type).toBe('CHOOSE_CANDIDATE');
    if (action?.type === 'CHOOSE_CANDIDATE') {
      expect(action.playerId).toBe(s.players[1]!.id);
      expect(typeof action.candidateId).toBe('string');
    }
  });

  it('leaves the human drafter alone (returns null)', () => {
    const base = candidateDraft();
    const s: GameState = { ...base, phase: { ...base.phase, activePlayerIndex: 0 } as GameState['phase'] };
    expect(botDraftAction(s)).toBeNull();
  });

  it('returns null outside the draft phases', () => {
    const base = candidateDraft();
    const s: GameState = {
      ...base,
      phase: { kind: 'errands', round: 1, activePlayerIndex: 1, actionUsed: false, fastActionUsed: false },
    };
    expect(botDraftAction(s)).toBeNull();
  });
});
