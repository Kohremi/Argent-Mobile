// Pure game engine. No React, no DOM, no I/O.
// Everything here is deterministic given (state, action), with all randomness
// living inside state.rng (a serializable RngState).

import { getPack } from '../content/registry';
import { validateAction } from './actions';
import { computeFinalScoring } from './scoring';
import { buildInitialState } from './setup';
import type {
  BellTowerCard,
  BellTowerCardId,
  ConsortiumVoter,
  GameAction,
  GameConfig,
  GameState,
  RoundNumber,
} from './types';

// Side-effect import: triggers effect registration for all packs at app start.
import './effects';

/** Builds a fresh GameState from setup config. */
export function initGame(config: GameConfig): GameState {
  return buildInitialState(config);
}

/** Pure reducer. Validates the action, then dispatches per-action. */
export function applyAction(state: GameState, action: GameAction): GameState {
  validateAction(state, action);

  switch (action.type) {
    case 'PLACE_WORKER':
    case 'CAST_SPELL':
    case 'BUY_VAULT_CARD':
    case 'RECRUIT_SUPPORTER':
    case 'PASS_TURN':
    case 'USE_ABILITY':
    case 'RESOLVE_PENDING':
      throw new Error(
        `applyAction: action "${action.type}" not yet implemented (phase=${state.phase.kind})`,
      );
    case 'ADVANCE_PHASE':
      return handleAdvancePhase(state);
    default: {
      const exhaustive: never = action;
      throw new Error(`applyAction: unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ============================================================================
// Phase machine
// ============================================================================

function handleAdvancePhase(state: GameState): GameState {
  switch (state.phase.kind) {
    case 'setup':
      // Not reachable in normal play (initGame produces round-setup directly),
      // but kept for safety so the union is exhaustively handled.
      return { ...state, phase: { kind: 'round-setup', round: 1 } };
    case 'round-setup':
      return processRoundSetup(state, state.phase.round);
    case 'errands':
      return processErrandsAdvance(state);
    case 'resolution':
      return processResolutionStep(state);
    case 'mid-game-scoring':
      return processMidGameScoring(state, state.phase.round);
    case 'final-scoring':
      // Reachable only if a future caller produces this phase explicitly.
      // Our happy path goes mid-game-scoring (round 5) → directly to complete.
      return finalizeGame(state);
    case 'complete':
      return state;
  }
}

/**
 * Round Setup phase. Round 1 starts cleanly from `buildInitialState`'s output,
 * so refresh logic is skipped. Round 2+ refreshes exhausted Spells/Treasures,
 * Merit Badges, and redeals all tableaus + the Bell Tower. Then transitions
 * to errands with the first player going first.
 */
function processRoundSetup(state: GameState, round: RoundNumber): GameState {
  let updated = state;
  if (round > 1) {
    updated = refreshPlayerCardsAndMerit(updated);
    updated = redealTableaus(updated);
    updated = restoreBellTower(updated);
  }

  // Run any room setupEffectId. Effects are no-ops in scaffold; resolving via
  // the registry would require effects to be implemented. Skip for now.
  // TODO: invoke setup effects once the effect resolution model is in place.

  return {
    ...updated,
    phase: {
      kind: 'errands',
      round,
      activePlayerIndex: state.firstPlayerIndex,
    },
  };
}

function refreshPlayerCardsAndMerit(state: GameState): GameState {
  const players = state.players.map((p) => ({
    ...p,
    ownedSpells: p.ownedSpells.map((s) => ({ ...s, exhausted: false })),
    vaultCards: p.vaultCards.map((v) => ({ ...v, exhausted: false })),
    resources: {
      ...p.resources,
      meritBadges: p.resources.meritBadges + p.resources.meritBadgesSpent,
      meritBadgesSpent: 0,
    },
    bellTowerCards: [],
  }));
  return { ...state, players };
}

function redealTableaus(state: GameState): GameState {
  // Spell tableau: return current to bottom of deck, deal 3.
  const spellPool = [...state.spellDeck, ...state.spellTableau];
  const spellTableau = spellPool.slice(0, 3);
  const spellDeck = spellPool.slice(3);

  // Vault tableau: return current to bottom of deck, deal 3.
  const vaultPool = [...state.vaultDeck, ...state.vaultTableau];
  const vaultTableau = vaultPool.slice(0, 3);
  const vaultDeck = vaultPool.slice(3);

  // Supporter tableau: return current to bottom of deck, deal 5.
  const supporterPool = [...state.supporterDeck, ...state.supporterTableau];
  const supporterTableau = supporterPool.slice(0, 5);
  const supporterDeck = supporterPool.slice(5);

  return {
    ...state,
    spellDeck,
    spellTableau,
    vaultDeck,
    vaultTableau,
    supporterDeck,
    supporterTableau,
  };
}

/**
 * Brings every taken Bell Tower card back to `available`. Looks them up
 * through the content registry — `taken` only stores the card id, not the
 * full definition, so we rehydrate from the active pack.
 */
function restoreBellTower(state: GameState): GameState {
  const restored: BellTowerCard[] = [];
  for (const t of state.bellTower.taken) {
    const card = lookupBellTowerCard(state, t.cardId);
    if (card) restored.push(card);
  }
  return {
    ...state,
    bellTower: {
      available: [...state.bellTower.available, ...restored],
      taken: [],
    },
  };
}

function lookupBellTowerCard(
  state: GameState,
  cardId: BellTowerCardId,
): BellTowerCard | null {
  for (const packId of state.activePackIds) {
    const pack = getPack(packId);
    if (!pack) continue;
    const found = pack.bellTowerCards.find((c) => c.id === cardId);
    if (found) return found;
  }
  return null;
}

/**
 * Errands phase advance. Per rulebook, the round ends as soon as the last
 * Bell Tower offering is taken, which we model as `bellTower.available`
 * being empty. Otherwise turn passes clockwise.
 */
function processErrandsAdvance(state: GameState): GameState {
  if (state.phase.kind !== 'errands') {
    throw new Error('processErrandsAdvance: not in errands phase');
  }
  if (state.bellTower.available.length === 0) {
    return {
      ...state,
      phase: {
        kind: 'resolution',
        round: state.phase.round,
        pendingRoomIndex: 0,
        pendingSpaceIndex: 0,
      },
    };
  }
  const next = (state.phase.activePlayerIndex + 1) % state.players.length;
  return {
    ...state,
    phase: { ...state.phase, activePlayerIndex: next },
  };
}

/**
 * Resolution step. Each ADVANCE_PHASE call resolves one occupied space, or
 * skips through any number of empty / instant / Infirmary slots until it
 * either finds an occupant or exhausts the room list.
 */
function processResolutionStep(state: GameState): GameState {
  if (state.phase.kind !== 'resolution') {
    throw new Error('processResolutionStep: not in resolution phase');
  }
  const round = state.phase.round;
  let roomIdx = state.phase.pendingRoomIndex;
  let spaceIdx = state.phase.pendingSpaceIndex;

  while (roomIdx < state.rooms.length) {
    const room = state.rooms[roomIdx];
    if (!room) {
      roomIdx++;
      spaceIdx = 0;
      continue;
    }

    // Instant rooms and the Infirmary already resolved at placement.
    if (room.isInstantRoom || room.cannotBePlacedInDirectly) {
      roomIdx++;
      spaceIdx = 0;
      continue;
    }

    if (spaceIdx >= room.actionSpaces.length) {
      roomIdx++;
      spaceIdx = 0;
      continue;
    }

    const space = room.actionSpaces[spaceIdx];
    if (!space) {
      spaceIdx++;
      continue;
    }
    if (space.occupant === null) {
      spaceIdx++;
      continue;
    }

    // Found an occupied space. TODO: apply space.effectId, return Mage to
    // owner's office, log entry. For now, just advance pointers — the test
    // spine drives the phase machine without occupants.
    return {
      ...state,
      phase: {
        kind: 'resolution',
        round,
        pendingRoomIndex: roomIdx,
        pendingSpaceIndex: spaceIdx + 1,
      },
    };
  }

  return {
    ...state,
    phase: { kind: 'mid-game-scoring', round },
  };
}

/**
 * Mid-game scoring is a no-op for the base game. Reserved for expansions
 * (Era of Ascension may score per round).
 *
 * Transitions to round-setup for round+1, OR runs final scoring at round 5.
 */
function processMidGameScoring(state: GameState, round: RoundNumber): GameState {
  // EXPANSION: invoke per-round scoring effects here (none in base).

  if (round < 5) {
    const next = (round + 1) as RoundNumber;
    return { ...state, phase: { kind: 'round-setup', round: next } };
  }
  return finalizeGame(state);
}

function finalizeGame(state: GameState): GameState {
  const revealedVoters: ConsortiumVoter[] = state.voters.map((v) => ({
    ...v,
    revealed: true,
  }));
  const result = computeFinalScoring({ ...state, voters: revealedVoters });
  return {
    ...state,
    voters: revealedVoters,
    phase: { kind: 'complete', archmage: result.archmage },
  };
}
