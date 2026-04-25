import type { ContentPack } from '../types';

// Era of Ascension expansion.
// EXPANSION: campaign-style content + alternate councils. Alternate councils
// likely use custom scoring criteria (CouncilTile.customScoringEffectId).
// TODO: campaign metadata, alternate councils, expansion mages/spells.

export const ascensionPack: ContentPack = {
  id: 'ascension',
  name: 'Era of Ascension',
  description: 'Campaign-style content and alternate councils.',
  mages: [],
  familiars: [],
  rooms: [],
  spells: [],
  treasures: [],
  councils: [],
};
