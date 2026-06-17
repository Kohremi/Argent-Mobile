// AI personality registry. Add a personality here and it becomes selectable
// in setup and drivable by `useKlankDriver`.
import { klank } from './klank';
import { malfoy } from './malfoy';
import { thickhide } from './thickhide';
import type { BotPersonality } from './types';

export type { BotPersonality } from './types';
export { klank } from './klank';
export { malfoy } from './malfoy';
export { thickhide } from './thickhide';

export const DEFAULT_BOT_PERSONALITY_ID = 'klank';

const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  [klank.id]: klank,
  [malfoy.id]: malfoy,
  [thickhide.id]: thickhide,
};

/** Personalities offered in the setup screen's per-seat picker. */
export const BOT_PERSONALITY_OPTIONS: { id: string; name: string }[] = [
  { id: klank.id, name: klank.name },
  { id: malfoy.id, name: malfoy.name },
  { id: thickhide.id, name: thickhide.name },
];

/** Resolve a personality by id, defaulting to Klank. */
export function getBotPersonality(id?: string): BotPersonality {
  return (id && BOT_PERSONALITIES[id]) || klank;
}
