import { useEffect, useRef } from 'react';
import { getBotPersonality } from '../game/ai';
import type { GameAction, GameState } from '../game/types';
import { useGameStore } from '../store/gameStore';
import { botDecisionContext } from '../utils/uiSelectors';

/** The personality to use for the seat that owns the current bot decision. */
function personalityFor(state: GameState, playerId: string) {
  const player = state.players.find((p) => p.id === playerId);
  return getBotPersonality(player?.botPersonalityId);
}

/**
 * Delay between a bot-controlled seat's actions so a human can follow play (and
 * the placement / FX flourishes are visible). A single constant for now; a real
 * user-facing speed setting is a planned follow-up.
 */
export const KLANK_MOVE_DELAY_MS = 600;

/**
 * Drives AI-controlled ("Klank") seats. Mounted once in GameScreen alongside
 * `useStateDiffFx`. After every state change it asks `botDecisionContext` whether
 * a bot owns the next decision; if so it schedules ONE delayed dispatch. When the
 * timer fires it re-reads the latest store state and re-validates before acting,
 * so rapid state changes (or React StrictMode double-invokes) can't double-move.
 *
 * Each dispatch produces a new state object → this effect re-runs → the next move
 * is scheduled, pacing the bot at one action per `KLANK_MOVE_DELAY_MS`. The
 * cleanup cancels a pending move if the state changes first (e.g. a human acts).
 */
export function useKlankDriver(): void {
  const state = useGameStore((s) => s.state);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!state) return;
    if (!botDecisionContext(state)) return;

    timerRef.current = setTimeout(() => {
      // Re-read the freshest state — it may have moved on since we scheduled.
      const fresh = useGameStore.getState().state;
      if (!fresh) return;
      const ctx = botDecisionContext(fresh);
      if (!ctx) return;

      const action: GameAction =
        ctx.kind === 'advance'
          ? { type: 'ADVANCE_PHASE' }
          : ctx.kind === 'prompt'
            ? {
                type: 'RESOLVE_PENDING',
                resolutionId: ctx.pending.id,
                answer: personalityFor(
                  fresh,
                  ctx.pending.responderId,
                ).answerPendingResolution(fresh, ctx.pending),
              }
            : personalityFor(fresh, ctx.playerId).chooseErrandsAction(
                fresh,
                ctx.playerId,
              );

      try {
        useGameStore.getState().dispatch(action);
      } catch (err) {
        // Safety net: the policy returns only legal moves, but never wedge the
        // loop. End the bot's turn if we somehow produced an illegal Errands move.
        console.error('Klank move failed; falling back', err);
        if (ctx.kind === 'errands') {
          try {
            useGameStore
              .getState()
              .dispatch({ type: 'PASS_TURN', playerId: ctx.playerId });
          } catch (passErr) {
            console.error('Klank PASS_TURN fallback failed', passErr);
          }
        }
      }
    }, KLANK_MOVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state]);
}
