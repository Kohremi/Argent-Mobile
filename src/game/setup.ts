import { requirePack } from '../content/registry';
import type {
  BellTowerCard,
  ConsortiumVoter,
  Department,
  GameConfig,
  GamePhase,
  GameState,
  MageAbilitySide,
  MageColor,
  PackId,
  Player,
  Room,
  RoomId,
  RoomLayout,
} from './types';
import {
  createRngState,
  nextRandom,
  shuffleWithState,
} from '../utils/rng';
import type { RngState } from './types';
import { pickPlayerColor, startingResourceBundle } from '../utils/helpers';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/** Hard cap on grid columns ("3 across" per the rulebook layout). */
const MAX_GRID_COLS = 3;

/**
 * Fixed beginner layout for `roomLayoutMode: { kind: 'first-time' }` —
 * all 8 base rooms, side A, listed in grid row-major order (2 cols × 4
 * rows). Matches the rulebook-recommended starter board.
 */
export const FIRST_TIME_LAYOUT_ROOM_IDS: RoomId[] = [
  'base.room.vault.a',
  'base.room.training-fields.a',
  'base.room.infirmary.a',
  'base.room.courtyard.a',
  'base.room.catacombs.a',
  'base.room.guilds.a',
  'base.room.library.a',
  'base.room.council-chamber.a',
];

/**
 * Default number of rooms in play, by player count. Overridable via
 * `GameConfig.numberOfRooms`.
 */
function defaultRoomCountForPlayerCount(playerCount: number): number {
  if (playerCount <= 3) return 8;
  if (playerCount === 4) return 10;
  return 12;
}

/**
 * Pick a grid (cols × rows) that fits `n` rooms with cols ≤ MAX_GRID_COLS,
 * minimizing empty cells, then preferring wider grids over taller ones.
 *
 * Examples:
 *   8  → 2 cols × 4 rows (0 empty)
 *   9  → 3 cols × 3 rows (0 empty)
 *   10 → 2 cols × 5 rows (0 empty; preferred over 3×4 with 2 empty)
 *   11 → 3 cols × 4 rows (1 empty)
 *   12 → 3 cols × 4 rows (0 empty)
 */
export function pickGridForRoomCount(n: number): { cols: number; rows: number } {
  if (n < 1) throw new Error(`pickGridForRoomCount: n must be ≥ 1, got ${n}`);
  // For very small n (< 4), fall back to a single row — 1×n is fine.
  if (n < 4) return { cols: n, rows: 1 };
  // For n ≥ 4, only consider cols ∈ {2, 3}. cols=1 produces a long skinny
  // column the user explicitly doesn't want. Pick min waste, tiebreak max
  // cols (visually compact / square-ish).
  let best: { cols: number; rows: number; waste: number } | null = null;
  for (let cols = 2; cols <= MAX_GRID_COLS; cols++) {
    const rows = Math.ceil(n / cols);
    const waste = cols * rows - n;
    if (
      best === null ||
      waste < best.waste ||
      (waste === best.waste && cols > best.cols)
    ) {
      best = { cols, rows, waste };
    }
  }
  return { cols: best!.cols, rows: best!.rows };
}

/**
 * Builds a placeholder Room used to pad the room pool when the requested
 * room count exceeds the pack's available rooms. Placeholders have no
 * action spaces and are flagged cannotBePlacedInDirectly so they're skipped
 * by the placement / resolution flow.
 */
function makePlaceholderRoom(index: number, packId: string): Room {
  return {
    id: `base.room.placeholder-${index}` as RoomId,
    name: `Placeholder Room ${index}`,
    sourcePackId: packId,
    isUniversityCentral: false,
    side: 'A',
    isInstantRoom: false,
    cannotBePlacedInDirectly: true,
    cannotBeLocked: true,
    actionSpaces: [],
    description: 'Placeholder room — content pending.',
  };
}

/**
 * For random-layout mode: produce a one-side-per-name pool by flipping
 * a coin per room. Both sides must be "playable" (at least one action
 * space, OR `cannotBePlacedInDirectly` like the Infirmary, which is
 * playable via the wound-arrival bonus). If only one side qualifies,
 * it's used unconditionally; if neither does, Side A is the safe
 * fallback. The RNG state is threaded through and returned so the
 * caller can continue advancing it.
 */
function pickRandomSidesForRandom(
  allRooms: Room[],
  rng: RngState,
): { rooms: Room[]; rng: RngState } {
  const byName = new Map<string, Room[]>();
  for (const r of allRooms) {
    const existing = byName.get(r.name) ?? [];
    existing.push(r);
    byName.set(r.name, existing);
  }
  const out: Room[] = [];
  let nextRng = rng;
  const isPlayable = (r: Room | undefined): r is Room =>
    r !== undefined &&
    (r.actionSpaces.length > 0 || r.cannotBePlacedInDirectly);
  for (const sides of byName.values()) {
    const a = sides.find((r) => r.side === 'A');
    const b = sides.find((r) => r.side === 'B');
    const aOk = isPlayable(a);
    const bOk = isPlayable(b);
    if (aOk && bOk) {
      const step = nextRandom(nextRng);
      nextRng = step.state;
      out.push(step.value < 0.5 ? a! : b!);
    } else if (aOk) {
      out.push(a!);
    } else if (bOk) {
      out.push(b!);
    } else if (a) {
      out.push(a);
    } else if (b) {
      out.push(b);
    }
  }
  return { rooms: out, rng: nextRng };
}

/**
 * Builds the in-play room list for this game:
 *   - All University-Central rooms (Council, Library, Infirmary) on side A.
 *   - Non-UC rooms shuffled, then drawn until the total reaches
 *     `targetCount`.
 *   - If pool is smaller than `targetCount`, fill the remainder with
 *     placeholder rooms.
 * Returns the selected rooms plus the updated RNG state.
 */
function selectInPlayRooms(
  allRoomsSideA: Room[],
  targetCount: number,
  rng: RngState,
  packId: string,
): { rooms: Room[]; rng: RngState } {
  const ucRooms = allRoomsSideA.filter((r) => r.isUniversityCentral);
  const nonUcRooms = allRoomsSideA.filter((r) => !r.isUniversityCentral);
  if (ucRooms.length > targetCount) {
    throw new Error(
      `selectInPlayRooms: targetCount=${targetCount} smaller than number of UC rooms (${ucRooms.length})`,
    );
  }
  const remaining = targetCount - ucRooms.length;
  const shuffled = shuffleWithState(nonUcRooms, rng);
  let nextRng = shuffled.state;
  const picked = shuffled.value.slice(0, Math.min(remaining, nonUcRooms.length));
  const selected: Room[] = [...ucRooms, ...picked];
  // Pad with placeholders if pack didn't have enough non-UC rooms.
  let placeholderIdx = 1;
  while (selected.length < targetCount) {
    selected.push(makePlaceholderRoom(placeholderIdx++, packId));
  }
  return { rooms: selected, rng: nextRng };
}

/**
 * Randomly assigns `rooms` to cells of a `cols × rows` grid. Returns a
 * 2D array of RoomId-or-null (empty cells fill from the end). Uses the
 * provided RNG state and returns the post-shuffle state.
 */
function placeRoomsInGrid(
  rooms: Room[],
  cols: number,
  rows: number,
  rng: RngState,
): { grid: (RoomId | null)[][]; rng: RngState } {
  const cellCount = cols * rows;
  if (rooms.length > cellCount) {
    throw new Error(
      `placeRoomsInGrid: ${rooms.length} rooms > ${cellCount} cells`,
    );
  }
  // Shuffle cell indices; rooms[i] lands in shuffledCellIndices[i].
  const cells = Array.from({ length: cellCount }, (_, i) => i);
  const shuffled = shuffleWithState(cells, rng);
  const slots: (RoomId | null)[] = new Array(cellCount).fill(null);
  for (let i = 0; i < rooms.length; i++) {
    slots[shuffled.value[i]!] = rooms[i]!.id;
  }
  const grid: (RoomId | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: (RoomId | null)[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(slots[r * cols + c]!);
    }
    grid.push(row);
  }
  return { grid, rng: shuffled.state };
}

/**
 * Returns the orthogonally-adjacent rooms (up / down / left / right) of
 * `roomId` in the game's grid. Empty cells (null) are treated as walls —
 * adjacency does NOT pass through them. Returns an empty array if the room
 * isn't in the grid.
 */
export function getOrthogonallyAdjacentRoomIds(
  layout: RoomLayout,
  roomId: RoomId,
): RoomId[] {
  let row = -1;
  let col = -1;
  for (let r = 0; r < layout.rows && row === -1; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (layout.grid[r]?.[c] === roomId) {
        row = r;
        col = c;
        break;
      }
    }
  }
  if (row === -1) return [];
  const deltas: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const out: RoomId[] = [];
  for (const [dr, dc] of deltas) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= layout.rows) continue;
    if (nc < 0 || nc >= layout.cols) continue;
    const cell = layout.grid[nr]?.[nc];
    if (cell != null) out.push(cell);
  }
  return out;
}

/**
 * Validates that every physical room has both A and B definitions in the
 * pack data. Currently we only return side A (B sides are stubs); this check
 * exists to catch malformed content.
 */
function assertEveryRoomHasBothSides(rooms: Room[]): void {
  const map = new Map<string, { a?: Room; b?: Room }>();
  for (const r of rooms) {
    const baseId = r.id.replace(/\.[ab]$/, '');
    const entry = map.get(baseId) ?? {};
    if (r.side === 'A') entry.a = r;
    else entry.b = r;
    map.set(baseId, entry);
  }
  for (const [baseId, entry] of map) {
    if (!entry.a || !entry.b) {
      throw new Error(`Room "${baseId}" must declare both A and B sides`);
    }
  }
}

/**
 * Builds a fresh, valid GameState from the user's setup choices.
 *
 * Rooms: All UC rooms (Council / Library / Infirmary) are always in play.
 * Non-UC rooms are shuffled and drawn until the total reaches the requested
 * room count (default 8 / 10 / 12 by player count). If the pack doesn't
 * have enough non-UC rooms, placeholder rooms pad the remainder. Selected
 * rooms are then randomly placed in a cols×rows grid (cols ≤ 3) — the
 * layout drives orthogonal adjacency for spells like Plague / Fireball.
 */
export function buildInitialState(config: GameConfig): GameState {
  const { activePackIds, playerNames, rngSeed } = config;
  const playerCount = playerNames.length;

  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(
      `buildInitialState: player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${playerCount}`,
    );
  }
  if (!activePackIds.includes('base')) {
    throw new Error('buildInitialState: the base pack is required');
  }

  const packs = activePackIds.map(requirePack);
  const allRooms = packs.flatMap((p) => p.rooms);
  const allSpells = packs.flatMap((p) => p.spells);
  const allLegendary = packs.flatMap((p) => p.legendarySpells);
  const allVault = packs.flatMap((p) => p.vaultCards);
  const allSupporters = packs.flatMap((p) => p.supporters);
  const allVoters = packs.flatMap((p) => p.voters);
  const allBellTower = packs.flatMap((p) => p.bellTowerCards);

  assertEveryRoomHasBothSides(allRooms);

  let rng = createRngState(rngSeed);

  // ---- Room selection + grid placement ----
  // Layout mode controls both which rooms are in play AND how they sit on
  // the grid. Defaults to 'random' (legacy behavior) for back-compat with
  // existing tests; the SetupScreen UI offers 'first-time' as the
  // recommended default for new games.
  const layoutMode = config.roomLayoutMode ?? { kind: 'random' };
  const allRoomsById = new Map(allRooms.map((r) => [r.id, r] as const));
  let selectedRooms: Room[];
  let cols: number;
  let rows: number;
  let gridCells: (RoomId | null)[][];

  if (layoutMode.kind === 'first-time' || layoutMode.kind === 'custom') {
    const inputIds =
      layoutMode.kind === 'first-time'
        ? FIRST_TIME_LAYOUT_ROOM_IDS
        : layoutMode.roomIds;
    // 'first-time' uses the exact rulebook order. 'custom' shuffles the
    // user's selection so the player doesn't have to think about grid
    // positioning — they just pick which rooms (and which side) to include.
    let orderedIds: readonly RoomId[];
    if (layoutMode.kind === 'custom') {
      const shuffled = shuffleWithState(inputIds, rng);
      rng = shuffled.state;
      orderedIds = shuffled.value;
    } else {
      orderedIds = inputIds;
    }
    selectedRooms = orderedIds.map((rid) => {
      const r = allRoomsById.get(rid);
      if (!r) {
        throw new Error(
          `buildInitialState: room ${rid} not found in any active pack`,
        );
      }
      return r;
    });
    const dims = pickGridForRoomCount(selectedRooms.length);
    cols = dims.cols;
    rows = dims.rows;
    // Row-major fill: first N cells of the grid get the rooms in order,
    // any leftover cells are null.
    const flat: (RoomId | null)[] = new Array(cols * rows).fill(null);
    for (let i = 0; i < selectedRooms.length; i++) {
      flat[i] = selectedRooms[i]!.id;
    }
    gridCells = [];
    for (let r = 0; r < rows; r++) {
      const row: (RoomId | null)[] = [];
      for (let c = 0; c < cols; c++) {
        row.push(flat[r * cols + c]!);
      }
      gridCells.push(row);
    }
  } else {
    // Random mode. For each named room, flip a coin between Side A and
    // Side B (per the rulebook's setup variant), then shuffle / draw
    // the target count from that pool. Both sides of every base room
    // are wired, so the flip is fair across the board; the picker
    // gracefully falls back if a future expansion pack ships a
    // one-sided room.
    const targetRoomCount =
      config.numberOfRooms ?? defaultRoomCountForPlayerCount(playerCount);
    const sidePick = pickRandomSidesForRandom(allRooms, rng);
    rng = sidePick.rng;
    const roomSelection = selectInPlayRooms(
      sidePick.rooms,
      targetRoomCount,
      rng,
      'base',
    );
    rng = roomSelection.rng;
    const dims = pickGridForRoomCount(roomSelection.rooms.length);
    cols = dims.cols;
    rows = dims.rows;
    const grid = placeRoomsInGrid(roomSelection.rooms, cols, rows, rng);
    rng = grid.rng;
    gridCells = grid.grid;
    selectedRooms = roomSelection.rooms;
  }

  const roomLayout: RoomLayout = { cols, rows, grid: gridCells };
  // Reorder rooms to match the grid's row-major traversal (left to right,
  // top to bottom). The Resolution pump walks `state.rooms` by index, so
  // this guarantees rooms resolve in the canonical board order regardless
  // of how the random grid placement scrambled the selection list.
  const gridOrderedRooms: Room[] = [];
  const byId = new Map(selectedRooms.map((r) => [r.id, r] as const));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = gridCells[r]?.[c];
      if (cell == null) continue;
      const room = byId.get(cell);
      if (room) gridOrderedRooms.push(room);
    }
  }

  // ---- Players ----
  const players: Player[] = playerNames.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: pickPlayerColor(i),
    candidateId: '',
    candidateStartingSpellId: '',
    resources: startingResourceBundle(),
    mages: [],
    ownedSpells: [],
    vaultCards: [],
    supporters: [],
    personalDiscard: [],
    bellTowerCards: [],
    initiativeOrder: i + 1,
    influenceArrivalSeq: 0,
  }));

  // ---- First player (random per rulebook) ----
  const firstStep = nextRandom(rng);
  rng = firstStep.state;
  const firstPlayerIndex = Math.floor(firstStep.value * playerCount);

  const rooms: Room[] = gridOrderedRooms;

  // ---- Voters ----
  let faceDownPool = allVoters.filter((v) => !v.isAlwaysFaceUp);
  if (playerCount === 2) {
    // 2-player variant excludes second-place voters per rulebook.
    faceDownPool = faceDownPool.filter(
      (v) =>
        v.criterion !== 'second-most-influence' &&
        v.criterion !== 'second-most-supporters',
    );
  }
  const faceUpVoters = allVoters
    .filter((v) => v.isAlwaysFaceUp)
    .map((v): ConsortiumVoter => ({ ...v, revealed: true }));
  const shuffledVoters = shuffleWithState(faceDownPool, rng);
  rng = shuffledVoters.state;
  const drawnFaceDown = shuffledVoters.value
    .slice(0, 10)
    .map((v): ConsortiumVoter => ({ ...v, revealed: false }));
  const voters: ConsortiumVoter[] = [...faceUpVoters, ...drawnFaceDown];

  // ---- Bell Tower ----
  const bellAvailable: BellTowerCard[] = allBellTower.filter(
    (c) => c.minPlayers <= playerCount,
  );

  // ---- Decks & opening tableaus ----
  // Defensive: never shuffle a UNIQUE leader spell into the draftable
  // pool even if a pack mistakenly lists one under `spells` instead of
  // `legendarySpells`. Leader spells belong only to their candidate's
  // player (set up at allocation) and must not be acquirable by others.
  const spellShuffle = shuffleWithState(
    allSpells.filter((s) => !s.unique).map((s) => s.id),
    rng,
  );
  rng = spellShuffle.state;
  const spellTableau = spellShuffle.value.slice(0, 3);
  const spellDeck = spellShuffle.value.slice(3);

  // Expand the vault deck by each card's `copies` count (default 1).
  const vaultExpanded: string[] = [];
  for (const v of allVault) {
    for (let i = 0; i < (v.copies ?? 1); i++) {
      vaultExpanded.push(v.id);
    }
  }
  const vaultShuffle = shuffleWithState(vaultExpanded, rng);
  rng = vaultShuffle.state;
  const vaultTableau = vaultShuffle.value.slice(0, 3);
  const vaultDeck = vaultShuffle.value.slice(3);

  const supporterShuffle = shuffleWithState(
    allSupporters.map((s) => s.id),
    rng,
  );
  rng = supporterShuffle.state;
  const supporterTableau = supporterShuffle.value.slice(0, 5);
  const supporterDeck = supporterShuffle.value.slice(5);

  return {
    players,
    firstPlayerIndex,
    activePackIds: [...activePackIds],
    rngSeed,
    rng,
    rooms,
    roomLayout,
    voters,
    voterMarks: [],
    spellDeck,
    spellTableau,
    vaultDeck,
    vaultTableau,
    supporterDeck,
    supporterTableau,
    legendarySpells: allLegendary.map((s) => s.id),
    bellTower: { available: bellAvailable, taken: [] },
    archmagesApprenticeOwner: null,
    roomLocks: [],
    oncePerGameSpellsCast: [],
    astronomyTowerMarker: 0,
    mageAbilitySides: makeMageAbilitySides(config.mageAbilitySides),
    mageDraftPool: makeInitialMageDraftPool(config.activePackIds),
    phase: initialPhase(config, firstPlayerIndex),
    pendingResolutionStack: [],
    activeReactionWindows: [],
    researchQueue: [],
    pendingBellTowerLastEvent: null,
    pendingPlaceChain: null,
    pendingContractResearch: null,
    pendingRevivalChecks: [],
    pendingMysticismPostCast: [],
    pendingTechnomancyTrigger: [],
    vaultARevealed: null,
    tavernARevealed: null,
    adventuringBPool: null,
    activeBuffs: [],
    nextSequenceId: 1,
    actionLog: [],
  };
}

/**
 * Initial Mage piece supply. Base pack seeds 4 of each base colour + 10
 * neutrals. Orange (Technomancy) only appears when the Mancers pack is
 * active — the pool stays at 0 otherwise so neither the candidate
 * allocator nor the Dormitory colour picker offer it without Mancers
 * seated.
 */
function makeInitialMageDraftPool(
  activePackIds: PackId[],
): Record<MageColor, number> {
  const hasMancers = activePackIds.includes('mancers');
  return {
    red: 4,
    grey: 4,
    green: 4,
    blue: 4,
    purple: 4,
    orange: hasMancers ? 4 : 0,
    // Rainbow is the Archmage's Apprentice — it doesn't live in a
    // supply. Owners are tracked via `state.archmagesApprenticeOwner`.
    rainbow: 0,
    'off-white': 10,
  };
}

/**
 * Builds the per-department worker-Mage ability side record. Every department
 * defaults to Side A; `overrides` (from the setup screen) can flip individual
 * departments to Side B.
 */
function makeMageAbilitySides(
  overrides?: Partial<Record<Department, MageAbilitySide>>,
): Record<Department, MageAbilitySide> {
  const base: Record<Department, MageAbilitySide> = {
    sorcery: 'A',
    mysticism: 'A',
    'natural-magick': 'A',
    'planar-studies': 'A',
    divinity: 'A',
    technomancy: 'A',
    students: 'A',
    wild: 'A',
  };
  return { ...base, ...overrides };
}

function initialPhase(config: GameConfig, firstPlayerIndex: number): GamePhase {
  if (config.useCandidateDraft) {
    return { kind: 'candidate-draft', activePlayerIndex: firstPlayerIndex };
  }
  return { kind: 'round-setup', round: 1 };
}
