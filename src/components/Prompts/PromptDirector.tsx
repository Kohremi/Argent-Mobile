import clsx from 'clsx';
import { motion } from 'framer-motion';
import type {
  GameState,
  PendingResolution,
  ResolutionAnswer,
} from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import { PortraitBust } from '../Player/PortraitBust';
import { describeTrigger, playerName, topPending } from './promptHelpers';

/**
 * Routes the top of the engine's pendingResolutionStack to a visual
 * interaction (docs/UI_DESIGN.md §8). Sheets answer directly; targeting
 * prompts render a banner here while the board/dock/rail light up via
 * usePromptTargets. Functional pass — the styled cut-in lands in step 6.
 */

interface SheetOption {
  id: string;
  label: string;
  sub?: string | undefined;
}

function ResponderChip({ state, pending }: { state: GameState; pending: PendingResolution }) {
  const player = state.players.find((p) => p.id === pending.responderId);
  const aura = player ? PLAYER_AURA[player.color] : '#ffe9a8';
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-night-800/90 px-2.5 py-0.5 text-xs font-bold ring-1"
      style={{ borderColor: aura, color: aura, boxShadow: `0 0 8px ${aura}44` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: aura }} />
      {player?.name ?? pending.responderId} decides
    </span>
  );
}

/** Shared floating panel: context line, responder, option buttons. */
function ChoiceSheet({
  state,
  pending,
  title,
  options,
  onPick,
  canPass,
  passLabel = 'Pass',
}: {
  state: GameState;
  pending: PendingResolution;
  title: string;
  options: SheetOption[];
  onPick: (id: string) => void;
  canPass?: boolean;
  passLabel?: string;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl animate-pop rounded-card bg-night-700/95 p-3 ring-1 ring-white/15 shadow-card-lift backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-display text-sm font-bold text-starlight">
            {pending.source.description ?? 'Choose'} <span className="text-white/50">▸</span>{' '}
            <span className="text-white/90">{title}</span>
          </p>
          <ResponderChip state={state} pending={pending} />
        </div>
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className="rounded-xl bg-night-600 px-3 py-1.5 text-left text-sm ring-1 ring-white/15 transition hover:-translate-y-0.5 hover:bg-night-600/80 hover:ring-starlight/60"
            >
              <span className="font-semibold text-white/95">{o.label}</span>
              {o.sub && <span className="block text-[11px] text-white/55">{o.sub}</span>}
            </button>
          ))}
          {canPass && (
            <button
              type="button"
              onClick={() =>
                tryDispatch({
                  type: 'RESOLVE_PENDING',
                  resolutionId: pending.id,
                  answer: { kind: 'pass' },
                })
              }
              className="rounded-xl bg-night-800 px-3 py-1.5 text-sm text-white/60 ring-1 ring-white/10 transition hover:text-white/90"
            >
              {passLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Banner for board-targeting prompts (clicks happen on the lit board). */
function TargetBanner({
  state,
  pending,
  text,
  canPass,
}: {
  state: GameState;
  pending: PendingResolution;
  text: string;
  canPass?: boolean | undefined;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center">
      <div className="pointer-events-auto flex animate-pop items-center gap-3 rounded-full bg-night-800/95 px-4 py-2 ring-1 ring-starlight/50 shadow-glow-sm"
        style={{ '--glow': '#ffe9a833' } as React.CSSProperties}
      >
        <p className="font-display text-sm font-bold text-starlight">
          {pending.source.description ?? ''} <span className="text-white/50">▸</span>{' '}
          <span className="text-white/95">{text}</span>
        </p>
        <ResponderChip state={state} pending={pending} />
        {canPass && (
          <button
            type="button"
            onClick={() =>
              tryDispatch({
                type: 'RESOLVE_PENDING',
                resolutionId: pending.id,
                answer: { kind: 'pass' },
              })
            }
            className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/70 ring-1 ring-white/15 hover:text-white"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

/** Reaction interrupt (functional pass; the styled cut-in is build step 6). */
function ReactionCutIn({ state, pending }: { state: GameState; pending: PendingResolution }) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const reactionSlotPick = useUiStore((s) => s.reactionSlotPick);
  const setReactionSlotPick = useUiStore((s) => s.setReactionSlotPick);
  if (pending.prompt.kind !== 'reaction-window') return null;
  const { triggerEvents, reactionOptions } = pending.prompt;

  // Waiting on a destination slot — slim banner; the board is lit.
  if (reactionSlotPick && reactionSlotPick.resolutionId === pending.id) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center">
        <div className="pointer-events-auto flex animate-pop items-center gap-3 rounded-full bg-night-800/95 px-4 py-2 ring-1 ring-leyline/60">
          <p className="font-display text-sm font-bold text-leyline">
            Choose a destination slot
          </p>
          <button
            type="button"
            onClick={() => setReactionSlotPick(null)}
            className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/70 ring-1 ring-white/15 hover:text-white"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const resolve = (answer: ResolutionAnswer) =>
    tryDispatch({ type: 'RESOLVE_PENDING', resolutionId: pending.id, answer });

  const responder = state.players.find((p) => p.id === pending.responderId);
  const responderAura = responder ? PLAYER_AURA[responder.color] : '#b16cea';

  return (
    <div className="absolute inset-0 z-40 overflow-hidden bg-night-900/55 backdrop-saturate-50">
      {/* speed-lines vignette — time freezes */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `repeating-conic-gradient(from 0deg at 85% 35%, transparent 0deg 9deg, ${responderAura}14 9deg 11deg)`,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      />
      {/* impact flash on entry */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-white"
        initial={{ opacity: 0.45 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="absolute inset-x-0 top-1/4 flex justify-center px-4">
        <motion.div
          className="relative w-full max-w-xl rounded-card border-l-8 bg-night-700/95 p-4 pl-20 shadow-card-lift ring-1 ring-white/15"
          style={{ borderLeftColor: responderAura, rotate: -1.5 }}
          initial={{ x: 560, skewX: -14, opacity: 0 }}
          animate={{ x: 0, skewX: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          {/* responder portrait — worried under attack, determined when they
              have an answer ready (docs/UI_DESIGN.md §13.5) */}
          {responder && (
            <motion.span
              className="absolute -left-7 top-1/2"
              initial={{ y: '-50%', scale: 0.6, rotate: -10 }}
              animate={{ y: '-50%', scale: 1, rotate: -4 }}
              transition={{ type: 'spring', stiffness: 380, damping: 20, delay: 0.06 }}
            >
              <PortraitBust
                player={responder}
                state={state}
                expression={reactionOptions.length > 0 ? 'determined' : 'worried'}
                size={84}
              />
            </motion.span>
          )}
          <div className="mb-1 flex items-center justify-between gap-2">
            <p
              className="font-display text-xl font-extrabold uppercase tracking-wide"
              style={{ color: responderAura, textShadow: `0 0 18px ${responderAura}88` }}
            >
              ⚡ Reaction!
            </p>
            <ResponderChip state={state} pending={pending} />
          </div>
          <p className="mb-3 text-sm text-white/85">
            {triggerEvents.map((ev, i) => (
              <span key={i} className="block">{describeTrigger(state, ev)}</span>
            ))}
            <span className="text-white/50">
              — by {playerName(state, pending.source.triggeringPlayerId)} ({pending.source.description})
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {reactionOptions.map((o, i) => (
              <button
                key={`${o.effectId}-${o.forMageId ?? i}`}
                type="button"
                onClick={() => {
                  if (o.requiresSlotPick) {
                    setReactionSlotPick({ resolutionId: pending.id, effectId: o.effectId });
                    return;
                  }
                  resolve({
                    kind: 'reaction-played',
                    effectId: o.effectId,
                    reactionContext: {},
                    ...(o.forMageId ? { forMageId: o.forMageId } : {}),
                  });
                }}
                className="rounded-xl bg-gradient-to-b from-starlight to-amber-300 px-3 py-1.5 text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5"
              >
                {o.label}
                {o.requiresSlotPick && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">
                    then pick slot
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => resolve({ kind: 'reaction-passed' })}
              className={clsx(
                'rounded-xl px-4 py-1.5 text-sm font-bold ring-1 transition',
                reactionOptions.length === 0
                  ? 'bg-gradient-to-b from-starlight to-amber-300 text-ink-900'
                  : 'bg-night-800 text-white/75 ring-white/20 hover:text-white',
              )}
            >
              {reactionOptions.length === 0 ? 'Continue' : 'Take the hit'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export function PromptDirector() {
  const state = useGameStore((s) => s.state);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  if (!state) return null;
  const pending = topPending(state);
  if (!pending) return null;
  const prompt = pending.prompt;

  const answer = (a: ResolutionAnswer) =>
    tryDispatch({ type: 'RESOLVE_PENDING', resolutionId: pending.id, answer: a });
  const pickOption = (optionId: string) =>
    answer({ kind: 'option-chosen', optionId, payload: {} });

  switch (prompt.kind) {
    case 'choose-from-options':
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title="choose one"
          options={prompt.options.map((o) => ({ id: o.id, label: o.label }))}
          onPick={pickOption}
        />
      );
    case 'choose-target-mage':
      return (
        <TargetBanner
          state={state}
          pending={pending}
          text={prompt.label ?? 'Choose a target student'}
          canPass={prompt.canPass}
        />
      );
    case 'choose-target-action-space':
      return (
        <TargetBanner
          state={state}
          pending={pending}
          text={prompt.label ?? 'Choose a slot'}
        />
      );
    case 'choose-vault-card':
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title="choose a Vault card"
          options={prompt.eligibleCardIds.map((id) => {
            const def = lookupVaultCardDef(state, id);
            return { id, label: def?.name ?? id, sub: def?.description };
          })}
          onPick={(id) => answer({ kind: 'card-chosen', cardId: id })}
        />
      );
    case 'choose-supporter-card':
    case 'choose-peeked-supporter':
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title="choose a Supporter"
          options={prompt.eligibleCardIds.map((id) => {
            const def = lookupSupporterCardDef(state, id);
            return { id, label: def?.name ?? id, sub: def?.description };
          })}
          onPick={(id) => answer({ kind: 'card-chosen', cardId: id })}
        />
      );
    case 'choose-spell-level': {
      const def = lookupSpellCardDef(state, prompt.spellId);
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title={`cast ${def?.name ?? prompt.spellId} at…`}
          options={prompt.availableLevels.map((lvl) => {
            const level = def?.levels.find((l) => l.level === lvl);
            return {
              id: String(lvl),
              label: `Level ${lvl}${level?.title ? ` · ${level.title}` : ''}`,
              sub: level?.description,
            };
          })}
          onPick={(id) => answer({ kind: 'level-chosen', level: Number(id) as 1 | 2 | 3 })}
        />
      );
    }
    case 'choose-deck':
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title="choose a deck"
          options={prompt.eligibleDecks.map((d) => ({ id: d, label: `${d} deck` }))}
          onPick={(id) => answer({ kind: 'deck-chosen', deck: id as 'spell' | 'vault' | 'supporter' })}
        />
      );
    case 'choose-voter':
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title="choose a voter to mark"
          options={prompt.eligibleVoterIds.map((id) => {
            const v = state.voters.find((vv) => vv.id === id);
            return {
              id,
              label: v?.name ?? id,
              sub: v?.revealed || v?.isAlwaysFaceUp ? v?.description : 'Face-down voter',
            };
          })}
          onPick={(id) => answer({ kind: 'voter-chosen', voterId: id })}
        />
      );
    case 'reaction-window':
      return <ReactionCutIn state={state} pending={pending} />;
    case 'confirm':
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title={prompt.message}
          options={[{ id: 'ok', label: 'Confirm' }]}
          onPick={() => answer({ kind: 'confirmed' })}
        />
      );
    default:
      return null;
  }
}
