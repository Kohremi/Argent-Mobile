import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { computeFinalScoring } from '../../game/scoring';
import { useGameStore } from '../../store/gameStore';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import { PortraitBust } from '../Player/PortraitBust';

/**
 * The Election (docs/UI_DESIGN.md §12.D): staged end-game ceremony. Voter
 * awards reveal one at a time under the night sky; running totals tick up
 * on the podium; the Archmage-Elect title card closes the game. Click to
 * advance, or skip to the result.
 */
export function ScoringCeremony() {
  const state = useGameStore((s) => s.state);
  const reset = useGameStore((s) => s.reset);
  const result = useMemo(
    () => (state && state.phase.kind === 'complete' ? computeFinalScoring(state) : null),
    [state],
  );
  const [stage, setStage] = useState(0);

  const totalStages = (result?.voterAwards.length ?? 0) + 1;
  useEffect(() => {
    if (!result || stage >= totalStages) return;
    const t = setTimeout(() => setStage((s) => s + 1), 1300);
    return () => clearTimeout(t);
  }, [result, stage, totalStages]);

  if (!state || state.phase.kind !== 'complete' || !result) return null;

  const revealed = result.voterAwards.slice(0, stage);
  const done = stage >= totalStages;
  const archmage = state.players.find((p) => p.id === result.archmage);

  // Running vote totals across the awards revealed so far.
  const running = new Map<string, number>();
  for (const award of revealed) {
    if (award.winnerPlayerId) {
      running.set(award.winnerPlayerId, (running.get(award.winnerPlayerId) ?? 0) + award.votes);
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center overflow-y-auto bg-night-900/97 px-6 py-8"
      onClick={() => setStage((s) => Math.min(s + 1, totalStages))}
    >
      <h2 className="font-display text-3xl font-extrabold text-starlight">The Election</h2>
      <p className="mb-4 text-xs uppercase tracking-[0.3em] text-white/50">
        the consortium votes
      </p>

      {/* podium: running totals */}
      <div className="mb-5 flex items-end gap-3">
        {state.players.map((p) => {
          const aura = PLAYER_AURA[p.color];
          const votes = running.get(p.id) ?? 0;
          const isArchmage = done && result.archmage === p.id;
          return (
            <motion.div
              key={p.id}
              layout
              className={clsx(
                'flex min-w-[92px] flex-col items-center rounded-card px-3 py-2 ring-1',
                isArchmage ? 'bg-night-600 ring-starlight shadow-glow' : 'bg-night-700 ring-white/10',
              )}
              style={{ '--glow': isArchmage ? '#ffe9a866' : 'transparent' } as never}
            >
              <PortraitBust
                player={p}
                state={state}
                expression={isArchmage ? 'smug' : done ? 'worried' : 'neutral'}
                size={40}
                className="mb-1"
              />
              <span className="font-display text-sm font-bold" style={{ color: aura }}>
                {p.name}
              </span>
              <motion.span
                key={votes}
                initial={{ scale: 1.6 }}
                animate={{ scale: 1 }}
                className="font-arcane text-2xl text-white/95"
              >
                {votes}
              </motion.span>
              <span className="text-[9px] uppercase tracking-widest text-white/40">votes</span>
            </motion.div>
          );
        })}
      </div>

      {/* award reveals */}
      <div className="flex w-full max-w-xl flex-col gap-1.5">
        {revealed.map((award) => {
          const winner = state.players.find((p) => p.id === award.winnerPlayerId);
          const aura = winner ? PLAYER_AURA[winner.color] : '#9aa0b4';
          return (
            <motion.div
              key={award.voterId}
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="flex items-center justify-between rounded-card bg-parchment-50 px-3 py-1.5 text-ink-900 shadow-card"
            >
              <span className="text-sm font-bold">
                {award.voterName}
                <span className="ml-1.5 rounded-full bg-ink-900/10 px-1.5 text-[10px] font-extrabold">
                  {award.votes}🗳
                </span>
                {award.tiebreaker && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-widest text-black/40">
                    tiebreak: {award.tiebreaker}
                  </span>
                )}
              </span>
              {winner ? (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-extrabold text-ink-900"
                  style={{ background: aura }}
                >
                  {winner.name}
                </span>
              ) : (
                <span className="text-xs italic text-black/45">no winner</span>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* finale */}
      {done && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="mt-6 flex flex-col items-center"
        >
          {archmage ? (
            <>
              <PortraitBust
                player={archmage}
                state={state}
                expression="smug"
                size={104}
                className="mb-2"
              />
              <p className="text-xs uppercase tracking-[0.4em] text-white/60">archmage-elect</p>
              <p
                className="font-display text-5xl font-extrabold"
                style={{
                  color: PLAYER_AURA[archmage.color],
                  textShadow: `0 0 32px ${PLAYER_AURA[archmage.color]}aa`,
                }}
              >
                {archmage.name}
              </p>
              {result.tiebreaker !== 'votes' && (
                <p className="mt-1 text-[10px] uppercase tracking-widest text-white/45">
                  decided by {result.tiebreaker}
                </p>
              )}
            </>
          ) : (
            <p className="font-display text-3xl font-bold text-white/80">
              No Archmage — the Consortium is deadlocked.
            </p>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
            className="mt-5 rounded-full bg-gradient-to-b from-starlight to-amber-300 px-5 py-2 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5"
          >
            New game
          </button>
        </motion.div>
      )}

      {!done && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setStage(totalStages);
          }}
          className="mt-5 rounded-full bg-night-700 px-4 py-1.5 text-xs text-white/70 ring-1 ring-white/15 hover:text-white"
        >
          Skip to result
        </button>
      )}
    </div>
  );
}
