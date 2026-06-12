import clsx from 'clsx';
import type { ActionSpace, OwnedMage, Player } from '../../game/types';
import { useUiStore } from '../../store/uiStore';
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
  // Merit-badge costs render on the crest, not as a floating chip.
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

/**
 * The laurel crest that marks a merit slot, latched onto the right edge of
 * the circle. Carries the badge cost when the slot has one (a star when
 * free) — the slot IS visibly a merit slot, so no extra labels needed.
 */
function MeritCrest({ badges, shadow }: { badges?: number | undefined; shadow: boolean }) {
  return (
    <svg
      className="pointer-events-none absolute -right-0.5 bottom-0 z-[2]"
      width="20"
      height="26"
      viewBox="0 0 20 26"
    >
      {/* ribbon tails */}
      <path d="M5 16 L2 25 L7 22 Z" fill="#b4533c" />
      <path d="M15 16 L18 25 L13 22 Z" fill="#b4533c" />
      {/* shield */}
      <path
        d="M10 1 L18 4 V11 Q18 18 10 22 Q2 18 2 11 V4 Z"
        fill={shadow ? '#6c5a8e' : '#ffe9a8'}
        stroke={shadow ? '#b388eb' : '#b48a3c'}
        strokeWidth="1.5"
      />
      <path d="M10 3.2 L16 5.4 V11 Q16 16.4 10 19.8 Q4 16.4 4 11 V5.4 Z" fill="#00000022" />
      {badges ? (
        <text
          x="10"
          y="14.5"
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fill={shadow ? '#fff' : '#5d4a16'}
        >
          {badges}
        </text>
      ) : (
        <path
          d="M10 6.5 l1.5 3.1 3.4 .4 -2.5 2.3 .7 3.4 -3.1 -1.7 -3.1 1.7 .7 -3.4 -2.5 -2.3 3.4 -.4 Z"
          fill={shadow ? '#fff' : '#b48a3c'}
        />
      )}
    </svg>
  );
}

/** A mage token that lights up rose + becomes clickable under targeting.
 *  (Also used by the Infirmary bed grid in RoomScene.) */
export function TargetableToken({
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
  const setHoveredSlot = useUiStore((s) => s.setHoveredSlot);
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
    <div
      className="relative h-[72px] w-[64px] shrink-0"
      onPointerEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHoveredSlot({ space, rect: { x: r.x, y: r.y, w: r.width } });
      }}
      onPointerLeave={() => setHoveredSlot(null)}
    >
      <CostChips space={space} />

      {/* ground circle — placement / space-targeting click surface */}
      <button
        type="button"
        data-available={circleActive}
        disabled={!circleActive}
        onClick={onCircleClick}
        className={clsx(
          'absolute bottom-0 left-1/2 h-[26px] w-[56px] -translate-x-1/2 rounded-slot border-2 transition-all duration-150',
          occ ? 'border-solid bg-night-900/40' : 'border-dashed bg-night-900/25',
          isMerit && !occ && 'border-solid bg-starlight/10',
          circleActive
            ? 'cursor-pointer border-leyline shadow-glow animate-breathe hover:scale-110 hover:border-starlight'
            : isMerit
              ? 'border-starlight'
              : 'border-white/25',
        )}
        style={
          circleActive
            ? ({ '--glow': '#7ee8fa88' } as React.CSSProperties)
            : occ
              ? { borderColor: PLAYER_AURA[occ.owner.color] }
              : isMerit
                ? { boxShadow: 'inset 0 0 8px #ffe9a833' }
                : undefined
        }
      />

      {/* merit slots wear their crest — no labels needed */}
      {isMerit && (
        <MeritCrest
          badges={space.costToActivate?.meritBadges}
          shadow={space.slotType === 'shadow-merit'}
        />
      )}

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
