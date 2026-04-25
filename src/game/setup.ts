import { requirePack } from '../content/registry';
import type { ContentPack } from '../content/types';
import type {
  CouncilTile,
  GameConfig,
  GameState,
  Player,
  Room,
  SpellCard,
  TreasureCard,
} from './types';
import { createRng, shuffle } from '../utils/rng';
import { emptyResourceBundle, PLAYER_COLORS } from '../utils/helpers';

interface AssembledContent {
  rooms: Room[];
  councils: CouncilTile[];
  spells: SpellCard[];
  treasures: TreasureCard[];
}

function assembleContent(activePackIds: string[]): AssembledContent {
  const packs: ContentPack[] = activePackIds.map(requirePack);
  return {
    rooms: packs.flatMap((p) => p.rooms),
    councils: packs.flatMap((p) => p.councils),
    spells: packs.flatMap((p) => p.spells),
    treasures: packs.flatMap((p) => p.treasures),
  };
}

/**
 * Builds a fresh, valid GameState from the user's setup choices.
 *
 * What's actually wired up here:
 *   - Player records with names, colors, starting (empty) resources.
 *   - Active rooms cloned onto the board.
 *   - Active councils sliced to 5 (TODO: real council selection rules).
 *   - Spell + treasure decks shuffled with the seeded RNG.
 *   - Initiative track populated by player order.
 *
 * What's deliberately deferred (TODO):
 *   - Mage draft.
 *   - Familiar assignment.
 *   - Starting hand / starting resource grant per mage.
 *   - Market row population from decks.
 *   - Room action-space initialization for rooms whose data is still empty.
 */
export function buildInitialState(config: GameConfig): GameState {
  const { activePackIds, playerNames, rngSeed, totalRounds = 5 } = config;

  if (playerNames.length < 2 || playerNames.length > 6) {
    throw new Error(
      `buildInitialState: player count must be 2-6, got ${playerNames.length}`,
    );
  }
  if (!activePackIds.includes('base')) {
    throw new Error('buildInitialState: the base pack is required');
  }

  const content = assembleContent(activePackIds);
  const rng = createRng(rngSeed);

  const players: Player[] = playerNames.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: PLAYER_COLORS[i] ?? 'white',
    mages: [], // TODO: assigned during mage draft
    familiars: [],
    resources: emptyResourceBundle(),
    spells: [],
    treasures: [],
    influence: 0,
    initiative: i + 1,
  }));

  const spellDeck = shuffle(
    content.spells.map((s) => s.id),
    rng,
  );
  const treasureDeck = shuffle(
    content.treasures.map((t) => t.id),
    rng,
  );

  // TODO: Argent uses a randomized 5-of-N council selection per game.
  const councils = content.councils.slice(0, 5);

  return {
    players,
    board: { rooms: content.rooms },
    councils,
    initiativeTrack: {
      order: players.map((p) => p.id),
      passed: [],
    },
    round: 0,
    totalRounds,
    phase: 'setup',
    activePlayerIndex: 0,
    spellDeck,
    treasureDeck,
    spellMarket: [],
    treasureMarket: [],
    activePackIds: [...activePackIds],
    rngSeed,
  };
}
