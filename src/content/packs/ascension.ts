import type { ContentPack } from '../types';

// Era of Ascension expansion.
// EXPANSION: campaign-style content + alternate voters. Alternate voters likely
// use custom scoring criteria (`ConsortiumVoter.customScoringEffectId`).
// TODO: campaign metadata, alternate voters, expansion mages/spells.

export const ascensionPack: ContentPack = {
  id: 'ascension',
  name: 'Era of Ascension',
  description: 'Campaign-style content and alternate voters.',
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
