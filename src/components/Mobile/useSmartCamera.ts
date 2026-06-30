import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  botOwnsCurrentDecision,
  localOwnsCurrentDecision,
  smartCameraFocusTab,
} from '../../utils/uiSelectors';
import { describeOpponentAction } from './boardAction';

/** How long an opponent's board-action spotlight lingers before auto-clearing. */
export const SPOTLIGHT_MS = 2200;

/**
 * Smart Camera (toggled on the start menu): keeps the mobile shell pointed at
 * wherever the current decision is happening. When the focus tab CHANGES — a
 * voter prompt appears, a Supporter draft opens, a bot starts its turn — it
 * jumps the bottom-tab stage there and pulses a one-shot spotlight so the eye
 * follows. It only acts on a *change* of focus, so within a single decision the
 * player can still wander to another tab without being yanked back; the next
 * decision re-centres them.
 *
 * It also FOLLOWS each opponent move, derived from the state diff: a Mage
 * placement (incl. an Ars Magna takeover that wounds an occupant) pans + pulses
 * the Campus map and glides the wounded Mage to its bed; a Mark jumps to the
 * Council and pulses the voter; a Supporter / Consumable draft jumps to Rivals.
 * Each publishes a `boardSpotlight` that captions what happened. The bot-move
 * slowdown lives in `useBotDriver`.
 *
 * Returns `{ cueKey, bot }` for the shell: `cueKey` bumps on every tab jump
 * (remount the spotlight to replay its animation), and `bot` flags whether the
 * move being shown is a bot's.
 */
export function useSmartCamera(): { cueKey: number; bot: boolean } {
  const state = useGameStore((s) => s.state);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const smartCamera = useUiStore((s) => s.smartCamera);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const setBoardSpotlight = useUiStore((s) => s.setBoardSpotlight);
  const lastFocus = useRef<string | null>(null);
  const prevState = useRef<GameState | null>(null);
  const nonce = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cue, setCue] = useState<{ key: number; bot: boolean }>({ key: 0, bot: false });

  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state ?? null;
    if (!smartCamera || !state) return;

    // While anyone but the local seat is acting — a bot's Errands turn, a bot
    // prompt, or a between-turns phase auto-resolving (Nightfall/setup/scoring)
    // — a drilled-in room sheet hides the board (and the follow animation)
    // behind its scrim. Drop it so the Campus map is visible; the player
    // re-opens a room when it's their own turn again. The `openRoomId` guard
    // keeps this idempotent so it fires once per turn, not every bot sub-action.
    if (
      !localOwnsCurrentDecision(state, localPlayerId) &&
      useUiStore.getState().openRoomId
    ) {
      useUiStore.getState().setOpenRoomId(null);
    }

    // An opponent's combat/action caption must not bleed into the HUMAN's own
    // turn. The moment the local seat owns the decision again, clear the
    // spotlight (and cancel its lingering auto-clear timer) so the caption fades
    // out instead of staying up while they plan. Gated on a bound seat so an
    // all-bot spectator game (no human turn) still shows its captions.
    if (
      localPlayerId != null &&
      localOwnsCurrentDecision(state, localPlayerId) &&
      useUiStore.getState().boardSpotlight
    ) {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setBoardSpotlight(null);
    }

    // Completing a Fast Action also closes a drilled-in room, so the player sees
    // the board result before choosing their Regular Action. Detect the local
    // seat's `fastActionsUsed` ticking up within the same Errands turn (same
    // active index, so a turn handover that resets the count never counts).
    if (
      prev &&
      prev.phase.kind === 'errands' &&
      state.phase.kind === 'errands' &&
      prev.phase.activePlayerIndex === state.phase.activePlayerIndex &&
      activePlayer(state)?.id === localPlayerId &&
      (state.phase.fastActionsUsed ?? 0) > (prev.phase.fastActionsUsed ?? 0) &&
      useUiStore.getState().openRoomId
    ) {
      useUiStore.getState().setOpenRoomId(null);
    }

    // Follow an opponent's move (placement / Mark / recruit). Gate on the actor
    // NOT being the local seat — you already know what you just did.
    if (prev && prev !== state) {
      const action = describeOpponentAction(prev, state);
      if (action && action.actorOwnerId !== localPlayerId) {
        setBoardSpotlight({
          roomId: action.roomId,
          wounded: action.wounded,
          voterId: action.voterId,
          tab: action.tab,
          caption: action.caption,
          nonce: ++nonce.current,
        });
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => setBoardSpotlight(null), SPOTLIGHT_MS);

        // Follow the move to its tab and replay the cue there. Claim `lastFocus`
        // and bail so the generic focus pass below can't immediately yank us
        // back to the board while the off-board action is still being shown.
        if (action.tab) {
          if (action.tab !== useUiStore.getState().mobileTab) {
            useUiStore.getState().setOpenRoomId(null);
            setMobileTab(action.tab);
          }
          lastFocus.current = action.tab;
          setCue((c) => ({ key: c.key + 1, bot: true }));
          return;
        }
      }
    }

    // Rest the stage on the tab the current decision lives on — Campus by
    // default — jumping only when that target CHANGES, so a resolved Mark / draft
    // snaps back to the board instead of stranding the player on a side tab.
    const focus = smartCameraFocusTab(state, localPlayerId);
    if (focus === lastFocus.current) return;
    lastFocus.current = focus;
    if (focus !== useUiStore.getState().mobileTab) {
      // Drilled-in room / card sheets would otherwise hide the tab we're moving
      // to — close them so the destination is actually visible.
      useUiStore.getState().setOpenRoomId(null);
      setMobileTab(focus);
    }
    setCue((c) => ({ key: c.key + 1, bot: botOwnsCurrentDecision(state) }));
  }, [state, smartCamera, setMobileTab, setBoardSpotlight, localPlayerId]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  return { cueKey: cue.key, bot: cue.bot };
}
