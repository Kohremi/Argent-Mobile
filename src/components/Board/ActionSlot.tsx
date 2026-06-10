import clsx from 'clsx';
import type { ActionSpace, OwnedMage, Player } from '../../game/types';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import { MageToken } from './MageToken';

/**
 * A placement slot rendered as a ground spell-circle (docs/UI_DESIGN.md §7.3).
 * States: idle (dashed rune ring), available (leyline glow + breathe),
 * occupied (solid owner-color ring + student), merit (gold laurel rim),
 * shadow occupant (spectral copy floating behind the base occupant).
 */

export interface ActionSlotProps {
  space: ActionSpace;
  available: boolean;
  onPlace?: (spaceId: string) => void;
  mageIndex: Map<string, { mage: OwnedMage; owner: Player }>;
}

function CostChips({ space }: { space: ActionSpace }) {
  const cost = space.costToActivate;
  const chips: string[] = [];
  if (cost?.meritBadges) chips.push(`${cost.meritBadges}🎖`);
  if (cost?.gold) chips.push(`${cost.gold}g`);
  if (cost?.mana) chips.push(`${cost.mana}✦`);
  if (chips.length === 0) return null;
  return (
    <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-0.5 z-10">
      {chips.map((c, i) => (
        <span
          key={i}
          className="rounded-full bg-night-800/90 px-1.5 text-[10px] leading-4 text-starlight ring-1 ring-starlight/40"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

export function ActionSlot({ space, available, onPlace, mageIndex }: ActionSlotProps) {
  const occ = space.occupant ? mageIndex.get(space.occupant.mageId) : undefined;
  const shadow = space.shadowOccupant
    ? mageIndex.get(space.shadowOccupant.mageId)
    : undefined;
  const isMerit = space.slotType === 'merit' || space.slotType === 'shadow-merit';

  return (
    <button
      type="button"
      data-available={available}
      disabled={!available}
      onClick={available && onPlace ? () => onPlace(space.id) : undefined}
      title={space.description}
      className={clsx(
        'relative h-[72px] w-[64px] shrink-0 outline-none',
        available && 'cursor-pointer',
      )}
    >
      <CostChips space={space} />

      {/* ground circle */}
      <span
        className={clsx(
          'absolute bottom-0 left-1/2 h-[26px] w-[56px] -translate-x-1/2 rounded-slot border-2 transition-all duration-150',
          occ
            ? 'border-solid bg-night-900/40'
            : 'border-dashed bg-night-900/25',
          available
            ? 'border-leyline shadow-glow animate-breathe'
            : isMerit
              ? 'border-starlight/60'
              : 'border-white/25',
          available && 'hover:scale-110 hover:border-starlight',
        )}
        style={
          occ
            ? { borderColor: PLAYER_AURA[occ.owner.color] }
            : available
              ? ({ '--glow': '#7ee8fa88' } as React.CSSProperties)
              : undefined
        }
      />

      {/* spectral shadow occupant, floating behind/above */}
      {shadow && (
        <span className="absolute bottom-6 left-1/2 -translate-x-1/2 z-0">
          <MageToken
            color={shadow.mage.color}
            aura={PLAYER_AURA[shadow.owner.color]}
            isShadowing
            size={34}
          />
        </span>
      )}

      {/* base occupant */}
      {occ && (
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-[1] animate-pop">
          <MageToken
            color={occ.mage.color}
            aura={PLAYER_AURA[occ.owner.color]}
            isWounded={occ.mage.isWounded}
            size={44}
          />
        </span>
      )}
    </button>
  );
}
