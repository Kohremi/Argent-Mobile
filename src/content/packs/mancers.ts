import type { ContentPack } from '../types';
import type { Candidate, Department, MageColor } from '../../game/types';

const PACK_ID = 'mancers';

// Mancers of the University expansion.
// Holds the 6 candidates moved out of base.ts per rulebook.
// TODO: mages, additional rooms, spells, supporters, vault cards.

function candidate(args: {
  id: string;
  name: string;
  title: string;
  department: Department;
  starterSpellId: string;
  startingMageColor: MageColor | 'neutral';
  startingExtraMeritBadge: boolean;
}): Candidate {
  return {
    id: args.id,
    name: args.name,
    title: args.title,
    sourcePackId: PACK_ID,
    department: args.department,
    starterSpellId: args.starterSpellId,
    startingMageColor: args.startingMageColor,
    startingExtraMeritBadge: args.startingExtraMeritBadge,
  };
}

// TODO: each candidate's `starterSpellId` should point to a real Mancers
// spell once spell content is sourced. For now they reference base spell
// placeholders so the candidate sheets are valid.
const candidates: Candidate[] = [
  candidate({
    id: 'mancers.candidate.rikhi-kanhamme',
    name: 'Rikhi Kanhamme',
    title: 'Sorcery — Applied',
    department: 'sorcery',
    starterSpellId: 'base.spell.burn',
    startingMageColor: 'red',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'mancers.candidate.mannheim-wildern',
    name: 'Mannheim Wildern',
    title: 'Natural Magick — Development',
    department: 'natural-magick',
    starterSpellId: 'base.spell.placeholder.3',
    startingMageColor: 'green',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'mancers.candidate.monad-riverime',
    name: 'Monad Riverime',
    title: 'Auditor — Students',
    department: 'students',
    starterSpellId: 'base.spell.placeholder.2',
    startingMageColor: 'neutral',
    startingExtraMeritBadge: true,
  }),
  candidate({
    id: 'mancers.candidate.jesca-renetton',
    name: 'Jesca Renetton',
    title: 'Curriculum — Students',
    department: 'students',
    starterSpellId: 'base.spell.placeholder.2',
    startingMageColor: 'neutral',
    startingExtraMeritBadge: true,
  }),
  candidate({
    id: 'mancers.candidate.jion-erjon',
    name: 'Jion Erjon',
    title: 'Divinity — Honor Court',
    department: 'divinity',
    starterSpellId: 'base.spell.placeholder.4',
    startingMageColor: 'blue',
    startingExtraMeritBadge: false,
  }),
  candidate({
    id: 'mancers.candidate.lavanina',
    name: 'Lavanina',
    title: 'Planar Studies',
    department: 'planar-studies',
    starterSpellId: 'base.spell.placeholder.5',
    startingMageColor: 'purple',
    startingExtraMeritBadge: false,
  }),
];

export const mancersPack: ContentPack = {
  id: PACK_ID,
  name: 'Mancers of the University',
  description: 'Additional candidates, mages, spells, supporters, and rooms.',
  mages: [],
  candidates,
  rooms: [],
  spells: [],
  legendarySpells: [],
  vaultCards: [],
  supporters: [],
  voters: [],
  bellTowerCards: [],
};
