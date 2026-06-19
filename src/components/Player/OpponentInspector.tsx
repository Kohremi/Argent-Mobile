import { useEffect } from 'react';
import clsx from 'clsx';
import type { GameState, OwnedSpell, Player } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { DEPT_HUE, PLAYER_AURA, researchTotals } from '../../utils/uiSelectors';
import { ResourceIcon } from '../icons';
import { PortraitBust } from './PortraitBust';
import { RESOURCE_ORDER } from './PlayerDock';

/**
 * Opponent quick-reference (read-only): a focused overlay showing a rival's
 * full tableau — resources, researched spells, vault items, supporters, and the
 * vault / supporter discard piles. Opened by clicking a rival in the left rail
 * (OpponentRail); the backdrop blocks all other actions until the player closes
 * it (Return button, click-away, or Esc). Face-down "secret" supporter discards
 * stay hidden (shown as a count) — opponents may not peek at them.
 */

function Section({
  title,
  count,
  discardCount,
  children,
}: {
  title: string;
  count?: number;
  /** Cards in the matching face-down discard pile. Contents are hidden — only
   *  the count is public — so we surface just the number here. */
  discardCount?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45">
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-night-900/70 px-1.5 text-[9px] text-white/60">
            {count}
          </span>
        )}
        {discardCount !== undefined && (
          <span
            className="ml-auto flex items-center gap-1 rounded-full bg-night-900/70 px-1.5 text-[9px] font-semibold normal-case tracking-normal text-white/55"
            title="Cards in the face-down discard pile (contents hidden)"
          >
            🗑 {discardCount} discarded
          </span>
        )}
      </p>
      {children}
    </section>
  );
}

/** Compact, read-only card chip (name + optional meta line). */
function CardChip({
  name,
  hue,
  meta,
  dimmed,
}: {
  name: string;
  hue?: string;
  meta?: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex min-w-[150px] max-w-[210px] flex-col rounded-xl border-l-4 bg-night-700/80 px-2 py-1 ring-1 ring-white/10',
        dimmed && 'opacity-60',
      )}
      style={{ borderLeftColor: hue ?? '#6b7280' }}
    >
      <span className="text-[12px] font-bold leading-tight text-white/95">{name}</span>
      {meta && <span className="mt-0.5 text-[10px] leading-snug text-white/55">{meta}</span>}
    </div>
  );
}

function SpellChip({ state, spell }: { state: GameState; spell: OwnedSpell }) {
  const def = lookupSpellCardDef(state, spell.cardId);
  const hue = def ? DEPT_HUE[def.department] ?? '#ffe9a8' : '#ffe9a8';
  const owned = [spell.intPlaced, spell.wisPlacedLevel2, spell.wisPlacedLevel3];
  return (
    <CardChip
      name={def?.name ?? spell.cardId}
      hue={hue}
      meta={
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {([1, 2, 3] as const).map((lvl) => (
              <span
                key={lvl}
                className={clsx(
                  'flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold',
                  owned[lvl - 1]
                    ? 'text-ink-900'
                    : 'bg-black/25 text-white/30',
                )}
                style={owned[lvl - 1] ? { background: hue } : undefined}
                title={owned[lvl - 1] ? `Level ${lvl} researched` : `Level ${lvl} not researched`}
              >
                {lvl}
              </span>
            ))}
          </span>
          {spell.exhausted && (
            <span className="rounded bg-night-900/70 px-1 text-[8px] uppercase tracking-wide text-rose-300/90">
              exhausted
            </span>
          )}
        </span>
      }
    />
  );
}

export function OpponentInspector() {
  const state = useGameStore((s) => s.state);
  const inspectPlayerId = useUiStore((s) => s.inspectPlayerId);
  const setInspectPlayerId = useUiStore((s) => s.setInspectPlayerId);

  // Esc closes the overlay (matches the click-away / Return affordances).
  useEffect(() => {
    if (!inspectPlayerId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectPlayerId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectPlayerId, setInspectPlayerId]);

  if (!state || !inspectPlayerId) return null;
  const player: Player | undefined = state.players.find((p) => p.id === inspectPlayerId);
  if (!player) return null;

  const aura = PLAYER_AURA[player.color];
  const research = researchTotals(player);
  const close = () => setInspectPlayerId(null);

  // Discard piles are face-down once used — only the count is public.
  const vaultDiscardCount = player.personalDiscard.filter(
    (d) => d.kind === 'consumable',
  ).length;
  const supporterDiscardCount = player.personalDiscard.filter(
    (d) => d.kind === 'supporter' || d.kind === 'secret-supporter',
  ).length;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-night-900/80 px-6 backdrop-blur"
      onClick={close}
    >
      <div
        data-testid="opponent-inspector"
        className="max-h-[86vh] w-full max-w-3xl animate-pop overflow-y-auto rounded-card bg-night-800/97 p-4 shadow-card-lift ring-1 ring-white/15"
        style={{ boxShadow: `inset 0 3px 0 ${aura}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3">
          <PortraitBust player={player} state={state} expression="neutral" size={40} />
          <div className="min-w-0">
            <p className="font-display text-lg font-bold leading-tight" style={{ color: aura }}>
              {player.name}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-white/40">
              quick reference · read-only
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-full bg-night-700 px-4 py-1.5 font-display text-sm font-bold text-white/85 ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:text-white"
          >
            ✕ Return
          </button>
        </div>

        {/* resources */}
        <Section title="Resources">
          <div className="flex flex-wrap items-center gap-1.5">
            {RESOURCE_ORDER.map(({ kind, key }) => {
              const isInt = key === 'intelligence';
              const isWis = key === 'wisdom';
              return (
                <span
                  key={key}
                  className="flex items-center gap-1 rounded-full bg-night-700 px-2 py-1 text-xs font-bold ring-1 ring-white/10"
                  title={isInt ? 'INT (unspent / total)' : isWis ? 'WIS (unspent / total)' : key}
                >
                  <ResourceIcon kind={kind} className="h-3.5 w-3.5" />
                  {isInt ? (
                    <span>
                      {research.intRemaining}
                      <span className="text-white/45">/{research.intTotal}</span>
                    </span>
                  ) : isWis ? (
                    <span>
                      {research.wisRemaining}
                      <span className="text-white/45">/{research.wisTotal}</span>
                    </span>
                  ) : (
                    (player.resources as unknown as Record<string, number>)[key] ?? 0
                  )}
                </span>
              );
            })}
          </div>
        </Section>

        {/* spells */}
        <Section title="Spells" count={player.ownedSpells.length}>
          {player.ownedSpells.length === 0 ? (
            <p className="text-[11px] italic text-white/35">No researched spells.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {player.ownedSpells.map((s) => (
                <SpellChip key={s.cardId} state={state} spell={s} />
              ))}
            </div>
          )}
        </Section>

        {/* vault items */}
        <Section
          title="Vault items"
          count={player.vaultCards.length}
          discardCount={vaultDiscardCount}
        >
          {player.vaultCards.length === 0 ? (
            <p className="text-[11px] italic text-white/35">No vault items.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {player.vaultCards.map((v, i) => {
                const def = lookupVaultCardDef(state, v.cardId);
                return (
                  <CardChip
                    key={`${v.cardId}-${i}`}
                    name={def?.name ?? v.cardId}
                    hue="#e4c06a"
                    dimmed={v.exhausted}
                    meta={v.exhausted ? 'exhausted' : 'ready'}
                  />
                );
              })}
            </div>
          )}
        </Section>

        {/* supporters (in office) */}
        <Section
          title="Supporters"
          count={player.supporters.length}
          discardCount={supporterDiscardCount}
        >
          {player.supporters.length === 0 ? (
            <p className="text-[11px] italic text-white/35">No supporters.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {player.supporters.map((id, i) => {
                const def = lookupSupporterCardDef(state, id);
                return <CardChip key={`${id}-${i}`} name={def?.name ?? id} hue="#7ee8fa" />;
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
