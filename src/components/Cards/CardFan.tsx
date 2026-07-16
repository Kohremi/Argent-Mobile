import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GameCard, type CardFace, type CardStatus } from './GameCard';

/**
 * A compact "hand" of overlapping card faces. The cards collapse into a tight
 * stack to save room; touching (or hovering) fans them out, sliding the pointer
 * across the fan previews the card under it, and releasing on a card opens it.
 * Several of these sit side-by-side in a single row (e.g. spells / vault /
 * allies) on the Rivals board and the player's own un-collapsed hand. Purely
 * presentational — the caller decides what `onOpen` does (read-only zoom vs.
 * the play/cast sheet).
 *
 * Gesture handling lives on the container, not the cards: on touch, the first
 * element pressed implicitly captures the pointer, so per-card enter/move
 * handlers never fire while swiping. Instead we resolve the card under the
 * finger with elementFromPoint on every move, and `touch-action: none` keeps
 * the browser's scroll gesture from stealing the pointer (pointercancel)
 * mid-swipe.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
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
    pressed.current = false;
    setSpread(false);
    setHover(null);
  };

  // Which card is under the pointer right now? Hit-testing the rendered layout
  // (rather than doing math) stays correct through the spread/scale transition
  // and the cards' overlap/z-order.
  const indexAt = (x: number, y: number): number | null => {
    const root = rootRef.current;
    if (!root) return null;
    const el = document.elementFromPoint(x, y);
    const btn = el instanceof Element ? el.closest<HTMLElement>('[data-fan-card]') : null;
    if (!btn || !root.contains(btn)) return null;
    const i = Number(btn.dataset['fanCard']);
    return Number.isInteger(i) && i >= 0 && i < items.length ? i : null;
  };

  const trackPointer = (e: React.PointerEvent) => {
    lastPoint.current = { x: e.clientX, y: e.clientY };
    setHover(indexAt(e.clientX, e.clientY));
  };

  const previewItem = hover != null ? items[hover] : undefined;
  // Legibility peek: the hovered/dragged card, blown up in the upper half of the
  // screen (these thumbnails are too small to read). Portalled to the body so it
  // escapes the dock and isn't clipped; pointer-events-none so taps pass through.
  const previewW = previewItem?.face.kind === 'spell' ? 'min(48vw, 190px)' : 'min(58vw, 230px)';

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={rootRef}
        className="relative select-none"
        style={{
          width: footprint,
          height: fanH,
          zIndex: spread ? 30 : 1,
          // Enlarge the whole fan ~20% while it's being browsed.
          transform: spread ? 'scale(1.2)' : 'scale(1)',
          transformOrigin: 'bottom center',
          transition: 'transform 150ms ease',
          // The fan owns the touch: without this the browser claims the drag
          // as a scroll and pointercancels the swipe.
          touchAction: 'none',
        }}
        onPointerEnter={() => setSpread(true)}
        onPointerDown={(e) => {
          pressed.current = true;
          setSpread(true);
          trackPointer(e);
        }}
        onPointerMove={trackPointer}
        onPointerUp={() => {
          // Select what the preview is showing — not a fresh hit-test, which
          // could land on a neighbor mid-spread-animation.
          const idx = pressed.current ? hover : null;
          collapse();
          if (idx != null) items[idx]?.onOpen();
        }}
        onPointerLeave={(e) => {
          // While a finger is down the pointer is captured, so a "leave" only
          // means the gesture ended (up/cancel already handled it) — don't
          // collapse mid-swipe when the finger drifts past the fan's edge.
          if (!pressed.current) collapse();
          else if (e.pointerType === 'mouse') collapse();
        }}
        onPointerCancel={collapse}
        // Once the spread/scale transition settles, re-check what's under a
        // still finger — the cards moved out from under it while it held still.
        onTransitionEnd={() => {
          if (pressed.current && lastPoint.current) {
            setHover(indexAt(lastPoint.current.x, lastPoint.current.y));
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) => {
          const lifted = hover === i;
          const baseX = i * step;
          // A gentle lift only — the hovered card is already shown blown-up at
          // the top of the screen, so a big in-fan jump just disrupts the flow
          // of swiping through the hand. Keep it a subtle "this one" nudge.
          const transform = lifted
            ? `translateX(${baseX}px) translateY(-3px) scale(1.04)`
            : spread
              ? `translateX(${baseX}px) rotate(${(i - mid) * 4}deg)`
              : `translateX(${baseX}px)`;
          return (
            <button
              key={it.key}
              type="button"
              data-fan-card={i}
              // Pointer selection is handled by the container on release; this
              // only serves keyboard activation (Enter/Space arrive as detail 0).
              onClick={(e) => {
                if (e.detail === 0) it.onOpen();
              }}
              className="absolute left-0 top-0 origin-bottom appearance-none border-0 bg-transparent p-0 transition-transform duration-150"
              // Keep the natural stacking order even when hovered — pulling the
              // hovered card to the front re-layers the fan and makes it jumpy to
              // scroll through. The top-of-screen preview is the readable view.
              style={{ transform, zIndex: i }}
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

      {previewItem &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-4 drop-shadow-2xl">
            <GameCard
              face={previewItem.face}
              status={previewItem.status ?? null}
              style={{ width: previewW }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
