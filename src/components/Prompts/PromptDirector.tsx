import clsx from 'clsx';
import { motion } from 'framer-motion';
import type {
  GameState,
  OwnedSpell,
  PendingResolution,
  ResolutionAnswer,
} from '../../game/types';
import {
  buildInfirmaryBonusOptions,
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
  nextResearchLevel,
} from '../../game/effects/helpers';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { DEPT_HUE, PLAYER_AURA } from '../../utils/uiSelectors';
import { TIMING_HUE, TIMING_LABEL } from '../Cards/HandFans';
import { MageToken } from '../Board/MageToken';
import { PortraitBust } from '../Player/PortraitBust';
import { describeTrigger, playerName, promptDraftsFromShelf, topPending } from './promptHelpers';

/**
 * Research is a multi-step chain of generic `choose-from-options` prompts —
 * detectable by the effect each resumes into. We render it as a visual sheet
 * (spell tableau to draft from + the player's hand to advance) instead of
 * text buttons. Because the store dispatches synchronously, a click on the
 * top-level menu can pick the category and the specific card in one go.
 */
const RESEARCH_MENU = 'base.system.spend-research';
const RESEARCH_DRAFT = 'base.system.research-draft';
const RESEARCH_ADD_WIS = 'base.system.research-add-wis';
/** Adventuring Side B's revealed-pool draft (composite `kind::cardId` options). */
const ADVENTURING_B_DRAFT = 'base.room.adventuring-b.draft';

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
  /** When false, the button is dimmed and unclickable (engine would reject). */
  available?: boolean | undefined;
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
          {options.map((o) => {
            const disabled = o.available === false;
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                title={disabled ? o.sub : undefined}
                onClick={() => onPick(o.id)}
                className={clsx(
                  'rounded-xl px-3 py-1.5 text-left text-sm ring-1 transition',
                  disabled
                    ? 'cursor-not-allowed bg-night-800 text-white/40 ring-white/10'
                    : 'bg-night-600 text-white/95 ring-white/15 hover:-translate-y-0.5 hover:bg-night-600/80 hover:ring-starlight/60',
                )}
              >
                <span className="font-semibold">{o.label}</span>
                {o.sub && (
                  <span className="block text-[11px] text-white/55">{o.sub}</span>
                )}
              </button>
            );
          })}
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

/**
 * Hot-seat privacy curtain (docs/UI_DESIGN.md §9.4): secret content stays
 * hidden behind a full-screen interstitial until the responder confirms
 * everyone else has looked away.
 */
function PrivacyCurtain({
  state,
  responderId,
  title,
  onReveal,
}: {
  state: GameState;
  responderId: string;
  title: string;
  onReveal: () => void;
}) {
  const responder = state.players.find((p) => p.id === responderId);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-night-900/97 backdrop-blur">
      {responder && (
        <PortraitBust player={responder} state={state} expression="determined" size={88} />
      )}
      <p className="mt-3 font-display text-2xl font-extrabold text-starlight">
        {responder?.name ?? responderId} only!
      </p>
      <p className="mt-1 text-sm text-white/70">{title}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-[0.3em] text-white/40">
        everyone else — eyes away ✨
      </p>
      <button
        type="button"
        onClick={onReveal}
        className="mt-5 rounded-full bg-gradient-to-b from-starlight to-amber-300 px-6 py-2 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5"
      >
        👁 Reveal to me
      </button>
    </div>
  );
}

/** Banner for board-targeting prompts (clicks happen on the lit board). */
function TargetBanner({
  state,
  pending,
  text,
  canPass,
  onPass,
  passLabel = 'Skip',
}: {
  state: GameState;
  pending: PendingResolution;
  text: string;
  canPass?: boolean | undefined;
  /** Custom pass handler (e.g. an option-chosen 'pass'); defaults to a
   *  `pass` answer. */
  onPass?: (() => void) | undefined;
  passLabel?: string;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const showPass = canPass || onPass;
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
        {showPass && (
          <button
            type="button"
            onClick={() =>
              onPass
                ? onPass()
                : tryDispatch({
                    type: 'RESOLVE_PENDING',
                    resolutionId: pending.id,
                    answer: { kind: 'pass' },
                  })
            }
            className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/70 ring-1 ring-white/15 hover:text-white"
          >
            {passLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Finds a mage and its owning player by mage id (across all players). */
function findMageWithOwner(state: GameState, mageId: string) {
  for (const p of state.players) {
    const mage = p.mages.find((m) => m.id === mageId);
    if (mage) return { mage, owner: p };
  }
  return null;
}

/**
 * Slot-pick banner for a rearrange that re-places several Mages one at a time
 * (Flux): the generic `choose-target-action-space` banner doesn't say WHICH
 * Mage the next slot click seats. We show the queue as meeples — the one being
 * placed now is enlarged + ringed, the rest dimmed — each captioned with its
 * owner so the caster can tell whose Mage they're positioning. The slot click
 * itself still happens on the lit board (`usePromptTargets`).
 */
function RearrangePlacementBanner({
  state,
  pending,
  label,
  placingMageId,
  pendingMageIds,
}: {
  state: GameState;
  pending: PendingResolution;
  label: string;
  placingMageId: string;
  pendingMageIds: string[];
}) {
  const ids = pendingMageIds.length > 0 ? pendingMageIds : [placingMageId];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex animate-pop flex-col items-center gap-2 rounded-card bg-night-800/95 px-4 py-2.5 ring-1 ring-starlight/50 shadow-card-lift backdrop-blur">
        <div className="flex items-center gap-3">
          <p className="font-display text-sm font-bold text-starlight">
            {pending.source.description ?? 'Flux'} <span className="text-white/50">▸</span>{' '}
            <span className="text-white/95">{label}</span>
          </p>
          <ResponderChip state={state} pending={pending} />
        </div>
        <div className="flex items-end gap-1">
          {ids.map((id) => {
            const found = findMageWithOwner(state, id);
            if (!found) return null;
            const isCurrent = id === placingMageId;
            return (
              <div
                key={id}
                className={clsx(
                  'flex flex-col items-center rounded-xl px-1.5 pb-0.5 pt-1 transition',
                  isCurrent
                    ? 'bg-starlight/15 shadow-glow-sm ring-2 ring-starlight'
                    : 'opacity-45',
                )}
                style={
                  isCurrent
                    ? ({ '--glow': '#ffe9a866' } as React.CSSProperties)
                    : undefined
                }
              >
                <MageToken
                  color={found.mage.color}
                  aura={PLAYER_AURA[found.owner.color]}
                  golem={found.mage.isTemporary === true}
                  size={isCurrent ? 44 : 30}
                />
                <span
                  className={clsx(
                    'mt-0.5 max-w-[68px] truncate text-[9px] font-bold',
                    isCurrent ? 'text-starlight' : 'text-white/50',
                  )}
                >
                  {isCurrent ? `▶ ${found.owner.name}` : found.owner.name}
                </span>
              </div>
            );
          })}
        </div>
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

/** One spell card in the research sheet (tableau draft or hand upgrade). */
function ResearchSpellCard({
  state,
  cardId,
  enabled,
  targetLevel,
  owned,
  onClick,
}: {
  state: GameState;
  cardId: string;
  enabled: boolean;
  /** For hand cards: the level this research would unlock (2 or 3). */
  targetLevel?: 2 | 3 | undefined;
  /** Owned research flags, for lighting gems on hand cards. */
  owned?: { intPlaced: boolean; wisPlacedLevel2: boolean; wisPlacedLevel3: boolean } | undefined;
  onClick: () => void;
}) {
  const def = lookupSpellCardDef(state, cardId);
  if (!def) return null;
  const hue = DEPT_HUE[def.department] ?? '#ffe9a8';
  const gemState = (lvl: number): 'have' | 'target' | 'empty' => {
    if (targetLevel === lvl) return 'target';
    if (!owned) return 'empty';
    if (lvl === 1) return owned.intPlaced ? 'have' : 'empty';
    if (lvl === 2) return owned.wisPlacedLevel2 ? 'have' : 'empty';
    return owned.wisPlacedLevel3 ? 'have' : 'empty';
  };
  // Full card face: every level's title, cost, timing, and complete rules
  // text — no truncation, so the player sees exactly what they're learning.
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      title={def.name}
      className={clsx(
        'flex w-[168px] shrink-0 flex-col self-start rounded-xl border-l-4 bg-parchment-50 px-2 py-1.5 text-left shadow-card transition',
        enabled
          ? 'cursor-pointer ring-1 ring-leyline/50 hover:-translate-y-1 hover:scale-[1.02] hover:shadow-card-lift'
          : 'opacity-45 ring-1 ring-black/10',
      )}
      style={{ borderLeftColor: hue }}
    >
      <span className="text-[12px] font-bold leading-tight text-ink-900">{def.name}</span>
      <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-black/45">
        {def.department}
      </span>
      <span className="mt-1 flex flex-col gap-1">
        {def.levels.map((lvl) => {
          const g = gemState(lvl.level);
          return (
            <span
              key={lvl.level}
              className={clsx(
                'rounded-md px-1 py-0.5',
                g === 'target'
                  ? 'bg-white/80 ring-1 ring-leyline/50'
                  : g === 'have'
                    ? 'bg-black/[0.04]'
                    : 'opacity-80',
              )}
            >
              <span className="flex items-center gap-1">
                <span
                  className={clsx(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-arcane text-[8px] font-bold',
                    g === 'target'
                      ? 'animate-breathe text-ink-900 shadow-glow-sm ring-2 ring-white'
                      : g === 'have'
                        ? 'text-ink-900'
                        : 'bg-black/15 text-black/35',
                  )}
                  style={
                    g === 'target'
                      ? ({ background: hue, '--glow': `${hue}aa` } as React.CSSProperties)
                      : g === 'have'
                        ? { background: hue }
                        : undefined
                  }
                >
                  {lvl.level}
                </span>
                <span className="truncate text-[9px] font-bold text-ink-900">
                  {lvl.title ?? `Level ${lvl.level}`}
                </span>
                <span className="ml-auto shrink-0 text-[8px] font-bold text-black/55">
                  {lvl.manaCost > 0 ? `${lvl.manaCost}✦` : 'free'}
                </span>
              </span>
              <span className="block text-[8.5px] leading-snug text-black/70">
                <span
                  className="mr-1 font-bold uppercase tracking-wide"
                  style={{ color: TIMING_HUE[lvl.timing] }}
                >
                  {TIMING_LABEL[lvl.timing]}
                  {lvl.description ? ' ·' : ''}
                </span>
                {lvl.description}
              </span>
            </span>
          );
        })}
      </span>
    </button>
  );
}

/**
 * Visual research sheet: drives the spend-research chain by clicking the
 * actual spells. Tableau cards draft a new spell (spend 1 INT); hand cards
 * advance an owned spell to its next level (spend 1 WIS). At the top-level
 * menu a single click picks the category and the card together.
 */
function ResearchSheet({
  state,
  pending,
}: {
  state: GameState;
  pending: PendingResolution;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const level = pending.resume.effectId;
  const prompt = pending.prompt;
  if (prompt.kind !== 'choose-from-options') return null;
  const opts = prompt.options;
  const player = state.players.find((p) => p.id === pending.responderId);

  const restrictRaw = pending.resume.context?.['restrictDepartment'];
  const restrict = typeof restrictRaw === 'string' ? restrictRaw : undefined;
  const deptMatches = (cardId: string) =>
    !restrict || lookupSpellCardDef(state, cardId)?.department === restrict;

  const menuHasDraft = level === RESEARCH_MENU && opts.some((o) => o.id === 'draft');
  const menuHasWis = level === RESEARCH_MENU && opts.some((o) => o.id === 'add-wis');
  const canDiscard = level === RESEARCH_MENU && opts.some((o) => o.id === 'discard');

  const dispatchOption = (resolutionId: string, optionId: string) =>
    tryDispatch({
      type: 'RESOLVE_PENDING',
      resolutionId,
      answer: { kind: 'option-chosen', optionId, payload: {} },
    });

  // Drive the two-step chain in one click: at the menu, pick the category
  // then forward the specific card (the store updates synchronously, so the
  // sub-prompt is already on top by the time we read it back).
  const forward = (category: string, subEffect: string, cardId: string) => {
    if (level !== RESEARCH_MENU) {
      dispatchOption(pending.id, cardId);
      return;
    }
    if (!dispatchOption(pending.id, category)) return;
    const next = topPending(useGameStore.getState().state!);
    if (
      next &&
      next.resume.effectId === subEffect &&
      next.prompt.kind === 'choose-from-options' &&
      next.prompt.options.some((o) => o.id === cardId)
    ) {
      dispatchOption(next.id, cardId);
    }
  };

  const tableauDraftable = (cardId: string) =>
    level === RESEARCH_DRAFT
      ? opts.some((o) => o.id === cardId)
      : menuHasDraft && deptMatches(cardId);

  const learned = player?.ownedSpells.filter((s) => s.intPlaced) ?? [];
  const ownedUpgradable = (s: OwnedSpell) => {
    // No next level to unlock (single-level leader/unique spell, or maxed)
    // → never advanceable, regardless of WIS on hand.
    if (nextResearchLevel(state, s) === undefined) return false;
    return level === RESEARCH_ADD_WIS
      ? opts.some((o) => o.id === s.cardId)
      : menuHasWis && deptMatches(s.cardId);
  };

  const showTableau = level === RESEARCH_MENU || level === RESEARCH_DRAFT;
  const showHand = level === RESEARCH_MENU || level === RESEARCH_ADD_WIS;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-night-900/70 px-4 backdrop-blur-sm">
      <div className="pointer-events-auto max-h-[88vh] w-full max-w-4xl animate-pop overflow-y-auto rounded-card bg-night-700/95 p-4 ring-1 ring-white/15 shadow-card-lift">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-display text-base font-bold text-starlight">
            🔬 Research <span className="text-white/50">▸</span>{' '}
            <span className="text-white/90">
              {restrict ? `${restrict} only — ` : ''}draft a spell or advance one you own
            </span>
          </p>
          <ResponderChip state={state} pending={pending} />
        </div>

        {showTableau && (
          <div className="mb-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/45">
              Draft from the tableau <span className="text-white/30">· spend 1 INT</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {state.spellTableau.map((cardId, i) => (
                <ResearchSpellCard
                  key={`${cardId}-${i}`}
                  state={state}
                  cardId={cardId}
                  enabled={tableauDraftable(cardId)}
                  onClick={() => forward('draft', RESEARCH_DRAFT, cardId)}
                />
              ))}
              {state.spellTableau.length === 0 && (
                <p className="text-[11px] italic text-white/35">The tableau is empty.</p>
              )}
            </div>
          </div>
        )}

        {showHand && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/45">
              Advance an owned spell <span className="text-white/30">· spend 1 WIS</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {learned.map((s) => {
                const upgradable = ownedUpgradable(s);
                return (
                  <ResearchSpellCard
                    key={s.cardId}
                    state={state}
                    cardId={s.cardId}
                    enabled={upgradable}
                    targetLevel={upgradable ? nextResearchLevel(state, s) : undefined}
                    owned={s}
                    onClick={() => forward('add-wis', RESEARCH_ADD_WIS, s.cardId)}
                  />
                );
              })}
              {learned.length === 0 && (
                <p className="text-[11px] italic text-white/35">No learned spells yet.</p>
              )}
            </div>
          </div>
        )}

        {canDiscard && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => dispatchOption(pending.id, 'discard')}
              className="rounded-full bg-night-800 px-4 py-1.5 text-xs font-bold text-white/70 ring-1 ring-white/15 transition hover:text-white"
            >
              Discard this Research
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PromptDirector() {
  const state = useGameStore((s) => s.state);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const privacyRevealedForId = useUiStore((s) => s.privacyRevealedForId);
  const setPrivacyRevealed = useUiStore((s) => s.setPrivacyRevealed);
  const setPeek = useUiStore((s) => s.setPeek);
  if (!state) return null;
  const pending = topPending(state);
  if (!pending) return null;
  const prompt = pending.prompt;

  const answer = (a: ResolutionAnswer) =>
    tryDispatch({ type: 'RESOLVE_PENDING', resolutionId: pending.id, answer: a });
  // Payload is engine-filled: RESOLVE_PENDING canonicalizes it from the
  // chosen option (e.g. Infirmary B's buffed-bed flag), so clients never
  // need to echo it.
  const pickOption = (optionId: string) =>
    answer({ kind: 'option-chosen', optionId, payload: {} });

  switch (prompt.kind) {
    case 'choose-from-options': {
      // The visual draft/advance sheet handles the standard research menu
      // (offers draft / add-wis) and its two card-pick sub-prompts. The
      // Research Archive's move-WIS / swap-spell menus reuse the same resume
      // effect but offer different actions — those fall through to the
      // generic option buttons.
      const eid = pending.resume.effectId;
      const isStandardResearchMenu =
        eid === RESEARCH_MENU &&
        prompt.options.some((o) => o.id === 'draft' || o.id === 'add-wis');
      if (eid === RESEARCH_DRAFT || eid === RESEARCH_ADD_WIS || isStandardResearchMenu) {
        return <ResearchSheet state={state} pending={pending} />;
      }
      // Adventuring B pool draft → click a card in the pool on the board.
      // (The pool's cards are shown on the shelf; usePromptTargets lights
      // the affordable ones.) Pass is an option here, not a `pass` answer.
      if (eid === ADVENTURING_B_DRAFT) {
        return (
          <TargetBanner
            state={state}
            pending={pending}
            text="Choose a card from the Adventuring pool ↓"
            onPass={
              prompt.options.some((o) => o.id === 'pass')
                ? () => pickOption('pass')
                : undefined
            }
            passLabel="Pass"
          />
        );
      }
      // Infirmary wound bonus: re-derive the options from LIVE state so a
      // reward bed already claimed this round (e.g. by an earlier mage from
      // the same multi-wound) is no longer offered as buffed — the prompt
      // snapshot can predate the claim. The engine still re-checks at apply
      // time; this keeps the displayed choice honest. Option ids are stable
      // (gold/mana/ip), so dispatch + payload canonicalization are unchanged.
      if (pending.source.id === 'base.system.infirmary-bonus') {
        return (
          <ChoiceSheet
            state={state}
            pending={pending}
            title="choose your Infirmary reward"
            options={buildInfirmaryBonusOptions(state).map((o) => ({
              id: o.id,
              label: o.label,
            }))}
            onPick={pickOption}
          />
        );
      }
      return (
        <ChoiceSheet
          state={state}
          pending={pending}
          title="choose one"
          options={prompt.options.map((o) => ({
            id: o.id,
            label: o.label,
            available: o.available,
            sub: o.available === false ? o.unavailableReason : undefined,
          }))}
          onPick={pickOption}
        />
      );
    }
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
      // Rearrange placements (Flux) name the Mage being placed — show the
      // meeple queue with it highlighted instead of the bare banner.
      if (prompt.placingMageId) {
        return (
          <RearrangePlacementBanner
            state={state}
            pending={pending}
            label={prompt.label ?? 'Choose a slot'}
            placingMageId={prompt.placingMageId}
            pendingMageIds={prompt.pendingMageIds ?? [prompt.placingMageId]}
          />
        );
      }
      return (
        <TargetBanner
          state={state}
          pending={pending}
          text={prompt.label ?? 'Choose a slot'}
        />
      );
    case 'choose-vault-card':
      // If the eligible cards are on the board's shelf, click one there;
      // otherwise fall back to the text sheet.
      if (promptDraftsFromShelf(state, pending)) {
        return (
          <TargetBanner
            state={state}
            pending={pending}
            text="Choose a Vault card on the board ↓"
          />
        );
      }
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
    case 'choose-peeked-supporter': {
      // Open supporter drafts whose cards are on the shelf → click a card.
      if (prompt.kind === 'choose-supporter-card' && promptDraftsFromShelf(state, pending)) {
        return (
          <TargetBanner
            state={state}
            pending={pending}
            text="Choose a Supporter on the board ↓"
          />
        );
      }
      // Peeked cards are SECRET (top of the supporter deck) — curtain first.
      if (
        prompt.kind === 'choose-peeked-supporter' &&
        privacyRevealedForId !== pending.id
      ) {
        return (
          <PrivacyCurtain
            state={state}
            responderId={pending.responderId}
            title={`${pending.source.description ?? 'A peek'} — secret cards from the deck`}
            onReveal={() => setPrivacyRevealed(pending.id)}
          />
        );
      }
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
    }
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
          title="choose a deck to look at"
          options={prompt.eligibleDecks.map((d) => ({ id: d, label: `${d} deck` }))}
          onPick={(id) => {
            const deck = id as 'spell' | 'vault' | 'supporter';
            // Snapshot the top 3 BEFORE resolving (the effect may shuffle /
            // consume), then show them behind the privacy curtain.
            const ids =
              deck === 'spell'
                ? state.spellDeck.slice(0, 3)
                : deck === 'vault'
                  ? state.vaultDeck.slice(0, 3)
                  : state.supporterDeck.slice(0, 3);
            const cards = ids.map((cardId) => {
              if (deck === 'spell') {
                const def = lookupSpellCardDef(state, cardId);
                return { name: def?.name ?? cardId, sub: def?.department };
              }
              const def =
                deck === 'vault'
                  ? lookupVaultCardDef(state, cardId)
                  : lookupSupporterCardDef(state, cardId);
              return { name: def?.name ?? cardId, sub: def?.description };
            });
            if (answer({ kind: 'deck-chosen', deck })) {
              setPeek({ title: `Top ${cards.length} of the ${deck} deck`, cards });
            }
          }}
        />
      );
    case 'choose-voter':
      // The Consortium panel lights up its eligible voters (usePromptTargets);
      // the player clicks one there. We just show the banner here.
      return (
        <TargetBanner
          state={state}
          pending={pending}
          text="Choose a voter in the Consortium →"
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
