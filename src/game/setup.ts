import { requirePack } from '../content/registry';
import type {
  BellTowerCard,
  ConsortiumVoter,
  GameConfig,
  GamePhase,
  GameState,
  MageColor,
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
 * Builds the in-play room list for this game:
 *   - All University-Central rooms (Council, Library, Infirmary) on side A.
 *   - Non-UC rooms (side A) shuffled, then drawn until the total reaches
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
  const targetRoomCount =
    config.numberOfRooms ?? defaultRoomCountForPlayerCount(playerCount);
  const allRoomsSideA = allRooms.filter((r) => r.side === 'A');
  const roomSelection = selectInPlayRooms(
    allRoomsSideA,
    targetRoomCount,
    rng,
    'base',
  );
  rng = roomSelection.rng;
  const { cols, rows } = pickGridForRoomCount(roomSelection.rooms.length);
  const grid = placeRoomsInGrid(roomSelection.rooms, cols, rows, rng);
  rng = grid.rng;
  const roomLayout: RoomLayout = { cols, rows, grid: grid.grid };
  // Reorder rooms to match the grid's row-major traversal (left to right,
  // top to bottom). The Resolution pump walks `state.rooms` by index, so
  // this guarantees rooms resolve in the canonical board order regardless
  // of how the random grid placement scrambled the selection list.
  const gridOrderedRooms: Room[] = [];
  const byId = new Map(roomSelection.rooms.map((r) => [r.id, r] as const));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid.grid[r]?.[c];
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
  const spellShuffle = shuffleWithState(
    allSpells.map((s) => s.id),
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
    mageDraftPool: makeInitialMageDraftPool(),
    phase: initialPhase(config, firstPlayerIndex),
    pendingResolutionStack: [],
    activeReactionWindows: [],
    researchQueue: [],
    pendingBellTowerLastEvent: null,
    pendingPlaceChain: null,
    pendingContractResearch: null,
    pendingRevivalChecks: [],
    activeBuffs: [],
    nextSequenceId: 1,
    actionLog: [],
  };
}

function makeInitialMageDraftPool(): Record<MageColor, number> {
  return {
    red: 4,
    grey: 4,
    green: 4,
    blue: 4,
    purple: 4,
    'off-white': 10,
  };
}

function initialPhase(config: GameConfig, firstPlayerIndex: number): GamePhase {
  if (config.useCandidateDraft) {
    return { kind: 'candidate-draft', activePlayerIndex: firstPlayerIndex };
  }
  return { kind: 'round-setup', round: 1 };
}
