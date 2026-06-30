import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { botOwnsCurrentDecision, smartCameraFocusTab } from '../../utils/uiSelectors';

/**
 * Smart Camera (toggled on the start menu): keeps the mobile shell pointed at
 * wherever the current decision is happening. When the focus tab CHANGES — a
 * voter prompt appears, a Supporter draft opens, a bot starts its turn — it
 * jumps the bottom-tab stage there and pulses a one-shot spotlight so the eye
 * follows. It only acts on a *change* of focus, so within a single decision the
 * player can still wander to another tab without being yanked back; the next
 * decision re-centres them. The bot-move slowdown lives in `useBotDriver`.
 *
 * Returns `{ cueKey, bot }` for the shell: `cueKey` bumps on every jump (remount
 * the spotlight to replay its animation), and `bot` flags whether the move being
 * shown is a bot's (so the spotlight can read as "watch this" rather than "act").
 */
export function useSmartCamera(): { cueKey: number; bot: boolean } {
  const state = useGameStore((s) => s.state);
  const smartCamera = useUiStore((s) => s.smartCamera);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const lastFocus = useRef<string | null>(null);
  const [cue, setCue] = useState<{ key: number; bot: boolean }>({ key: 0, bot: false });

  useEffect(() => {
    if (!smartCamera || !state) return;
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
  }, [state, smartCamera, setMobileTab]);

  return { cueKey: cue.key, bot: cue.bot };
}
