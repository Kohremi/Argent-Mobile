import { useMemo, type ReactNode } from 'react';
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
import { useUiStore } from '../../store/uiStore';
import { BOT_PERSONALITY_OPTIONS } from '../../game/ai';
import { randomSeed } from '../../utils/rng';
import type { Department, GameConfig, Mage, RoomId } from '../../game/types';

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

/**
 * Brief, NON-mechanical "what to expect" blurbs per room, keyed by the room's
 * display name. Purely presentational setup-screen flavor (like
 * LAYOUT_MODE_OPTIONS) — the authoritative mechanical text lives on the room's
 * action-space `description`s in the content packs. A room whose two sides
 * differ in feel carries `{ a, b }`; otherwise a single string covers both.
 */
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
    id: 'random',
    title: 'Normal Game — Random',
    description:
      'Shuffle rooms into a randomized grid every game. Room count auto-scales with player count.',
  },
  {
    id: 'first-time',
    title: 'First time playing — 8 Rooms',
    description:
      'Rulebook-recommended beginner board: Vault, Training Fields, Infirmary, Courtyard, Catacombs, Guilds, Library, Council Chamber (all side A).',
  },
  {
    id: 'custom',
    title: 'Select your Layout',
    description:
      'Pick exactly which rooms (and which side, A or B) end up on the board. Selected rooms are shuffled into the grid at game start.',
  },
];

/** A titled section that won't be split across columns in the masonry flow. */
function SetupCard({
  title,
  headerRight,
  className,
  children,
}: {
  title?: string;
  headerRight?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={clsx(
        'mb-4 break-inside-avoid rounded-xl border border-slate-700/70 bg-slate-900/40 p-4 shadow-sm',
        className,
      )}
    >
      {(title || headerRight) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
              {title}
            </h2>
          )}
          {headerRight}
        </div>
      )}
      {children}
    </section>
  );
}

export function SetupScreen({ onQuickStart }: { onQuickStart?: () => void } = {}) {
  const packs = useMemo(() => listPacks(), []);
  const scenarios = useMemo(() => listScenarios(), []);
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
  // Presentation preference (mobile shell), not game config — lives in uiStore.
  const smartCamera = useUiStore((s) => s.smartCamera);
  const setSmartCamera = useUiStore((s) => s.setSmartCamera);

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
  const scenarioActive = scenarioId !== null;
  const selectedScenario = scenarioActive
    ? scenarios.find((sc) => sc.id === scenarioId) ?? null
    : null;
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

  // ── Reusable A/B side toggle (used by custom rooms + mage abilities). ──
  const sideButton = (
    side: 'A' | 'B',
    active: boolean,
    onClick: () => void,
    opts?: {
      disabled?: boolean;
      locked?: boolean;
      label?: string;
      title?: string | undefined;
    },
  ) => (
    <button
      type="button"
      disabled={opts?.disabled}
      onClick={onClick}
      className={clsx(
        'h-6 w-7 rounded text-xs text-center font-semibold border transition-colors',
        active
          ? 'bg-amber-400 text-slate-950 border-amber-300'
          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
        opts?.locked && active && 'cursor-default',
        opts?.disabled &&
          'opacity-40 cursor-not-allowed hover:bg-slate-800',
      )}
      aria-pressed={active}
      aria-label={opts?.label}
      title={opts?.title}
    >
      {side}
    </button>
  );

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100">
      {/* Sticky command bar: identity · decoupled Rounds control · Start. */}
      <header className="sticky top-0 z-10 border-b border-slate-700/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <div className="mr-auto flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold leading-tight">
                Argent: The Consortium
              </h1>
              <p className="text-xs text-slate-400">
                Configure your table — single-player by default, fully customisable.
              </p>
            </div>
            {onQuickStart && (
              <button
                type="button"
                onClick={onQuickStart}
                className="rounded-full bg-slate-800 px-3 py-1.5 text-sm text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
              >
                ⚡ Quick solo
              </button>
            )}
          </div>

          {/* Smart Camera — follow the action on mobile (presentation only). */}
          <label
            className="flex cursor-pointer select-none items-center gap-2"
            title="On phones, auto-jump to the tab where each decision happens — yours and the bots' — and slow bot moves so you can watch."
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Smart Camera
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={smartCamera}
              aria-label="Smart Camera"
              onClick={() => setSmartCamera(!smartCamera)}
              className={clsx(
                'relative h-5 w-9 rounded-full border transition-colors',
                smartCamera
                  ? 'border-amber-300 bg-amber-400'
                  : 'border-slate-600 bg-slate-800',
              )}
            >
              <span
                className={clsx(
                  'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-slate-950 transition-all',
                  smartCamera ? 'left-[1.125rem]' : 'left-0.5',
                )}
              />
            </button>
          </label>

          {/* Rounds — its own small control, independent of the scenario. */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Rounds
            </span>
            <div className="flex overflow-hidden rounded-md border border-slate-700">
              {([5, 6] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={scenarioActive}
                  onClick={() => setRoundCount(n)}
                  className={clsx(
                    'px-3 py-1 text-sm font-medium transition-colors',
                    roundCount === n
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800',
                    scenarioActive && 'opacity-40 cursor-not-allowed',
                  )}
                  title={
                    scenarioActive
                      ? 'Scenarios are always 5 rounds.'
                      : undefined
                  }
                >
                  {n}
                </button>
              ))}
            </div>
            {scenarioActive && (
              <span className="text-[11px] text-slate-500" title="Locked by scenario">
                🔒
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className="rounded-md bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start Game ▸
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-16 pt-5">
        {!canStart && (
          <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-200/90">
            {layoutMode === 'custom' && customRoomIds.length === 0
              ? 'Pick at least one room in Board Layout to start.'
              : 'Give every player a name to start.'}
          </p>
        )}

        {/* Two columns. On mobile the cards stack in source order; on md+ the
            `order` utilities swap the columns so the board/abilities column
            sits on the left and Players is pinned to the top-right. */}
        <div className="grid items-start gap-4 md:grid-cols-2">
          {/* RIGHT column (md+): Players + Expansions & Modules. */}
          <div className="flex min-w-0 flex-col md:order-2">
            {/* ── Players ──────────────────────────────────────────────── */}
            <SetupCard
              title="Players"
            headerRight={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                  onClick={() => setPlayerCount(playerCount - 1)}
                  disabled={playerCount <= PLAYER_COUNT_RANGE.min}
                  aria-label="Remove a player"
                >
                  −
                </button>
                <span className="w-16 text-center text-sm text-slate-300">
                  {playerCount} {playerCount === 1 ? 'player' : 'players'}
                </span>
                <button
                  type="button"
                  className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                  onClick={() => setPlayerCount(playerCount + 1)}
                  disabled={playerCount >= PLAYER_COUNT_RANGE.max}
                  aria-label="Add a player"
                >
                  +
                </button>
              </div>
            }
          >
            <ul className="space-y-2">
              {playerNames.map((name, i) => {
                const isBot = playerControlledByBot[i] ?? false;
                return (
                  <li key={i} className="rounded-lg bg-slate-950/40 p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-right text-xs text-slate-500">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setPlayerName(i, e.target.value)}
                        className="flex-1 rounded bg-slate-900 px-2.5 py-1.5 text-sm border border-slate-700 focus:border-amber-400/60 focus:outline-none"
                        placeholder={`Player ${i + 1}`}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 pl-7">
                      <label
                        className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-400"
                        title="Let an AI play this seat"
                      >
                        <input
                          type="checkbox"
                          checked={isBot}
                          onChange={(e) =>
                            setPlayerControlledByBot(i, e.target.checked)
                          }
                          className="accent-amber-400"
                        />
                        🤖 Bot
                      </label>
                      <select
                        value={playerBotPersonality[i] ?? 'klank'}
                        onChange={(e) =>
                          setPlayerBotPersonality(i, e.target.value)
                        }
                        disabled={!isBot}
                        title="Which AI personality plays this seat"
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-amber-400/60 focus:outline-none disabled:opacity-40"
                      >
                        {BOT_PERSONALITY_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SetupCard>

          {/* ── Expansions & Modules (content packs + scenario) ────────── */}
          <SetupCard title="Expansions & Modules">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Content packs
            </p>
            <ul className="space-y-1.5">
              {packs.map((pack) => {
                const isSelected = selectedPackIds.includes(pack.id);
                const isBase = pack.id === 'base';
                return (
                  <li key={pack.id}>
                    <label
                      className={clsx(
                        'flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                        isSelected
                          ? 'border-amber-400/60 bg-amber-400/5'
                          : 'border-slate-700 bg-slate-900 hover:border-slate-600',
                        !isBase && 'cursor-pointer',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-amber-400"
                        checked={isSelected}
                        disabled={isBase}
                        onChange={() => togglePack(pack.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{pack.name}</span>
                          {isBase && (
                            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
                              required
                            </span>
                          )}
                        </div>
                        {pack.description && (
                          <p className="text-xs leading-snug text-slate-400">
                            {pack.description}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {packContentSummary(pack)}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="my-3 border-t border-slate-700/60" />

            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Scenario module
              </p>
              <span className="text-[10px] text-slate-500">
                campaign overlay · 5 rounds
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {/* "None" is itself a selectable module tile — spans the full
                  width across the top, with a 2×3 grid of scenarios below. */}
              <button
                type="button"
                onClick={() => setScenario(null)}
                className={clsx(
                  'col-span-2 flex items-center justify-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors',
                  !scenarioActive
                    ? 'border-amber-400/60 bg-amber-400/5 text-amber-100'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600',
                )}
                aria-pressed={!scenarioActive}
              >
                <span className="font-medium">None</span>
                <span className="text-[10px] text-slate-500">normal game</span>
              </button>
              {scenarios.map((sc) => {
                const active = scenarioId === sc.id;
                return (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setScenario(sc.id)}
                    className={clsx(
                      'flex min-h-[2.75rem] items-center rounded-lg border px-2.5 py-2 text-left text-sm leading-snug transition-colors',
                      active
                        ? 'border-amber-400/60 bg-amber-400/5 text-amber-100'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600',
                    )}
                    aria-pressed={active}
                  >
                    {sc.name}
                  </button>
                );
              })}
            </div>
            {selectedScenario && (
              <div className="mt-2.5 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5">
                <p className="text-xs leading-snug text-slate-300">
                  {selectedScenario.description}
                </p>
                {(selectedScenario.requiresPackIds?.length ?? 0) > 0 && (
                  <p className="mt-1 text-[11px] text-amber-300/80">
                    Requires the{' '}
                    {selectedScenario.requiresPackIds!.join(', ')} pack
                    (auto-enabled).
                  </p>
                )}
              </div>
            )}
          </SetupCard>
          </div>

          {/* LEFT column (md+): Board Layout + Mage Abilities. */}
          <div className="flex min-w-0 flex-col md:order-1">
            {/* ── Board Layout ────────────────────────────────────────── */}
          <SetupCard title="Board Layout">
            <ul className="space-y-1.5">
              {LAYOUT_MODE_OPTIONS.map(({ id, title, description }) => {
                const isActive = layoutMode === id;
                return (
                  <li key={id}>
                    <label
                      className={clsx(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                        isActive
                          ? 'border-amber-400/60 bg-amber-400/5'
                          : 'border-slate-700 bg-slate-900 hover:border-slate-600',
                      )}
                    >
                      <input
                        type="radio"
                        name="layout-mode"
                        className="mt-0.5 accent-amber-400"
                        checked={isActive}
                        onChange={() => setLayoutMode(id)}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{title}</div>
                        <p className="text-xs leading-snug text-slate-400">
                          {description}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>

            {layoutMode === 'random' && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 p-2.5">
                <div className="pr-3">
                  <p className="text-sm font-medium">Number of rooms</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Auto-set by player count; override manually.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                    onClick={() => setNumberOfRooms(numberOfRooms - 1)}
                    disabled={numberOfRooms <= ROOM_COUNT_RANGE.min}
                    aria-label="Fewer rooms"
                  >
                    −
                  </button>
                  <span className="w-16 text-center text-sm text-slate-300">
                    {numberOfRooms} rooms
                  </span>
                  <button
                    type="button"
                    className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                    onClick={() => setNumberOfRooms(numberOfRooms + 1)}
                    disabled={numberOfRooms >= ROOM_COUNT_RANGE.max}
                    aria-label="More rooms"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {layoutMode === 'custom' && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/40 p-2.5">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">Wired rooms</p>
                  <span className="text-[11px] text-slate-400">
                    {customRoomIds.length} selected
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Click A or B to include that side. The grid is shuffled at
                  game start.
                </p>
                <ul className="mt-2 space-y-1">
                  {wiredRoomGroups.map((g) => {
                    const aSelected =
                      g.sideA !== null && customRoomIds.includes(g.sideA);
                    const bSelected =
                      g.sideB !== null && customRoomIds.includes(g.sideB);
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
                            className="flex h-6 w-7 items-center justify-center rounded border border-slate-800/60 bg-slate-950/40 text-xs text-slate-600"
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
                      return sideButton(side, active, handleClick, {
                        locked: required,
                        label: `Toggle ${g.name} side ${side}`,
                        title:
                          required && active
                            ? `${g.name} is always included — click the other side to flip.`
                            : undefined,
                      });
                    };
                    const overview = roomOverviewFor(
                      g.name,
                      bSelected ? 'B' : 'A',
                    );
                    return (
                      <li
                        key={`${g.packId}::${g.name}`}
                        className={clsx(
                          'flex items-start gap-2 rounded bg-slate-950/40 px-2 py-1.5',
                          required && 'border border-white/40',
                        )}
                      >
                        <span className="min-w-0 flex-1">
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
                            <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
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
                  <p className="mt-2 text-[11px] italic text-rose-300/80">
                    Pick at least one room to start the game.
                  </p>
                )}
              </div>
            )}
          </SetupCard>

          {/* ── Mage Abilities ────────────────────────────────────────── */}
          <SetupCard title="Mage Abilities">
            <p className="-mt-1 mb-2 text-[11px] leading-snug text-slate-400">
              Pick which side of each department's worker-Mage power is in
              play — the two sides are different abilities.
            </p>
            <ul className="space-y-1">
              {ABILITY_DEPARTMENTS.map((dept) => {
                const requiresPack = dept.pack !== undefined;
                const packActive =
                  !requiresPack || selectedPackIds.includes(dept.pack!);
                const current = mageAbilitySides[dept.id];
                const mage = mageByDept.get(dept.id);
                const ability =
                  (current === 'B' ? mage?.bDescription : mage?.aDescription) ??
                  mage?.description ??
                  null;
                return (
                  <li
                    key={dept.id}
                    className="flex items-start gap-2 rounded bg-slate-950/40 px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx('text-sm', !packActive && 'text-slate-500')}
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
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                          {ability}
                        </span>
                      )}
                    </span>
                    {sideButton(
                      'A',
                      current === 'A',
                      () => setMageAbilitySide(dept.id, 'A'),
                      { disabled: !packActive, label: `${dept.label} side A` },
                    )}
                    {sideButton(
                      'B',
                      current === 'B',
                      () => setMageAbilitySide(dept.id, 'B'),
                      { disabled: !packActive, label: `${dept.label} side B` },
                    )}
                  </li>
                );
              })}
            </ul>
          </SetupCard>
          </div>
        </div>
      </main>
    </div>
  );
}
