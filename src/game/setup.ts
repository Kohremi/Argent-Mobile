import { requirePack } from '../content/registry';
import type {
  BellTowerCard,
  ConsortiumVoter,
  GameConfig,
  GamePhase,
  GameState,
  Player,
  Room,
} from './types';
import {
  createRngState,
  nextRandom,
  shuffleWithState,
} from '../utils/rng';
import { emptyResourceBundle, pickPlayerColor } from '../utils/helpers';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/**
 * Number of physical rooms drawn from the variable pool, by player count
 * (per rulebook clarification). Total rooms in play = this + 3 University
 * Central rooms.
 *
 *   2p: 6 (3 + 6 = 9 — uses the 2-player 3×3 layout variant)
 *   3p: 5 (3 + 5 = 8)
 *   4p: 7 (3 + 7 = 10)
 *   5p: 9 (3 + 9 = 12)
 *
 * 6p assumes Mancers content active and reuses 5p count for now.
 */
function variableRoomCount(playerCount: number): number {
  switch (playerCount) {
    case 2:
      return 6;
    case 3:
      return 5;
    case 4:
      return 7;
    case 5:
      return 9;
    case 6:
      return 9;
    default:
      throw new Error(`Unsupported player count: ${playerCount}`);
  }
}

/** Groups Rooms by physical room (id with `.a`/`.b` stripped). */
function groupRoomsByPhysical(rooms: Room[]): [Room, Room][] {
  const map = new Map<string, { a?: Room; b?: Room }>();
  for (const r of rooms) {
    const baseId = r.id.replace(/\.[ab]$/, '');
    const entry = map.get(baseId) ?? {};
    if (r.side === 'A') entry.a = r;
    else entry.b = r;
    map.set(baseId, entry);
  }
  const result: [Room, Room][] = [];
  for (const [baseId, entry] of map) {
    if (!entry.a || !entry.b) {
      throw new Error(`Room "${baseId}" must declare both A and B sides`);
    }
    result.push([entry.a, entry.b]);
  }
  return result;
}

function isDormitoryPair(pair: [Room, Room]): boolean {
  return pair[0].id.includes('dormitory');
}

function isGreatHallPair(pair: [Room, Room]): boolean {
  return pair[0].id.includes('great-hall');
}

function isInfirmaryPair(pair: [Room, Room]): boolean {
  return pair[0].id.includes('infirmary');
}

/**
 * 2-player variant filters per rulebook:
 *  - Dormitory excluded entirely.
 *  - Great Hall: only side B can be used (force B by replacing the A entry).
 *  - Infirmary: always side B (force B in the UC pair).
 *
 * Returns separate UC + variable lists so the caller can apply player-count
 * draws without mixing.
 */
function applyTwoPlayerVariant(pairs: [Room, Room][]): [Room, Room][] {
  return pairs
    .filter((pair) => !isDormitoryPair(pair))
    .map<[Room, Room]>((pair) => {
      // For the rooms we want to lock to side B, replace the A slot with the
      // B room so the random side pick later resolves to B regardless.
      if (isGreatHallPair(pair) || isInfirmaryPair(pair)) {
        return [pair[1], pair[1]];
      }
      return pair;
    });
}

/**
 * Builds a fresh, valid GameState from the user's setup choices.
 *
 * Wired up:
 *   - Players with empty resource bundles (resource grants per candidate are
 *     deferred until candidate draft).
 *   - Random first player.
 *   - Variable room set: 3 University Central + N from variable pool;
 *     A/B side picked randomly per physical room. 2p variant applies its
 *     specific filters.
 *   - Voters: 2 always-face-up + 10 from face-down pool; 2p removes the
 *     second-place voters before drawing.
 *   - Bell Tower filtered by player count threshold.
 *   - Spell / Vault / Supporter decks shuffled; opening tableaus dealt.
 *
 * Deferred:
 *   - Candidate draft (each player's `candidateId` is `''`).
 *   - Mage allocation (5 mages base / 7 in 2p variant).
 *   - Starting hand / resource grants per candidate.
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

  let rng = createRngState(rngSeed);

  // ---- Players ----
  const players: Player[] = playerNames.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: pickPlayerColor(i),
    candidateId: '',
    candidateStartingSpellId: '',
    resources: emptyResourceBundle(),
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

  // ---- Rooms ----
  let physicalRooms = groupRoomsByPhysical(allRooms);
  if (playerCount === 2) {
    physicalRooms = applyTwoPlayerVariant(physicalRooms);
  }
  const universityCentralPairs = physicalRooms.filter(
    (pair) => pair[0].isUniversityCentral,
  );
  const variablePairs = physicalRooms.filter(
    (pair) => !pair[0].isUniversityCentral,
  );

  const targetVariableCount = variableRoomCount(playerCount);
  const shuffledVariable = shuffleWithState(variablePairs, rng);
  rng = shuffledVariable.state;
  const drawnVariable = shuffledVariable.value.slice(0, targetVariableCount);

  // Pick A or B side for each room in play. (For 2p-locked rooms, the pair
  // is already [B, B] so the pick doesn't matter.)
  const rooms: Room[] = [];
  for (const pair of [...universityCentralPairs, ...drawnVariable]) {
    const sideStep = nextRandom(rng);
    rng = sideStep.state;
    const picked = sideStep.value < 0.5 ? pair[0] : pair[1];
    rooms.push(picked);
  }

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

  const vaultShuffle = shuffleWithState(
    allVault.map((v) => v.id),
    rng,
  );
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
    phase: initialPhase(config, firstPlayerIndex),
    pendingResolutionStack: [],
    activeReactionWindows: [],
    nextSequenceId: 1,
    actionLog: [],
  };
}

function initialPhase(config: GameConfig, firstPlayerIndex: number): GamePhase {
  if (config.useCandidateDraft) {
    return { kind: 'candidate-draft', activePlayerIndex: firstPlayerIndex };
  }
  return { kind: 'round-setup', round: 1 };
}
