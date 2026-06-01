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
  | 'technomancy' // Orange (Mancers expansion)
  | 'students' // Off-white / neutral candidates
  | 'wild'; // Special: counts as any department for scoring (e.g., White Ash)

export const DEPARTMENTS: readonly Department[] = [
  'sorcery',
  'mysticism',
  'natural-magick',
  'planar-studies',
  'divinity',
  'technomancy',
  'students',
  'wild',
];

/**
 * Mage piece colors. Each maps 1:1 to a Department except `off-white`
 * (neutral) and `rainbow` (the Archmage's Apprentice). Ability summary
 * by color (per rulebook):
 *  - red:       Ars Magna — wound a Mage and take its slot
 *  - blue:      immune to rival spells
 *  - green:     cannot be wounded
 *  - purple:    place as a fast action
 *  - grey:      may place after casting a spell
 *  - orange:    Technomancy (Mancers expansion) — Place: spend 3 Gold
 *               when placing this Mage to gain a Research.
 *  - rainbow:   Archmage's Apprentice — a special "joker" mage gained
 *               from the Archmage's Study. Has all Mage Powers.
 *               Untradeable; cleared at round-end.
 *  - off-white: no department ability
 */
export type MageColor =
  | 'red'
  | 'grey'
  | 'green'
  | 'purple'
  | 'blue'
  | 'orange'
  | 'rainbow'
  | 'off-white';

export const MAGE_COLORS: readonly MageColor[] = [
  'red',
  'grey',
  'green',
  'purple',
  'blue',
  'orange',
  'rainbow',
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
  /**
   * Marks a Mage as a temporary summon (e.g., Living Image's neutral mage
   * from the supply). At round-end, the round-setup step removes every
   * summoned mage and returns one to the off-white supply pool.
   */
  isSummoned?: boolean;
}

export type MageLocation =
  | { kind: 'office'; playerId: PlayerId }
  | { kind: 'action-space'; spaceId: ActionSpaceId }
  | { kind: 'infirmary'; slot?: number };

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
   * Buff flag: the next Spell this player casts during this turn costs 0
   * Mana. Set by vault cards like Mana Elixir. Consumed by CAST_SPELL on
   * the very next spell, and cleared unconditionally at turn end.
   */
  nextSpellFreeMana?: boolean;
  /**
   * Buff flag: the next Spell this player casts during this turn does NOT
   * exhaust. Set by Will of the Divines L1 "Concentration". Consumed by
   * CAST_SPELL on the very next spell, and cleared unconditionally at turn
   * end (same lifecycle as `nextSpellFreeMana`).
   */
  nextSpellSkipsExhaust?: boolean;
  /**
   * Buff flag: the next Gold cost this player would pay is reduced to
   * zero. Set by Auric Catalyst's reaction. Consumed by the post-window
   * apply-buy step (or the equivalent paid acquisition). Does NOT
   * affect Swap-for-Gold abilities; only triggers that fire a
   * gold-payment-pending reaction window.
   */
  nextGoldCostWaived?: boolean;
  /**
   * For each wild-department supporter the player owns (e.g. White Ash),
   * the department they've declared it counts as. Set during the
   * 'final-scoring' phase prompt (before voters are revealed) and read by
   * `countDepartment` / `countDiversity`. A single field is enough for
   * the base game since White Ash is the only wild supporter; if a future
   * expansion ships multiple, this can become a Record keyed by card id.
   */
  wildDepartmentChoice?: Department;
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
  /** Human-readable effect text for this level, copied from the card. */
  description?: string;
}

export interface SpellCard {
  id: SpellCardId;
  name: string;
  sourcePackId: PackId;
  department: Department;
  /**
   * Most Spell Books have three levels per rulebook. Unique candidate
   * starter spells ("leader spells") have only one level — no L2/L3
   * research is possible.
   */
  levels: SpellLevel[];
  /**
   * True for candidate-starter "leader" spells: a single-level book that
   * doesn't consume INT/WIS research and is bound to the candidate's
   * player (never enters the regular spell deck, never re-researched).
   */
  unique?: boolean;
}

export type VaultCardType = 'treasure' | 'consumable';

export type VaultCardTiming = 'action' | 'fast-action' | 'reaction';

export interface VaultCard {
  id: VaultCardId;
  name: string;
  sourcePackId: PackId;
  type: VaultCardType;
  goldCost: number;
  timing: VaultCardTiming;
  effectId: EffectId;
  /** Human-readable summary of the card's effect, copied from the card. */
  description?: string;
  /** Number of copies of this card to add to the vault deck (default 1). */
  copies?: number;
}

export type SupporterTiming =
  | 'action'
  | 'fast-action'
  | 'reaction'
  | 'passive' // Familiars and similar — sit in office, not played as an action.
  | 'endgame'; // Wild cards / scoring-only effects.

export interface SupporterCard {
  id: SupporterCardId;
  name: string;
  /** Optional in-world title / role (e.g., "Professor of Correspondence"). */
  title?: string;
  sourcePackId: PackId;
  department: Department;
  timing: SupporterTiming;
  /** Effect to invoke when the supporter is played; ignored for passive/endgame. */
  effectId: EffectId;
  /** Human-readable summary of the card's effect, copied from the card. */
  description?: string;
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
  /**
   * Optional shadow occupant. Only fillable via effects that explicitly
   * "shadow a mage" (Paralocation, Shadow Potion, Phase Steppers / Invisibility
   * Cloak reactions, etc.) — never via normal PLACE_WORKER. During the
   * resolution phase, the shadow occupant resolves AFTER the base occupant
   * (if any). A mage occupying a shadow position loses its color-based
   * ability and is not targetable by default (only by effects that explicitly
   * target shadowing mages).
   */
  shadowOccupant?: WorkerOccupancy | null;
  effectId: EffectId;
  costToActivate?: ActionSpaceCost;
  /** Human-readable summary of the slot's reward, sourced from the room file. */
  description?: string;
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
  /** Free-form room description (e.g., Infirmary's on-wound rules). */
  description?: string;
  /**
   * Marks the room as having no shadow positions on its slots — base-only
   * placement. Great Hall ("holds any number of mages") is the canonical
   * use case. Under a mandatory shadow-on-place buff (Inversion), the
   * engine treats placements here as base placements instead of
   * rejecting them. Defaults to false.
   */
  noShadowSlots?: boolean;
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
  /** In-world title / role (e.g., "Departing Chancellor"). */
  title?: string;
  /** Human-readable description of how this voter awards their vote. */
  description?: string;
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
  /** Short rules-text description; the UI shows it next to the name. */
  description: string;
}

// ============================================================================
// Phase machine
// ============================================================================

export type RoundNumber = 1 | 2 | 3 | 4 | 5;

/**
 * Action kinds tracked by Bend Time's "each must be a different type" rule.
 * The 4 named action categories the rulebook lists; other action-budget
 * operations (BUY_VAULT_CARD, USE_ABILITY, CLAIM_BELL_TOWER) don't carry a
 * kind and aren't tracked here.
 */
export type BendTimeKind = 'place' | 'spell' | 'supporter' | 'vault';

export type GamePhase =
  | { kind: 'setup' }
  | { kind: 'candidate-draft'; activePlayerIndex: number }
  | {
      /**
       * 2-player only: after both leaders are picked, the player who picked
       * second decides whether to draft first or pass the first pick to the
       * other player. For 3+ player games we skip this and use the leader-pick
       * order as the draft order.
       */
      kind: 'mage-draft-first-choice';
      chooserIndex: number;
    }
  | {
      /**
       * Snake-style draft of additional Mages from the shared pool. Each
       * player makes 3 picks total (so `pickOrder.length === playerCount * 3`).
       */
      kind: 'mage-draft';
      pickOrder: number[];
      nextPickIndex: number;
    }
  | {
      /**
       * Each player places their starting Mark on a Consortium voter,
       * in turn order from `firstPlayerIndex`. Transitions to `round-setup`
       * once every player has placed.
       */
      kind: 'initial-mark-placement';
      activePlayerIndex: number;
    }
  | { kind: 'round-setup'; round: RoundNumber }
  | {
      kind: 'errands';
      round: RoundNumber;
      activePlayerIndex: number;
      /**
       * True once the active player has spent this turn's mandatory Action.
       * Reset to false on every turn change (handled in `processErrandsAdvance`).
       */
      actionUsed: boolean;
      /**
       * True once the active player has spent this turn's optional Fast Action.
       * Same reset cadence as `actionUsed`.
       */
      fastActionUsed: boolean;
      /**
       * Bonus Action grants in addition to the base Action. Granted by
       * spells like Flare (+1), Dazzle (+2), and Bend Time (+3). When
       * consuming an Action with `actionUsed: true`, decrements this
       * counter instead of throwing — so the player can spend their
       * bonus actions after the base one is used. Reset to 0 on every
       * turn change.
       */
      extraActions?: number;
      /**
       * Set by Bend Time (Temporal Calculus L3). Each bonus action must be
       * a DIFFERENT type from this list:
       *   - 'place'     PLACE_WORKER
       *   - 'spell'     CAST_SPELL (action timing)
       *   - 'supporter' PLAY_SUPPORTER (action timing)
       *   - 'vault'     PLAY_VAULT_CARD (action timing)
       *
       * The engine appends each used kind here; subsequent attempts of
       * the same kind throw under Bend Time. Cleared on every turn change
       * and by DISCARD_BONUS_ACTIONS. Absent = Bend Time isn't active.
       */
      bendTimeUsedKinds?: BendTimeKind[];
    }
  | {
      kind: 'resolution';
      round: RoundNumber;
      pendingRoomIndex: number;
      pendingSpaceIndex: number;
      /**
       * Per-slot position pointer. A slot can carry both a base and a shadow
       * occupant; both resolve, base first. Defaults to 'base' (omitted ==
       * 'base' for backward compatibility with serialized state).
       */
      pendingSlotPosition?: 'base' | 'shadow';
      /**
       * True between `pushResolutionChoicePrompt` (the pump pushes the
       * forfeit-or-reward prompt for the current slot) and
       * `completeCurrentSpaceResolution` (the slot's effect chain ends and
       * the mage returns to office). Used to gate auto-complete on
       * RESOLVE_PENDING: prompts surfaced OUTSIDE an active slot chain —
       * e.g. drained from `researchQueue` between slots — must not
       * trigger an extra completeCurrentSpaceResolution call (that would
       * advance past the next slot without firing it).
       */
      slotInProgress?: boolean;
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
  /**
   * When true, the UI must collect an `actionSpaceId` from the player BEFORE
   * submitting `reaction-played` — the chosen slot id should land in
   * `reactionContext.destinationSpaceId`. Used by Shield Potion / Ancient
   * Armor / Mystic Amulet so the player can pick "any open slot on the
   * board" instead of being locked to the trigger's original slot.
   */
  requiresSlotPick?: boolean;
  /**
   * For multi-mage reaction windows (batch wound/banish spells like Plague,
   * Fireball, Tsunami, etc.), the responder may have several of their mages
   * affected by the same spell. Each reaction-card×mage pair becomes its
   * own option; `forMageId` records which mage this option targets. The
   * engine threads the matching event into the reaction's resumeContext.
   *
   * For single-mage windows (Burn, Lightning, etc.) this is unset — the
   * window's only event is used implicitly.
   */
  forMageId?: OwnedMageId;
}

export type PendingPrompt =
  | { kind: 'choose-from-options'; options: ChoiceOption[] }
  /**
   * Target-mage pick. When `canPass` is true, the responder may decline
   * the pick (answer kind `'pass'`); the effect treats that as a skip.
   * `label`, when set, is rendered as a step-specific banner above the
   * choice buttons ("Choose a Mage to wound" / "Choose a Mage to banish"
   * / etc.). Used by Ice Comet's optional wound / banish / move legs.
   */
  | {
      kind: 'choose-target-mage';
      eligibleMageIds: OwnedMageId[];
      canPass?: boolean;
      label?: string;
    }
  | {
      kind: 'choose-target-action-space';
      eligibleSpaceIds: ActionSpaceId[];
      label?: string;
    }
  | { kind: 'choose-vault-card'; eligibleCardIds: VaultCardId[] }
  | { kind: 'choose-supporter-card'; eligibleCardIds: SupporterCardId[] }
  /**
   * Picks one supporter card out of a small set the player has just peeked
   * at — typically the top N of the Supporter Deck (Mystic Lantern). Same
   * shape as `choose-supporter-card` but the UI shouldn't try to route the
   * pick through the supporter tableau, because the eligible cards live
   * outside it. The prompt panel renders full card details inline.
   */
  | { kind: 'choose-peeked-supporter'; eligibleCardIds: SupporterCardId[] }
  | {
      kind: 'choose-spell-level';
      spellId: SpellCardId;
      availableLevels: (1 | 2 | 3)[];
    }
  | { kind: 'choose-deck'; eligibleDecks: ('spell' | 'vault' | 'supporter')[] }
  | { kind: 'choose-voter'; eligibleVoterIds: ConsortiumVoterId[] }
  | {
      kind: 'reaction-window';
      /**
       * Events that triggered this window. For single-mage spells this is
       * a length-1 array. For batch spells (Plague, Fireball, Tsunami, etc.)
       * it contains every mage affected by the cast; the prompt's options
       * include one entry per (reaction card × affected mage) pair so the
       * responder picks both at once.
       */
      triggerEvents: ReactionTriggerEvent[];
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
  /**
   * Decline a `canPass`-enabled pick prompt (Ice Comet's optional wound /
   * banish / move legs). Effect handlers treat this as a skip.
   */
  | { kind: 'pass' }
  | {
      kind: 'reaction-played';
      effectId: EffectId;
      reactionContext: SerializableContext;
      /**
       * For multi-mage reaction windows, identifies which affected mage the
       * reaction targets — the engine looks up the matching trigger event
       * and threads it into the reaction's resumeContext. Unset for
       * single-mage windows (where the only event is used implicitly).
       */
      forMageId?: OwnedMageId;
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

export type HarmfulEffectKind = 'wound' | 'banish' | 'move' | 'shadow';

/**
 * Duration tag shared by every active buff:
 *   - `turn-start` expires the moment the named player's next turn begins.
 *   - `round-end` expires when the round transitions to Resolution.
 *
 * All active buffs additionally clear unconditionally at the start of
 * Resolution so nothing carries across rounds.
 */
export type BuffExpiry =
  | { kind: 'turn-start'; playerId: PlayerId }
  | { kind: 'round-end' };

/**
 * Sustained "immunity" buff (Moste Holie Litanies, Heart of the Mountain,
 * Tome of Protection, etc.). Protects every mage owned by `ownerId` from
 * the listed harmful effect kinds. `source: 'spell'` means only spell
 * sources are blocked (Tome of Protection L1); `'any'` blocks every
 * source (Tome of Protection L2, Heart of the Mountain L3).
 */
export interface MageImmunityBuff {
  kind: 'mage-immunity';
  ownerId: PlayerId;
  spellCardId: SpellCardId;
  /** Display name shown in tooltips ("Sanctification", "Stoneskin", ...). */
  label: string;
  /** Effects this buff blocks. */
  immuneTo: HarmfulEffectKind[];
  /** `'spell'` blocks only spell-source effects; `'any'` blocks everything. */
  source: 'spell' | 'any';
  expiresAt: BuffExpiry;
}

/**
 * Global "all Mages lose their powers" buff (Tenets of Dominance L1
 * Mesmerize). Mages of every colour except Divinity (blue) are treated
 * as neutral while this is active:
 *   - Green: no longer wound-immune
 *   - Purple: no fast-action placement
 *   - Red: cannot trigger Ars Magna
 *   - Grey: no Mysticism place-after-cast
 *   - Blue: KEEPS its opposing-spell immunity (the "except those immune
 *     to Spells" clause from the rules).
 */
export interface MagesLosePowersBuff {
  kind: 'mages-lose-powers';
  casterPlayerId: PlayerId;
  spellCardId: SpellCardId;
  label: string;
  expiresAt: BuffExpiry;
}

/**
 * "Shadow on place" buff (Infinite Universes Realized L2 Zero Hour,
 * L3 Inversion). Lets the caster's PLACE_WORKER target a slot's shadow
 * position instead of its base position.
 *
 * - `mode: 'optional'` (Zero Hour) — the caster MAY place into a shadow
 *   slot, but only over an OPPOSING base occupant. Normal base placement
 *   is still allowed.
 * - `mode: 'mandatory'` (Inversion) — every placement MUST go to a shadow
 *   slot. Shadow slots over an empty base are also valid destinations.
 *
 * Both modes still respect: shadow slot must be empty, room not locked,
 * caster under per-room cap.
 */
export interface ShadowOnPlaceBuff {
  kind: 'shadow-on-place';
  casterPlayerId: PlayerId;
  spellCardId: SpellCardId;
  label: string;
  mode: 'optional' | 'mandatory';
  expiresAt: BuffExpiry;
}

/**
 * Global "no placements" buff (The Darkness Within L1 Malaise). While
 * active, PLACE_WORKER is rejected for every player — including the
 * caster. Expires at the caster's next turn (or round-end as the global
 * fallback). The grey Mysticism "place after Action Spell" prompt is
 * also suppressed while this buff is active, since selecting it could
 * never produce a legal placement.
 */
export interface PlacementsBlockedBuff {
  kind: 'placements-blocked';
  casterPlayerId: PlayerId;
  spellCardId: SpellCardId;
  label: string;
  expiresAt: BuffExpiry;
}

/**
 * Cheaper-spells buff (Power bell tower offering). Reduces the caster's spell
 * mana cost by `discount` (floored at 0) for every cast while the buff is
 * active. Expires at round-end.
 */
export interface SpellsCheaperBuff {
  kind: 'spells-cheaper';
  casterPlayerId: PlayerId;
  /** Source identifier for tooling — bell tower card id, supporter id, etc. */
  sourceId: string;
  label: string;
  discount: number;
  expiresAt: BuffExpiry;
}

/**
 * Global "no spell casts" buff (Will of the Divines L2 Silence). While
 * active, NO player may execute CAST_SPELL as a direct action — Silence
 * affects the caster too. Reaction-timing spells fired from a reaction
 * window are still allowed (per rulebook intent — reactions aren't "cast
 * spells" actions). Expires at the caster's next turn-start, or at
 * round-end as the global fallback.
 */
export interface SpellsBlockedBuff {
  kind: 'spells-blocked';
  casterPlayerId: PlayerId;
  spellCardId: SpellCardId;
  label: string;
  expiresAt: BuffExpiry;
}

/**
 * Revival buff (Will of the Divines L3). After one of the caster's mages is
 * wounded by an opponent's action (and the Infirmary bonus has been settled),
 * the caster may move that wounded mage out of the Infirmary onto any open
 * base slot, healing it in the process. Bonus still fires (per the card
 * text: "Still gain Infirmary Bonuses"). Expires at round-end.
 *
 * Wired via `state.pendingRevivalChecks` — each qualifying wound enqueues an
 * entry; the engine's `drainRevivalCheckIfIdle` pump surfaces the prompt
 * once the wound's reaction window and any infirmary-bonus chain are idle.
 */
export interface RevivalBuff {
  kind: 'revival';
  casterPlayerId: PlayerId;
  spellCardId: SpellCardId;
  label: string;
  expiresAt: BuffExpiry;
}

/**
 * Energy Drain buff (Thirteen Greater Mysteries L3). For the rest of the
 * round, opposing players pay an extra `surcharge` Mana every time they
 * cast a Spell — the extra Mana is routed to the buff's caster. Caster's
 * own casts are unaffected.
 */
export interface EnergyDrainBuff {
  kind: 'energy-drain';
  casterPlayerId: PlayerId;
  spellCardId: SpellCardId;
  label: string;
  surcharge: number;
  expiresAt: BuffExpiry;
}

export type ActiveBuff =
  | MageImmunityBuff
  | MagesLosePowersBuff
  | ShadowOnPlaceBuff
  | PlacementsBlockedBuff
  | SpellsCheaperBuff
  | SpellsBlockedBuff
  | RevivalBuff
  | EnergyDrainBuff;

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
      kind: 'mage-shadowed';
      mageId: OwnedMageId;
      ownerId: PlayerId;
      byPlayerId: PlayerId;
      spaceId: ActionSpaceId;
    }
  | {
      kind: 'spell-cast';
      spellId: SpellCardId;
      level: 1 | 2 | 3;
      byPlayerId: PlayerId;
    }
  | {
      /**
       * Fires immediately before a player would pay gold for a buy (and
       * similar paid acquisitions — NOT for "Swap" abilities). The only
       * reactor is the paying player themselves, who may play Auric
       * Catalyst to set `nextGoldCostWaived` and reduce the cost to zero.
       */
      kind: 'gold-payment-pending';
      payingPlayerId: PlayerId;
      amount: number;
      purpose: 'vault-purchase';
    }
  | {
      /**
       * Fires AFTER an opponent takes the last Bell Tower card (the bell
       * tower is now empty). Triggers Tardy and Stop Time reactions for
       * opponents who have those spells researched and not exhausted.
       */
      kind: 'bell-tower-last-claimed';
      cardId: BellTowerCardId;
      byPlayerId: PlayerId;
    };

export interface ReactionWindow {
  id: ReactionWindowId;
  /**
   * Events that opened this window. Single-mage actions store a length-1
   * array; batch spells (Plague, Fireball, Tsunami, Nox, etc.) store one
   * event per affected mage. Each affected player gets ONE reaction across
   * the window — when they react they pick which of their affected mages
   * the reaction targets (via `ReactionOption.forMageId`).
   */
  triggerEvents: ReactionTriggerEvent[];
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
  /**
   * Spatial layout of `rooms` in a 2D grid. Used for orthogonal-adjacency
   * lookups by spells like Plague / Pestilence / Fireball / Inferno that
   * target adjacent rooms. The flat `rooms` list keeps stable declaration
   * order; the grid records where each room was placed at game start.
   */
  roomLayout: RoomLayout;
  /**
   * Pending Research opportunities waiting to be surfaced one-by-one. Cards
   * that grant N Research (e.g. Brilliance, Welsie Acktern) append N entries
   * here; the engine drains one entry at a time, surfacing a fresh research
   * prompt for the queued player whenever the resolution stack is otherwise
   * idle. Single-research effects can either bypass this and surface the
   * prompt directly (existing behavior) or push one entry — both work.
   */
  researchQueue: {
    playerId: PlayerId;
    source: ResolutionSource;
    /**
     * Optional department restriction (e.g., Adelaide Chivers grants Research
     * usable only on Planar Studies spells). Filters draft tableau options and
     * WIS-upgrade options to spells of the named department. Absent = no
     * restriction (unrestricted research).
     */
    restrictDepartment?: Department;
  }[];
  /**
   * Set when a `bell-tower-last-claimed` reaction window needs to open
   * after the active claim chain settles. Drained by the engine pump on
   * the next idle moment (similar to `researchQueue`). Cleared after the
   * reaction window opens.
   */
  pendingBellTowerLastEvent: {
    cardId: BellTowerCardId;
    byPlayerId: PlayerId;
    source: ResolutionSource;
  } | null;
  /**
   * Tracks "place a Mage without using Mage powers" chains (Stop Time —
   * 2 placements). After each placement (and its potential instant-room
   * reward chain) fully resolves and the stack is idle, the engine pump
   * drains one entry from `remaining` and surfaces the next placement's
   * mage prompt. Cleared when `remaining` hits 0. Tardy (1 placement)
   * does not need this — its placement fires inline.
   */
  pendingPlaceChain: {
    playerId: PlayerId;
    source: ResolutionSource;
    remaining: number;
    /**
     * Optional room constraint — when set, placements in this chain are
     * limited to open base slots inside the named room. Slow Time
     * (Temporal Calculus L1) sets this so the "up to two Mages" share the
     * chosen room. Absent = any open slot, the original Stop Time behavior.
     */
    restrictRoomId?: RoomId;
    /**
     * When true, the placement prompt offers a "Stop" option so the player
     * can end the chain early. Slow Time uses this for the "up to two"
     * semantic. Absent / false = the placement is mandatory (Stop Time).
     */
    allowStop?: boolean;
  } | null;
  /**
   * The Contract chain (3 Research, all locked to a single department of
   * the player's implicit choice). The first non-discard pick locks the
   * department for the remaining picks. Drained one Research at a time
   * by the engine pump.
   */
  pendingContractResearch: {
    playerId: PlayerId;
    source: ResolutionSource;
    remaining: number;
    lockedDepartment?: Department;
  } | null;
  /**
   * Revival prompt queue (Will of the Divines L3). Each entry is a wounded
   * mage whose owner has the Revival buff active at wound time. The
   * `drainRevivalCheckIfIdle` engine pump pops one entry per idle moment and
   * surfaces a Yes/No move-and-heal prompt for that mage's owner. Cleared at
   * round-end alongside the buff itself.
   */
  pendingRevivalChecks: { ownerId: PlayerId; mageId: OwnedMageId }[];

  /**
   * Mysticism post-cast trigger queue. Each entry is the caster's id of
   * an action-timed spell whose post-cast Mysticism mage-placement hasn't
   * yet been offered. `handleCastSpell` appends one entry per action
   * cast; `drainMysticismPostCastIfIdle` shifts the head off the queue
   * once the spell's full resolution chain has settled and either
   * surfaces the Yes/No prompt or skips silently.
   *
   * Multiple entries can be in flight when a spell like Mystic Link or
   * Chain Lightning L3 borrows a cast — both the outer cast AND the
   * borrowed cast trigger their own Mysticism opportunity (if it was
   * action-timed). The queue is reset between turns.
   */
  pendingMysticismPostCast: PlayerId[];

  /**
   * Technomancy post-placement trigger queue. Each entry holds the
   * placer's id and the room id their orange (Technomancy) mage just
   * landed in. The queue mirrors the Mysticism post-cast pattern — it
   * drains AFTER the placement (and any instant-room reward chain) has
   * fully resolved and the stack is idle, surfacing the Side A "Pay 3
   * Gold to gain a Research" prompt. Keeping the trigger out of the
   * placement chain itself prevents action-time complications.
   *
   * The queue is reset at the same lifecycle points as
   * `pendingMysticismPostCast` (resolution transition + turn change).
   */
  pendingTechnomancyTrigger: { playerId: PlayerId; roomId: RoomId }[];

  /**
   * Active "immunity" buffs (Moste Holie Litanies / Heart of the Mountain
   * / Tome of Protection). Each buff protects its owner's mages from one
   * or more harmful effect kinds for a bounded duration.
   *
   * Read by `isMageImmuneToEffect` / `magesLosePowers`; expired by
   * `processErrandsAdvance` (turn-start kind matches incoming player)
   * and unconditionally cleared at the resolution-start hook.
   */
  activeBuffs: ActiveBuff[];

  voters: ConsortiumVoter[];
  voterMarks: VoterMark[];

  spellDeck: SpellCardId[];
  spellTableau: SpellCardId[];
  vaultDeck: VaultCardId[];
  vaultTableau: VaultCardId[];
  /**
   * Pool of cards added to Adventuring Side B during the errands phase
   * via its on-place trigger. Each occupant who places a Mage on the
   * room picks a card type (Spell / Vault / Supporter) and the top of
   * that deck is moved here, capped at 3 per type. At resolution every
   * occupant drafts from this pool; whatever's left at the end of the
   * round (= when the pump leaves the room) is returned to the bottom
   * of each respective deck. `null` outside Adventuring B's lifetime.
   */
  adventuringBPool: {
    spells: SpellCardId[];
    vaultCards: VaultCardId[];
    supporters: SupporterCardId[];
  } | null;

  /**
   * Transient revealed pool used by Vault Side A's slot effects: when
   * the first occupied slot resolves, three cards are popped from the
   * top of the vault deck and stashed here so the remaining slots can
   * draft from the same pool in slot order. The resolution pump clears
   * the field once it leaves Vault A and returns any unclaimed cards to
   * the top of the deck. `null` outside Vault A's resolution.
   */
  vaultARevealed: VaultCardId[] | null;
  supporterDeck: SupporterCardId[];
  supporterTableau: SupporterCardId[];
  legendarySpells: SpellCardId[];

  bellTower: {
    available: BellTowerCard[];
    taken: { cardId: BellTowerCardId; takenBy: PlayerId }[];
  };

  archmagesApprenticeOwner: PlayerId | null;
  roomLocks: { roomId: RoomId }[];

  /**
   * Shared Mage pool used during the candidate / mage-draft setup phases.
   * Initialized to 4 of each color (Sorcery red, Mysticism grey, Natural
   * Magick green, Divinity blue, Planar Studies purple, Neutral off-white).
   * Each candidate pick removes 2 of the leader's color; each draft pick
   * removes 1.
   */
  mageDraftPool: Record<MageColor, number>;

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
  /**
   * Number of rooms in play this game. Defaults to 8 (2-3 players), 10 (4
   * players), 12 (5+ players). Always ≥ the number of UC rooms in the pack.
   * If the available room pool is smaller than the requested count, the
   * remainder is filled with placeholder rooms (no action spaces). Ignored
   * when `roomLayoutMode.kind === 'first-time'` (always 8) or `'custom'`
   * (count = `roomIds.length`).
   */
  numberOfRooms?: number;
  /**
   * How rooms are arranged on the board:
   *   - `'first-time'`: fixed 8-room beginner layout, all side A, in the
   *     row-major order Vault, Training Fields, Infirmary, Courtyard,
   *     Catacombs, Guilds, Library, Council Chamber (2 cols × 4 rows).
   *   - `'random'`: select rooms via the random pump and shuffle them
   *     into the grid. Legacy default; preserved for existing tests.
   *   - `'custom'`: caller provides the exact room IDs in row-major
   *     order; the grid dimensions are derived from the count.
   */
  roomLayoutMode?: RoomLayoutMode;
}

export type RoomLayoutMode =
  | { kind: 'first-time' }
  | { kind: 'random' }
  | { kind: 'custom'; roomIds: RoomId[] };

/**
 * 2-D grid layout for rooms in play. `cols × rows` cells, each holding a
 * RoomId or null (empty cell). `cols` is the horizontal count ("across") and
 * is capped at 3 per the rulebook's visual layout. Empty cells break
 * orthogonal adjacency — `getOrthogonallyAdjacentRoomIds` treats `null` as
 * a wall, not a passthrough.
 */
export interface RoomLayout {
  cols: number;
  rows: number;
  /** grid[row][col] → RoomId or null (empty cell). */
  grid: (RoomId | null)[][];
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

export interface PlayVaultCardAction {
  type: 'PLAY_VAULT_CARD';
  playerId: PlayerId;
  vaultCardId: VaultCardId;
}

export interface RecruitSupporterAction {
  type: 'RECRUIT_SUPPORTER';
  playerId: PlayerId;
  supporterCardId: SupporterCardId;
}

export interface PlaySupporterAction {
  type: 'PLAY_SUPPORTER';
  playerId: PlayerId;
  supporterCardId: SupporterCardId;
}

export interface PassTurnAction {
  type: 'PASS_TURN';
  playerId: PlayerId;
}

/**
 * Discards remaining bonus actions (extraActions / Bend Time tracker) and
 * lets the turn auto-advance immediately. Issued from the UI's "Discard
 * remaining bonus actions" button under Bend Time.
 */
export interface DiscardBonusActionsAction {
  type: 'DISCARD_BONUS_ACTIONS';
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

export interface ChooseDraftFirstAction {
  type: 'CHOOSE_DRAFT_FIRST';
  playerId: PlayerId;
  /** True = chooser drafts first; false = chooser passes the first pick. */
  draftFirst: boolean;
}

export interface DraftMageAction {
  type: 'DRAFT_MAGE';
  playerId: PlayerId;
  color: MageColor;
}

export interface ClaimBellTowerAction {
  type: 'CLAIM_BELL_TOWER';
  playerId: PlayerId;
  bellTowerCardId: BellTowerCardId;
  /**
   * Optional pre-supplied resolution for the bell tower card's effect.
   * When the card surfaces a choose-from-options prompt (e.g.
   * `base.bell.gold-or-mana` offers Gold vs Mana), the UI can dispatch
   * the choice up front so the player commits to a single button click
   * instead of clicking Claim and then resolving a follow-up prompt.
   * The engine threads it in as the effect's `resumeAnswer`.
   */
  claimChoice?: string;
}

export interface AdvancePhaseAction {
  type: 'ADVANCE_PHASE';
}

export type GameAction =
  | PlaceWorkerAction
  | CastSpellAction
  | BuyVaultCardAction
  | PlayVaultCardAction
  | RecruitSupporterAction
  | PlaySupporterAction
  | PassTurnAction
  | DiscardBonusActionsAction
  | UseAbilityAction
  | ResolvePendingAction
  | ChooseCandidateAction
  | ChooseDraftFirstAction
  | DraftMageAction
  | ClaimBellTowerAction
  | AdvancePhaseAction;
