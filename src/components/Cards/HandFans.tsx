import { useState } from 'react';
import clsx from 'clsx';
import type { GameState, Player } from '../../game/types';
import {
  lookupSpellCardDef,
  lookupSupporterCardDef,
  lookupVaultCardDef,
} from '../../game/effects/helpers';
import { useUiStore } from '../../store/uiStore';
import {
  castableSpellLevels,
  DEPT_HUE,
  playableSupporters,
  playableVaultCards,
} from '../../utils/uiSelectors';

/**
 * The active player's hands (docs/UI_DESIGN.md §9.2, functional pass):
 * spell tomes with level gems + cast popover, vault card chips, supporter
 * chips. Playability comes from engine dry-runs; clicking dispatches the
 * real action and PromptDirector takes over any follow-up prompts.
 */

const GEM_KEYS = ['intPlaced', 'wisPlacedLevel2', 'wisPlacedLevel3'] as const;

function SpellTome({
  state,
  player,
  cardId,
  castable,
}: {
  state: GameState;
  player: Player;
  cardId: string;
  castable: Set<1 | 2 | 3> | undefined;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const [open, setOpen] = useState(false);
  const owned = player.ownedSpells.find((s) => s.cardId === cardId);
  const def = lookupSpellCardDef(state, cardId);
  if (!owned || !def) return null;
  const hue = DEPT_HUE[def.department] ?? '#ffe9a8';
  const anyCastable = (castable?.size ?? 0) > 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={def.name}
        className={clsx(
          'flex h-[52px] w-[108px] flex-col justify-between rounded-lg border-l-4 bg-parchment-50 px-1.5 py-1 text-left shadow-card transition',
          owned.exhausted && 'opacity-60 saturate-50',
          anyCastable
            ? 'hover:-translate-y-1 hover:shadow-card-lift ring-1 ring-leyline/50'
            : 'ring-1 ring-black/10',
          open && 'ring-2 ring-starlight',
        )}
        style={{ borderLeftColor: hue }}
      >
        <span className="line-clamp-2 text-[11px] font-bold leading-tight text-ink-900">
          {def.name}
        </span>
        <span className="flex gap-1">
          {def.levels.map((lvl, i) => {
            const researched = owned[GEM_KEYS[i] ?? 'intPlaced'];
            const lit = castable?.has(lvl.level as 1 | 2 | 3) ?? false;
            return (
              <span
                key={lvl.level}
                className={clsx(
                  'flex h-3.5 w-3.5 items-center justify-center rounded-full font-arcane text-[8px] font-bold',
                  lit
                    ? 'text-ink-900 shadow-glow-sm'
                    : researched
                      ? 'bg-night-600 text-white/80'
                      : 'bg-black/15 text-black/35',
                )}
                style={lit ? { background: hue, '--glow': `${hue}66` } as React.CSSProperties : undefined}
                title={`Level ${lvl.level}${researched ? '' : ' (not researched)'}`}
              >
                {lvl.level}
              </span>
            );
          })}
          {owned.exhausted && (
            <span className="ml-auto text-[8px] font-bold uppercase tracking-wide text-black/45">
              used
            </span>
          )}
        </span>
      </button>

      {/* level popover */}
      {open && (
        <div className="absolute bottom-[58px] left-0 z-50 w-64 animate-pop rounded-card bg-night-700/98 p-2 shadow-card-lift ring-1 ring-white/15">
          <p className="mb-1.5 font-display text-sm font-bold" style={{ color: hue }}>
            {def.name}
          </p>
          <div className="flex flex-col gap-1">
            {def.levels.map((lvl) => {
              const ok = castable?.has(lvl.level as 1 | 2 | 3) ?? false;
              return (
                <button
                  key={lvl.level}
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    setOpen(false);
                    tryDispatch({
                      type: 'CAST_SPELL',
                      playerId: player.id,
                      spellCardId: cardId,
                      level: lvl.level as 1 | 2 | 3,
                    });
                  }}
                  className={clsx(
                    'rounded-lg px-2 py-1 text-left text-xs ring-1 transition',
                    ok
                      ? 'bg-night-600 ring-leyline/40 hover:-translate-y-0.5 hover:ring-starlight/70'
                      : 'bg-night-800 opacity-50 ring-white/10',
                  )}
                >
                  <span className="font-bold text-white/95">
                    L{lvl.level} {lvl.title ?? ''}
                  </span>
                  <span className="ml-1 text-starlight">
                    {lvl.manaCost > 0 ? `${lvl.manaCost}✦` : 'free'}
                  </span>
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-white/40">
                    {lvl.timing === 'fast-action' ? 'fast' : 'action'}
                  </span>
                  {lvl.description && (
                    <span className="block text-[11px] leading-snug text-white/65">
                      {lvl.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HandChip({
  name,
  sub,
  hue,
  playable,
  exhausted,
  onPlay,
  tooltip,
}: {
  name: string;
  sub?: string | undefined;
  hue: string;
  playable: boolean;
  exhausted?: boolean;
  onPlay: () => void;
  tooltip?: string | undefined;
}) {
  return (
    <button
      type="button"
      disabled={!playable}
      onClick={onPlay}
      title={tooltip}
      className={clsx(
        'flex h-[52px] w-[96px] flex-col justify-between rounded-lg border-l-4 bg-parchment-50 px-1.5 py-1 text-left shadow-card transition',
        exhausted && 'opacity-60 saturate-50',
        playable
          ? 'ring-1 ring-leyline/50 hover:-translate-y-1 hover:shadow-card-lift'
          : 'ring-1 ring-black/10',
      )}
      style={{ borderLeftColor: hue }}
    >
      <span className="line-clamp-2 text-[11px] font-bold leading-tight text-ink-900">
        {name}
      </span>
      <span className="flex w-full items-center justify-between text-[8px] font-bold uppercase tracking-wide text-black/45">
        {sub}
        {exhausted && <span>used</span>}
      </span>
    </button>
  );
}

export function HandFans({ state, player }: { state: GameState; player: Player }) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const castable = castableSpellLevels(state, player.id);
  const vaultOk = playableVaultCards(state, player.id);
  const suppOk = playableSupporters(state, player.id);

  return (
    <div className="flex items-end gap-3 overflow-x-auto px-1 pb-0.5">
      {player.ownedSpells.length > 0 && (
        <div className="flex items-end gap-1">
          <span className="mb-1 shrink-0 -rotate-90 text-[9px] uppercase tracking-widest text-white/35">
            spells
          </span>
          {player.ownedSpells.map((s) => (
            <SpellTome
              key={s.cardId}
              state={state}
              player={player}
              cardId={s.cardId}
              castable={castable.get(s.cardId)}
            />
          ))}
        </div>
      )}
      {player.vaultCards.length > 0 && (
        <div className="flex items-end gap-1">
          <span className="mb-1 shrink-0 -rotate-90 text-[9px] uppercase tracking-widest text-white/35">
            vault
          </span>
          {player.vaultCards.map((v, i) => {
            const def = lookupVaultCardDef(state, v.cardId);
            return (
              <HandChip
                key={`${v.cardId}-${i}`}
                name={def?.name ?? v.cardId}
                sub={def?.type === 'treasure' ? 'treasure' : 'consumable'}
                hue="#ff9f43"
                playable={vaultOk.has(v.cardId) && !v.exhausted}
                exhausted={v.exhausted}
                tooltip={def?.description}
                onPlay={() =>
                  tryDispatch({ type: 'PLAY_VAULT_CARD', playerId: player.id, vaultCardId: v.cardId })
                }
              />
            );
          })}
        </div>
      )}
      {player.supporters.length > 0 && (
        <div className="flex items-end gap-1">
          <span className="mb-1 shrink-0 -rotate-90 text-[9px] uppercase tracking-widest text-white/35">
            allies
          </span>
          {player.supporters.map((cardId, i) => {
            const def = lookupSupporterCardDef(state, cardId);
            const hue = DEPT_HUE[def?.department ?? 'students'] ?? '#e8e4da';
            return (
              <HandChip
                key={`${cardId}-${i}`}
                name={def?.name ?? cardId}
                sub={def?.timing}
                hue={hue}
                playable={suppOk.has(cardId)}
                tooltip={def?.description}
                onPlay={() =>
                  tryDispatch({ type: 'PLAY_SUPPORTER', playerId: player.id, supporterCardId: cardId })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
