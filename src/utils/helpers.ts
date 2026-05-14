import type {
  Department,
  MageColor,
  PlayerColor,
  ResourceBundle,
} from '../game/types';
import { PLAYER_COLORS } from '../game/types';

export function emptyResourceBundle(): ResourceBundle {
  return {
    gold: 0,
    mana: 0,
    influence: 0,
    intelligence: 0,
    wisdom: 0,
    marks: 0,
    meritBadges: 0,
    meritBadgesSpent: 0,
  };
}

/**
 * Returns the per-player starting resource bundle (per rulebook):
 *   6 Gold, 2 Mana, 5 IP, 2 INT, 2 WIS, 0 marks, 0 merit badges.
 *
 * Players also begin with 1 Mark to place on a Voter; that placement is
 * handled by the `initial-mark-placement` phase (which increments
 * `resources.marks` to 1 once the player picks a voter).
 */
export function startingResourceBundle(): ResourceBundle {
  return {
    gold: 6,
    mana: 2,
    influence: 5,
    intelligence: 2,
    wisdom: 2,
    marks: 0,
    meritBadges: 0,
    meritBadgesSpent: 0,
  };
}

/** Returns the matching Department for a Mage piece color, or null for off-white. */
export function mageColorToDepartment(color: MageColor): Department | null {
  switch (color) {
    case 'red':
      return 'sorcery';
    case 'grey':
      return 'mysticism';
    case 'green':
      return 'natural-magick';
    case 'purple':
      return 'planar-studies';
    case 'blue':
      return 'divinity';
    case 'off-white':
      return null;
  }
}

/**
 * Picks the player slot color for the i-th seat. Throws on out-of-range
 * indices (callers should clamp player count before getting here).
 */
export function pickPlayerColor(index: number): PlayerColor {
  const c = PLAYER_COLORS[index];
  if (c === undefined) {
    throw new Error(
      `pickPlayerColor: index ${index} out of range (max ${PLAYER_COLORS.length - 1})`,
    );
  }
  return c;
}

export { PLAYER_COLORS };
