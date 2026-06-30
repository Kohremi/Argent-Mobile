import { useEffect, useRef } from 'react';
import { getBotPersonality } from '../game/ai';
import { botDraftAction } from '../game/ai/draft';
import type { GameAction, GameState } from '../game/types';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { activePlayer, botDecisionContext } from '../utils/uiSelectors';

/**
 * The single bot driver for the whole game. Mounted once (at the App root) so it
 * auto-plays every AI seat across ALL phases — the pre-game drafts AND in-game
 * Errands / prompts / between-turn advances — without depending on which screen
 * is showing. Human seats are never touched (each branch checks `controlledByBot`
 * via `botDecisionContext` / `botDraftAction`), which is what makes a single-
 * player table "just work" and is the seam a future join-room system slots into:
 * each client drives its bot seats; remote human seats are left to their owners.
 *
 * After every state change it asks for the next bot action; if there is one it
 * schedules ONE delayed dispatch, then re-reads + re-validates before acting so
 * rapid changes (or StrictMode double-invokes) can't double-move.
 */
export const BOT_MOVE_DELAY_MS = 600;
/**
 * Pacing when Smart Camera is on: bots move slower so you can actually watch
 * each one as the camera follows it to the relevant tab.
 */
export const BOT_MOVE_DELAY_SMART_MS = 1100;
/**
 * How long the turn hand-off splash (`TurnBanner`) stays up. The incoming bot's
 * FIRST move is held until just after this clears (see the hand-off delay below)
 * so its action isn't hidden behind the banner. Shared with `TurnBanner` so the
 * two never drift.
 */
export const TURN_BANNER_MS = 900;

function personalityFor(state: GameState, playerId: string) {
  const player = state.players.find((p) => p.id === playerId);
  return getBotPersonality(player?.botPersonalityId);
}

/** The next action a bot owes right now, or `null` if a human owns the decision. */
function nextBotAction(state: GameState): GameAction | null {
  const ctx = botDecisionContext(state);
  if (ctx?.kind === 'advance') return { type: 'ADVANCE_PHASE' };
  if (ctx?.kind === 'prompt') {
    return {
      type: 'RESOLVE_PENDING',
      resolutionId: ctx.pending.id,
      answer: personalityFor(state, ctx.pending.responderId).answerPendingResolution(
        state,
        ctx.pending,
      ),
    };
  }
  if (ctx?.kind === 'errands') {
    return personalityFor(state, ctx.playerId).chooseErrandsAction(state, ctx.playerId);
  }
  // Pre-game draft phases (candidate / mage draft) aren't pending-resolutions, so
  // botDecisionContext doesn't cover them — handle bot draft seats here.
  return botDraftAction(state);
}

export function useBotDriver(): void {
  const state = useGameStore((s) => s.state);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;

    // Track the active Errands seat on every change (incl. human turns) so we
    // can tell when the turn has just handed off — the moment the TurnBanner
    // splash sweeps in. Update the ref BEFORE the gate below so a human→bot
    // hand-off is still seen on the next bot turn.
    const activeId =
      state.phase.kind === 'errands' ? activePlayer(state)?.id ?? null : null;
    const handedOff =
      activeId !== null &&
      prevActiveIdRef.current !== null &&
      prevActiveIdRef.current !== activeId;
    prevActiveIdRef.current = activeId;

    // Cheap gate: only schedule when a bot actually owns the next decision.
    const ctx = botDecisionContext(state);
    if (!ctx && !botDraftAction(state)) return;

    // Smart Camera slows the cadence so each bot move is watchable as the shell
    // pans to it; otherwise keep the snappy default.
    const base = useUiStore.getState().smartCamera
      ? BOT_MOVE_DELAY_SMART_MS
      : BOT_MOVE_DELAY_MS;
    // Right after a hand-off, hold the incoming bot's first move until the
    // splash has cleared, so its action begins on a visible board.
    const delay = handedOff ? Math.max(base, TURN_BANNER_MS + 200) : base;

    timerRef.current = setTimeout(() => {
      const fresh = useGameStore.getState().state;
      if (!fresh) return;
      const action = nextBotAction(fresh);
      if (!action) return;
      try {
        useGameStore.getState().dispatch(action);
      } catch (err) {
        // Safety net: policies return only legal moves, but never wedge the loop.
        console.error('Bot move failed; falling back', err);
        const fctx = botDecisionContext(fresh);
        if (fctx?.kind === 'errands') {
          try {
            useGameStore.getState().dispatch({ type: 'PASS_TURN', playerId: fctx.playerId });
          } catch (passErr) {
            console.error('Bot PASS_TURN fallback failed', passErr);
          }
        }
      }
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state]);
}
