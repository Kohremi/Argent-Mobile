// All shared game types live here.
//
// Convention: every content-bearing entity carries a `sourcePackId` so the UI
// can badge expansion content and the engine can validate referenced content
// against the active pack list.

// ---------- Identifiers ----------

export type PackId = string;
export type PlayerId = string;
export type MageId = string;
export type FamiliarId = string;
export type RoomId = string;
export type ActionSpaceId = string;
export type SpellCardId = string;
export type TreasureCardId = string;
export type CouncilTileId = string;
export type EffectId = string;
export type AbilityId = string;

// ---------- Resources ----------

export type VisColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple';

export const VIS_COLORS: readonly VisColor[] = ['red', 'blue', 'green', 'yellow', 'purple'];

export type VisSupply = Record<VisColor, number>;

export interface ResourceBundle {
  vis: VisSupply;
  gold: number;
  // EXPANSION: Mancers / Ascension introduce additional resource tracks.
  mana?: number;
  reputation?: number;
}

// ---------- Players ----------

export type PlayerColor = 'white' | 'black' | 'red' | 'blue' | 'green' | 'purple';

export interface Player {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  /**
   * Mage ids the player controls. Typically 1 in base game; some expansion
   * content (and certain Saturday Knight Special rules) can grant more.
   */
  mages: MageId[];
  familiars: FamiliarId[];
  resources: ResourceBundle;
  spells: SpellCardId[];
  treasures: TreasureCardId[];
  /**
   * Influence is conceptually a token resource but is tracked as a top-level
   * field per the design spec (used heavily for council manipulation).
   */
  influence: number;
  /** Position on the initiative track; lower = earlier. */
  initiative: number;
}

// ---------- Mages, Familiars, Workers ----------

export interface MageAbility {
  id: AbilityId;
  name: string;
  description: string;
  /** Optional registered effect that runs when the ability is triggered. */
  effectId?: EffectId;
  // TODO: model trigger timing — passive, on-place, end-of-round, on-cast, etc.
}

export interface Mage {
  id: MageId;
  name: string;
  sourcePackId: PackId;
  abilities: MageAbility[];
  portrait?: string;
}

export interface Familiar {
  id: FamiliarId;
  name: string;
  sourcePackId: PackId;
  abilities: MageAbility[];
}

export type WorkerType = 'mage' | 'familiar';

export interface Worker {
  owner: PlayerId;
  type: WorkerType;
  /** `null` while in the player's supply. */
  location: ActionSpaceId | null;
  /** Set when type === 'mage'. */
  mageId?: MageId;
  /** Set when type === 'familiar'. */
  familiarId?: FamiliarId;
}

// ---------- Rooms & Action Spaces ----------

export interface ActionSpaceRestriction {
  // TODO: enumerate restriction kinds — mage-only, familiar-only, vis-color,
  // requires-spell-of-color, only-once-per-round, etc.
  kind: string;
  data?: unknown;
}

export interface ActionSpace {
  id: ActionSpaceId;
  roomId: RoomId;
  /** 1 = exclusive; >1 = multi-occupant with escalating join cost. */
  capacity: number;
  occupants: Worker[];
  /**
   * Base cost to occupy the space. Escalating cost for multi-occupant spaces
   * is computed by the engine from `capacity` and current occupancy.
   */
  joinCost?: ResourceBundle;
  /** ID of the registered effect that fires when this space is activated. */
  effectId: EffectId;
  restrictions?: ActionSpaceRestriction[];
}

export interface Room {
  id: RoomId;
  name: string;
  sourcePackId: PackId;
  actionSpaces: ActionSpace[];
  /** Optional effect that resolves at the end of each round. */
  roundEndEffectId?: EffectId;
}

// ---------- Cards ----------

export type SpellType = 'instant' | 'ongoing';

export interface SpellCard {
  id: SpellCardId;
  name: string;
  sourcePackId: PackId;
  /** Vis required to cast. Partial — only colors that cost anything are listed. */
  visCost: Partial<VisSupply>;
  type: SpellType;
  effectId: EffectId;
}

export interface TreasureCard {
  id: TreasureCardId;
  name: string;
  sourcePackId: PackId;
  cost: ResourceBundle;
  effectId: EffectId;
}

// ---------- Councils ----------

/**
 * Built-in scoring criteria. Expansion content may need new criteria; in that
 * case set `customScoringEffectId` on the council tile and the scoring engine
 * will route to the registered effect.
 */
export type ScoringCriterion =
  | 'most-gold'
  | 'most-spells'
  | 'most-treasures'
  | 'most-influence'
  | 'most-vis'
  | 'most-vis-red'
  | 'most-vis-blue'
  | 'most-vis-green'
  | 'most-vis-yellow'
  | 'most-vis-purple'
  | 'most-familiars'
  | 'most-mages-on-board'
  | 'fewest-spells'
  | 'highest-initiative'
  | 'custom';

export interface CouncilTile {
  id: CouncilTileId;
  name: string;
  sourcePackId: PackId;
  scoringCriterion: ScoringCriterion;
  /** Used when `scoringCriterion === 'custom'`. EXPANSION hook. */
  customScoringEffectId?: EffectId;
  /** Hidden until end-game reveal. */
  votes: number;
  revealed: boolean;
}

// ---------- Game state ----------

export type GamePhase =
  | 'setup'
  | 'refresh'
  | 'action'
  | 'resolution'
  | 'mid-scoring'
  | 'final-scoring'
  | 'complete';

export interface InitiativeTrack {
  /** Player ids in current turn order. */
  order: PlayerId[];
  /** Players who have passed in the current action phase. */
  passed: PlayerId[];
}

export interface BoardState {
  rooms: Room[];
}

export interface GameConfig {
  activePackIds: PackId[];
  playerNames: string[];
  rngSeed: number;
  /** Defaults to 5 if omitted. */
  totalRounds?: number;
}

export interface GameState {
  players: Player[];
  board: BoardState;
  councils: CouncilTile[];
  initiativeTrack: InitiativeTrack;
  round: number;
  totalRounds: number;
  phase: GamePhase;
  /** Index into `initiativeTrack.order` of whose turn it is. */
  activePlayerIndex: number;
  /** Card-id draw decks (top of deck = end of array). */
  spellDeck: SpellCardId[];
  treasureDeck: TreasureCardId[];
  /** Visible market rows. */
  spellMarket: SpellCardId[];
  treasureMarket: TreasureCardId[];
  activePackIds: PackId[];
  rngSeed: number;
  // TODO: action log, pending effect resolution stack, choice prompts.
}

// ---------- Actions ----------

export interface PlaceWorkerAction {
  type: 'PLACE_WORKER';
  playerId: PlayerId;
  workerType: WorkerType;
  mageId?: MageId;
  familiarId?: FamiliarId;
  actionSpaceId: ActionSpaceId;
}

export interface CastSpellAction {
  type: 'CAST_SPELL';
  playerId: PlayerId;
  spellCardId: SpellCardId;
  visPaid: Partial<VisSupply>;
  choices?: unknown;
}

export interface BuyTreasureAction {
  type: 'BUY_TREASURE';
  playerId: PlayerId;
  treasureCardId: TreasureCardId;
}

export interface PassTurnAction {
  type: 'PASS_TURN';
  playerId: PlayerId;
}

export interface UseAbilityAction {
  type: 'USE_ABILITY';
  playerId: PlayerId;
  abilityId: AbilityId;
  /** Optional id of the card/mage/treasure that owns the ability. */
  sourceCardId?: string;
  choices?: unknown;
}

export interface AdvancePhaseAction {
  type: 'ADVANCE_PHASE';
}

export type GameAction =
  | PlaceWorkerAction
  | CastSpellAction
  | BuyTreasureAction
  | PassTurnAction
  | UseAbilityAction
  | AdvancePhaseAction;

// ---------- Effect surface ----------

export interface EffectContext {
  state: GameState;
  playerId: PlayerId;
  /** ID of the card/room/ability that triggered this effect, if any. */
  sourceCardId?: string;
  /** Player-supplied choices (e.g., target picks, vis color picks). */
  choices?: unknown;
}

/**
 * Effects return a partial diff. The engine merges it into the next state.
 *
 * TODO: decide on patch semantics — shallow merge today; switch to immer or
 * a typed diff format once nested updates become common.
 */
export type GameStatePatch = Partial<GameState>;
