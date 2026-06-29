import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { getBotPersonality } from '../../game/ai';
import type { GameState } from '../../game/types';
import { activePlayer, botOwnsCurrentDecision, PLAYER_AURA } from '../../utils/uiSelectors';
import { phaseLabel } from '../HUD/TopBar';

/**
 * Live narration of the action currently being taken — a running line that says
 * what's happening (your move, a bot taking its turn, or an active prompt's
 * guidance + Skip). It renders INLINE inside the consolidated MobileTopBar (it
 * used to be its own status row beneath it); folding it into the top bar
 * reclaims the second strip's height for the board. While a bot owns the
 * decision, PromptDirector's floating prompt banners are suppressed on mobile
 * (see PromptDirector), so this note is the single place that says what's up.
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

export function LiveActionNote() {
  const state = useGameStore((s) => s.state);
  const hint = useUiStore((s) => s.mobilePromptHint);
  if (!state) return null;

  const live = liveAction(state);

  if (hint) {
    // An active board/shelf-targeting prompt of the local player's — its
    // guidance + Skip live here; the lit board/cards are the tap target.
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]">
        <span className="shrink-0 animate-breathe text-starlight">✦</span>
        <span className="truncate font-semibold text-starlight">{hint.text}</span>
        {hint.pass && (
          <button
            type="button"
            onClick={hint.pass.onPass}
            className="shrink-0 rounded-full bg-night-700 px-2.5 py-0.5 text-[10px] font-bold text-white/75 ring-1 ring-white/15 active:scale-95"
          >
            {hint.pass.label}
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]">
      {live.bot && <span className="shrink-0 animate-breathe">🤖</span>}
      {live.busy && !live.bot && (
        <span
          className="h-1.5 w-1.5 shrink-0 animate-breathe rounded-full"
          style={{ background: live.aura ?? '#ffe9a8' }}
        />
      )}
      <span
        className={clsx('truncate font-semibold', live.busy ? 'text-white/90' : 'text-white/50')}
      >
        {live.text}
      </span>
    </span>
  );
}
