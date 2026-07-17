import { motion } from 'framer-motion';
import type { RewardGain } from './useStateDiffFx';
import { ResourceIcon, type ResourceKind } from '../icons';

/**
 * The round-end loot bubble: a little speech bubble that pops up over the room
 * a mage just walked out of, listing what its owner collected (+2 gold, a
 * drafted spell, …). Ringed in the owner's aura so it reads as *their* payout
 * at a glance. Shared by the zoomed-out CampusMap tiles and the desktop
 * RoomScene overlays — callers position it; it animates itself.
 */

/** Card-shaped loot has no ResourceIcon — small glyphs carry those. */
const CARD_GLYPH: Record<string, string> = {
  spell: '📜',
  vault: '💎',
  supporter: '🎓',
  mage: '🧙',
};

export function RewardBubble({
  gains,
  aura,
}: {
  gains: RewardGain[];
  aura?: string | undefined;
}) {
  return (
    <motion.span
      className="relative flex items-center gap-1.5 rounded-full bg-night-900/90 px-2 py-1 text-[11px] font-extrabold text-parchment-50 shadow-lg"
      style={{ boxShadow: `0 0 0 1.5px ${aura ?? '#ffffff55'}, 0 4px 12px #000c` }}
      initial={{ y: 8, scale: 0.5, opacity: 0 }}
      animate={{ y: [8, -10, -16], scale: 1, opacity: [0, 1, 1, 0] }}
      transition={{ duration: 1.6, ease: 'easeOut', times: [0, 0.15, 0.8, 1] }}
    >
      {gains.map((g, i) => (
        <span key={i} className="flex items-center gap-0.5 whitespace-nowrap">
          +{g.amount}
          {g.icon in CARD_GLYPH ? (
            <span className="text-[12px] leading-none">{CARD_GLYPH[g.icon]}</span>
          ) : (
            <ResourceIcon kind={g.icon as ResourceKind} size={12} />
          )}
        </span>
      ))}
      {/* speech-bubble tail pointing down at the room */}
      <span
        aria-hidden
        className="absolute -bottom-[3px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-night-900/90"
        style={{ borderRight: `1.5px solid ${aura ?? '#ffffff55'}`, borderBottom: `1.5px solid ${aura ?? '#ffffff55'}` }}
      />
    </motion.span>
  );
}
