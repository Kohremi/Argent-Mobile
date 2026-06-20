import type {
  BellTowerCard,
  Candidate,
  ConsortiumVoter,
  Mage,
  PackId,
  Room,
  RoomId,
  RoundEndScenario,
  RoundNumber,
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

  /**
   * Optional round-end scenarios — effects that fire in turn order at the end
   * of specific rounds (after resolution + scoring, before the next round is
   * prepared). Summer Break uses these; most packs omit the field.
   */
  roundEndScenarios?: RoundEndScenario[];

  /**
   * Number of rounds this pack wants the game to run. The engine uses the
   * MAX `totalRounds` across active packs (default 5). Summer Break sets 6.
   */
  totalRounds?: RoundNumber;

  /**
   * When any active pack sets this, players begin with only their two
   * candidate starting Mages — the extra snake-draft of three more Mages is
   * skipped. (Summer Break's "Students Return" scenarios hand those Mages out
   * over the first rounds instead.)
   */
  skipInitialMageDraft?: boolean;

  /**
   * Room ids that must be included whenever the random layout is used (in
   * addition to the always-present University-Central rooms). Summer Break
   * guarantees the Dormitory; a future "random + Archmage's Staff" mode could
   * add the Staff room here. Ignored by the first-time / custom layouts (the
   * player already picks rooms there).
   */
  guaranteedRandomRoomIds?: RoomId[];
}
