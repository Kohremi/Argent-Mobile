import { useEffect } from 'react';
import clsx from 'clsx';
import { MotionConfig } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useStateDiffFx } from './FX/useStateDiffFx';
import { TopBar } from './HUD/TopBar';
import { TurnBanner } from './HUD/TurnBanner';
import { CampusBoard } from './Board/CampusBoard';
import { PlayerDock } from './Player/PlayerDock';
import { OpponentRail } from './Player/OpponentRail';
import { CouncilTower } from './Council/CouncilTower';
import { PromptDirector } from './Prompts/PromptDirector';
import { ScoringCeremony } from './Modals/ScoringCeremony';
import { DebugControls } from './DebugControls';

/**
 * Game shell (docs/UI_DESIGN.md §7.1): sky → HUD → campus → dock, plus the
 * error toast and the debug console drawer (the engine console drives
 * everything PromptDirector doesn't render yet — build step 2 replaces it).
 */

/** Sky phase from bell-tower depletion (§1 — the bell tower is the sun). */
function skyPhase(bells: number, phaseKind: string): 'dawn' | 'day' | 'dusk' | 'night' {
  if (phaseKind === 'resolution' || phaseKind === 'final-scoring' || phaseKind === 'complete') {
    return 'night';
  }
  if (phaseKind === 'round-setup') return 'dawn';
  if (bells >= 7) return 'day';
  if (bells >= 4) return 'dusk';
  if (bells >= 1) return 'dusk';
  return 'night';
}

const SKY: Record<ReturnType<typeof skyPhase>, string> = {
  dawn: 'linear-gradient(180deg, #2a2554 0%, #7a5a8c 55%, #e8927c 100%)',
  day: 'linear-gradient(180deg, #1f3a6e 0%, #3a76c2 55%, #7ee8fa 100%)',
  dusk: 'linear-gradient(180deg, #1f1b3f 0%, #5b3a7e 55%, #e8794a 100%)',
  night: 'linear-gradient(180deg, #0d0b22 0%, #171430 60%, #2a2554 100%)',
};

function ErrorToast() {
  const lastError = useUiStore((s) => s.lastError);
  const clearError = useUiStore((s) => s.clearError);
  useEffect(() => {
    if (!lastError) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [lastError, clearError]);
  if (!lastError) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-50 flex justify-center">
      <p className="animate-pop rounded-full bg-night-800/95 px-4 py-2 text-sm text-rose-300 ring-1 ring-rose-400/50 shadow-card">
        {lastError}
      </p>
    </div>
  );
}

export function GameScreen() {
  const state = useGameStore((s) => s.state);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  useStateDiffFx();
  if (!state) return null;

  const sky = skyPhase(state.bellTower.available.length, state.phase.kind);

  return (
    <MotionConfig reducedMotion="user">
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* sky — crossfades as the bell tower depletes */}
      <div
        className="absolute inset-0 -z-10 transition-[background] duration-1000"
        style={{ background: SKY[sky] }}
      />
      {/* starfield, visible at night */}
      <div
        className={clsx(
          'absolute inset-0 -z-10 transition-opacity duration-1000',
          sky === 'night' ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          backgroundImage:
            'radial-gradient(1.5px 1.5px at 12% 18%, #ffe9a8cc, transparent), radial-gradient(1px 1px at 34% 8%, #ffffffaa, transparent), radial-gradient(1.5px 1.5px at 58% 22%, #ffe9a899, transparent), radial-gradient(1px 1px at 76% 12%, #ffffff99, transparent), radial-gradient(1.5px 1.5px at 90% 30%, #ffe9a8bb, transparent), radial-gradient(1px 1px at 22% 38%, #ffffff77, transparent), radial-gradient(1.5px 1.5px at 44% 45%, #ffe9a877, transparent)',
        }}
      />

      <TopBar />
      <main className="flex min-h-0 flex-1">
        <OpponentRail />
        <div className="min-w-0 flex-1">
          <CampusBoard />
        </div>
        <CouncilTower />
      </main>
      <PlayerDock />

      <PromptDirector />
      <TurnBanner />
      <ScoringCeremony />
      <ErrorToast />

      {/* debug console drawer */}
      {debugOpen && (
        <div className="absolute inset-x-0 bottom-0 z-40 max-h-[72vh] overflow-y-auto border-t border-white/15 bg-slate-950/97 shadow-card-lift backdrop-blur">
          <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-950/95 px-4 py-2 ring-1 ring-white/10">
            <p className="font-display text-sm font-bold text-starlight">
              Engine console
            </p>
            <button
              type="button"
              onClick={() => setDebugOpen(false)}
              className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/80 ring-1 ring-white/15 hover:text-white"
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
