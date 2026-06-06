import { useMemo } from 'react';
import clsx from 'clsx';
import { listPacks } from '../../content/registry';
import {
  ABILITY_DEPARTMENTS,
  PLAYER_COUNT_RANGE,
  ROOM_COUNT_RANGE,
  useSetupStore,
  type LayoutModeId,
} from '../../store/setupStore';
import { useGameStore } from '../../store/gameStore';
import { randomSeed } from '../../utils/rng';
import type { GameConfig, RoomId } from '../../game/types';

const LAYOUT_MODE_OPTIONS: {
  id: LayoutModeId;
  title: string;
  description: string;
}[] = [
  {
    id: 'first-time',
    title: 'First time playing — 8 Rooms',
    description:
      'Rulebook-recommended beginner board: Vault, Training Fields, Infirmary, Courtyard, Catacombs, Guilds, Library, Council Chamber (all side A).',
  },
  {
    id: 'random',
    title: 'Normal — Random',
    description:
      'Shuffle rooms into a randomized grid every game. Room count auto-scales with player count.',
  },
  {
    id: 'custom',
    title: 'Select your Layout',
    description:
      'Pick exactly which rooms (and which side, A or B) end up on the board. Selected rooms are shuffled into the grid at game start.',
  },
];

export function SetupScreen() {
  const packs = useMemo(() => listPacks(), []);
  const selectedPackIds = useSetupStore((s) => s.selectedPackIds);
  const playerNames = useSetupStore((s) => s.playerNames);
  const numberOfRooms = useSetupStore((s) => s.numberOfRooms);
  const layoutMode = useSetupStore((s) => s.layoutMode);
  const customRoomIds = useSetupStore((s) => s.customRoomIds);
  const togglePack = useSetupStore((s) => s.togglePack);
  const setPlayerName = useSetupStore((s) => s.setPlayerName);
  const setPlayerCount = useSetupStore((s) => s.setPlayerCount);
  const setNumberOfRooms = useSetupStore((s) => s.setNumberOfRooms);
  const setLayoutMode = useSetupStore((s) => s.setLayoutMode);
  const toggleCustomRoomSide = useSetupStore((s) => s.toggleCustomRoomSide);
  const mageAbilitySides = useSetupStore((s) => s.mageAbilitySides);
  const setMageAbilitySide = useSetupStore((s) => s.setMageAbilitySide);
  const startGame = useGameStore((s) => s.start);

  // Index every wired room across the selected packs, grouped by name so
  // we can show one row per "physical" room with A/B side buttons. A room
  // is wired iff it has action spaces or a placement-blocked special
  // (Infirmary). Unwired stubs (e.g. Adventuring Side A today) are filtered
  // so the player can't pick something that wouldn't do anything.
  const wiredRoomGroups = useMemo(() => {
    type Group = {
      name: string;
      packId: string;
      packName: string;
      sideA: RoomId | null;
      sideB: RoomId | null;
      isAlwaysIncluded: boolean;
    };
    const groups = new Map<string, Group>();
    for (const pack of packs) {
      if (!selectedPackIds.includes(pack.id)) continue;
      for (const r of pack.rooms) {
        const isWired = r.actionSpaces.length > 0 || r.cannotBePlacedInDirectly;
        if (!isWired) continue;
        const key = `${pack.id}::${r.name}`;
        const existing = groups.get(key) ?? {
          name: r.name,
          packId: pack.id,
          packName: pack.name,
          sideA: null,
          sideB: null,
          isAlwaysIncluded: r.isUniversityCentral,
        };
        if (r.side === 'A') existing.sideA = r.id;
        else existing.sideB = r.id;
        // Mark the group as always-included if EITHER side flags as UC.
        if (r.isUniversityCentral) existing.isAlwaysIncluded = true;
        groups.set(key, existing);
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      // Always-included rooms pin to the top.
      if (a.isAlwaysIncluded !== b.isAlwaysIncluded) {
        return a.isAlwaysIncluded ? -1 : 1;
      }
      // Then base pack first, then alphabetical within each pack.
      if (a.packId !== b.packId) {
        if (a.packId === 'base') return -1;
        if (b.packId === 'base') return 1;
        return a.packId.localeCompare(b.packId);
      }
      return a.name.localeCompare(b.name);
    });
  }, [packs, selectedPackIds]);

  const playerCount = playerNames.length;
  const canStart =
    playerNames.every((n) => n.trim().length > 0) &&
    (layoutMode !== 'custom' || customRoomIds.length > 0);

  const handleStart = () => {
    if (!canStart) return;
    const config: GameConfig = {
      activePackIds: selectedPackIds,
      playerNames: playerNames.map((n) => n.trim()),
      rngSeed: randomSeed(),
      useCandidateDraft: true,
      numberOfRooms,
      roomLayoutMode:
        layoutMode === 'first-time'
          ? { kind: 'first-time' }
          : layoutMode === 'custom'
            ? { kind: 'custom', roomIds: customRoomIds }
            : { kind: 'random' },
      mageAbilitySides,
    };
    startGame(config);
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
                      {pack.spells.length} spells · {pack.voters.length} voters
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

      <section className="mb-8">
        <h2 className="text-xl font-medium mb-3">Board Layout</h2>
        <ul className="space-y-2">
          {LAYOUT_MODE_OPTIONS.map(({ id, title, description }) => {
            const isActive = layoutMode === id;
            return (
              <li key={id}>
                <label
                  className={clsx(
                    'flex items-start gap-3 p-3 rounded border cursor-pointer',
                    isActive
                      ? 'border-amber-400/60 bg-amber-400/5'
                      : 'border-slate-700 bg-slate-900',
                  )}
                >
                  <input
                    type="radio"
                    name="layout-mode"
                    className="mt-1"
                    checked={isActive}
                    onChange={() => setLayoutMode(id)}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{title}</div>
                    <p className="text-sm text-slate-400">{description}</p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        {layoutMode === 'random' && (
          <div className="mt-4 flex items-center justify-between rounded border border-slate-700 bg-slate-900 p-3">
            <div>
              <p className="font-medium text-sm">Number of rooms</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto-set by player count; override manually. Extras beyond
                the pack&apos;s available rooms are placeholders.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40"
                onClick={() => setNumberOfRooms(numberOfRooms - 1)}
                disabled={numberOfRooms <= ROOM_COUNT_RANGE.min}
              >
                −
              </button>
              <span className="text-sm text-slate-300 w-20 text-center">
                {numberOfRooms} rooms
              </span>
              <button
                type="button"
                className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40"
                onClick={() => setNumberOfRooms(numberOfRooms + 1)}
                disabled={numberOfRooms >= ROOM_COUNT_RANGE.max}
              >
                +
              </button>
            </div>
          </div>
        )}

        {layoutMode === 'custom' && (
          <div className="mt-4 rounded border border-slate-700 bg-slate-900 p-3 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="font-medium text-sm">Wired rooms</p>
              <span className="text-xs text-slate-400">
                {customRoomIds.length} selected
              </span>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              Click A or B to include that side. The room grid is shuffled
              at game start.
            </p>
            <ul className="space-y-1">
              {wiredRoomGroups.map((g) => {
                const aSelected = g.sideA !== null && customRoomIds.includes(g.sideA);
                const bSelected = g.sideB !== null && customRoomIds.includes(g.sideB);
                const required = g.isAlwaysIncluded;
                const renderSideButton = (
                  side: 'A' | 'B',
                  rid: RoomId | null,
                  active: boolean,
                  otherRid: RoomId | null,
                ) => {
                  if (rid === null) {
                    return (
                      <span
                        className="px-2 py-0.5 rounded text-xs w-7 text-center text-slate-600 bg-slate-950/40 border border-slate-800/60"
                        title={`Side ${side} not wired`}
                      >
                        —
                      </span>
                    );
                  }
                  // Always-included rooms can flip sides but can't be
                  // fully deselected — clicking the active side is a no-op.
                  const handleClick = () => {
                    if (required && active) return;
                    toggleCustomRoomSide(rid, otherRid);
                  };
                  return (
                    <button
                      type="button"
                      onClick={handleClick}
                      className={clsx(
                        'px-2 py-0.5 rounded text-xs w-7 text-center font-medium border',
                        active
                          ? 'bg-amber-400 text-slate-950 border-amber-300'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
                        required && active && 'cursor-default',
                      )}
                      aria-pressed={active}
                      aria-label={`Toggle ${g.name} side ${side}`}
                      title={
                        required && active
                          ? `${g.name} is always included — click the other side to flip.`
                          : undefined
                      }
                    >
                      {side}
                    </button>
                  );
                };
                return (
                  <li
                    key={`${g.packId}::${g.name}`}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1.5 rounded bg-slate-950/40',
                      required && 'border border-white/70',
                    )}
                  >
                    <span className="flex-1 text-sm">
                      {g.name}
                      {required && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                          always in play
                        </span>
                      )}
                      {!required && g.packId !== 'base' && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">
                          {g.packName}
                        </span>
                      )}
                    </span>
                    {renderSideButton('A', g.sideA, aSelected, g.sideB)}
                    {renderSideButton('B', g.sideB, bSelected, g.sideA)}
                  </li>
                );
              })}
            </ul>
            {customRoomIds.length === 0 && (
              <p className="text-xs text-rose-300/80 italic">
                Pick at least one room to start the game.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-medium mb-1">Mage Abilities</h2>
        <p className="text-sm text-slate-400 mb-3">
          Pick which side of each department's worker-Mage power is in play.
          All current abilities are Side A.
        </p>
        <ul className="space-y-1">
          {ABILITY_DEPARTMENTS.map((dept) => {
            const requiresPack = dept.pack !== undefined;
            const packActive =
              !requiresPack || selectedPackIds.includes(dept.pack!);
            const current = mageAbilitySides[dept.id];
            const renderSideButton = (side: 'A' | 'B') => {
              const active = current === side;
              return (
                <button
                  key={side}
                  type="button"
                  disabled={!packActive}
                  onClick={() => setMageAbilitySide(dept.id, side)}
                  className={clsx(
                    'px-2 py-0.5 rounded text-xs w-7 text-center font-medium border',
                    active
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
                    !packActive && 'opacity-40 cursor-not-allowed hover:bg-slate-800',
                  )}
                  aria-pressed={active}
                  aria-label={`${dept.label} side ${side}`}
                >
                  {side}
                </button>
              );
            };
            return (
              <li
                key={dept.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-slate-950/40"
              >
                <span
                  className={clsx(
                    'flex-1 text-sm',
                    !packActive && 'text-slate-500',
                  )}
                >
                  {dept.label}
                  {requiresPack && (
                    <span
                      className={clsx(
                        'ml-2 text-[10px] uppercase tracking-wide',
                        packActive ? 'text-slate-500' : 'text-slate-600',
                      )}
                    >
                      Mancers{packActive ? '' : ' — not included'}
                    </span>
                  )}
                </span>
                {renderSideButton('A')}
                {renderSideButton('B')}
              </li>
            );
          })}
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
