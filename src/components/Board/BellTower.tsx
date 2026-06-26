import clsx from 'clsx';
import type { GameState } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, claimableBellCards } from '../../utils/uiSelectors';

/**
 * The Bell Tower, sitting over the campus as the round's clock/sun (§1 — "the
 * bell tower is the sun"): the round's offerings laid out as claimable cards.
 * Lives on the board itself rather than a cramped HUD popover — thematic, and
 * there's room for the full card text. Claimable offerings glow on the active
 * player's turn (claiming ends the turn); a bot's turn shows them static.
 */
export function BellTower({ state, onClaim }: { state: GameState; onClaim?: () => void }) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const player = activePlayer(state);
  // Only the active HUMAN may claim; on a bot's turn the offerings are read-only.
  const claimable =
    player && !player.controlledByBot
      ? claimableBellCards(state, player.id)
      : new Set<string>();
  const bells = state.bellTower.available;

  return (
    <section className="rounded-card bg-gradient-to-b from-night-700/70 to-night-800/50 p-2 ring-1 ring-amber-300/20">
      <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-200/70">
        🔔 Bell Tower
        <span className="font-normal normal-case tracking-normal text-white/35">
          {bells.length > 0 ? 'claiming a bell ends your turn' : 'all bells claimed'}
        </span>
      </p>

      {bells.length === 0 ? (
        <p className="px-0.5 py-1 text-[11px] italic text-white/40">
          Nightfall comes when the turn ends.
        </p>
      ) : (
        <div className="flex flex-wrap justify-center gap-1.5">
          {bells.map((card) => {
            const ok = claimable.has(card.id);
            return (
              <button
                key={card.id}
                type="button"
                data-bell
                disabled={!ok}
                onClick={() => {
                  if (
                    player &&
                    tryDispatch({
                      type: 'CLAIM_BELL_TOWER',
                      playerId: player.id,
                      bellTowerCardId: card.id,
                    })
                  ) {
                    onClaim?.();
                  }
                }}
                title={ok ? `Claim ${card.name} — ends your turn` : card.name}
                className={clsx(
                  'flex w-44 shrink-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left ring-1 transition',
                  ok
                    ? 'animate-breathe cursor-pointer bg-night-600 ring-starlight/60 shadow-glow-sm hover:-translate-y-0.5 hover:ring-starlight'
                    : 'bg-night-800/70 opacity-70 ring-white/10',
                )}
                style={ok ? ({ '--glow': '#ffe9a877' } as React.CSSProperties) : undefined}
              >
                <span className="flex items-center gap-1 text-[11px] font-bold text-white/95">
                  {card.name}
                  {ok && (
                    <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide text-starlight">
                      claim ✦
                    </span>
                  )}
                </span>
                <span className="line-clamp-3 text-[10px] leading-snug text-white/65">
                  {card.description}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
