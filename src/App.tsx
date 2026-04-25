import { SetupScreen } from './components/Setup/SetupScreen';
import { useGameStore } from './store/gameStore';

function GamePlaceholder() {
  const state = useGameStore((s) => s.state);
  const reset = useGameStore((s) => s.reset);

  if (!state) return null;

  return (
    <div className="min-h-full p-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Game in progress</h1>
          <p className="text-slate-400 text-sm">
            Round {state.round} / {state.totalRounds} · phase: {state.phase} · seed:{' '}
            {state.rngSeed}
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
        >
          Back to setup
        </button>
      </header>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">Active packs</h2>
        <p className="text-sm text-slate-300">{state.activePackIds.join(', ')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">Players</h2>
        <ul className="grid grid-cols-2 gap-2">
          {state.players.map((p) => (
            <li
              key={p.id}
              className="p-3 rounded border border-slate-700 bg-slate-900"
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-slate-500">
                {p.id} · color: {p.color} · initiative: {p.initiative}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">Tower (rooms)</h2>
        <ul className="grid grid-cols-2 gap-2">
          {state.board.rooms.map((room) => (
            <li
              key={room.id}
              className="p-3 rounded border border-slate-700 bg-slate-900"
            >
              <div className="font-medium">{room.name}</div>
              <div className="text-xs text-slate-500">
                pack: {room.sourcePackId} · {room.actionSpaces.length} action spaces
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Councils</h2>
        <ul className="space-y-1 text-sm">
          {state.councils.map((c) => (
            <li key={c.id} className="text-slate-300">
              {c.name} <span className="text-slate-500">— {c.scoringCriterion}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-slate-600 mt-8">
        Placeholder game screen. Real board UI, action prompts, and scoring come next.
      </p>
    </div>
  );
}

export default function App() {
  const inGame = useGameStore((s) => s.state !== null);
  return inGame ? <GamePlaceholder /> : <SetupScreen />;
}
