import { useState } from 'react';
import { GameCard, type CardFace, type CardStatus } from './GameCard';

/**
 * A compact "hand" of overlapping card faces. The cards collapse into a tight
 * stack to save room; dragging (or hovering) over them fans them out and lifts
 * the one under the pointer; tapping a card fires its `onOpen`. Several of these
 * sit side-by-side in a single row (e.g. spells / vault / allies) on the Rivals
 * board and the player's own un-collapsed hand. Purely presentational — the
 * caller decides what `onOpen` does (read-only zoom vs. the play/cast sheet).
 */

export type FanItem = {
  key: string;
  face: CardFace;
  status?: CardStatus;
  onOpen: () => void;
};

const DEFAULT_CARD_W = 50; // px

export function CardFan({
  label,
  items,
  cardWidth = DEFAULT_CARD_W,
}: {
  label: string;
  items: FanItem[];
  cardWidth?: number;
}) {
  const [spread, setSpread] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  if (items.length === 0) return null;

  const n = items.length;
  const mid = (n - 1) / 2;
  const collapsedStep = n > 4 ? 9 : 14;
  const spreadStep = n > 4 ? 24 : 32;
  const step = spread ? spreadStep : collapsedStep;
  const footprint = cardWidth + (n - 1) * collapsedStep;
  // Tarot (spells) is taller than trading cards — reserve the right height.
  const ratioH = items[0]?.face.kind === 'spell' ? 19 / 11 : 7 / 5;
  const fanH = Math.round(cardWidth * ratioH);

  const collapse = () => {
    setSpread(false);
    setHover(null);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative"
        style={{ width: footprint, height: fanH, zIndex: spread ? 30 : 1 }}
        onPointerEnter={() => setSpread(true)}
        onPointerDown={() => setSpread(true)}
        onPointerLeave={collapse}
        onPointerCancel={collapse}
      >
        {items.map((it, i) => {
          const lifted = hover === i;
          const baseX = i * step;
          const transform = lifted
            ? `translateX(${baseX}px) translateY(-10px) scale(1.16)`
            : spread
              ? `translateX(${baseX}px) rotate(${(i - mid) * 4}deg)`
              : `translateX(${baseX}px)`;
          return (
            <button
              key={it.key}
              type="button"
              onPointerMove={() => setHover(i)}
              onPointerEnter={() => setHover(i)}
              onClick={it.onOpen}
              className="absolute left-0 top-0 origin-bottom appearance-none border-0 bg-transparent p-0 transition-transform duration-150"
              style={{ transform, zIndex: lifted ? 50 : i }}
            >
              <GameCard face={it.face} status={it.status ?? null} style={{ width: cardWidth }} />
            </button>
          );
        })}
      </div>
      <span className="text-[9px] font-bold uppercase tracking-widest text-white/35">
        {label}
        <span className="ml-1 text-white/25">{n}</span>
      </span>
    </div>
  );
}
