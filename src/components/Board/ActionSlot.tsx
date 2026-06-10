import clsx from 'clsx';
import type { ActionSpace, OwnedMage, Player } from '../../game/types';
import { PLAYER_AURA } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from './MageToken';

/**
 * A placement slot rendered as a ground spell-circle (docs/UI_DESIGN.md §7.3).
 * Three interactive layers, each lit by its own source of truth:
 *   - the circle: placement availability (selected bench mage) OR a
 *     choose-target-action-space / reaction-destination prompt;
 *   - the base occupant token: choose-target-mage prompts;
 *   - the shadow occupant token: same, rendered spectral behind the base.
 */

export interface ActionSlotProps {
  space: ActionSpace;
  /** Placement availability for the currently selected bench mage. */
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
    <div className="absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 gap-0.5">
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

/** A mage token that lights up rose + becomes clickable under targeting. */
function TargetableToken({
  entry,
  size,
  className,
}: {
  entry: { mage: OwnedMage; owner: Player };
  size: number;
  className?: string;
}) {
  const { mageTargets, pickMage } = usePromptTargets();
  const targeted = mageTargets.has(entry.mage.id);
  const token = (
    <MageToken
      color={entry.mage.color}
      aura={PLAYER_AURA[entry.owner.color]}
      isWounded={entry.mage.isWounded}
      isShadowing={entry.mage.isShadowing}
      size={size}
      glideId={entry.mage.id}
    />
  );
  if (!targeted) return <span className={className}>{token}</span>;
  return (
    <button
      type="button"
      onClick={() => pickMage(entry.mage.id)}
      className={clsx(
        className,
        'animate-breathe cursor-pointer rounded-full transition hover:scale-110',
      )}
      style={{ filter: 'drop-shadow(0 0 7px #ff5d7d)' }}
      title="Choose this student"
    >
      {token}
    </button>
  );
}

export function ActionSlot({ space, available, onPlace, mageIndex }: ActionSlotProps) {
  const { spaceTargets, pickSpace } = usePromptTargets();
  const occ = space.occupant ? mageIndex.get(space.occupant.mageId) : undefined;
  const shadow = space.shadowOccupant
    ? mageIndex.get(space.shadowOccupant.mageId)
    : undefined;
  const isMerit = space.slotType === 'merit' || space.slotType === 'shadow-merit';

  const spaceTargeted = spaceTargets.has(space.id);
  const circleActive = available || spaceTargeted;
  const onCircleClick = spaceTargeted
    ? () => pickSpace(space.id)
    : available && onPlace
      ? () => onPlace(space.id)
      : undefined;

  return (
    <div className="relative h-[72px] w-[64px] shrink-0">
      <CostChips space={space} />

      {/* ground circle — placement / space-targeting click surface */}
      <button
        type="button"
        data-available={circleActive}
        disabled={!circleActive}
        onClick={onCircleClick}
        title={space.description}
        className={clsx(
          'absolute bottom-0 left-1/2 h-[26px] w-[56px] -translate-x-1/2 rounded-slot border-2 transition-all duration-150',
          occ ? 'border-solid bg-night-900/40' : 'border-dashed bg-night-900/25',
          circleActive
            ? 'cursor-pointer border-leyline shadow-glow animate-breathe hover:scale-110 hover:border-starlight'
            : isMerit
              ? 'border-starlight/60'
              : 'border-white/25',
        )}
        style={
          circleActive
            ? ({ '--glow': '#7ee8fa88' } as React.CSSProperties)
            : occ
              ? { borderColor: PLAYER_AURA[occ.owner.color] }
              : undefined
        }
      />

      {/* spectral shadow occupant, floating behind/above */}
      {shadow && (
        <TargetableToken
          entry={shadow}
          size={34}
          className="absolute bottom-6 left-1/2 z-0 -translate-x-1/2"
        />
      )}

      {/* base occupant */}
      {occ && (
        <span className="absolute bottom-1.5 left-1/2 z-[1] -translate-x-1/2">
          <TargetableToken entry={occ} size={44} />
        </span>
      )}
    </div>
  );
}
