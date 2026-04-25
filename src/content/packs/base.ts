import type { ContentPack } from '../types';
import type { Mage, Room, SpellCard, CouncilTile } from '../../game/types';

const PACK_ID = 'base';

// ---------- Mages ----------
// Real names from the base game; abilities are stubs to be filled in once the
// effect system supports the relevant trigger timings.
const mages: Mage[] = [
  {
    id: 'base.mage.hand-of-the-apprentice',
    name: 'The Hand of the Apprentice',
    sourcePackId: PACK_ID,
    abilities: [
      // TODO: implement passive ability — extra action / familiar at start.
    ],
  },
  {
    id: 'base.mage.bookworm',
    name: 'The Bookworm',
    sourcePackId: PACK_ID,
    abilities: [
      // TODO: spell-related bonus when placing in library-type rooms.
    ],
  },
  {
    id: 'base.mage.master-of-coin',
    name: 'The Master of Coin',
    sourcePackId: PACK_ID,
    abilities: [
      // TODO: gold/treasure-related bonus.
    ],
  },
  {
    id: 'base.mage.champion-of-the-faith',
    name: 'The Champion of the Faith',
    sourcePackId: PACK_ID,
    abilities: [
      // TODO: chapel/influence-related bonus.
    ],
  },
];

// ---------- Rooms ----------
// Real base-game room names. Action spaces are TODO until the effect IDs they
// reference are registered.
const rooms: Room[] = [
  {
    id: 'base.room.great-library',
    name: 'The Great Library',
    sourcePackId: PACK_ID,
    actionSpaces: [
      // TODO: draw spells, search deck, scry, etc.
    ],
  },
  {
    id: 'base.room.vault',
    name: 'The Vault',
    sourcePackId: PACK_ID,
    actionSpaces: [
      // TODO: gain gold, buy treasures.
    ],
  },
  {
    id: 'base.room.chapel',
    name: 'The Chapel',
    sourcePackId: PACK_ID,
    actionSpaces: [
      // TODO: gain influence, mid-game scoring trigger.
    ],
  },
  {
    id: 'base.room.bell-tower',
    name: 'The Bell Tower',
    sourcePackId: PACK_ID,
    actionSpaces: [
      // TODO: initiative manipulation.
    ],
  },
];

// ---------- Spells ----------
// Real base-game spell names; effect IDs are TODO until effect functions are
// implemented in `src/game/effects/base.ts`.
const spells: SpellCard[] = [
  {
    id: 'base.spell.burn',
    name: 'Burn',
    sourcePackId: PACK_ID,
    visCost: { red: 1 },
    type: 'instant',
    effectId: 'base.spell.burn', // TODO: register effect
  },
  {
    id: 'base.spell.heal',
    name: 'Heal',
    sourcePackId: PACK_ID,
    visCost: { green: 1 },
    type: 'instant',
    effectId: 'base.spell.heal', // TODO: register effect
  },
  {
    id: 'base.spell.time-stop',
    name: 'Time Stop',
    sourcePackId: PACK_ID,
    visCost: { yellow: 2 },
    type: 'instant',
    effectId: 'base.spell.time-stop', // TODO: register effect
  },
  {
    id: 'base.spell.reanimate',
    name: 'Reanimate',
    sourcePackId: PACK_ID,
    visCost: { purple: 1 },
    type: 'ongoing',
    effectId: 'base.spell.reanimate', // TODO: register effect
  },
  {
    id: 'base.spell.wash',
    name: 'Wash',
    sourcePackId: PACK_ID,
    visCost: { blue: 1 },
    type: 'instant',
    effectId: 'base.spell.wash', // TODO: register effect
  },
];

// ---------- Council tiles ----------
// Five council tiles with real scoring criteria. Vote counts are TODO — Argent
// uses 1–3 votes per council with a specific distribution per rulebook.
const councils: CouncilTile[] = [
  {
    id: 'base.council.treasurer',
    name: 'The Voice of the Treasurer',
    sourcePackId: PACK_ID,
    scoringCriterion: 'most-gold',
    votes: 0, // TODO: set per rulebook
    revealed: false,
  },
  {
    id: 'base.council.librarian',
    name: 'The Voice of the Librarian',
    sourcePackId: PACK_ID,
    scoringCriterion: 'most-spells',
    votes: 0, // TODO
    revealed: false,
  },
  {
    id: 'base.council.quartermaster',
    name: 'The Voice of the Quartermaster',
    sourcePackId: PACK_ID,
    scoringCriterion: 'most-treasures',
    votes: 0, // TODO
    revealed: false,
  },
  {
    id: 'base.council.diplomat',
    name: 'The Voice of the Diplomat',
    sourcePackId: PACK_ID,
    scoringCriterion: 'most-influence',
    votes: 0, // TODO
    revealed: false,
  },
  {
    id: 'base.council.stargazer',
    name: 'The Voice of the Stargazer',
    sourcePackId: PACK_ID,
    scoringCriterion: 'most-vis',
    votes: 0, // TODO
    revealed: false,
  },
];

export const baseGamePack: ContentPack = {
  id: PACK_ID,
  name: 'Argent: The Consortium',
  description: 'Core mages, rooms, spells, and councils.',
  mages,
  familiars: [],
  rooms,
  spells,
  treasures: [],
  councils,
};
