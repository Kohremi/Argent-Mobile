// Regression: no bot may pick a vault card it can't afford on a BUY prompt.
//
// A `choose-vault-card` BUY prompt resolves through a real purchase effect that
// throws when the buyer lacks the gold. Most engine buy prompts pre-filter to
// affordable cards, but some paths surface the full tableau — and a naive bot
// that always picks `eligibleCardIds[0]` would then attempt an illegal move (the
// crash this guards against). Every personality now legality-checks its card
// pick via an engine dry-run, so it skips the unaffordable card.
import { describe, expect, it } from 'vitest';
import { applyAction, initGame } from '../engine';
import type { GameState, PendingResolution } from '../types';
import { darthPotter } from './darthpotter';
import { klank } from './klank';
import { malfoy } from './malfoy';
import { thickhide } from './thickhide';

const EXPENSIVE = 'base.vault.ancient-armor'; // 5 gold
const CHEAP = 'base.vault.bottled-memories'; // 1 gold

/** A state where p1 holds 1 gold and both cards sit in the vault tableau. */
function buyState(pending: PendingResolution): GameState {
  const s = initGame({ activePackIds: ['base'], playerNames: ['A', 'B'], rngSeed: 3 });
  return {
    ...s,
    // Both cards available to buy; the unaffordable one listed first.
    vaultTableau: [
      EXPENSIVE,
      CHEAP,
      ...s.vaultTableau.filter((c) => c !== EXPENSIVE && c !== CHEAP),
    ],
    players: s.players.map((p, i) =>
      i === 0 ? { ...p, resources: { ...p.resources, gold: 1 } } : p,
    ),
    // The bots dry-run RESOLVE_PENDING, so the prompt must be on the stack.
    pendingResolutionStack: [pending],
  };
}

const bots = [klank, malfoy, thickhide, darthPotter];

describe('bots never attempt an unaffordable vault buy', () => {
  for (const bot of bots) {
    it(`${bot.name} skips the card it can't afford and picks the affordable one`, () => {
      const responder = 'p1';
      const pending: PendingResolution = {
        id: 'r-buy',
        responderId: responder,
        // Unaffordable card FIRST — a naive eligibleCardIds[0] pick would throw.
        prompt: { kind: 'choose-vault-card', eligibleCardIds: [EXPENSIVE, CHEAP] },
        resume: { effectId: 'base.room.library-a.slot-3', context: { step: 'pick-card' } },
        source: {
          kind: 'room-action',
          id: 'base.room.library-a.slot-3',
          triggeringPlayerId: responder,
          description: 'Gain a Buy',
        },
      };
      const s = buyState(pending);

      const answer = bot.answerPendingResolution(s, pending);
      expect(answer).toEqual({ kind: 'card-chosen', cardId: CHEAP });
      // And the bot's chosen answer must actually be legal (no illegal-move throw).
      expect(() =>
        applyAction(s, { type: 'RESOLVE_PENDING', resolutionId: pending.id, answer }),
      ).not.toThrow();
    });
  }
});
