import type { ContentPack } from '../types';

// Saturday Knight Special expansion.
// EXPANSION: introduces Knight characters and alternate placement rules — those
// rules will need engine hooks (custom worker placement validators) in addition
// to data entries.
// TODO: knight characters as mages, alternate-rule effects.

export const knightsPack: ContentPack = {
  id: 'knights',
  name: 'Saturday Knight Special',
  description: 'Knight characters and alternate placement rules.',
  mages: [],
  candidates: [],
  rooms: [],
  spells: [],
  legendarySpells: [],
  vaultCards: [],
  supporters: [],
  voters: [],
  bellTowerCards: [],
};
