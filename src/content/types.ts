import type {
  BellTowerCard,
  Candidate,
  ConsortiumVoter,
  Mage,
  PackId,
  Room,
  SpellCard,
  SupporterCard,
  VaultCard,
} from '../game/types';

/**
 * A self-contained bundle of game content. Adding a new expansion = adding a
 * new pack file in `src/content/packs/` and registering it in `registry.ts`.
 *
 * No engine code should ever switch on `pack.id`. Pack-specific logic lives
 * in effect functions registered through `src/game/effects`.
 */
export interface ContentPack {
  id: PackId;
  name: string;
  description?: string;

  /** Mage type definitions (color + department + abilities). */
  mages: Mage[];

  /** Candidate sheets a player can pick at setup. */
  candidates: Candidate[];

  /** Rooms (each typically has both A and B side definitions). */
  rooms: Room[];

  /** Spell cards (3 levels each). */
  spells: SpellCard[];

  /** Legendary spells — held aside, not shuffled into the regular spell deck. */
  legendarySpells: SpellCard[];

  /** Vault cards (treasures + consumables). */
  vaultCards: VaultCard[];

  /** Supporter cards. */
  supporters: SupporterCard[];

  /** Consortium voter tiles. */
  voters: ConsortiumVoter[];

  /** Bell Tower offering cards (round-end timer). */
  bellTowerCards: BellTowerCard[];
}
