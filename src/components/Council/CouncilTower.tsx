import { useState } from 'react';
import clsx from 'clsx';
import type { ConsortiumVoter, GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { activePlayer, PLAYER_AURA } from '../../utils/uiSelectors';

/**
 * Right rail: the Consortium (docs/UI_DESIGN.md §9.4). One tile per voter —
 * rune-backed while face-down, name + criterion + votes once revealed —
 * with players' wax-seal marks stamped along the bottom edge.
 *
 * Privacy: marking a voter means you LOOKED at it, so the active player may
 * privately re-check any voter they've marked. The peek is hold-to-view
 * (press 👁, release to hide) — transient by design, so a glance over the
 * shoulder never leaves it face-up.
 */

function VoterTile({ state, voter }: { state: GameState; voter: ConsortiumVoter }) {
  const marks = state.voterMarks.filter((m) => m.voterId === voter.id);
  const active = activePlayer(state);
  const canPeek =
    !voter.revealed &&
    !voter.isAlwaysFaceUp &&
    active !== null &&
    marks.some((m) => m.playerId === active.id);
  const [peeking, setPeeking] = useState(false);
  const faceUp = voter.revealed || voter.isAlwaysFaceUp || (canPeek && peeking);

  return (
    <div
      className={clsx(
        'relative rounded-card p-2 ring-1 transition',
        faceUp
          ? 'bg-parchment-50 text-ink-900 ring-black/10'
          : 'bg-night-600/90 ring-white/15',
        canPeek && peeking && 'ring-2 ring-starlight',
      )}
    >
      {faceUp ? (
        <>
          <p className="font-display text-[13px] font-bold leading-tight">
            {voter.name}
            <span className="ml-1 rounded-full bg-ink-900/10 px-1.5 font-body text-[10px] font-extrabold">
              {voter.votes}🗳
            </span>
          </p>
          {voter.title && (
            <p className="text-[9px] uppercase tracking-widest text-black/45">{voter.title}</p>
          )}
          {voter.description && (
            <p className="mt-0.5 text-[11px] leading-snug text-black/70">{voter.description}</p>
          )}
        </>
      ) : (
        <div className="flex h-12 items-center justify-center">
          {/* rune back */}
          <span className="font-arcane text-2xl text-leyline/50">✦</span>
          <span className="ml-2 text-[10px] uppercase tracking-widest text-white/40">
            sealed voter
          </span>
        </div>
      )}

      {/* hold-to-peek for voters the active player has marked */}
      {canPeek && (
        <button
          type="button"
          title="You marked this voter — hold to peek"
          onPointerDown={() => setPeeking(true)}
          onPointerUp={() => setPeeking(false)}
          onPointerLeave={() => setPeeking(false)}
          onContextMenu={(e) => e.preventDefault()}
          className={clsx(
            'absolute -top-1.5 left-2 select-none rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 transition',
            peeking
              ? 'bg-starlight text-ink-900 ring-starlight'
              : 'bg-night-800 text-starlight ring-starlight/50 hover:ring-starlight',
          )}
        >
          👁 {peeking ? 'peeking' : 'hold'}
        </button>
      )}

      {/* wax-seal marks */}
      {marks.length > 0 && (
        <div className="absolute -bottom-1.5 right-2 flex gap-1">
          {marks.map((m, i) => {
            const player = state.players.find((p) => p.id === m.playerId);
            const aura = player ? PLAYER_AURA[player.color] : '#ffe9a8';
            return (
              <span
                key={`${m.playerId}-${i}`}
                title={`${player?.name ?? m.playerId}'s mark`}
                className="h-4 w-4 rounded-full ring-2 ring-night-900/60"
                style={{
                  background: `radial-gradient(circle at 35% 30%, ${aura}, ${aura}aa)`,
                  boxShadow: `0 1px 3px #00000088`,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CouncilTower() {
  const state = useGameStore((s) => s.state);
  if (!state || state.voters.length === 0) return null;

  return (
    <aside className="z-20 flex w-52 shrink-0 flex-col gap-1.5 overflow-y-auto p-2">
      <p className="px-1 font-display text-sm font-bold text-starlight">
        The Consortium
        <span className="ml-2 text-[10px] font-normal uppercase tracking-widest text-white/40">
          {state.voters.length} voters
        </span>
      </p>
      {state.voters.map((v) => (
        <VoterTile key={v.id} state={state} voter={v} />
      ))}
    </aside>
  );
}
