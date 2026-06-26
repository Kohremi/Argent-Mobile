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
import { spellFace, supporterFace, vaultFace, type CardStatus } from '../Cards/GameCard';
import { CardFan, type FanItem } from '../Cards/CardFan';

/**
 * The active player's un-collapsed hand: three overlapping fans (spells / vault
 * / allies) on a single row — the same browse-by-fanning, tap-to-open interaction
 * as the Rivals board, but here a tap opens the CardDetailSheet where the card
 * can be cast or played. Playability comes from the same engine dry-run selectors
 * as HandFans.
 */

const HAND_CARD_W = 54; // px — a touch larger than the rivals thumbnails.

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

  const spellItems: FanItem[] = player.ownedSpells.flatMap((s) => {
    const def = lookupSpellCardDef(state, s.cardId);
    if (!def) return [];
    const playable = (castable.get(s.cardId)?.size ?? 0) > 0;
    const status: CardStatus = s.exhausted ? 'exhausted' : playable ? 'playable' : null;
    return [
      {
        key: s.cardId,
        face: spellFace(def),
        status,
        onOpen: () => setCardDetail({ kind: 'spell', id: s.cardId }),
      },
    ];
  });

  const vaultItems: FanItem[] = player.vaultCards.flatMap((v, i) => {
    const def = lookupVaultCardDef(state, v.cardId);
    if (!def) return [];
    const reason = vaultInfo.get(v.cardId);
    const status: CardStatus = v.exhausted ? 'exhausted' : reason === null ? 'playable' : null;
    return [
      {
        key: `${v.cardId}-${i}`,
        face: vaultFace(def),
        status,
        onOpen: () => setCardDetail({ kind: 'vault', id: v.cardId }),
      },
    ];
  });

  const allyItems: FanItem[] = player.supporters.flatMap((id, i) => {
    const def = lookupSupporterCardDef(state, id);
    if (!def) return [];
    const reason = suppInfo.get(id);
    return [
      {
        key: `${id}-${i}`,
        face: supporterFace(def),
        status: reason === null ? 'playable' : null,
        onOpen: () => setCardDetail({ kind: 'supporter', id }),
      },
    ];
  });

  return (
    <div className="flex items-end gap-3 pt-4">
      <CardFan label="spells" items={spellItems} cardWidth={HAND_CARD_W} />
      <CardFan label="vault" items={vaultItems} cardWidth={HAND_CARD_W} />
      <CardFan label="allies" items={allyItems} cardWidth={HAND_CARD_W} />
    </div>
  );
}
