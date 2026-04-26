import { requirePack } from '../content/registry';
import type {
  BellTowerCard,
  ConsortiumVoter,
  GameConfig,
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
 * Number of physical rooms drawn from the variable pool, by player count.
 *
 * NOTE on player counts:
 *   - 2p uses the 4p layout per the prompt; the rulebook actually has a
 *     bespoke 2p variant (TODO: implement).
 *   - 6p assumes Mancers content is active and reuses the 5p count for now.
 *
 * NOTE on these specific values: the prompt reads "8 rooms for 3p, 10 for 4p,
 * 12 for 5p (per rulebook)" as the count of *additional* rooms drawn from the
 * variable pool, on top of the 3 always-present University Central rooms. If
 * the rulebook actually means 8/10/12 total rooms in play (i.e., variable
 * = total − 3), we'll need to revise this. Flagged in Open Questions.
 */
function variableRoomCount(playerCount: number): number {
  switch (playerCount) {
    case 2:
      return 10;
    case 3:
      return 8;
    case 4:
      return 10;
    case 5:
      return 12;
    case 6:
      return 12;
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

/**
 * Builds a fresh, valid GameState from the user's setup choices.
 *
 * What's wired up:
 *   - Players (with starting empty resources, no mages/spells/etc — drafts deferred).
 *   - Random first player.
 *   - Variable room set: all 3 University Central rooms + N from the variable
 *     pool (N depends on player count); for each physical room, A or B side
 *     is picked randomly.
 *   - Voters: 2 always-face-up + 10 randomly drawn from the face-down pool.
 *   - Bell Tower: filtered by player count threshold.
 *   - Spell / Vault / Supporter decks shuffled; opening tableaus dealt
 *     (3 / 3 / 5 cards respectively, or fewer if the deck is empty).
 *   - Initial phase: round-setup, round 1.
 *
 * Deferred to later prompts:
 *   - Candidate selection / draft (each player's `candidateId` is `''`).
 *   - Mage allocation (each player starts with `mages: []`).
 *   - Starting hand / resource grants per candidate.
 *   - 2p layout variant.
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
    // TODO: candidate draft — set candidateId to drafted candidate.
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
  }));

  // ---- First player (random per rulebook) ----
  const firstStep = nextRandom(rng);
  rng = firstStep.state;
  const firstPlayerIndex = Math.floor(firstStep.value * playerCount);

  // ---- Rooms ----
  const physicalRooms = groupRoomsByPhysical(allRooms);
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

  // Pick A or B side for each room in play.
  const rooms: Room[] = [];
  for (const pair of [...universityCentralPairs, ...drawnVariable]) {
    const sideStep = nextRandom(rng);
    rng = sideStep.state;
    const picked = sideStep.value < 0.5 ? pair[0] : pair[1];
    rooms.push(picked);
  }

  // ---- Voters ----
  const faceUpVoters = allVoters
    .filter((v) => v.isAlwaysFaceUp)
    .map((v): ConsortiumVoter => ({ ...v, revealed: true }));
  const faceDownPool = allVoters.filter((v) => !v.isAlwaysFaceUp);
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
    phase: { kind: 'round-setup', round: 1 },
    pendingResolution: null,
    actionLog: [],
  };
}
