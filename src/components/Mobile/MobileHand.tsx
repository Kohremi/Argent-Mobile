import type { GameState, Player } from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { useUiStore } from '../../store/uiStore';
import {
  castableSpellLevels,
  supporterPlayability,
  vaultCardPlayability,
} from '../../utils/uiSelectors';
import {
  GameCard,
  spellFace,
  supporterFace,
  vaultFace,
  type CardStatus,
} from '../Cards/GameCard';

/**
 * The active player's hand on mobile: shrunk card faces grouped into spells /
 * vault / allies, laid out in a horizontal-scroll row. Tapping a card opens the
 * CardZoom detail (the tap-up pattern) where it can be cast or played. Spells
 * are tarot-shaped, vault and allies trading-card shaped. Playability comes from
 * the same engine dry-run selectors as HandFans.
 */

const CARD_W = 72; // px — shrunk thumbnail width; aspect ratio sets the height.

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <span className="px-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
        {label}
      </span>
      <div className="flex items-start gap-1.5">{children}</div>
    </div>
  );
}

export function MobileHand({ state, player }: { state: GameState; player: Player }) {
  const setCardDetail = useUiStore((s) => s.setCardDetail);
  const castable = castableSpellLevels(state, player.id);
  const vaultInfo = vaultCardPlayability(state, player.id);
  const suppInfo = supporterPlayability(state, player.id);

  const hasAny =
    player.ownedSpells.length + player.vaultCards.length + player.supporters.length > 0;
  if (!hasAny) {
    return <p className="px-1 py-2 text-[11px] italic text-white/35">Your hand is empty.</p>;
  }

  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-1">
      {player.ownedSpells.length > 0 && (
        <Group label="spells">
          {player.ownedSpells.map((s) => {
            const def = lookupSpellCardDef(state, s.cardId);
            if (!def) return null;
            const playable = (castable.get(s.cardId)?.size ?? 0) > 0;
            const status: CardStatus = s.exhausted ? 'exhausted' : playable ? 'playable' : null;
            return (
              <GameCard
                key={s.cardId}
                face={spellFace(def)}
                status={status}
                style={{ width: CARD_W }}
                onClick={() => setCardDetail({ kind: 'spell', id: s.cardId })}
              />
            );
          })}
        </Group>
      )}
      {player.vaultCards.length > 0 && (
        <Group label="vault">
          {player.vaultCards.map((v, i) => {
            const def = lookupVaultCardDef(state, v.cardId);
            if (!def) return null;
            const reason = vaultInfo.get(v.cardId);
            const status: CardStatus = v.exhausted
              ? 'exhausted'
              : reason === null
                ? 'playable'
                : null;
            return (
              <GameCard
                key={`${v.cardId}-${i}`}
                face={vaultFace(def)}
                status={status}
                style={{ width: CARD_W }}
                onClick={() => setCardDetail({ kind: 'vault', id: v.cardId })}
              />
            );
          })}
        </Group>
      )}
      {player.supporters.length > 0 && (
        <Group label="allies">
          {player.supporters.map((id, i) => {
            const def = lookupSupporterCardDef(state, id);
            if (!def) return null;
            const reason = suppInfo.get(id);
            return (
              <GameCard
                key={`${id}-${i}`}
                face={supporterFace(def)}
                status={reason === null ? 'playable' : null}
                style={{ width: CARD_W }}
                onClick={() => setCardDetail({ kind: 'supporter', id })}
              />
            );
          })}
        </Group>
      )}
    </div>
  );
}
