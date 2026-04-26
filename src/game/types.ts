// All shared game types live here.
//
// Vocabulary follows the Argent: The Consortium rulebook (no placeholder
// terms from other games). Every content-bearing entity carries a
// `sourcePackId` so the UI can badge expansion content and the engine can
// validate references against the active pack list.

// ============================================================================
// Identifiers
// ============================================================================

export type PackId = string;
export type ContentPackId = PackId;
export type PlayerId = string;
export type CandidateId = string;
export type MageCardId = string;
export type OwnedMageId = string;
export type RoomId = string;
export type ActionSpaceId = string;
export type SpellCardId = string;
export type VaultCardId = string;
export type SupporterCardId = string;
export type ConsortiumVoterId = string;
export type BellTowerCardId = string;
export type EffectId = string;
export type AbilityId = string;
export type ActionLogId = string;

// ============================================================================
// Departments & Mage colors
// ============================================================================

export type Department =
  | 'sorcery' // Red
  | 'mysticism' // Grey
  | 'natural-magick' // Green
  | 'planar-studies' // Purple
  | 'divinity' // Blue
  | 'students'; // Off-white / neutral candidates

export const DEPARTMENTS: readonly Department[] = [
  'sorcery',
  'mysticism',
  'natural-magick',
  'planar-studies',
  'divinity',
  'students',
];

/**
 * Mage piece colors. Each maps 1:1 to a Department except `off-white`, which
 * is neutral. Ability summary by color (per rulebook):
 *  - red:       Ars Magna — wound a Mage and take its slot
 *  - blue:      immune to rival spells
 *  - green:     cannot be wounded
 *  - purple:    place as a fast action
 *  - grey:      may place after casting a spell
 *  - off-white: no department ability
 */
export type MageColor = 'red' | 'grey' | 'green' | 'purple' | 'blue' | 'off-white';

export const MAGE_COLORS: readonly MageColor[] = [
  'red',
  'grey',
  'green',
  'purple',
  'blue',
  'off-white',
];

// ============================================================================
// Resources
// ============================================================================

/**
 * Storable resources sitting in a player's office.
 *
 * Notes:
 *  - INT/WIS placed onto a Spell to research it live on the OwnedSpell, NOT here.
 *  - Research is a transient "use it or lose it" effect — never stored here.
 *  - Mana / Influence / IP have a board cap (Influence Track is a stack); the
 *    cap is enforced by effect logic, not by the type.
 */
export interface ResourceBundle {
  gold: number;
  mana: number;
  influence: number;
  intelligence: number;
  wisdom: number;
  marks: number;
  meritBadges: number;
  meritBadgesSpent: number;
}

// ============================================================================
// Player & player-side instances
// ============================================================================

/**
 * Slot color for a player's pieces (Mana discs, IP marker, etc.). Independent
 * of MageColor — these are arbitrary identity colors so 6 players can be
 * distinguished, not in-game departments.
 */
export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export const PLAYER_COLORS: readonly PlayerColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
];

/** A Mage instance owned by a player (distinct from the Mage card definition). */
export interface OwnedMage {
  id: OwnedMageId;
  cardId: MageCardId;
  color: MageColor;
  location: MageLocation;
  isShadowing: boolean;
  isWounded: boolean;
}

export type MageLocation =
  | { kind: 'office'; playerId: PlayerId }
  | { kind: 'action-space'; spaceId: ActionSpaceId }
  | { kind: 'infirmary'; slot?: number }
  | { kind: 'banished' };

/**
 * A Spell instance owned by a player. Research tokens (INT for level 1, WIS
 * for level 2 / level 3) flip booleans here. The card definition stays in the
 * content pack.
 */
export interface OwnedSpell {
  cardId: SpellCardId;
  intPlaced: boolean;
  wisPlacedLevel2: boolean;
  wisPlacedLevel3: boolean;
  exhausted: boolean;
}

/**
 * A Vault card sitting in a player's office. Treasures track exhaustion;
 * consumables don't (they're discarded after use).
 *
 * NOTE: this is a wrapper around the content-pack VaultCard definition, so the
 * card's static data lives once in content and the instance only carries
 * mutable state. The prompt's `vaultCards: VaultCard[]` shape was ambiguous
 * about where exhaustion lives — wrapping it here mirrors how OwnedSpell
 * relates to SpellCard.
 */
export interface OwnedVaultCard {
  cardId: VaultCardId;
  exhausted: boolean;
}

export type DiscardEntry =
  | { kind: 'supporter'; cardId: SupporterCardId }
  | { kind: 'consumable'; cardId: VaultCardId }
  /** Face-down "secret" supporters — opponents may not peek. */
  | { kind: 'secret-supporter'; cardId: SupporterCardId };

export interface Player {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  candidateId: CandidateId;
  /**
   * The candidate's starting Spell. Never lost, never counted toward
   * "Most Spells" type voters per rulebook.
   */
  candidateStartingSpellId: SpellCardId;
  resources: ResourceBundle;
  mages: OwnedMage[];
  ownedSpells: OwnedSpell[];
  vaultCards: OwnedVaultCard[];
  /** Supporter cards in the player's office (not yet used). */
  supporters: SupporterCardId[];
  /** Used Supporters and Consumables. Counts for end-game scoring. */
  personalDiscard: DiscardEntry[];
  /** Bell Tower offerings claimed during the current round. */
  bellTowerCards: BellTowerCardId[];
  initiativeOrder: number;
}

// ============================================================================
// Content cards (definitions in content packs; stable across the game)
// ============================================================================

export type SpellTiming = 'action' | 'fast-action' | 'reaction';

export interface SpellLevel {
  level: 1 | 2 | 3;
  title: string;
  manaCost: number;
  effectId: EffectId;
  timing: SpellTiming;
}

export interface SpellCard {
  id: SpellCardId;
  name: string;
  sourcePackId: PackId;
  department: Department;
  /** Exactly three levels per rulebook. */
  levels: [SpellLevel, SpellLevel, SpellLevel];
}

export type VaultCardType = 'treasure' | 'consumable';

export interface VaultCard {
  id: VaultCardId;
  name: string;
  sourcePackId: PackId;
  type: VaultCardType;
  goldCost: number;
  effectId: EffectId;
  timing?: 'reaction' | 'fast-action';
}

export interface SupporterCard {
  id: SupporterCardId;
  name: string;
  sourcePackId: PackId;
  department: Department;
  effectId: EffectId;
  timing?: 'fast-action' | 'reaction';
}

export interface MageAbility {
  id: AbilityId;
  name: string;
  description: string;
  effectId?: EffectId;
}

/**
 * Definition of a Mage type (e.g., "Red Sorcery Mage"). Owned instances are
 * `OwnedMage`. The two A/B power slots correspond to the rulebook's
 * room-side toggling — a Mage exposes different abilities depending on which
 * side of the room it's placed in.
 */
export interface Mage {
  id: MageCardId;
  name: string;
  sourcePackId: PackId;
  color: MageColor;
  /** Null only for off-white neutral mages. */
  department: Department | null;
  aPowerEffectId?: EffectId;
  bPowerEffectId?: EffectId;
  /** Free-form ability description shown in the UI. */
  description?: string;
  abilities?: MageAbility[];
  portrait?: string;
}

/**
 * A candidate sheet — the role a player picks at setup. Determines starting
 * resources, Mage distribution, and starting Spell.
 */
export interface Candidate {
  id: CandidateId;
  name: string;
  title: string;
  sourcePackId: PackId;
  department: Department;
  starterSpellId: SpellCardId;
  /**
   * Color of the bonus Mages this candidate starts with (typically two of the
   * department color). Students candidates get an extra Merit Badge instead.
   */
  startingMageColor: MageColor;
  /** Free-form ability description. */
  description?: string;
}

// ============================================================================
// Rooms & action spaces
// ============================================================================

export type ActionSpaceSlotType =
  | 'regular'
  | 'merit'
  | 'shadow'
  | 'shadow-merit'
  | 'wound';

export interface ActionSpaceCost {
  meritBadges?: number;
  gold?: number;
  mana?: number;
}

export interface WorkerOccupancy {
  mageId: OwnedMageId;
  ownerId: PlayerId;
  /** True if this is a shadow / shadow-merit slot occupant. */
  isShadowing: boolean;
}

export interface ActionSpace {
  id: ActionSpaceId;
  roomId: RoomId;
  /** Top-to-bottom order within room (0 = topmost). */
  index: number;
  slotType: ActionSpaceSlotType;
  occupant: WorkerOccupancy | null;
  effectId: EffectId;
  costToActivate?: ActionSpaceCost;
}

export interface Room {
  id: RoomId;
  name: string;
  sourcePackId: PackId;
  /** Council Chamber, Library, Infirmary — always in every game. */
  isUniversityCentral: boolean;
  side: 'A' | 'B';
  /** Errands resolve at placement, not in Resolution Phase. */
  isInstantRoom: boolean;
  /** True for Infirmary — Mages cannot be placed there directly. */
  cannotBePlacedInDirectly: boolean;
  /** True for Infirmary — never lockable. */
  cannotBeLocked: boolean;
  actionSpaces: ActionSpace[];
  /** Optional setup-phase effect (e.g., Astronomy Tower B marker reset). */
  setupEffectId?: EffectId;
}

// ============================================================================
// Voters (Consortium board) & Bell Tower
// ============================================================================

/**
 * Built-in scoring criteria. Expansion content can declare `'custom'` and
 * provide a `customScoringEffectId` that returns the per-player score.
 */
export type ScoringCriterion =
  | 'most-supporters'
  | 'most-influence'
  | 'second-most-supporters'
  | 'second-most-influence'
  | 'most-mana'
  | 'most-gold'
  | 'most-marks'
  | 'most-intelligence'
  | 'most-wisdom'
  | 'most-research'
  | 'most-treasures'
  | 'most-consumables'
  | 'most-diversity'
  | 'most-sorcery'
  | 'most-mysticism'
  | 'most-natural-magick'
  | 'most-planar-studies'
  | 'most-divinity'
  | 'custom';

export interface ConsortiumVoter {
  id: ConsortiumVoterId;
  name: string;
  sourcePackId: PackId;
  criterion: ScoringCriterion;
  /** Vote count printed on the tile. TODO: real values from card images. */
  votes: number;
  /** True from setup if the voter is one of the always-face-up pair. */
  isAlwaysFaceUp: boolean;
  revealed: boolean;
  /** Used when `criterion === 'custom'`. */
  customScoringEffectId?: EffectId;
}

export interface VoterMark {
  voterId: ConsortiumVoterId;
  playerId: PlayerId;
}

export interface BellTowerCard {
  id: BellTowerCardId;
  name: string;
  sourcePackId: PackId;
  effectId: EffectId;
  /** Card is included only when the game has at least this many players. */
  minPlayers: 2 | 3 | 4 | 5;
}

// ============================================================================
// Phase machine
// ============================================================================

export type RoundNumber = 1 | 2 | 3 | 4 | 5;

export type GamePhase =
  | { kind: 'setup' }
  | { kind: 'round-setup'; round: RoundNumber }
  | { kind: 'errands'; round: RoundNumber; activePlayerIndex: number }
  | {
      kind: 'resolution';
      round: RoundNumber;
      pendingRoomIndex: number;
      pendingSpaceIndex: number;
    }
  | { kind: 'mid-game-scoring'; round: RoundNumber }
  | { kind: 'final-scoring' }
  | { kind: 'complete'; archmage: PlayerId | null };

// ============================================================================
// RNG
// ============================================================================

/**
 * Serializable RNG state. Carries the seed (for diagnostics / replay reset)
 * plus the current mulberry32 counter. Engine code threads this through state
 * rather than using a closure so games can be saved / restored mid-flight.
 */
export interface RngState {
  seed: number;
  counter: number;
}

// ============================================================================
// Action log
// ============================================================================

export interface ActionLogEntry {
  id: ActionLogId;
  round: RoundNumber | 0;
  phaseKind: GamePhase['kind'];
  message: string;
  // TODO: structured payload for replay.
}

// ============================================================================
// GameState
// ============================================================================

export interface GameState {
  players: Player[];
  firstPlayerIndex: number;
  activePackIds: PackId[];
  rngSeed: number;
  rng: RngState;

  /** Rooms in row-major board order. */
  rooms: Room[];

  /** All voters in play this game (12 in base: 2 face-up + 10 face-down). */
  voters: ConsortiumVoter[];
  voterMarks: VoterMark[];

  spellDeck: SpellCardId[];
  spellTableau: SpellCardId[];
  vaultDeck: VaultCardId[];
  vaultTableau: VaultCardId[];
  supporterDeck: SupporterCardId[];
  supporterTableau: SupporterCardId[];
  /** Legendary spells are not shuffled into the regular spell deck. */
  legendarySpells: SpellCardId[];

  bellTower: {
    available: BellTowerCard[];
    taken: { cardId: BellTowerCardId; takenBy: PlayerId }[];
  };

  archmagesApprenticeOwner: PlayerId | null;
  roomLocks: { roomId: RoomId }[];

  phase: GamePhase;
  pendingResolution: PendingResolution | null;

  actionLog: ActionLogEntry[];
}

// ============================================================================
// Game configuration / actions
// ============================================================================

export interface GameConfig {
  activePackIds: PackId[];
  playerNames: string[];
  rngSeed: number;
}

export interface PlaceWorkerAction {
  type: 'PLACE_WORKER';
  playerId: PlayerId;
  mageId: OwnedMageId;
  actionSpaceId: ActionSpaceId;
  isShadowing?: boolean;
}

export interface CastSpellAction {
  type: 'CAST_SPELL';
  playerId: PlayerId;
  spellCardId: SpellCardId;
  level: 1 | 2 | 3;
  choices?: unknown;
}

export interface BuyVaultCardAction {
  type: 'BUY_VAULT_CARD';
  playerId: PlayerId;
  vaultCardId: VaultCardId;
}

export interface RecruitSupporterAction {
  type: 'RECRUIT_SUPPORTER';
  playerId: PlayerId;
  supporterCardId: SupporterCardId;
}

export interface PassTurnAction {
  type: 'PASS_TURN';
  playerId: PlayerId;
}

export interface UseAbilityAction {
  type: 'USE_ABILITY';
  playerId: PlayerId;
  abilityId: AbilityId;
  sourceCardId?: string;
  choices?: unknown;
}

export interface ResolvePendingAction {
  type: 'RESOLVE_PENDING';
  playerId: PlayerId;
  /** Player's answer to the current pending resolution prompt. */
  answer: unknown;
}

export interface AdvancePhaseAction {
  type: 'ADVANCE_PHASE';
}

export type GameAction =
  | PlaceWorkerAction
  | CastSpellAction
  | BuyVaultCardAction
  | RecruitSupporterAction
  | PassTurnAction
  | UseAbilityAction
  | ResolvePendingAction
  | AdvancePhaseAction;

// ============================================================================
// Effect surface
// ============================================================================

export interface EffectContext {
  state: GameState;
  playerId: PlayerId;
  sourceCardId?: string;
  choices?: unknown;
}

export type GameStatePatch = Partial<GameState>;

/**
 * Pending player input that pauses the engine. The full shape is designed in
 * `docs/effect-resolution.md` and will be implemented in a follow-up prompt.
 */
export type PendingResolution = unknown;
