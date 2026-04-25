import { useMemo } from 'react';
import clsx from 'clsx';
import { listPacks } from '../../content/registry';
import { PLAYER_COUNT_RANGE, useSetupStore } from '../../store/setupStore';
import { useGameStore } from '../../store/gameStore';
import { randomSeed } from '../../utils/rng';

export function SetupScreen() {
  const packs = useMemo(() => listPacks(), []);
  const selectedPackIds = useSetupStore((s) => s.selectedPackIds);
  const playerNames = useSetupStore((s) => s.playerNames);
  const togglePack = useSetupStore((s) => s.togglePack);
  const setPlayerName = useSetupStore((s) => s.setPlayerName);
  const setPlayerCount = useSetupStore((s) => s.setPlayerCount);
  const startGame = useGameStore((s) => s.start);

  const playerCount = playerNames.length;
  const canStart = playerNames.every((n) => n.trim().length > 0);

  const handleStart = () => {
    if (!canStart) return;
    startGame({
      activePackIds: selectedPackIds,
      playerNames: playerNames.map((n) => n.trim()),
      rngSeed: randomSeed(),
    });
  };

  return (
    <div className="min-h-full p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-semibold mb-2">Argent: The Consortium</h1>
      <p className="text-slate-400 mb-8">
        Local hot-seat scaffold. Pick content packs and players to begin.
      </p>

      <section className="mb-8">
        <h2 className="text-xl font-medium mb-3">Content Packs</h2>
        <ul className="space-y-2">
          {packs.map((pack) => {
            const isSelected = selectedPackIds.includes(pack.id);
            const isBase = pack.id === 'base';
            return (
              <li key={pack.id}>
                <label
                  className={clsx(
                    'flex items-start gap-3 p-3 rounded border',
                    isSelected
                      ? 'border-amber-400/60 bg-amber-400/5'
                      : 'border-slate-700 bg-slate-900',
                    isBase && 'opacity-90',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={isSelected}
                    disabled={isBase}
                    onChange={() => togglePack(pack.id)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pack.name}</span>
                      {isBase && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                          required
                        </span>
                      )}
                    </div>
                    {pack.description && (
                      <p className="text-sm text-slate-400">{pack.description}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-1">
                      {pack.mages.length} mages · {pack.rooms.length} rooms ·{' '}
                      {pack.spells.length} spells · {pack.councils.length} councils
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-medium">Players</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40"
              onClick={() => setPlayerCount(playerCount - 1)}
              disabled={playerCount <= PLAYER_COUNT_RANGE.min}
            >
              −
            </button>
            <span className="text-sm text-slate-300 w-20 text-center">
              {playerCount} players
            </span>
            <button
              type="button"
              className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40"
              onClick={() => setPlayerCount(playerCount + 1)}
              disabled={playerCount >= PLAYER_COUNT_RANGE.max}
            >
              +
            </button>
          </div>
        </div>
        <ul className="space-y-2">
          {playerNames.map((name, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="text-sm text-slate-500 w-6 text-right">{i + 1}.</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setPlayerName(i, e.target.value)}
                className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 focus:border-amber-400/60 focus:outline-none"
                placeholder={`Player ${i + 1}`}
              />
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        onClick={handleStart}
        disabled={!canStart}
        className="w-full py-3 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Game
      </button>
    </div>
  );
}
