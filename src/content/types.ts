import type {
  CouncilTile,
  Familiar,
  Mage,
  PackId,
  Room,
  SpellCard,
  TreasureCard,
} from '../game/types';

/**
 * A self-contained bundle of game content. Adding a new expansion = adding a
 * new pack file in `src/content/packs/` and registering it in `registry.ts`.
 *
 * No engine code should ever switch on `pack.id`. Pack-specific logic lives in
 * effect functions registered through `src/game/effects`.
 */
export interface ContentPack {
  id: PackId;
  name: string;
  description?: string;
  mages: Mage[];
  familiars: Familiar[];
  rooms: Room[];
  spells: SpellCard[];
  treasures: TreasureCard[];
  councils: CouncilTile[];
}
