import { SetupScreen } from './components/Setup/SetupScreen';
import { DebugControls } from './components/DebugControls';
import { useGameStore } from './store/gameStore';

export default function App() {
  const inGame = useGameStore((s) => s.state !== null);
  return inGame ? <DebugControls /> : <SetupScreen />;
}
