import { listPacks } from '../../content/registry';
import type { GameAction, GameState } from '../types';

/**
 * Deterministic legal draft pick for a BOT seat during the pre-game draft
 * phases (candidate / mage-draft-first-choice / mage-draft). Returns `null` when
 * the active seat is human-controlled or the phase isn't a draft — so the live
 * bot driver only auto-plays bots and leaves the human's picks to the UI.
 *
 * The bot picks the first legal option (preferring non-neutral leaders / mages),
 * which keeps games reproducible from their seed — no RNG in the driver. The
 * engine validates every pick, so an illegal choice simply can't be produced.
 */

/** candidate id → department, for the one-school-per-player draft rule. */
const DEPT_OF_CANDIDATE = new Map(
  listPacks().flatMap((p) => p.candidates.map((c) => [c.id, c.department] as const)),
);

export function botDraftAction(state: GameState): GameAction | null {
  const phase = state.phase;

  if (phase.kind === 'candidate-draft') {
    const player = state.players[phase.activePlayerIndex];
    if (!player?.controlledByBot) return null;
    const takenIds = new Set(state.players.map((p) => p.candidateId).filter(Boolean));
    const takenDepts = new Set([...takenIds].map((id) => DEPT_OF_CANDIDATE.get(id as string)));
    const pool = listPacks()
      .filter((p) => state.activePackIds.includes(p.id))
      .flatMap((p) => p.candidates);
    // Prefer non-neutral leaders, then fall back to any legal candidate.
    const legal = pool.filter((c) => !takenIds.has(c.id) && !takenDepts.has(c.department));
    const pick = legal.find((c) => c.startingMageColor !== 'neutral') ?? legal[0];
    if (!pick) return null;
    return { type: 'CHOOSE_CANDIDATE', playerId: player.id, candidateId: pick.id };
  }

  if (phase.kind === 'mage-draft-first-choice') {
    const player = state.players[phase.chooserIndex];
    if (!player?.controlledByBot) return null;
    return { type: 'CHOOSE_DRAFT_FIRST', playerId: player.id, draftFirst: true };
  }

  if (phase.kind === 'mage-draft') {
    const player = state.players[phase.pickOrder[phase.nextPickIndex]!];
    if (!player?.controlledByBot) return null;
    const draftable = (c: string) =>
      (state.mageDraftPool[c as keyof typeof state.mageDraftPool] ?? 0) > 0 &&
      player.mages.filter((m) => m.color === c).length < 2;
    const allLegal = Object.keys(state.mageDraftPool).filter(draftable);
    const nonWhite = allLegal.filter((c) => c !== 'off-white');
    const pick = (nonWhite[0] ?? allLegal[0]) as never;
    if (pick === undefined) return null;
    return { type: 'DRAFT_MAGE', playerId: player.id, color: pick };
  }

  return null;
}
