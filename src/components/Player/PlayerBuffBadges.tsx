import clsx from 'clsx';
import type { GameState } from '../../game/types';
import { mysticismInPlaceDiscount } from '../../game/effects/helpers';
import { ResourceIcon, ShieldIcon } from '../icons';

/**
 * Renders the small shield + label pills for every buff currently affecting
 * `playerId` — the production-board counterpart to the debug console's
 * PlayerBuffBadges. Each pill hovers to its full effect text (kinds blocked,
 * source restriction, duration).
 *
 * Beyond the entries in `state.activeBuffs`, this also surfaces the Mysticism
 * Side B "In-Place" discount: that's a passive Mage power (not a stored buff),
 * so it would otherwise be invisible even though it's shaving 1 Mana off the
 * player's spells. We synthesise a badge for it whenever it's active.
 */
export function PlayerBuffBadges({
  state,
  playerId,
  className,
}: {
  state: GameState;
  playerId: string;
  className?: string;
}) {
  const mine = state.activeBuffs.filter((b) =>
    b.kind === 'mage-immunity'
      ? b.ownerId === playerId
      : b.casterPlayerId === playerId,
  );
  const mysticismB = mysticismInPlaceDiscount(state, playerId) > 0;

  if (mine.length === 0 && !mysticismB) return null;

  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1', className)}>
      {mine.map((b, i) => {
        const dur =
          b.expiresAt.kind === 'turn-start'
            ? 'until your next turn'
            : 'rest of round';
        let title: string;
        let toneClass: string;
        let keyBase: string;
        if (b.kind === 'mage-immunity') {
          const kinds = b.immuneTo.join(' / ');
          const sourceLabel =
            b.source === 'spell' ? 'spell-source only' : 'any source';
          title = `${b.label} — your mages immune to ${kinds} (${sourceLabel}, ${dur})`;
          toneClass = 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
          keyBase = b.spellCardId;
        } else if (b.kind === 'mages-lose-powers') {
          title = `${b.label} — all non-Divinity mages lose their powers (${dur})`;
          toneClass = 'text-violet-300 bg-violet-500/10 border-violet-500/30';
          keyBase = b.spellCardId;
        } else if (b.kind === 'shadow-on-place') {
          const modeText =
            b.mode === 'mandatory'
              ? 'all your placements must shadow'
              : 'your placements may shadow opposing mages';
          title = `${b.label} — ${modeText} (${dur})`;
          toneClass = 'text-sky-300 bg-sky-500/10 border-sky-500/30';
          keyBase = b.spellCardId;
        } else if (b.kind === 'placements-blocked') {
          title = `${b.label} — Mages cannot be placed by anyone (${dur})`;
          toneClass = 'text-rose-300 bg-rose-500/10 border-rose-500/30';
          keyBase = b.spellCardId;
        } else if (b.kind === 'spells-blocked') {
          title = `${b.label} — Spells cannot be cast by anyone (${dur})`;
          toneClass = 'text-rose-300 bg-rose-500/10 border-rose-500/30';
          keyBase = b.spellCardId;
        } else if (b.kind === 'revival') {
          title = `${b.label} — your wounded Mages can move out of the Infirmary right after they're wounded (${dur})`;
          toneClass = 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
          keyBase = b.spellCardId;
        } else if (b.kind === 'energy-drain') {
          title = `${b.label} — opponents pay ${b.surcharge} extra Mana on Spell casts (Mana flows to you, ${dur})`;
          toneClass = 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30';
          keyBase = b.spellCardId;
        } else {
          // spells-cheaper (Power / Inner Fire)
          title = `${b.label} — your Spells cost ${b.discount} less Mana (${dur})`;
          toneClass = 'text-amber-300 bg-amber-500/10 border-amber-500/30';
          keyBase = b.sourceId;
        }
        return (
          <span
            key={`${keyBase}-${i}`}
            title={title}
            aria-label={title}
            className={clsx(
              'inline-flex items-center gap-0.5 rounded border px-1 text-[10px] font-semibold',
              toneClass,
            )}
          >
            <ShieldIcon size={11} />
            {b.label}
          </span>
        );
      })}
      {mysticismB && (
        <span
          title="Mysticism (Side B) — In-Place: while one of your grey Mages sits in a University slot, your Spells cost 1 less Mana (minimum 1)"
          aria-label="Mysticism In-Place discount active"
          className="inline-flex items-center gap-0.5 rounded border border-slate-400/40 bg-slate-400/10 px-1 text-[10px] font-semibold text-slate-200"
        >
          <ShieldIcon size={11} />
          In-Place −1
          <ResourceIcon kind="mana" size={10} />
        </span>
      )}
    </span>
  );
}
