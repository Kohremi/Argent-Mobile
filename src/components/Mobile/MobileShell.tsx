import clsx from 'clsx';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useStateDiffFx } from '../FX/useStateDiffFx';
import { SPOTLIGHT_MS, useSmartCamera } from './useSmartCamera';
import { PromptDirector } from '../Prompts/PromptDirector';
import { ScoringCeremony } from '../Modals/ScoringCeremony';
import { TurnBanner } from '../HUD/TurnBanner';
import { DebugControls } from '../DebugControls';
import { PeekModal, ErrorToast } from '../GameScreen';
import { MobileTopBar } from './MobileTopBar';
import { MobileActionRow } from './MobileActionRow';
import { MobileDock } from './MobileDock';
import { TabBar } from './TabBar';
import { CampusMap } from './CampusMap';
import { BellTowerSheet } from './BellTowerSheet';
import { RoomDetailSheet } from './RoomDetailSheet';
import { CardDetailSheet } from './CardDetailSheet';
import { TableauView } from './TableauView';
import { RivalsView } from './RivalsView';
import { CouncilView } from './CouncilView';

/**
 * Mobile shell (< lg): a focal "stage" switched by a bottom tab bar, a compact
 * top status bar, and the active-player dock above the tabs. Reuses the engine
 * drivers and global overlays from the desktop GameScreen; the per-tab views
 * reuse existing components (CampusBoard, CouncilTower, PlayerTableau, the
 * OpponentInspector overlay). Phase B replaces the Campus tab with a spatial
 * map + drill-in room view.
 */
/**
 * The Smart Camera's action/combat caption (e.g. "⚔ A wounded B → Infirmary").
 * Owns its OWN dismissal so it can never get stuck: every new spotlight (a new
 * `nonce`) shows the caption and arms a fresh self-expiry timer; the store going
 * null hides it at once. Either way AnimatePresence fades it out rather than
 * popping. The timer lives in a ref (not effect cleanup) so a transition to a
 * captionless state can't strand a pending dismissal.
 */
function SpotlightCaption() {
  const boardSpotlight = useUiStore((s) => s.boardSpotlight);
  const [shown, setShown] = useState<{ text: string; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nonce = boardSpotlight?.nonce ?? null;
  const caption = boardSpotlight?.caption ?? null;
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!caption || nonce == null) {
      setShown(null); // store cleared (turn began / hygiene timer) → fade out now
      return;
    }
    setShown({ text: caption, key: nonce });
    timer.current = setTimeout(() => setShown(null), SPOTLIGHT_MS);
  }, [nonce, caption]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          aria-live="polite"
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-x-3 bottom-3 z-20 mx-auto max-w-[22rem] rounded-full border border-rose-400/40 bg-night-900/90 px-3 py-1.5 text-center text-[11px] font-semibold text-rose-100 shadow-card-lift ring-1 ring-rose-500/20 backdrop-blur"
        >
          {shown.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MobileShell() {
  const state = useGameStore((s) => s.state);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const mobileTab = useUiStore((s) => s.mobileTab);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  useStateDiffFx();
  // Smart Camera: auto-jump the stage to wherever the current decision lives.
  const { cueKey, bot: cueBot } = useSmartCamera();
  if (!state) return null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full flex-col overflow-hidden bg-night-900">
        <MobileTopBar />
        <MobileActionRow />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {mobileTab === 'campus' && <CampusMap />}
          {mobileTab === 'tableau' && <TableauView state={state} />}
          {mobileTab === 'rivals' && <RivalsView state={state} localPlayerId={localPlayerId} />}
          {mobileTab === 'council' && <CouncilView />}

          {/* drilled-in enlarged room view (over the Campus map) */}
          {mobileTab === 'campus' && <RoomDetailSheet />}

          {/* Bell Tower offerings — drops out of the top-bar bell over the board */}
          <BellTowerSheet />

          {/* Smart Camera action/combat caption — self-dismissing + faded. */}
          <SpotlightCaption />

          {/* Smart Camera spotlight: a one-shot ring pulse when the camera jumps
              tabs, so the eye follows the action. Re-keyed each jump to replay. */}
          {cueKey > 0 && (
            <div
              key={cueKey}
              aria-hidden
              className={clsx(
                'smart-cue pointer-events-none absolute inset-0 z-10',
                cueBot ? 'smart-cue-bot' : 'smart-cue-you',
              )}
            />
          )}
        </main>

        <MobileDock />
        <TabBar />

        {/* global overlays (shared with the desktop shell) */}
        <CardDetailSheet />
        <PromptDirector />
        <PeekModal />
        <TurnBanner />
        <ScoringCeremony />
        <ErrorToast />

        {debugOpen && (
          <div className="absolute inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto border-t border-white/15 bg-slate-950/97 shadow-card-lift backdrop-blur">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-950/95 px-4 py-2 ring-1 ring-white/10">
              <p className="font-display text-sm font-bold text-starlight">Engine console</p>
              <button
                type="button"
                onClick={() => setDebugOpen(false)}
                className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/80 ring-1 ring-white/15"
              >
                ✕ Close
              </button>
            </div>
            <DebugControls />
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
