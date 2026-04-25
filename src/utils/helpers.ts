import type { PlayerColor, ResourceBundle, VisSupply } from '../game/types';

export const PLAYER_COLORS: readonly PlayerColor[] = [
  'white',
  'black',
  'red',
  'blue',
  'green',
  'purple',
];

export function emptyVisSupply(): VisSupply {
  return { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 };
}

export function emptyResourceBundle(): ResourceBundle {
  return { vis: emptyVisSupply(), gold: 0 };
}
