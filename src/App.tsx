import { SetupScreen } from './components/Setup/SetupScreen';
import { useGameStore } from './store/gameStore';

function GamePlaceholder() {
  const state = useGameStore((s) => s.state);
  const reset = useGameStore((s) => s.reset);

  if (!state) return null;

  const phase = state.phase;
  const phaseLabel =
    phase.kind === 'errands'
      ? `errands · turn ${phase.activePlayerIndex + 1}`
      : phase.kind === 'resolution'
        ? `resolution · room ${phase.pendingRoomIndex + 1}/${state.rooms.length}`
        : phase.kind === 'complete'
          ? `complete · archmage: ${phase.archmage ?? 'none'}`
          : phase.kind;
  const roundLabel =
    phase.kind === 'round-setup' ||
    phase.kind === 'errands' ||
    phase.kind === 'resolution' ||
    phase.kind === 'mid-game-scoring'
      ? `Round ${phase.round} / 5`
      : 'Round —';

  return (
    <div className="min-h-full p-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Game in progress</h1>
          <p className="text-slate-400 text-sm">
            {roundLabel} · phase: {phaseLabel} · seed: {state.rngSeed}
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
                {p.id} · color: {p.color} · initiative: {p.initiativeOrder}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">Tower (rooms)</h2>
        <ul className="grid grid-cols-2 gap-2">
          {state.rooms.map((room) => (
            <li
              key={room.id}
              className="p-3 rounded border border-slate-700 bg-slate-900"
            >
              <div className="font-medium">
                {room.name} <span className="text-xs text-slate-500">side {room.side}</span>
              </div>
              <div className="text-xs text-slate-500">
                pack: {room.sourcePackId} · {room.actionSpaces.length} action spaces
                {room.isUniversityCentral && ' · University Central'}
                {room.isInstantRoom && ' · instant'}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Consortium voters</h2>
        <ul className="space-y-1 text-sm">
          {state.voters.map((v) => (
            <li key={v.id} className="text-slate-300">
              {v.revealed ? v.name : '[face-down voter]'}{' '}
              <span className="text-slate-500">— {v.criterion}</span>
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
