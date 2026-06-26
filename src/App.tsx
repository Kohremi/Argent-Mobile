import { useState } from 'react';
import { SetupScreen } from './components/Setup/SetupScreen';
import { SoloSetup } from './components/Setup/SoloSetup';
import { DebugControls } from './components/DebugControls';
import { GameScreen } from './components/GameScreen';
import { MobileShell } from './components/Mobile/MobileShell';
import { useGameStore } from './store/gameStore';
import { useIsMobile } from './hooks/useMediaQuery';
import { useBotDriver } from './hooks/useBotDriver';

/** Pre-campus phases still use the existing full-screen draft flows. */
const DRAFT_PHASES = new Set([
  'setup',
  'candidate-draft',
  'mage-draft-first-choice',
  'mage-draft',
  'initial-mark-placement',
]);

export default function App() {
  const phaseKind = useGameStore((s) => s.state?.phase.kind ?? null);
  const isMobile = useIsMobile();
  const [quick, setQuick] = useState(false);

  // One driver for the whole table: auto-plays every bot seat in every phase
  // (drafts included). Mounted at the root so it runs regardless of screen.
  useBotDriver();

  if (phaseKind === null) {
    // The full setup (all packs, scenarios, layout, per-seat bots) is the
    // default — it starts solo out of the box but every option is editable.
    // A one-tap quick-solo screen stays available.
    return quick ? (
      <SoloSetup onAdvanced={() => setQuick(false)} />
    ) : (
      <SetupScreen onQuickStart={() => setQuick(true)} />
    );
  }
  if (DRAFT_PHASES.has(phaseKind)) return <DebugControls />;
  // In-game: the new mobile shell below lg, the desktop three-column shell above.
  return isMobile ? <MobileShell /> : <GameScreen />;
}
