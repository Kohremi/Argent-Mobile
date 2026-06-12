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
 * The active player's hand (docs/UI_DESIGN.md §9.2): three card fans —
 * spellbook, vault, allies — rising out of the dock. Each card carries its
 * function on the face (per-level rules text for spells, description for
 * vault items and supporters); hovering lifts a card clear of the fan.
 * Playability comes from engine dry-runs; clicking dispatches the real
 * action and PromptDirector takes over any follow-up prompts.
 */

const GEM_KEYS = ['intPlaced', 'wisPlacedLevel2', 'wisPlacedLevel3'] as const;

/** Timing stamps: every spell level is a Fast Action, Action, or Reaction. */
const TIMING_LABEL: Record<string, string> = {
  'fast-action': 'fast',
  action: 'action',
  reaction: 'reaction',
  passive: 'passive',
  endgame: 'endgame',
};
const TIMING_HUE: Record<string, string> = {
  'fast-action': '#b45309', // amber — squeeze it in any time on your turn
  action: '#475569', // slate — your action for the turn
  reaction: '#be185d', // rose — fires on an opponent's move
  passive: '#15803d', // green — always on
  endgame: '#6d28d9', // violet — scores at the election
};

/** Arc a card into its fan position (origin well below the card). */
function fanStyle(i: number, n: number, flat: boolean): React.CSSProperties {
  const style: React.CSSProperties = { transformOrigin: '50% 140%' };
  if (!flat && n > 1) {
    const off = i - (n - 1) / 2;
    style.transform = `rotate(${off * 3}deg) translateY(${Math.abs(off) * 4}px)`;
  }
  if (i > 0) style.marginLeft = n >= 6 ? -64 : n >= 4 ? -40 : -16;
  return style;
}

function SpellTome({
  state,
  player,
  cardId,
  castable,
  fanIndex,
  fanCount,
}: {
  state: GameState;
  player: Player;
  cardId: string;
  castable: Set<1 | 2 | 3> | undefined;
  fanIndex: number;
  fanCount: number;
}) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const [open, setOpen] = useState(false);
  const owned = player.ownedSpells.find((s) => s.cardId === cardId);
  const def = lookupSpellCardDef(state, cardId);
  if (!owned || !def) return null;
  const hue = DEPT_HUE[def.department] ?? '#ffe9a8';
  const anyCastable = (castable?.size ?? 0) > 0;

  return (
    <div
      className={clsx('relative transition-transform duration-150', open ? 'z-50' : 'hover:z-40')}
      style={fanStyle(fanIndex, fanCount, open)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={def.name}
        className={clsx(
          'flex h-[232px] w-[136px] flex-col rounded-xl border-l-4 bg-parchment-50 px-1.5 py-1.5 text-left shadow-card transition',
          owned.exhausted && 'opacity-60 saturate-50',
          anyCastable
            ? 'ring-1 ring-leyline/50 hover:-translate-y-5 hover:scale-105 hover:shadow-card-lift'
            : 'ring-1 ring-black/10 hover:-translate-y-5',
          open && 'ring-2 ring-starlight',
        )}
        style={{ borderLeftColor: hue }}
      >
        <span className="flex items-start justify-between gap-1">
          <span className="line-clamp-2 text-[11px] font-bold leading-tight text-ink-900">
            {def.name}
          </span>
          {owned.exhausted && (
            <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide text-black/45">
              used
            </span>
          )}
        </span>

        {/* per-level rules text on the face */}
        <span className="mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
          {def.levels.map((lvl, i) => {
            const researched = owned[GEM_KEYS[i] ?? 'intPlaced'];
            const lit = castable?.has(lvl.level as 1 | 2 | 3) ?? false;
            return (
              <span
                key={lvl.level}
                className={clsx(
                  'rounded-md px-1 py-0.5',
                  lit ? 'bg-white/70' : researched ? 'bg-black/[0.04]' : 'opacity-45',
                )}
              >
                <span className="flex items-center gap-1">
                  <span
                    className={clsx(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full font-arcane text-[8px] font-bold',
                      lit ? 'text-ink-900 shadow-glow-sm' : researched ? 'bg-night-600 text-white/80' : 'bg-black/15 text-black/35',
                    )}
                    style={lit ? ({ background: hue, '--glow': `${hue}66` } as React.CSSProperties) : undefined}
                    title={`Level ${lvl.level}${researched ? '' : ' (not researched)'}`}
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
                <span className="line-clamp-3 block text-[8.5px] leading-snug text-black/70">
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

      {/* level popover (cast controls + full text) */}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 animate-pop rounded-card bg-night-700/98 p-2 shadow-card-lift ring-1 ring-white/15">
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
                  <span
                    className="ml-1 text-[10px] font-bold uppercase tracking-wide brightness-150"
                    style={{ color: TIMING_HUE[lvl.timing] }}
                  >
                    {TIMING_LABEL[lvl.timing]}
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

function HandCard({
  name,
  sub,
  timing,
  description,
  hue,
  playable,
  exhausted,
  onPlay,
  fanIndex,
  fanCount,
}: {
  name: string;
  sub?: string | undefined;
  timing?: string | undefined;
  description?: string | undefined;
  hue: string;
  playable: boolean;
  exhausted?: boolean;
  onPlay: () => void;
  fanIndex: number;
  fanCount: number;
}) {
  return (
    <div
      className="relative transition-transform duration-150 hover:z-40"
      style={fanStyle(fanIndex, fanCount, false)}
    >
      <button
        type="button"
        disabled={!playable}
        onClick={onPlay}
        title={description}
        className={clsx(
          'flex h-[140px] w-[124px] flex-col rounded-xl border-l-4 bg-parchment-50 px-2 py-1.5 text-left shadow-card transition hover:-translate-y-5',
          exhausted && 'opacity-60 saturate-50',
          playable
            ? 'ring-1 ring-leyline/50 hover:scale-105 hover:shadow-card-lift'
            : 'ring-1 ring-black/10',
        )}
        style={{ borderLeftColor: hue }}
      >
        <span className="line-clamp-2 text-[11px] font-bold leading-tight text-ink-900">
          {name}
        </span>
        <span className="flex w-full items-center gap-1 text-[8px] font-bold uppercase tracking-wide text-black/45">
          {sub}
          {timing && (
            <span style={{ color: TIMING_HUE[timing] }}>· {TIMING_LABEL[timing] ?? timing}</span>
          )}
          {exhausted && <span className="ml-auto">used</span>}
        </span>
        {description && (
          <span className="mt-1 line-clamp-6 text-[9px] leading-snug text-black/70">
            {description}
          </span>
        )}
      </button>
    </div>
  );
}

function FanGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-end">
      <span className="mb-2 shrink-0 -rotate-90 text-[9px] uppercase tracking-widest text-white/35">
        {label}
      </span>
      <div className="flex items-end pt-1">{children}</div>
    </div>
  );
}

export function HandFans({ state, player }: { state: GameState; player: Player }) {
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const castable = castableSpellLevels(state, player.id);
  const vaultOk = playableVaultCards(state, player.id);
  const suppOk = playableSupporters(state, player.id);

  return (
    <div className="flex h-[96px] items-end gap-6 px-2">
      {player.ownedSpells.length > 0 && (
        <FanGroup label="spells">
          {player.ownedSpells.map((s, i) => (
            <SpellTome
              key={s.cardId}
              state={state}
              player={player}
              cardId={s.cardId}
              castable={castable.get(s.cardId)}
              fanIndex={i}
              fanCount={player.ownedSpells.length}
            />
          ))}
        </FanGroup>
      )}
      {player.vaultCards.length > 0 && (
        <FanGroup label="vault">
          {player.vaultCards.map((v, i) => {
            const def = lookupVaultCardDef(state, v.cardId);
            return (
              <HandCard
                key={`${v.cardId}-${i}`}
                name={def?.name ?? v.cardId}
                sub={def?.type === 'treasure' ? 'treasure' : 'consumable'}
                timing={def?.timing}
                description={def?.description}
                hue="#ff9f43"
                playable={vaultOk.has(v.cardId) && !v.exhausted}
                exhausted={v.exhausted}
                fanIndex={i}
                fanCount={player.vaultCards.length}
                onPlay={() =>
                  tryDispatch({ type: 'PLAY_VAULT_CARD', playerId: player.id, vaultCardId: v.cardId })
                }
              />
            );
          })}
        </FanGroup>
      )}
      {player.supporters.length > 0 && (
        <FanGroup label="allies">
          {player.supporters.map((cardId, i) => {
            const def = lookupSupporterCardDef(state, cardId);
            const hue = DEPT_HUE[def?.department ?? 'students'] ?? '#e8e4da';
            return (
              <HandCard
                key={`${cardId}-${i}`}
                name={def?.name ?? cardId}
                sub="supporter"
                timing={def?.timing}
                description={def?.description}
                hue={hue}
                playable={suppOk.has(cardId)}
                fanIndex={i}
                fanCount={player.supporters.length}
                onPlay={() =>
                  tryDispatch({ type: 'PLAY_SUPPORTER', playerId: player.id, supporterCardId: cardId })
                }
              />
            );
          })}
        </FanGroup>
      )}
    </div>
  );
}
