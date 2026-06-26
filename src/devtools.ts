// Dev-only helpers, attached to `window.__dev` in `vite dev` (guarded by
// import.meta.env.DEV in main.tsx, so this never ships in a build). Lets a
// screenshot/automation harness jump straight to an in-game board state without
// clicking through setup + drafts. The game-driving loop mirrors the all-bot
// fuzzer in boardInvariant.test.ts.
import { applyAction, initGame } from './game/engine';
import { getPack, listPacks } from './content/registry';
import { getBotPersonality } from './game/ai';
import { botDecisionContext } from './utils/uiSelectors';
import { createRng } from './utils/rng';
import { useGameStore } from './store/gameStore';
import type { GameAction, GameState, PackId, ScenarioId } from './game/types';

const PERSONALITIES = ['klank', 'malfoy', 'thickhide', 'darthpotter'];

const DEPT_OF_CANDIDATE = new Map(
  listPacks().flatMap((p) => p.candidates.map((c) => [c.id, c.department] as const)),
);

interface PlayToOpts {
  /** Phase to stop at (default 'errands'). */
  targetPhase?: GameState['phase']['kind'];
  seed?: number;
  players?: number;
  packIds?: PackId[];
  scenarioId?: ScenarioId;
  /** Min number of Errands actions to let bots take before stopping (so the
   *  board looks lived-in rather than empty). Default 2× player count. */
  minErrandsActions?: number;
  /** Leave seats as bots (keeps the live driver auto-running). Default false —
   *  flips every seat to human so the injected state is frozen for inspection. */
  keepBots?: boolean;
  /** Single-player: keep seat 0 human (the rest bots) + bind localPlayerId, and
   *  stop on the human's turn. Mirrors a real solo game for inspection. */
  singlePlayer?: boolean;
}

/** Compute the next all-bot action for the current state (drafts + play). */
function nextAction(s: GameState, candidateIds: string[], rnd: (n: number) => number, rng: () => number): GameAction | null {
  const ctx = botDecisionContext(s);
  if (ctx?.kind === 'advance') return { type: 'ADVANCE_PHASE' };
  if (ctx?.kind === 'prompt') {
    const bot = getBotPersonality(s.players.find((p) => p.id === ctx.pending.responderId)?.botPersonalityId);
    return { type: 'RESOLVE_PENDING', resolutionId: ctx.pending.id, answer: bot.answerPendingResolution(s, ctx.pending) };
  }
  if (ctx?.kind === 'errands') {
    const bot = getBotPersonality(s.players.find((p) => p.id === ctx.playerId)?.botPersonalityId);
    return bot.chooseErrandsAction(s, ctx.playerId);
  }
  switch (s.phase.kind) {
    case 'candidate-draft': {
      const pid = s.players[s.phase.activePlayerIndex]!.id;
      const takenIds = new Set(s.players.map((p) => p.candidateId).filter(Boolean));
      const takenDepts = new Set([...takenIds].map((id) => DEPT_OF_CANDIDATE.get(id as string)));
      const avail = candidateIds.filter((id) => !takenIds.has(id) && !takenDepts.has(DEPT_OF_CANDIDATE.get(id)));
      return { type: 'CHOOSE_CANDIDATE', playerId: pid, candidateId: avail[rnd(avail.length)]! };
    }
    case 'mage-draft-first-choice':
      return { type: 'CHOOSE_DRAFT_FIRST', playerId: s.players[s.phase.chooserIndex]!.id, draftFirst: rng() < 0.5 };
    case 'mage-draft': {
      const player = s.players[s.phase.pickOrder[s.phase.nextPickIndex]!]!;
      const draftable = (c: string) =>
        (s.mageDraftPool[c as keyof typeof s.mageDraftPool] ?? 0) > 0 &&
        player.mages.filter((m) => m.color === c).length < 2;
      const allLegal = Object.keys(s.mageDraftPool).filter(draftable);
      const nonWhite = allLegal.filter((c) => c !== 'off-white');
      const pool = nonWhite.length > 0 ? nonWhite : allLegal;
      return { type: 'DRAFT_MAGE', playerId: player.id, color: pool[rnd(pool.length)] as never };
    }
    default:
      return null;
  }
}

function playTo(opts: PlayToOpts = {}): string {
  const {
    targetPhase = 'errands',
    seed = 7,
    players = 4,
    packIds = ['base'],
    scenarioId,
    keepBots = false,
    singlePlayer = false,
  } = opts;
  const minErrandsActions = opts.minErrandsActions ?? players * 2;

  const candidateIds = getPack('base')!
    .candidates.filter((c) => c.startingMageColor !== 'neutral')
    .map((c) => c.id);
  const rng = createRng((seed * 2654435761) | 0);
  const rnd = (n: number) => Math.floor(rng() * n);

  let s = initGame({
    activePackIds: packIds,
    playerNames: Array.from({ length: players }, (_, i) => `Player ${i + 1}`),
    rngSeed: seed,
    controlledByBot: Array.from({ length: players }, () => true),
    botPersonalityIds: PERSONALITIES.slice(0, players),
    useCandidateDraft: true,
    roomLayoutMode: { kind: 'random' },
    ...(scenarioId ? { scenarioId } : {}),
  });

  let errandsActions = 0;
  let steps = 0;
  while (s.phase.kind !== 'complete' && steps < 40000) {
    const activeIsLocal =
      s.phase.kind === 'errands' && s.phase.activePlayerIndex === 0;
    if (
      s.phase.kind === targetPhase &&
      s.pendingResolutionStack.length === 0 &&
      errandsActions >= minErrandsActions &&
      // In single-player, stop on the human's (seat 0) turn for a clean shot.
      (!singlePlayer || activeIsLocal)
    ) {
      break;
    }
    const action = nextAction(s, candidateIds, rnd, rng);
    if (!action) break;
    const wasErrands = s.phase.kind === 'errands';
    s = applyAction(s, action);
    if (wasErrands) errandsActions++;
    steps++;
  }

  if (singlePlayer) {
    // Seat 0 is the human; the rest stay bots and are driven by useBotDriver.
    s = {
      ...s,
      players: s.players.map((p, i) => ({ ...p, controlledByBot: i !== 0 })),
    };
    useGameStore.setState({ state: s });
    useGameStore.getState().setLocalPlayerId(s.players[0]!.id);
  } else {
    if (!keepBots) {
      s = { ...s, players: s.players.map((p) => ({ ...p, controlledByBot: false })) };
    }
    useGameStore.setState({ state: s });
  }
  return `${s.phase.kind} (${errandsActions} errands actions, ${steps} steps)`;
}

export function installDevTools(): void {
  (window as unknown as { __dev: unknown }).__dev = {
    playTo,
    store: useGameStore,
    reset: () => useGameStore.setState({ state: null }),
  };
  // eslint-disable-next-line no-console
  console.log('[devtools] window.__dev ready — __dev.playTo({ players, seed, targetPhase })');
}
