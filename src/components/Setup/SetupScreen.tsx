import { useMemo } from 'react';
import clsx from 'clsx';
import { listPacks } from '../../content/registry';
import { listScenarios } from '../../content/scenarios';
import type { ContentPack } from '../../content/types';
import {
  ABILITY_DEPARTMENTS,
  PLAYER_COUNT_RANGE,
  ROOM_COUNT_RANGE,
  useSetupStore,
  type LayoutModeId,
} from '../../store/setupStore';
import { useGameStore } from '../../store/gameStore';
import { BOT_PERSONALITY_OPTIONS } from '../../game/ai';
import { randomSeed } from '../../utils/rng';
import type { Department, GameConfig, Mage, RoomId } from '../../game/types';

/**
 * Brief, NON-mechanical "what to expect" blurbs per room, keyed by the room's
 * display name. Purely presentational setup-screen flavor (like
 * LAYOUT_MODE_OPTIONS) — the authoritative mechanical text lives on the room's
 * action-space `description`s in the content packs. A room whose two sides
 * differ in feel carries `{ a, b }`; otherwise a single string covers both.
 */
/**
 * One-line content summary for an expansion's setup-screen row. Lists only the
 * non-empty categories, so content-light packs (e.g. Summer Break, which adds
 * vault cards, supporters, and round-end events rather than mages/rooms) don't
 * read as "0 mages · 0 rooms · …". Falls back to a "rules changes" note for a
 * pack that only adjusts rules.
 */
function packContentSummary(pack: ContentPack): string {
  const parts: string[] = [];
  const add = (n: number, label: string) => {
    if (n > 0) parts.push(`${n} ${label}`);
  };
  add(pack.mages.length, 'mages');
  add(pack.rooms.length, 'rooms');
  add(pack.spells.length, 'spells');
  add(pack.vaultCards.length, 'vault cards');
  add(pack.supporters.length, 'supporters');
  add(pack.voters.length, 'voters');
  add(pack.bellTowerCards.length, 'bell tower offerings');
  add(pack.roundEndScenarios?.length ?? 0, 'round-end events');
  return parts.length > 0 ? parts.join(' · ') : 'rules changes';
}

const ROOM_OVERVIEWS: Record<string, string | { a?: string; b?: string }> = {
  'Council Chamber':
    'Study for Intelligence & Wisdom, bank Research, and draft Vault cards.',
  Library: 'Research your spell books — gain Intelligence, Wisdom, and Research.',
  Infirmary:
    'Where wounded Mages recover — claim Gold or Mana when one is struck down.',
  'Training Fields': 'Train up your Intelligence and Wisdom.',
  Guilds: {
    a: 'Cash in for Gold or Mana.',
    b: 'Instantly earn Gold or Mana the moment you place.',
  },
  Catacombs:
    'Dig for Influence and Marks, recruit shady Supporters, and trade Gold for IP.',
  Courtyard: 'Channel your Wisdom into a surge of Mana.',
  Vault: 'Reveal and draft powerful Vault cards (with a little Gold on the side).',
  Adventuring: 'Draft from a shared pool of Spells, Vault cards, and Supporters.',
  Chapel: 'Collect Marks alongside knowledge, Influence, and resources.',
  Dormitory: 'Recruit new Mages into your ranks.',
  'Student Stores': {
    a: 'Stock up on Buys to purchase Vault cards.',
    b: 'Stock up on Buys — with a discount on Vault purchases.',
  },
  'Great Hall': {
    a: 'Place freely for guaranteed Influence — holds any number of Mages.',
    b: 'Place freely for Gold or Mana — holds any number of Mages.',
  },
  "Archmage's Study":
    "Borrow the Archmage's Apprentice — a Mage that wields every power.",
  'Astronomy Tower': 'Advance the reward-track marker and claim where it lands.',
  // Mancers expansion
  Laboratory: 'Tinker for Research and Technomancy power.',
  'Research Archive': 'Pore over the archives for Research and knowledge.',
  'Golem Lab': 'Conjure a temporary golem Mage that ignores the usual limits.',
  'University Tavern': 'Mingle for Supporters, Marks, and favors.',
  Atelier: 'Craft and upgrade your Treasures.',
  'Synthesis Workshop': 'Synthesize new Treasures from the ones you hold.',
};

/** Resolve the overview for a room name + selected side (B falls back to A). */
function roomOverviewFor(name: string, side: 'A' | 'B'): string | null {
  const entry = ROOM_OVERVIEWS[name];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return (side === 'B' ? entry.b : entry.a) ?? entry.a ?? entry.b ?? null;
}

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
  const playerControlledByBot = useSetupStore((s) => s.playerControlledByBot);
  const playerBotPersonality = useSetupStore((s) => s.playerBotPersonality);
  const numberOfRooms = useSetupStore((s) => s.numberOfRooms);
  const layoutMode = useSetupStore((s) => s.layoutMode);
  const customRoomIds = useSetupStore((s) => s.customRoomIds);
  const togglePack = useSetupStore((s) => s.togglePack);
  const setPlayerName = useSetupStore((s) => s.setPlayerName);
  const setPlayerControlledByBot = useSetupStore((s) => s.setPlayerControlledByBot);
  const setPlayerBotPersonality = useSetupStore((s) => s.setPlayerBotPersonality);
  const setPlayerCount = useSetupStore((s) => s.setPlayerCount);
  const setNumberOfRooms = useSetupStore((s) => s.setNumberOfRooms);
  const setLayoutMode = useSetupStore((s) => s.setLayoutMode);
  const toggleCustomRoomSide = useSetupStore((s) => s.toggleCustomRoomSide);
  const mageAbilitySides = useSetupStore((s) => s.mageAbilitySides);
  const setMageAbilitySide = useSetupStore((s) => s.setMageAbilitySide);
  const roundCount = useSetupStore((s) => s.roundCount);
  const setRoundCount = useSetupStore((s) => s.setRoundCount);
  const scenarioId = useSetupStore((s) => s.scenarioId);
  const setScenario = useSetupStore((s) => s.setScenario);
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

  // Department → its worker-Mage, for surfacing the ability blurb in the Mage
  // Abilities section. Only the six magic departments have one.
  const mageByDept = useMemo(() => {
    const map = new Map<Department, Mage>();
    for (const pack of packs) {
      if (!selectedPackIds.includes(pack.id)) continue;
      for (const m of pack.mages) {
        if (m.department) map.set(m.department, m);
      }
    }
    return map;
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
      controlledByBot: playerNames.map((_, i) => playerControlledByBot[i] ?? false),
      botPersonalityIds: playerNames.map((_, i) =>
        playerControlledByBot[i] ? (playerBotPersonality[i] ?? 'klank') : undefined,
      ),
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
      ...(scenarioId ? { scenarioId } : {}),
      totalRounds: roundCount,
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
                      {packContentSummary(pack)}
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-medium mb-3">Game Length & Scenario</h2>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm text-slate-300 w-28">Rounds</span>
          <div className="flex gap-2">
            {([5, 6] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={clsx(
                  'px-3 py-1 rounded border text-sm',
                  roundCount === n
                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300',
                  scenarioId !== null && 'opacity-50 cursor-not-allowed',
                )}
                disabled={scenarioId !== null}
                onClick={() => setRoundCount(n)}
              >
                {n} rounds
              </button>
            ))}
          </div>
          {scenarioId !== null && (
            <span className="text-xs text-slate-500">
              Scenarios are always 5 rounds.
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-300 w-28">Scenario</span>
          <select
            className="flex-1 px-3 py-2 rounded border border-slate-700 bg-slate-900 text-sm"
            value={scenarioId ?? ''}
            onChange={(e) => setScenario(e.target.value || null)}
          >
            <option value="">None — normal game</option>
            {listScenarios().map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>
        {scenarioId !== null && (
          <p className="text-sm text-slate-400 mt-2">
            {listScenarios().find((sc) => sc.id === scenarioId)?.description}
          </p>
        )}
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
              <label
                className="flex items-center gap-1.5 text-xs text-slate-400 select-none cursor-pointer whitespace-nowrap"
                title="Let an AI play this seat"
              >
                <input
                  type="checkbox"
                  checked={playerControlledByBot[i] ?? false}
                  onChange={(e) => setPlayerControlledByBot(i, e.target.checked)}
                  className="accent-amber-400"
                />
                🤖 Controlled by bot
              </label>
              <select
                value={playerBotPersonality[i] ?? 'klank'}
                onChange={(e) => setPlayerBotPersonality(i, e.target.value)}
                disabled={!(playerControlledByBot[i] ?? false)}
                title="Which AI personality plays this seat"
                className="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200 focus:border-amber-400/60 focus:outline-none disabled:opacity-40"
              >
                {BOT_PERSONALITY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
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
                const overview = roomOverviewFor(g.name, bSelected ? 'B' : 'A');
                return (
                  <li
                    key={`${g.packId}::${g.name}`}
                    className={clsx(
                      'flex items-start gap-2 px-2 py-1.5 rounded bg-slate-950/40',
                      required && 'border border-white/70',
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="text-sm">
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
                      {overview && (
                        <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">
                          {overview}
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
          The two sides are different abilities — the selected side's effect
          is shown below each department.
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
            const mage = mageByDept.get(dept.id);
            const ability =
              (current === 'B' ? mage?.bDescription : mage?.aDescription) ??
              mage?.description ??
              null;
            return (
              <li
                key={dept.id}
                className="flex items-start gap-2 px-2 py-1.5 rounded bg-slate-950/40"
              >
                <span className="flex-1 min-w-0">
                  <span
                    className={clsx(
                      'text-sm',
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
                  {ability && packActive && (
                    <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">
                      {ability}
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
