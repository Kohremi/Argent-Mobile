import clsx from 'clsx';
import type { GameState } from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { DEPT_HUE } from '../../utils/uiSelectors';
import { TIMING_HUE, TIMING_LABEL } from '../Cards/HandFans';
import { usePromptTargets } from '../Prompts/usePromptTargets';

/**
 * The market shelf beneath the university (docs/UI_DESIGN.md §7): the three
 * standing tableaus — spells, vault, supporters — laid out as stalls so the
 * round's offers are always on the board. Temporary reveals (Adventuring B's
 * pool, Vault A / University Tavern A draft piles) appear as extra stalls
 * with a starlight ring while they're live and vanish when the engine
 * clears them. Display-only: drafting happens through prompts/actions.
 */

/** Reserved vertical space in the board stage (CampusBoard sizing). */
export const SHELF_MT = 116; // clears the floating foundation + clouds
export const SHELF_H = 230;

function fanMargin(i: number, n: number): number {
  return i === 0 ? 0 : n >= 6 ? -72 : n >= 4 ? -44 : -6;
}

/** Shared mini-card chrome: parchment face, dept/type hue spine, hover-lift
 *  clear of the stall's overlap. */
function MiniCard({
  i,
  n,
  hue,
  title,
  className,
  cardId,
  children,
}: {
  i: number;
  n: number;
  hue: string;
  title: string;
  className: string;
  /** When set + draftable, the card becomes a clickable draft target. */
  cardId?: string;
  children: React.ReactNode;
}) {
  const { cardTargets, pickCard } = usePromptTargets();
  const targeted = cardId !== undefined && cardTargets.has(cardId);
  return (
    <div
      className="relative transition-transform duration-150 hover:z-40"
      style={{ marginLeft: fanMargin(i, n) }}
    >
      <div
        title={targeted ? `Draft ${title}` : title}
        role={targeted ? 'button' : undefined}
        onClick={targeted ? () => pickCard(cardId!) : undefined}
        className={clsx(
          'flex flex-col rounded-lg border-l-4 bg-parchment-50 px-1.5 py-1 text-left shadow-card transition hover:-translate-y-3 hover:shadow-card-lift',
          targeted &&
            'animate-breathe cursor-pointer ring-2 ring-leyline shadow-glow-sm hover:scale-[1.04]',
          className,
        )}
        style={{
          borderLeftColor: hue,
          ...(targeted ? ({ '--glow': '#7ee8fa88' } as React.CSSProperties) : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SpellMini({ state, cardId, i, n }: { state: GameState; cardId: string; i: number; n: number }) {
  const def = lookupSpellCardDef(state, cardId);
  if (!def) return null;
  const hue = DEPT_HUE[def.department] ?? '#ffe9a8';
  return (
    <MiniCard i={i} n={n} hue={hue} cardId={cardId} title={def.name} className="h-[186px] w-[128px]">
      <span className="line-clamp-1 text-[10.5px] font-bold leading-tight text-ink-900">
        {def.name}
      </span>
      <span className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
        {def.levels.map((lvl) => (
          <span key={lvl.level} className="rounded bg-black/[0.04] px-1 py-0.5">
            <span className="flex items-center gap-1">
              <span
                className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full font-arcane text-[7px] font-bold text-ink-900"
                style={{ background: hue }}
              >
                {lvl.level}
              </span>
              <span className="truncate text-[8.5px] font-bold text-ink-900">
                {lvl.title ?? `Level ${lvl.level}`}
              </span>
              <span className="ml-auto shrink-0 text-[7.5px] font-bold text-black/55">
                {lvl.manaCost > 0 ? `${lvl.manaCost}✦` : 'free'}
              </span>
            </span>
            <span className="line-clamp-2 block text-[8px] leading-snug text-black/70">
              <span
                className="mr-0.5 font-bold uppercase tracking-wide"
                style={{ color: TIMING_HUE[lvl.timing] }}
              >
                {TIMING_LABEL[lvl.timing]}
                {lvl.description ? ' ·' : ''}
              </span>
              {lvl.description}
            </span>
          </span>
        ))}
      </span>
    </MiniCard>
  );
}

function VaultMini({ state, cardId, i, n }: { state: GameState; cardId: string; i: number; n: number }) {
  const def = lookupVaultCardDef(state, cardId);
  if (!def) return null;
  return (
    <MiniCard i={i} n={n} hue="#ff9f43" cardId={cardId} title={def.name} className="h-[150px] w-[118px]">
      <span className="line-clamp-2 text-[10.5px] font-bold leading-tight text-ink-900">
        {def.name}
      </span>
      <span className="flex w-full items-center gap-1 text-[7.5px] font-bold uppercase tracking-wide text-black/45">
        {def.type}
        <span style={{ color: TIMING_HUE[def.timing] }}>· {TIMING_LABEL[def.timing]}</span>
        <span className="ml-auto text-amber-700">{def.goldCost}g</span>
      </span>
      <span className="mt-0.5 line-clamp-5 text-[8.5px] leading-snug text-black/70">
        {def.description}
      </span>
    </MiniCard>
  );
}

function SupporterMini({ state, cardId, i, n }: { state: GameState; cardId: string; i: number; n: number }) {
  const def = lookupSupporterCardDef(state, cardId);
  if (!def) return null;
  const hue = DEPT_HUE[def.department] ?? '#e8e4da';
  return (
    <MiniCard i={i} n={n} hue={hue} cardId={cardId} title={def.name} className="h-[150px] w-[118px]">
      <span className="line-clamp-2 text-[10.5px] font-bold leading-tight text-ink-900">
        {def.name}
      </span>
      <span className="flex w-full items-center gap-1 text-[7.5px] font-bold uppercase tracking-wide text-black/45">
        {def.title ?? 'supporter'}
        <span className="shrink-0" style={{ color: TIMING_HUE[def.timing] }}>
          · {TIMING_LABEL[def.timing] ?? def.timing}
        </span>
      </span>
      <span className="mt-0.5 line-clamp-5 text-[8.5px] leading-snug text-black/70">
        {def.description}
      </span>
    </MiniCard>
  );
}

function Stall({
  label,
  deckCount,
  temporary,
  children,
}: {
  label: string;
  deckCount?: number | undefined;
  temporary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col rounded-card px-2.5 pb-2.5 pt-1.5 ring-1',
        temporary ? 'bg-night-700/80 ring-starlight/60' : 'bg-night-800/70 ring-white/10',
      )}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/50">
        {temporary && <span className="mr-1 text-starlight">✨</span>}
        <span className={clsx(temporary && 'text-starlight')}>{label}</span>
        {deckCount !== undefined && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-white/35">
            deck {deckCount}
          </span>
        )}
      </p>
      <div className="flex items-end">{children}</div>
    </div>
  );
}

export function TableauShelf({ state, width }: { state: GameState; width: number }) {
  const adv = state.adventuringBPool;
  const advCards = adv ? [...adv.spells, ...adv.vaultCards, ...adv.supporters] : [];
  return (
    <div
      className="flex flex-wrap items-start justify-center gap-3"
      style={{ width, marginTop: SHELF_MT, minHeight: SHELF_H }}
    >
      {state.spellTableau.length > 0 && (
        <Stall label="Spells on offer" deckCount={state.spellDeck.length}>
          {state.spellTableau.map((id, i) => (
            <SpellMini key={`${id}-${i}`} state={state} cardId={id} i={i} n={state.spellTableau.length} />
          ))}
        </Stall>
      )}
      {state.vaultTableau.length > 0 && (
        <Stall label="Vault on offer" deckCount={state.vaultDeck.length}>
          {state.vaultTableau.map((id, i) => (
            <VaultMini key={`${id}-${i}`} state={state} cardId={id} i={i} n={state.vaultTableau.length} />
          ))}
        </Stall>
      )}
      {state.supporterTableau.length > 0 && (
        <Stall label="Supporters on offer" deckCount={state.supporterDeck.length}>
          {state.supporterTableau.map((id, i) => (
            <SupporterMini key={`${id}-${i}`} state={state} cardId={id} i={i} n={state.supporterTableau.length} />
          ))}
        </Stall>
      )}

      {/* temporary reveals — live only while their room effect holds cards */}
      {adv && advCards.length > 0 && (
        <Stall label="Adventuring pool" temporary>
          {adv.spells.map((id, i) => (
            <SpellMini key={`s-${id}-${i}`} state={state} cardId={id} i={i} n={advCards.length} />
          ))}
          {adv.vaultCards.map((id, i) => (
            <VaultMini key={`v-${id}-${i}`} state={state} cardId={id} i={adv.spells.length + i} n={advCards.length} />
          ))}
          {adv.supporters.map((id, i) => (
            <SupporterMini
              key={`p-${id}-${i}`}
              state={state}
              cardId={id}
              i={adv.spells.length + adv.vaultCards.length + i}
              n={advCards.length}
            />
          ))}
        </Stall>
      )}
      {state.vaultARevealed && state.vaultARevealed.length > 0 && (
        <Stall label="Vault reveal" temporary>
          {state.vaultARevealed.map((id, i) => (
            <VaultMini key={`${id}-${i}`} state={state} cardId={id} i={i} n={state.vaultARevealed!.length} />
          ))}
        </Stall>
      )}
      {state.tavernARevealed && state.tavernARevealed.length > 0 && (
        <Stall label="Tavern reveal" temporary>
          {state.tavernARevealed.map((id, i) => (
            <SupporterMini key={`${id}-${i}`} state={state} cardId={id} i={i} n={state.tavernARevealed!.length} />
          ))}
        </Stall>
      )}
    </div>
  );
}
