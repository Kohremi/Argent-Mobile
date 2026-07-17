import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { GameState } from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import {
  CardZoom,
  GameCard,
  spellFace,
  supporterFace,
  vaultFace,
  type CardFace,
} from '../Cards/GameCard';
import { usePromptTargets } from '../Prompts/usePromptTargets';

/**
 * Touch-native "On Offer" view — the round's tableaus (and any temporary
 * reveals) as shrunk card faces in a grid. Tapping a card picks it up into a
 * CardZoom for a close look; when a draft prompt is live the matching cards glow
 * and the zoom shows a one-tap "Draft" button.
 */

type Kind = 'spell' | 'vault' | 'supporter';
interface CardRef {
  kind: Kind;
  id: string;
  key: string;
}

function faceFor(state: GameState, ref: CardRef): CardFace | null {
  if (ref.kind === 'spell') {
    const d = lookupSpellCardDef(state, ref.id);
    return d ? spellFace(d) : null;
  }
  if (ref.kind === 'vault') {
    const d = lookupVaultCardDef(state, ref.id);
    return d ? vaultFace(d) : null;
  }
  const d = lookupSupporterCardDef(state, ref.id);
  return d ? supporterFace(d) : null;
}

function Section({
  label,
  temporary,
  deckCount,
  cards,
  state,
  cardTargets,
  onTap,
}: {
  label: string;
  temporary?: boolean;
  deckCount?: number;
  cards: CardRef[];
  state: GameState;
  cardTargets: Set<string>;
  onTap: (ref: CardRef) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section
      className={clsx(
        'rounded-card p-2 ring-1',
        temporary ? 'bg-night-700/70 ring-starlight/60' : 'bg-night-800/60 ring-white/10',
      )}
    >
      <p className="mb-1.5 px-0.5 text-[10px] font-bold uppercase tracking-widest text-white/50">
        {temporary && <span className="mr-1 text-starlight">✨</span>}
        <span className={clsx(temporary && 'text-starlight')}>{label}</span>
        {deckCount !== undefined && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-white/35">
            deck {deckCount}
          </span>
        )}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {cards.map((c) => {
          const face = faceFor(state, c);
          if (!face) return null;
          const draftable = cardTargets.has(c.id);
          return (
            <div key={c.key} data-draft-target={draftable ? true : undefined}>
              <GameCard
                face={face}
                status={draftable ? 'draftable' : null}
                className="w-full"
                onClick={() => onTap(c)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function MobileTableau({ state }: { state: GameState }) {
  const { cardTargets, pickCard } = usePromptTargets();
  const [detail, setDetail] = useState<CardRef | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const adv = state.adventuringBPool;

  // When a draft prompt lights cards, bring the first eligible one into view —
  // an Adventuring-pool draft's targets live in a temporary section below the
  // three standing tableaus, otherwise hidden under the fold.
  const targetsKey = [...cardTargets].sort().join('|');
  useEffect(() => {
    if (!targetsKey) return;
    rootRef.current
      ?.querySelector('[data-draft-target]')
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [targetsKey]);

  const close = () => setDetail(null);
  const draftable = detail ? cardTargets.has(detail.id) : false;
  const detailFace = detail ? faceFor(state, detail) : null;

  return (
    <div ref={rootRef} className="h-full overflow-y-auto p-3">
      <p className="mb-2 px-1 font-display text-sm font-bold text-starlight">
        On Offer
        <span className="ml-2 text-[10px] font-normal uppercase tracking-widest text-white/40">
          tap a card to enlarge
        </span>
      </p>

      <div className="flex flex-col gap-2">
        <Section
          label="Spells on offer"
          deckCount={state.spellDeck.length}
          cards={state.spellTableau.map((id, i) => ({ kind: 'spell', id, key: `s-${id}-${i}` }))}
          state={state}
          cardTargets={cardTargets}
          onTap={setDetail}
        />
        <Section
          label="Vault on offer"
          deckCount={state.vaultDeck.length}
          cards={state.vaultTableau.map((id, i) => ({ kind: 'vault', id, key: `v-${id}-${i}` }))}
          state={state}
          cardTargets={cardTargets}
          onTap={setDetail}
        />
        <Section
          label="Supporters on offer"
          deckCount={state.supporterDeck.length}
          cards={state.supporterTableau.map((id, i) => ({ kind: 'supporter', id, key: `p-${id}-${i}` }))}
          state={state}
          cardTargets={cardTargets}
          onTap={setDetail}
        />

        {/* temporary reveals */}
        {adv && (
          <Section
            label="Adventuring pool"
            temporary
            cards={[
              ...adv.spells.map((id, i) => ({ kind: 'spell' as const, id, key: `as-${id}-${i}` })),
              ...adv.vaultCards.map((id, i) => ({ kind: 'vault' as const, id, key: `av-${id}-${i}` })),
              ...adv.supporters.map((id, i) => ({ kind: 'supporter' as const, id, key: `ap-${id}-${i}` })),
            ]}
            state={state}
            cardTargets={cardTargets}
            onTap={setDetail}
          />
        )}
        {state.vaultARevealed && (
          <Section
            label="Vault reveal"
            temporary
            cards={state.vaultARevealed.map((id, i) => ({ kind: 'vault', id, key: `vr-${id}-${i}` }))}
            state={state}
            cardTargets={cardTargets}
            onTap={setDetail}
          />
        )}
        {state.tavernARevealed && (
          <Section
            label="Tavern reveal"
            temporary
            cards={state.tavernARevealed.map((id, i) => ({ kind: 'supporter', id, key: `tr-${id}-${i}` }))}
            state={state}
            cardTargets={cardTargets}
            onTap={setDetail}
          />
        )}
      </div>

      {detail && detailFace && (
        <CardZoom face={detailFace} onClose={close}>
          {draftable && (
            <button
              type="button"
              onClick={() => {
                pickCard(detail.id);
                close();
              }}
              className="w-full rounded-full bg-gradient-to-b from-starlight to-amber-300 px-4 py-2.5 font-display text-sm font-bold text-ink-900 shadow-card transition active:scale-[.98]"
            >
              ✦ Draft this
            </button>
          )}
        </CardZoom>
      )}
    </div>
  );
}
