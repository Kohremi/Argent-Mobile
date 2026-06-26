import { useState } from 'react';
import type { GameState } from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { getBotPersonality } from '../../game/ai';
import { localPlayer, PLAYER_AURA, researchTotals } from '../../utils/uiSelectors';
import { ResourceIcon } from '../icons';
import { MageToken } from '../Board/MageToken';
import { PortraitBust } from '../Player/PortraitBust';
import { MeritBadge, RESOURCE_ORDER_COMPACT } from '../Player/PlayerDock';
import {
  CardZoom,
  GameCard,
  spellFace,
  supporterFace,
  vaultFace,
  type CardFace,
} from '../Cards/GameCard';

/**
 * The Rivals tab: each opponent shown in full rather than as a one-line summary
 * — their mages as small tokens, a compact resource strip, and every spell,
 * vault item, and supporter as a shrunk card face. Tapping any card picks it up
 * into a read-only CardZoom for full info. This replaces the old quick-reference
 * overlay (OpponentInspector) on mobile; the info that used to require a drill-in
 * now lives inline.
 */

const RIVAL_CARD_W = 58; // px — small tappable thumbnails.

type CardRef = { kind: 'spell' | 'vault' | 'supporter'; id: string };

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

function CardRow({
  label,
  cards,
  state,
  onOpen,
}: {
  label: string;
  cards: CardRef[];
  state: GameState;
  onOpen: (ref: CardRef) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-widest text-white/35">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {cards.map((c, i) => {
          const face = faceFor(state, c);
          if (!face) return null;
          return (
            <GameCard
              key={`${c.id}-${i}`}
              face={face}
              style={{ width: RIVAL_CARD_W }}
              onClick={() => onOpen(c)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function RivalsView({
  state,
  localPlayerId,
}: {
  state: GameState;
  localPlayerId: string | null;
}) {
  const [zoom, setZoom] = useState<CardRef | null>(null);
  const self = localPlayer(state, localPlayerId) ?? state.players[0]!;
  const rivals = state.players.filter((p) => p.id !== self.id);
  const zoomFace = zoom ? faceFor(state, zoom) : null;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-3">
      {rivals.map((p) => {
        const aura = PLAYER_AURA[p.color];
        const research = researchTotals(p);
        return (
          <section
            key={p.id}
            className="rounded-card bg-night-700/80 p-2.5 ring-1 ring-white/10"
            style={{ boxShadow: `inset 0 2px 0 ${aura}` }}
          >
            {/* identity + mages */}
            <div className="flex items-center gap-2">
              <PortraitBust player={p} state={state} expression="neutral" size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold" style={{ color: aura }}>
                  {p.name}
                  {p.controlledByBot && (
                    <span className="ml-1.5 rounded-full bg-night-900/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-starlight ring-1 ring-starlight/40">
                      🤖 {getBotPersonality(p.botPersonalityId).name}
                    </span>
                  )}
                </p>
                <p className="text-[10px] uppercase tracking-widest text-white/40">
                  {p.mages.length} mages
                </p>
              </div>
              <MeritBadge count={p.resources.meritBadges} />
              <div className="flex max-w-[38%] flex-wrap justify-end gap-0.5">
                {p.mages.map((m) => (
                  <span
                    key={m.id}
                    title={`${m.color} mage · ${m.location.kind}${m.isWounded ? ' · wounded' : ''}`}
                    className={m.location.kind === 'office' ? '' : 'opacity-55'}
                  >
                    <MageToken color={m.color} aura={aura} isWounded={m.isWounded} size={20} />
                  </span>
                ))}
              </div>
            </div>

            {/* resources */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {RESOURCE_ORDER_COMPACT.map(({ kind, key }) => {
                const isInt = key === 'intelligence';
                const isWis = key === 'wisdom';
                return (
                  <span
                    key={key}
                    className="flex items-center gap-1 rounded-full bg-night-800/80 px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-white/10"
                  >
                    <ResourceIcon kind={kind} className="h-3 w-3" />
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
                      (p.resources as unknown as Record<string, number>)[key] ?? 0
                    )}
                  </span>
                );
              })}
            </div>

            {/* tableau cards — tap any for full info */}
            <div className="mt-2 flex flex-col gap-2">
              <CardRow
                label="spells"
                state={state}
                cards={p.ownedSpells.map((s) => ({ kind: 'spell', id: s.cardId }))}
                onOpen={setZoom}
              />
              <CardRow
                label="vault"
                state={state}
                cards={p.vaultCards.map((v) => ({ kind: 'vault', id: v.cardId }))}
                onOpen={setZoom}
              />
              <CardRow
                label="allies"
                state={state}
                cards={p.supporters.map((id) => ({ kind: 'supporter', id }))}
                onOpen={setZoom}
              />
              {p.ownedSpells.length + p.vaultCards.length + p.supporters.length === 0 && (
                <p className="text-[11px] italic text-white/35">No cards in play yet.</p>
              )}
            </div>
          </section>
        );
      })}

      {zoom && zoomFace && <CardZoom face={zoomFace} onClose={() => setZoom(null)} />}
    </div>
  );
}
