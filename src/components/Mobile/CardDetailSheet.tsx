import clsx from 'clsx';
import type { GameState, Player, SpellLevel } from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  castableSpellLevels,
  spellLevelManaDisplay,
  supporterPlayability,
  vaultCardPlayability,
} from '../../utils/uiSelectors';
import { CardZoom, spellFace, supporterFace, vaultFace } from '../Cards/GameCard';

/**
 * Tap-up detail for a hand card on mobile — picks the card up into a full-screen
 * CardZoom for a close look, with its play/cast controls in an action bar below.
 * Cast/play dispatch through the same actions as the desktop HandFans; on
 * success the overlay closes (tryDispatch clears state).
 */

function SpellDetail({
  state,
  player,
  cardId,
  onClose,
}: {
  state: GameState;
  player: Player;
  cardId: string;
  onClose: () => void;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const owned = player.ownedSpells.find((s) => s.cardId === cardId);
  const def = lookupSpellCardDef(state, cardId);
  if (!owned || !def) return null;
  const castable = castableSpellLevels(state, player.id).get(cardId);
  const researched = [owned.intPlaced, owned.wisPlacedLevel2, owned.wisPlacedLevel3];

  return (
    <CardZoom face={spellFace(def)} onClose={onClose}>
      <div className="flex flex-col gap-1.5 rounded-2xl bg-night-800/95 p-2 ring-1 ring-white/10">
        {def.levels.map((lvl, i) => {
          const ok = castable?.has(lvl.level as 1 | 2 | 3) ?? false;
          const isResearched = researched[i];
          const { printed, effective } = spellLevelManaDisplay(state, player.id, lvl as SpellLevel);
          return (
            <button
              key={lvl.level}
              type="button"
              disabled={!ok}
              onClick={() => {
                if (
                  tryDispatch({
                    type: 'CAST_SPELL',
                    playerId: player.id,
                    spellCardId: cardId,
                    level: lvl.level as 1 | 2 | 3,
                  })
                )
                  onClose();
              }}
              className={clsx(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-left ring-1 transition',
                ok
                  ? 'bg-night-600 ring-leyline/50 active:scale-[.98]'
                  : 'bg-night-900/60 opacity-60 ring-white/10',
              )}
            >
              <span className="font-bold text-white/95">
                L{lvl.level} · {lvl.title ?? `Level ${lvl.level}`}
              </span>
              <span className="ml-auto text-sm font-bold text-starlight">
                {printed <= 0 ? (
                  'free'
                ) : effective < printed ? (
                  <span>
                    <span className="text-sky-300">{effective}✦</span>{' '}
                    <span className="text-xs line-through opacity-50">{printed}</span>
                  </span>
                ) : (
                  `${printed}✦`
                )}
              </span>
              {!isResearched && (
                <span className="text-[10px] uppercase tracking-wide text-rose-300/80">locked</span>
              )}
            </button>
          );
        })}
      </div>
    </CardZoom>
  );
}

function PlayableDetail({
  state,
  player,
  kind,
  cardId,
  onClose,
}: {
  state: GameState;
  player: Player;
  kind: 'vault' | 'supporter';
  cardId: string;
  onClose: () => void;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const isVault = kind === 'vault';
  const def = isVault ? lookupVaultCardDef(state, cardId) : lookupSupporterCardDef(state, cardId);
  if (!def) return null;
  const reason = isVault
    ? vaultCardPlayability(state, player.id).get(cardId)
    : supporterPlayability(state, player.id).get(cardId);
  const exhausted = isVault
    ? player.vaultCards.find((v) => v.cardId === cardId)?.exhausted === true
    : false;
  const playable = reason === null && !exhausted;
  const face = isVault
    ? vaultFace(def as Parameters<typeof vaultFace>[0])
    : supporterFace(def as Parameters<typeof supporterFace>[0]);

  return (
    <CardZoom face={face} onClose={onClose}>
      <button
        type="button"
        disabled={!playable}
        onClick={() => {
          const action = isVault
            ? ({ type: 'PLAY_VAULT_CARD', playerId: player.id, vaultCardId: cardId } as const)
            : ({ type: 'PLAY_SUPPORTER', playerId: player.id, supporterCardId: cardId } as const);
          if (tryDispatch(action)) onClose();
        }}
        className={clsx(
          'w-full rounded-full px-4 py-2.5 font-display text-sm font-bold transition active:scale-[.98]',
          playable
            ? 'bg-gradient-to-b from-starlight to-amber-300 text-ink-900 shadow-card'
            : 'bg-night-700 text-white/40 ring-1 ring-white/10',
        )}
      >
        {exhausted
          ? 'Exhausted'
          : playable
            ? isVault
              ? 'Play item'
              : 'Play supporter'
            : (reason ?? 'Cannot play')}
      </button>
    </CardZoom>
  );
}

export function CardDetailSheet() {
  const state = useGameStore((s) => s.state);
  const cardDetail = useUiStore((s) => s.cardDetail);
  const setCardDetail = useUiStore((s) => s.setCardDetail);
  if (!state || !cardDetail) return null;
  const player = activePlayer(state);
  if (!player) return null;
  const close = () => setCardDetail(null);

  if (cardDetail.kind === 'spell') {
    return <SpellDetail state={state} player={player} cardId={cardDetail.id} onClose={close} />;
  }
  return (
    <PlayableDetail
      state={state}
      player={player}
      kind={cardDetail.kind}
      cardId={cardDetail.id}
      onClose={close}
    />
  );
}
