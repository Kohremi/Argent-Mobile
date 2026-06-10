import { SetupScreen } from './components/Setup/SetupScreen';
import { DebugControls } from './components/DebugControls';
import { GameScreen } from './components/GameScreen';
import { useGameStore } from './store/gameStore';

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
  if (phaseKind === null) return <SetupScreen />;
  if (DRAFT_PHASES.has(phaseKind)) return <DebugControls />;
  return <GameScreen />;
}
