import clsx from 'clsx';
import type { GameState, PlayerId } from '../../game/types';
import { staffHolderId } from '../../content/packs/archmage';

/**
 * A compact "🪄 Staff" pill shown next to the name of whoever currently holds
 * the Archmage's Staff. Renders nothing for any other player (or when the
 * Archmage's Staff expansion isn't in play). The holder is derived from
 * Staff-card ownership, so it stays in sync without a dedicated state field.
 */
export function StaffBadge({
  state,
  playerId,
  className,
}: {
  state: GameState;
  playerId: PlayerId;
  className?: string;
}) {
  if (staffHolderId(state) !== playerId) return null;
  return (
    <span
      title="Holds the Archmage's Staff"
      aria-label="Holds the Archmage's Staff"
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200',
        className,
      )}
    >
      🪄 Staff
    </span>
  );
}
