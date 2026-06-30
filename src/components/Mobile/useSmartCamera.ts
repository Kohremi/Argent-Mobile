import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  botOwnsCurrentDecision,
  localOwnsCurrentDecision,
  smartCameraFocusTab,
} from '../../utils/uiSelectors';
import { describeBoardAction } from './boardAction';

/** How long an opponent's board-action spotlight lingers before auto-clearing. */
const SPOTLIGHT_MS = 2200;

/**
 * Smart Camera (toggled on the start menu): keeps the mobile shell pointed at
 * wherever the current decision is happening. When the focus tab CHANGES — a
 * voter prompt appears, a Supporter draft opens, a bot starts its turn — it
 * jumps the bottom-tab stage there and pulses a one-shot spotlight so the eye
 * follows. It only acts on a *change* of focus, so within a single decision the
 * player can still wander to another tab without being yanked back; the next
 * decision re-centres them.
 *
 * It also FOLLOWS opponents on the board: when a rival places a Mage (including
 * an Ars Magna takeover that wounds an occupant), it publishes a `boardSpotlight`
 * so the Campus map can pan to that room, pulse it + the Infirmary, glide the
 * wounded Mage to its bed, and caption who got hit. The bot-move slowdown lives
 * in `useBotDriver`.
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

    // Follow an opponent's board placement (incl. Ars Magna). Gate on the actor
    // NOT being the local seat — you already know what you just did.
    if (prev && prev !== state) {
      const action = describeBoardAction(prev, state);
      if (action && action.actorOwnerId !== localPlayerId) {
        setBoardSpotlight({ ...action, nonce: ++nonce.current });
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => setBoardSpotlight(null), SPOTLIGHT_MS);
      }
    }

    // Jump the stage to the tab where the current decision lives, on a change.
    const focus = smartCameraFocusTab(state);
    if (!focus || focus === lastFocus.current) return;
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
