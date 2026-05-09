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
export type ResolutionId = string;
export type ReactionWindowId = string;

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
  /**
   * Sequence number from `state.nextSequenceId` recorded when this player's
   * `resources.influence` last changed. Lower = reached the value earlier; used
   * as the secondary tiebreaker during voter resolution per rulebook (the
   * Influence Track stack: bottom disc placed first wins ties).
   */
  influenceArrivalSeq: number;
  /**
   * Room ids this player has placed a mage in during the current round.
   * Reset to `[]` at the start of round-setup. Read by PLACE_WORKER to
   * enforce per-room per-round placement limits (e.g., Council Chamber's
   * "single mage per round" rule).
   */
  roundPlacements: RoomId[];
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

export interface Mage {
  id: MageCardId;
  name: string;
  sourcePackId: PackId;
  color: MageColor;
  /** Null only for off-white neutral mages. */
  department: Department | null;
  aPowerEffectId?: EffectId;
  bPowerEffectId?: EffectId;
  description?: string;
  abilities?: MageAbility[];
  portrait?: string;
}

/**
 * A candidate sheet — the role a player picks at setup. Determines starting
 * Mage allocation and starting Spell.
 *
 * `startingMageColor` is `'neutral'` for Students-department candidates per
 * rulebook (they get neutral mages, not a department-colored bonus pair).
 * Students candidates also get one extra Merit Badge (`startingExtraMeritBadge`).
 */
export interface Candidate {
  id: CandidateId;
  name: string;
  title: string;
  sourcePackId: PackId;
  department: Department;
  starterSpellId: SpellCardId;
  startingMageColor: MageColor | 'neutral';
  startingExtraMeritBadge: boolean;
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
  isUniversityCentral: boolean;
  side: 'A' | 'B';
  isInstantRoom: boolean;
  cannotBePlacedInDirectly: boolean;
  cannotBeLocked: boolean;
  actionSpaces: ActionSpace[];
  setupEffectId?: EffectId;
  /**
   * Optional cap on how many mages a single player may place in this room
   * per round (e.g., Council Chamber: 1). Counted against
   * `Player.roundPlacements`. Unset = unlimited.
   */
  maxMagesPerPlayerPerRound?: number;
}

// ============================================================================
// Voters (Consortium board) & Bell Tower
// ============================================================================

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
  votes: number;
  isAlwaysFaceUp: boolean;
  revealed: boolean;
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
  minPlayers: 2 | 3 | 4 | 5;
}

// ============================================================================
// Phase machine
// ============================================================================

export type RoundNumber = 1 | 2 | 3 | 4 | 5;

export type GamePhase =
  | { kind: 'setup' }
  | { kind: 'candidate-draft'; activePlayerIndex: number }
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
}

// ============================================================================
// Serializable values (constraint for effect context payloads)
// ============================================================================

export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue | undefined };

export type SerializableContext = { [key: string]: SerializableValue | undefined };

// ============================================================================
// Effect resolution: prompts, answers, sources, continuations
// ============================================================================

export interface ChoiceOption {
  id: string;
  label: string;
  payload: SerializableValue;
  available?: boolean;
  unavailableReason?: string;
}

export interface ReactionOption {
  /** Where the reaction comes from (vault card, supporter, etc.). */
  sourceKind: 'vault-card' | 'supporter' | 'spell' | 'mage-power';
  /** Card / spell / mage id that owns the reaction. */
  sourceId: string;
  /** Effect id to invoke if the player chooses this reaction. */
  effectId: EffectId;
  label: string;
}

export type PendingPrompt =
  | { kind: 'choose-from-options'; options: ChoiceOption[] }
  | { kind: 'choose-target-mage'; eligibleMageIds: OwnedMageId[] }
  | { kind: 'choose-target-action-space'; eligibleSpaceIds: ActionSpaceId[] }
  | { kind: 'choose-vault-card'; eligibleCardIds: VaultCardId[] }
  | { kind: 'choose-supporter-card'; eligibleCardIds: SupporterCardId[] }
  | {
      kind: 'choose-spell-level';
      spellId: SpellCardId;
      availableLevels: (1 | 2 | 3)[];
    }
  | { kind: 'choose-deck'; eligibleDecks: ('spell' | 'vault' | 'supporter')[] }
  | { kind: 'choose-voter'; eligibleVoterIds: ConsortiumVoterId[] }
  | {
      kind: 'reaction-window';
      /** Trigger event embedded directly so the prompt is self-describing. */
      triggerEvent: ReactionTriggerEvent;
      /** Reactions the responder may play; empty list = pass-only window. */
      reactionOptions: ReactionOption[];
      canPass: true;
    }
  | { kind: 'confirm'; message: string };

export type ResolutionAnswer =
  | { kind: 'option-chosen'; optionId: string; payload: SerializableValue }
  | { kind: 'mage-chosen'; mageId: OwnedMageId }
  | { kind: 'space-chosen'; spaceId: ActionSpaceId }
  | { kind: 'card-chosen'; cardId: string }
  | { kind: 'level-chosen'; level: 1 | 2 | 3 }
  | { kind: 'deck-chosen'; deck: 'spell' | 'vault' | 'supporter' }
  | { kind: 'voter-chosen'; voterId: ConsortiumVoterId }
  | {
      kind: 'reaction-played';
      effectId: EffectId;
      reactionContext: SerializableContext;
    }
  | { kind: 'reaction-passed' }
  | { kind: 'confirmed' };

export interface ResumeContinuation {
  effectId: EffectId;
  context: SerializableContext;
}

export interface ResolutionSource {
  kind:
    | 'spell'
    | 'vault-card'
    | 'supporter'
    | 'room-action'
    | 'mage-power'
    | 'bell-tower'
    | 'system';
  /** Id of the originating card / room / mage / etc. */
  id: string;
  triggeringPlayerId: PlayerId;
  description: string;
}

export interface PendingResolution {
  id: ResolutionId;
  responderId: PlayerId;
  prompt: PendingPrompt;
  resume: ResumeContinuation;
  source: ResolutionSource;
  /** Set when this prompt is part of an open reaction window. */
  reactionWindowId?: ReactionWindowId;
}

/** Engine input (effects don't generate IDs; the engine does). */
export type PendingResolutionInput = Omit<PendingResolution, 'id'>;

export type ReactionTriggerEvent =
  | {
      kind: 'mage-wounded';
      mageId: OwnedMageId;
      ownerId: PlayerId;
      byPlayerId: PlayerId;
      originalSpaceId: ActionSpaceId | null;
    }
  | {
      kind: 'mage-banished';
      mageId: OwnedMageId;
      ownerId: PlayerId;
      byPlayerId: PlayerId;
      originalSpaceId: ActionSpaceId | null;
    }
  | {
      kind: 'mage-moved';
      mageId: OwnedMageId;
      ownerId: PlayerId;
      fromSpaceId: ActionSpaceId;
      toSpaceId: ActionSpaceId;
      byPlayerId: PlayerId;
    }
  | {
      kind: 'spell-cast';
      spellId: SpellCardId;
      level: 1 | 2 | 3;
      byPlayerId: PlayerId;
    };

export interface ReactionWindow {
  id: ReactionWindowId;
  triggerEvent: ReactionTriggerEvent;
  /** Players still owed a reaction prompt, in turn order from the trigger. */
  pendingResponderIds: PlayerId[];
  /** Players who've already used their one reaction this window. */
  reactedPlayerIds: PlayerId[];
  /** Effect to invoke after the window closes (queue empty). */
  afterResume: ResumeContinuation;
  /** Source of the original reactable action — for logs / UI. */
  source: ResolutionSource;
}

export type ReactionWindowInput = Omit<ReactionWindow, 'id'>;

// ============================================================================
// Effect context & result
// ============================================================================

export interface EffectContext {
  state: GameState;
  source: ResolutionSource;
  triggeringPlayerId: PlayerId;
  /** Present when this is a resume call from a PendingResolution. */
  resumeContext?: SerializableContext;
  resumeAnswer?: ResolutionAnswer;
  /**
   * False inside reaction effect resolution per rulebook ("reactions cannot
   * themselves be reacted to"). Effects MAY check this; the engine ALSO
   * suppresses reaction windows when applying a reaction effect's result.
   */
  allowReactions: boolean;
}

export type GameStatePatch = Partial<GameState>;

export type EffectResult =
  | { kind: 'done'; patch: GameStatePatch }
  | {
      kind: 'pause';
      patch?: GameStatePatch;
      pending: PendingResolutionInput;
    }
  | {
      kind: 'open-reaction';
      patch?: GameStatePatch;
      window: ReactionWindowInput;
    };

// ============================================================================
// GameState
// ============================================================================

export interface GameState {
  players: Player[];
  firstPlayerIndex: number;
  activePackIds: PackId[];
  rngSeed: number;
  rng: RngState;

  rooms: Room[];

  voters: ConsortiumVoter[];
  voterMarks: VoterMark[];

  spellDeck: SpellCardId[];
  spellTableau: SpellCardId[];
  vaultDeck: VaultCardId[];
  vaultTableau: VaultCardId[];
  supporterDeck: SupporterCardId[];
  supporterTableau: SupporterCardId[];
  legendarySpells: SpellCardId[];

  bellTower: {
    available: BellTowerCard[];
    taken: { cardId: BellTowerCardId; takenBy: PlayerId }[];
  };

  archmagesApprenticeOwner: PlayerId | null;
  roomLocks: { roomId: RoomId }[];

  phase: GamePhase;

  /**
   * LIFO stack of outstanding player-input prompts. Top of stack = currently
   * active prompt; the engine refuses ADVANCE_PHASE while any prompt is open.
   */
  pendingResolutionStack: PendingResolution[];
  /** Open reaction windows. Each window owns a queue of responder prompts. */
  activeReactionWindows: ReactionWindow[];

  /**
   * Single monotonic counter used for every deterministic id the engine
   * needs (resolution ids, reaction window ids, action log ids) AND for
   * recording `Player.influenceArrivalSeq` whenever influence changes.
   */
  nextSequenceId: number;

  actionLog: ActionLogEntry[];
}

// ============================================================================
// Game configuration / actions
// ============================================================================

export interface GameConfig {
  activePackIds: PackId[];
  playerNames: string[];
  rngSeed: number;
  /**
   * If true, `initGame` produces a `candidate-draft` phase before round-setup;
   * each player must dispatch CHOOSE_CANDIDATE to pick a faction leader before
   * the game proper begins. Default false (existing test-friendly behavior:
   * players are seated with empty candidate state).
   */
  useCandidateDraft?: boolean;
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
  choices?: SerializableContext;
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
  choices?: SerializableContext;
}

export interface ResolvePendingAction {
  type: 'RESOLVE_PENDING';
  resolutionId: ResolutionId;
  answer: ResolutionAnswer;
}

export interface ChooseCandidateAction {
  type: 'CHOOSE_CANDIDATE';
  playerId: PlayerId;
  candidateId: CandidateId;
}

export interface EndErrandsTurnAction {
  type: 'END_ERRANDS_TURN';
  playerId: PlayerId;
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
  | ChooseCandidateAction
  | EndErrandsTurnAction
  | AdvancePhaseAction;
