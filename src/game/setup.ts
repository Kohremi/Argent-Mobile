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
} from './types';
import {
  createRngState,
  nextRandom,
  shuffleWithState,
} from '../utils/rng';
import { pickPlayerColor, startingResourceBundle } from '../utils/helpers';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

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
 * Room layout: every room from the active packs is included, on side A. The
 * earlier random "draw N variable rooms" / per-player-count logic was removed
 * — content is now restricted to the rooms in `argent details.txt`, and the
 * user wants every one visible at game start. Side B variants are kept in
 * the data (for the 2p Infirmary B rule and future wiring) but not selected.
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
    roundPlacements: [],
  }));

  // ---- First player (random per rulebook) ----
  const firstStep = nextRandom(rng);
  rng = firstStep.state;
  const firstPlayerIndex = Math.floor(firstStep.value * playerCount);

  // ---- Rooms — every side-A room from the active packs, in declaration order. ----
  const rooms: Room[] = allRooms.filter((r) => r.side === 'A');

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
    'off-white': 4,
  };
}

function initialPhase(config: GameConfig, firstPlayerIndex: number): GamePhase {
  if (config.useCandidateDraft) {
    return { kind: 'candidate-draft', activePlayerIndex: firstPlayerIndex };
  }
  return { kind: 'round-setup', round: 1 };
}
