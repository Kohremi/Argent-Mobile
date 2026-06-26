import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { getBotPersonality } from '../../game/ai';
import type { GameState } from '../../game/types';
import { activePlayer, botOwnsCurrentDecision, PLAYER_AURA } from '../../utils/uiSelectors';
import { phaseLabel } from '../HUD/TopBar';

/**
 * The mobile shell's second status row, sitting in normal flow directly beneath
 * the top bar. It owns two jobs that used to fight the board for space:
 *   1. round / phase context ("the rounds etc"), and
 *   2. a running narration of the action currently being taken.
 * Because it's an in-flow row (not an absolute popover), the live action no
 * longer flashes over the board. While a bot owns the decision, PromptDirector's
 * floating prompt banners are suppressed on mobile (see PromptDirector) and this
 * row is the single place that says what's happening.
 */

type Live = { text: string; busy: boolean; bot: boolean; aura?: string };

function liveAction(state: GameState): Live {
  const active = activePlayer(state);
  const top = state.pendingResolutionStack[state.pendingResolutionStack.length - 1] ?? null;

  if (botOwnsCurrentDecision(state)) {
    const activeBot = active?.controlledByBot ? active : null;
    const respondingBot = top
      ? state.players.find((p) => p.id === top.responderId && p.controlledByBot) ?? null
      : null;
    const bot = respondingBot ?? activeBot;
    const who = getBotPersonality(bot?.botPersonalityId).name;
    if (activeBot && !top) {
      return {
        text: `${who} is taking ${activeBot.name}'s turn…`,
        busy: true,
        bot: true,
        aura: PLAYER_AURA[activeBot.color],
      };
    }
    const what = top?.source.description;
    return {
      text: what ? `${who} ▸ ${what}` : `${who} is responding…`,
      busy: true,
      bot: true,
      ...(bot ? { aura: PLAYER_AURA[bot.color] } : {}),
    };
  }

  if (top) {
    return {
      text: top.source.description ?? 'Awaiting your choice…',
      busy: true,
      bot: false,
      ...(active ? { aura: PLAYER_AURA[active.color] } : {}),
    };
  }
  if (active) {
    return { text: `${active.name}'s move`, busy: false, bot: false, aura: PLAYER_AURA[active.color] };
  }
  return { text: phaseLabel(state.phase), busy: false, bot: false };
}

export function MobileActionRow() {
  const state = useGameStore((s) => s.state);
  if (!state) return null;

  const round = 'round' in state.phase ? (state.phase.round as number) : null;
  const live = liveAction(state);

  return (
    <div className="z-20 flex h-7 shrink-0 items-center gap-2 bg-night-900/80 px-3 text-[11px] ring-1 ring-white/5">
      <span className="shrink-0 font-display font-bold uppercase tracking-wide text-white/70">
        {round != null ? `Round ${round}` : phaseLabel(state.phase)}
      </span>
      <span className="h-3 w-px shrink-0 bg-white/15" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {live.bot && <span className="shrink-0 animate-breathe">🤖</span>}
        {live.busy && !live.bot && (
          <span
            className="h-1.5 w-1.5 shrink-0 animate-breathe rounded-full"
            style={{ background: live.aura ?? '#ffe9a8' }}
          />
        )}
        <span
          className={clsx(
            'truncate font-semibold',
            live.busy ? 'text-white/90' : 'text-white/50',
          )}
        >
          {live.text}
        </span>
      </span>
    </div>
  );
}
