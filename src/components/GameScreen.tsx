import { useEffect } from 'react';
import clsx from 'clsx';
import { MotionConfig } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useStateDiffFx } from './FX/useStateDiffFx';
import { useKlankDriver } from '../hooks/useKlankDriver';
import { botOwnsCurrentDecision, activePlayer } from '../utils/uiSelectors';
import { getBotPersonality } from '../game/ai';
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

/** Private peek results (deck tops): curtain → reveal → Done. */
function PeekModal() {
  const state = useGameStore((s) => s.state);
  const peek = useUiStore((s) => s.peek);
  const peekRevealed = useUiStore((s) => s.peekRevealed);
  const revealPeek = useUiStore((s) => s.revealPeek);
  const clearPeek = useUiStore((s) => s.clearPeek);
  if (!state || !peek) return null;

  if (!peekRevealed) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-night-900/97 backdrop-blur">
        <p className="font-display text-2xl font-extrabold text-starlight">A private glimpse…</p>
        <p className="mt-1 text-sm text-white/70">{peek.title}</p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.3em] text-white/40">
          everyone else — eyes away ✨
        </p>
        <button
          type="button"
          onClick={revealPeek}
          className="mt-5 rounded-full bg-gradient-to-b from-starlight to-amber-300 px-6 py-2 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5"
        >
          👁 Reveal to me
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-night-900/90 backdrop-blur">
      <p className="mb-3 font-display text-xl font-extrabold text-starlight">{peek.title}</p>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {peek.cards.map((c, i) => (
          <div
            key={i}
            className="w-52 animate-pop rounded-card bg-parchment-50 p-2.5 text-ink-900 shadow-card-lift"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <p className="text-sm font-bold leading-tight">{c.name}</p>
            {c.sub && <p className="mt-0.5 text-[11px] leading-snug text-black/65">{c.sub}</p>}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={clearPeek}
        className="mt-5 rounded-full bg-night-700 px-5 py-1.5 font-display text-sm font-bold text-white/85 ring-1 ring-white/20 transition hover:text-white"
      >
        Done — hide it
      </button>
    </div>
  );
}

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
  useKlankDriver();
  if (!state) return null;

  // While a bot owns the current decision, show a non-blocking "thinking"
  // banner. Name the seat on a bot's own Errands turn; otherwise (answering a
  // prompt between turns) name the responding bot.
  const botThinking = botOwnsCurrentDecision(state);
  const active = activePlayer(state);
  const activeBot = active?.controlledByBot ? active : null;
  const topPending = state.pendingResolutionStack[state.pendingResolutionStack.length - 1];
  const respondingBot = topPending
    ? state.players.find((p) => p.id === topPending.responderId && p.controlledByBot) ?? null
    : null;
  const bannerBot = activeBot ?? respondingBot;

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

      {botThinking && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center">
          <div className="flex animate-pop items-center gap-2 rounded-full bg-night-800/95 px-4 py-1.5 text-sm font-bold text-starlight ring-1 ring-starlight/40 shadow-glow-sm">
            <span className="animate-breathe">🤖</span>
            {activeBot
              ? `${getBotPersonality(activeBot.botPersonalityId).name} is taking ${activeBot.name}'s turn…`
              : `${getBotPersonality(bannerBot?.botPersonalityId).name} is responding…`}
          </div>
        </div>
      )}

      <PromptDirector />
      <PeekModal />
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
