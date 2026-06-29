// Inline SVG icons for resources and mages. Used across the debug UI to
// replace text labels with at-a-glance symbols. Each icon paints itself
// in `currentColor`, so it picks up Tailwind's text-color utilities.

import clsx from 'clsx';
import type { MageColor } from '../game/types';

export type ResourceKind =
  | 'gold'
  | 'mana'
  | 'influence'
  | 'intelligence'
  | 'wisdom'
  | 'marks'
  | 'merit-badge'
  | 'research';

interface IconProps {
  className?: string;
  size?: number;
}

const RESOURCE_COLOR: Record<ResourceKind, string> = {
  gold: 'text-amber-400',
  mana: 'text-cyan-400',
  influence: 'text-violet-400',
  intelligence: 'text-indigo-400',
  wisdom: 'text-emerald-400',
  marks: 'text-rose-400',
  'merit-badge': 'text-orange-400',
  research: 'text-fuchsia-400',
};

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  gold: 'Gold',
  mana: 'Mana',
  influence: 'Influence Points',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  marks: 'Marks',
  'merit-badge': 'Merit Badges',
  research: 'Research',
};

export function ResourceIcon({
  kind,
  className,
  size = 14,
}: IconProps & { kind: ResourceKind }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={RESOURCE_LABEL[kind]}
      className={clsx('inline-block flex-shrink-0', RESOURCE_COLOR[kind], className)}
      fill="currentColor"
    >
      <title>{RESOURCE_LABEL[kind]}</title>
      {resourceBody(kind)}
    </svg>
  );
}

function resourceBody(kind: ResourceKind) {
  switch (kind) {
    case 'gold':
      // Coin: outer ring + small inner stamp.
      return (
        <>
          <circle cx="12" cy="12" r="9" opacity="0.25" />
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="12" r="3.5" />
        </>
      );
    case 'mana':
      // Classic teardrop / water drop.
      return (
        <path d="M12 3 C9 8 5 12 5 16 C5 19.5 8 22 12 22 C16 22 19 19.5 19 16 C19 12 15 8 12 3 Z" />
      );
    case 'influence':
      // Diamond / gem.
      return (
        <>
          <path d="M12 3 L4 10 L12 22 L20 10 Z" />
          <path
            d="M4 10 H20 M12 3 V22"
            stroke="white"
            strokeOpacity="0.25"
            strokeWidth="0.8"
            fill="none"
          />
        </>
      );
    case 'intelligence':
      // Parchment with horizontal lines.
      return (
        <>
          <path d="M6 4 H18 Q19 4 19 5 V19 Q19 20 18 20 H6 Q5 20 5 19 V5 Q5 4 6 4 Z" />
          <path
            d="M9 9 H15 M9 13 H15 M9 17 H13"
            stroke="white"
            strokeOpacity="0.55"
            strokeWidth="0.9"
            fill="none"
          />
        </>
      );
    case 'wisdom':
      // Open book.
      return (
        <>
          <path d="M3 6 Q3 5 4 5 H11 V20 Q11 21 10 21 H4 Q3 21 3 20 Z" />
          <path d="M21 6 Q21 5 20 5 H13 V20 Q13 21 14 21 H20 Q21 21 21 20 Z" />
          <path
            d="M5 9 H9 M5 13 H9 M15 9 H19 M15 13 H19"
            stroke="white"
            strokeOpacity="0.55"
            strokeWidth="0.7"
            fill="none"
          />
        </>
      );
    case 'marks':
      // Wax-seal X.
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path
            d="M8 8 L16 16 M16 8 L8 16"
            stroke="white"
            strokeOpacity="0.85"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    case 'merit-badge':
      // Shield with a star.
      return (
        <>
          <path d="M12 3 L20 6 V12 Q20 18 12 22 Q4 18 4 12 V6 Z" />
          <path
            d="M12 8.5 L13.4 11.4 L16.5 11.8 L14.2 14 L14.7 17.1 L12 15.6 L9.3 17.1 L9.8 14 L7.5 11.8 L10.6 11.4 Z"
            fill="white"
            fillOpacity="0.65"
          />
        </>
      );
    case 'research':
      // Stylized flask.
      return (
        <>
          <path d="M9 3 H15 V8 L19 18 Q20 21 17 21 H7 Q4 21 5 18 L9 8 Z" />
          <path
            d="M8 3 H16"
            stroke="white"
            strokeOpacity="0.5"
            strokeWidth="1"
            fill="none"
          />
        </>
      );
  }
}

// ============================================================================
// Mage icons - robed wizard silhouette with a department-themed hat.
//
// Two render modes, auto-picked by `size`:
//   * size <  24  -> simple: silhouette + hat shape only (legible at 11-18 px)
//   * size >= 24  -> detailed: + hat decoration + robe accent (24+ px)
// Pass `detailed={true|false}` to override the auto-pick.
//
// Coordinate budget (viewBox 32x32):
//   y 1-10   hat
//   y 9-17   head (cx=16 cy=13 r=3.5)
//   y 16-30  robe
//   y 22-28  robe accent (centered at cx=16)
// ============================================================================

const MAGE_COLOR_CLASS: Record<MageColor, string> = {
  red: 'text-red-500',
  grey: 'text-slate-300',
  green: 'text-emerald-500',
  blue: 'text-sky-400',
  purple: 'text-purple-400',
  orange: 'text-orange-500',
  // Rainbow gets a violet base tint; the per-shape draw routine paints
  // the joker accents directly so it reads as multicolor regardless.
  rainbow: 'text-violet-400',
  'off-white': 'text-stone-100',
};

const MAGE_COLOR_LABEL: Record<MageColor, string> = {
  red: 'Sorcery (red)',
  grey: 'Mysticism (grey)',
  green: 'Natural Magick (green)',
  blue: 'Divinity (blue)',
  purple: 'Planar Studies (purple)',
  orange: 'Technomancy (orange)',
  rainbow: "Archmage's Apprentice (joker)",
  'off-white': 'Neutral (off-white)',
};

export function MageIcon({
  color,
  className,
  size = 14,
  detailed,
  golem,
}: IconProps & {
  color: MageColor;
  /** Force-show hat decoration + robe accent. Auto-enabled when size >= 24. */
  detailed?: boolean;
  /** Render a conjured Golem Lab temporary Mage — a rocky body with glowing
   *  eyes — instead of the standard wizard silhouette. */
  golem?: boolean;
}) {
  const isDetailed = detailed ?? size >= 24;
  if (golem) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role="img"
        aria-label="Golem (temporary)"
        className={clsx('inline-block flex-shrink-0 text-stone-400', className)}
        fill="currentColor"
      >
        <title>Golem (temporary)</title>
        {/* Hulking rocky body — broad, boulder-like shoulders. */}
        <path d="M 6 30 L 6 19 Q 6 16 9 15.5 L 11 13 L 21 13 L 23 15.5 Q 26 16 26 19 L 26 30 Z" />
        {/* Blocky stone head. */}
        <rect x="10.5" y="5" width="11" height="9.5" rx="1.4" />
        {/* Soft glow behind the eyes. */}
        <circle cx="14" cy="9.8" r="2.3" fill="#fbbf24" opacity="0.3" />
        <circle cx="18" cy="9.8" r="2.3" fill="#fbbf24" opacity="0.3" />
        {/* Glowing eyes. */}
        <circle cx="14" cy="9.8" r="1.3" fill="#fde68a" />
        <circle cx="18" cy="9.8" r="1.3" fill="#fde68a" />
        {/* Cracks across the body. */}
        <path
          d="M 13 18 L 15 21 L 13 24"
          stroke="#44403c"
          strokeOpacity="0.8"
          strokeWidth="0.8"
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d="M 20 17 L 18.5 20.5 L 20.5 23.5"
          stroke="#44403c"
          strokeOpacity="0.8"
          strokeWidth="0.8"
          fill="none"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={MAGE_COLOR_LABEL[color]}
      className={clsx('inline-block flex-shrink-0', MAGE_COLOR_CLASS[color], className)}
      fill="currentColor"
    >
      <title>{MAGE_COLOR_LABEL[color]}</title>
      {/* Body silhouette - same shape for every department. */}
      <circle cx="16" cy="13" r="3.5" />
      <path d="M 6 30 L 8 18 Q 10 16 16 16 Q 22 16 24 18 L 26 30 Z" />
      {/* Hat - unique per department. Rendered at every size. */}
      {hatShape(color)}
      {/* Decorations only render once we have the pixels for them. */}
      {isDetailed && hatDecoration(color)}
      {isDetailed && robeAccent(color)}
    </svg>
  );
}

/**
 * Each color gets a distinct silhouette so departments are recognizable
 * even at 12 px (where decorations would be lost).
 */
function hatShape(color: MageColor) {
  switch (color) {
    case 'red':
      // Sorcery: classic pointed wizard's hat.
      return (
        <>
          <ellipse cx="16" cy="10" rx="6.5" ry="0.9" />
          <path d="M 10 10 L 16 2 L 22 10 Z" />
        </>
      );
    case 'grey':
      // Mysticism: tall hat slouching to one side.
      return (
        <>
          <ellipse cx="16" cy="10" rx="6.5" ry="0.9" />
          <path d="M 10 10 L 13 3 Q 15 1.5 18 3 L 22 10 Z" />
        </>
      );
    case 'green':
      // Natural Magick: wide-brimmed low dome (druid hat).
      return (
        <>
          <ellipse cx="16" cy="10" rx="8" ry="1" />
          <path d="M 11 10 Q 11 5 16 5 Q 21 5 21 10 Z" />
        </>
      );
    case 'blue':
      // Divinity: bishop's mitre - two peaks with a notch.
      return (
        <>
          <ellipse cx="16" cy="10" rx="6" ry="0.9" />
          <path d="M 10 10 L 13 3 L 16 7 L 19 3 L 22 10 Z" />
        </>
      );
    case 'purple':
      // Planar Studies: tallest, narrowest cone.
      return (
        <>
          <ellipse cx="16" cy="10" rx="5.5" ry="0.8" />
          <path d="M 11 10 L 16 1 L 21 10 Z" />
        </>
      );
    case 'orange':
      // Technomancy: angular trapezoidal "hardhat" silhouette — a
      // squared-off shape evoking machinery / fabrication.
      return (
        <>
          <ellipse cx="16" cy="10" rx="7" ry="0.9" />
          <path d="M 11 10 L 12 4 L 20 4 L 21 10 Z" />
        </>
      );
    case 'rainbow':
      // Archmage's Apprentice — three-pointed jester's hat. The points
      // are drawn in the base colour; the per-point bell accents are
      // painted by `hatDecoration`.
      return (
        <>
          <ellipse cx="16" cy="10" rx="7" ry="0.9" />
          <path d="M 10 10 L 11 4 L 14 9 L 16 3 L 18 9 L 21 4 L 22 10 Z" />
        </>
      );
    case 'off-white':
      // Neutral: humble apprentice's skullcap.
      return <path d="M 12 10 Q 12 6 16 6 Q 20 6 20 10 Z" />;
  }
}

/**
 * Decorative element on the hat. Hardcoded accent colors so the symbol
 * stands out from the robe color.
 */
function hatDecoration(color: MageColor) {
  switch (color) {
    case 'red':
      // Flame embedded in the cone tip.
      return (
        <path
          d="M 14 5 Q 16 7 18 5 Q 17 8.5 16 7.5 Q 15 8.5 14 5 Z"
          fill="#fb923c"
          opacity="0.95"
        />
      );
    case 'grey':
      // Crescent moon: full disk with a chunk eaten in the hat color, plus a star.
      return (
        <>
          <circle cx="17" cy="6" r="1.2" fill="#fef3c7" />
          <circle cx="17.7" cy="5.5" r="0.85" fill="currentColor" />
          <circle cx="14" cy="7" r="0.35" fill="#fef3c7" />
        </>
      );
    case 'green':
      // Leaf pinned to the brim.
      return (
        <path
          d="M 21 7 Q 23.5 5.5 24.2 8 Q 22.5 9.2 21 7 Z"
          fill="#86efac"
          opacity="0.95"
        />
      );
    case 'blue':
      // Small cross sitting in the central V of the mitre.
      return (
        <>
          <rect x="15.5" y="5" width="1" height="3" fill="#fde047" />
          <rect x="14.5" y="5.7" width="3" height="0.9" fill="#fde047" />
        </>
      );
    case 'purple':
      // Spiral / portal mark.
      return (
        <>
          <circle
            cx="16"
            cy="5"
            r="1.4"
            fill="none"
            stroke="#e9d5ff"
            strokeWidth="0.5"
          />
          <circle cx="16" cy="5" r="0.55" fill="#e9d5ff" />
        </>
      );
    case 'orange':
      // Technomancy: a cog / gear sitting between the bands.
      return (
        <>
          <rect x="14" y="5.5" width="4" height="1" fill="#fde68a" />
          <rect x="14" y="7.5" width="4" height="1" fill="#fde68a" />
          <circle cx="16" cy="6.5" r="0.4" fill="currentColor" />
        </>
      );
    case 'rainbow':
      // Joker bells on each of the jester hat's three points — each
      // point gets a distinct colour so the multi-coloured silhouette
      // pops even at small sizes.
      return (
        <>
          <circle cx="11" cy="4" r="0.85" fill="#fb7185" />
          <circle cx="16" cy="3" r="0.85" fill="#fde047" />
          <circle cx="21" cy="4" r="0.85" fill="#60a5fa" />
        </>
      );
    case 'off-white':
      // Small button on the cap.
      return (
        <circle
          cx="16"
          cy="6"
          r="0.55"
          fill="currentColor"
          stroke="#fde68a"
          strokeOpacity="0.6"
          strokeWidth="0.35"
        />
      );
  }
}

/**
 * Department symbol on the chest.
 */
function robeAccent(color: MageColor) {
  switch (color) {
    case 'red':
      // Flame.
      return (
        <path
          d="M 16 22 Q 13.5 24.5 14.5 27 Q 15.5 26 16 27 Q 16.5 26 17.5 27 Q 18.5 24.5 16 22 Z"
          fill="#fb923c"
          opacity="0.85"
        />
      );
    case 'grey':
      // Crescent moon.
      return (
        <>
          <circle cx="16" cy="24.5" r="1.7" fill="#fef3c7" opacity="0.9" />
          <circle cx="16.6" cy="24" r="1.3" fill="currentColor" />
        </>
      );
    case 'green':
      // Leaf with a stem line.
      return (
        <>
          <path
            d="M 13 24.5 Q 16 21.5 19 24.5 Q 16 27.5 13 24.5 Z"
            fill="#86efac"
            opacity="0.9"
          />
          <path
            d="M 13.5 25 Q 16 25 18.5 25"
            stroke="#065f46"
            strokeOpacity="0.5"
            strokeWidth="0.4"
            fill="none"
          />
        </>
      );
    case 'blue':
      // Sun with rays.
      return (
        <>
          <circle cx="16" cy="24.5" r="1.5" fill="#fde047" opacity="0.95" />
          <path
            d="M 16 21.8 V 22.7 M 16 26.3 V 27.2 M 13.3 24.5 H 14.2 M 17.8 24.5 H 18.7 M 14.1 22.6 L 14.7 23.2 M 17.3 25.8 L 17.9 26.4 M 14.1 26.4 L 14.7 25.8 M 17.3 23.2 L 17.9 22.6"
            stroke="#fde047"
            strokeOpacity="0.85"
            strokeWidth="0.55"
            strokeLinecap="round"
          />
        </>
      );
    case 'purple':
      // Spiral / portal swirl.
      return (
        <path
          d="M 14.5 24.5 Q 14.5 22.5 16.5 22.5 Q 18 22.5 18 24 Q 18 25.4 16.5 25.4 Q 15.4 25.4 15.4 24.5 Q 15.4 23.6 16.4 23.6"
          fill="none"
          stroke="#e9d5ff"
          strokeOpacity="0.95"
          strokeWidth="0.7"
          strokeLinecap="round"
        />
      );
    case 'orange':
      // Technomancy: a cog wheel chest emblem (toothed circle).
      return (
        <>
          <circle
            cx="16"
            cy="24.5"
            r="1.7"
            fill="none"
            stroke="#fde68a"
            strokeOpacity="0.95"
            strokeWidth="0.6"
          />
          <path
            d="M 16 22.4 V 23.1 M 16 25.9 V 26.6 M 13.9 24.5 H 14.6 M 17.4 24.5 H 18.1 M 14.4 22.9 L 14.85 23.35 M 17.15 25.65 L 17.6 26.1 M 14.4 26.1 L 14.85 25.65 M 17.15 23.35 L 17.6 22.9"
            stroke="#fde68a"
            strokeOpacity="0.85"
            strokeWidth="0.5"
            strokeLinecap="round"
          />
        </>
      );
    case 'rainbow':
      // Diamond harlequin pattern across the chest — small alternating
      // colours so the apprentice reads as a "joker" mage.
      return (
        <>
          <path d="M 13 23 l 1.5 1.5 l -1.5 1.5 l -1.5 -1.5 Z" fill="#fb7185" />
          <path d="M 16 22 l 1.5 1.5 l -1.5 1.5 l -1.5 -1.5 Z" fill="#fde047" />
          <path d="M 19 23 l 1.5 1.5 l -1.5 1.5 l -1.5 -1.5 Z" fill="#34d399" />
          <path d="M 14.5 25.5 l 1.5 1.5 l -1.5 1.5 l -1.5 -1.5 Z" fill="#60a5fa" />
          <path d="M 17.5 25.5 l 1.5 1.5 l -1.5 1.5 l -1.5 -1.5 Z" fill="#a78bfa" />
        </>
      );
    case 'off-white':
      // Plain robe with a sash.
      return (
        <path
          d="M 11 22 L 21 22"
          stroke="#fde68a"
          strokeOpacity="0.6"
          strokeWidth="0.6"
        />
      );
  }
}

// ============================================================================
// Bell icon — used by the Bell Tower panel
// ============================================================================

/**
 * Lock icon — rendered on a room header when the room is in `state.roomLocks`.
 * Mages already inside still complete their Errands at Resolution; placement
 * is blocked while the lock is in effect.
 */
export function LockIcon({
  className,
  size = 14,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Locked"
      className={clsx('inline-block flex-shrink-0 text-rose-400', className)}
      fill="currentColor"
    >
      <title>Room locked</title>
      {/* Lock body */}
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      {/* Shackle */}
      <path
        d="M8 11 V7 a4 4 0 0 1 8 0 V11"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      {/* Keyhole */}
      <circle cx="12" cy="15" r="1.5" fill="rgba(0,0,0,0.45)" />
    </svg>
  );
}

/**
 * Shield icon — rendered next to a player's name when one or more
 * immunity buffs (Sanctification / Stoneskin / Spell Shield / Wall etc.)
 * are active. Hovering shows the buff tooltip the caller passes as
 * `title`/aria-label.
 */
export function ShieldIcon({
  className,
  size = 14,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Active immunity buff"
      className={clsx('inline-block flex-shrink-0 text-emerald-300', className)}
      fill="currentColor"
    >
      <title>Active buff</title>
      {/* Heater-style shield outline. */}
      <path d="M12 2 L20 5 V12 C20 17 16 21 12 22 C8 21 4 17 4 12 V5 Z" />
      {/* Inner highlight. */}
      <path
        d="M12 5 L17 7 V12 C17 16 14 19 12 19.5 C10 19 7 16 7 12 V7 Z"
        fill="rgba(255,255,255,0.18)"
      />
    </svg>
  );
}

export function BellIcon({
  className,
  size = 14,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Bell Tower"
      className={clsx('inline-block flex-shrink-0 text-amber-300', className)}
      fill="currentColor"
    >
      <title>Bell Tower</title>
      {/* Bell body: dome curving down to a flared lip. */}
      <path d="M12 3 C7 3 5 7 5 12 V16 H19 V12 C19 7 17 3 12 3 Z" />
      {/* Small handle on top. */}
      <circle cx="12" cy="3" r="1.3" />
      {/* Clapper hanging below the lip. */}
      <circle cx="12" cy="19" r="1.6" />
      {/* Lip accent. */}
      <path
        d="M5 16 H19"
        stroke="white"
        strokeOpacity="0.35"
        strokeWidth="0.8"
        fill="none"
      />
    </svg>
  );
}

// ============================================================================
// Room icons — a flat SVG glyph per university chamber, replacing the emoji
// glyphs the Campus map / room sheet used to draw (which clashed with the
// night/starlight theme). Each paints in `currentColor` (so the host sets the
// hue) with dark "cutout" + white accent details, matching the resource icons.
// ============================================================================

export type RoomIconKind =
  | 'infirmary'
  | 'catacombs'
  | 'vault'
  | 'archive'
  | 'library'
  | 'astronomy'
  | 'adventuring'
  | 'chapel'
  | 'council'
  | 'great-hall'
  | 'golem'
  | 'lab'
  | 'tavern'
  | 'workshop'
  | 'training'
  | 'dormitory'
  | 'guild'
  | 'stores'
  | 'staff'
  | 'courtyard'
  | 'castle';

/** Classify a room by keywords in its name (room data carries no glyph). Order
 *  matters — earlier, more-specific rules win. */
const ROOM_ICON_RULES: [RegExp, RoomIconKind][] = [
  [/infirmary|ward/i, 'infirmary'],
  [/catacomb|crypt|tomb|ossuary/i, 'catacombs'],
  [/vault/i, 'vault'],
  [/research|archive/i, 'archive'],
  [/library/i, 'library'],
  [/astronomy|observ/i, 'astronomy'],
  [/adventur/i, 'adventuring'],
  [/chapel|cathedral|shrine|temple/i, 'chapel'],
  [/council|chamber|senate/i, 'council'],
  [/great hall|dining/i, 'great-hall'],
  [/golem/i, 'golem'],
  [/labor|laboratory|lab\b/i, 'lab'],
  [/tavern|inn|pub/i, 'tavern'],
  [/atelier|workshop|synthesis|forge|smith/i, 'workshop'],
  [/archmage|staff|sanctum|study/i, 'staff'],
  // Courtyard before training so "court-YARD" doesn't match the yard rule.
  [/courtyard|garden|grove|nature|park/i, 'courtyard'],
  [/training|field|yard|arena/i, 'training'],
  [/dorm|dormitory|residence|barrack/i, 'dormitory'],
  [/guild|bazaar/i, 'guild'],
  [/store|market|shop|stall/i, 'stores'],
  [/tower/i, 'astronomy'],
  [/hall/i, 'great-hall'],
];

export function roomIconKind(name: string): RoomIconKind {
  for (const [re, kind] of ROOM_ICON_RULES) if (re.test(name)) return kind;
  return 'castle';
}

const HOLE = { fill: '#0b1020', fillOpacity: 0.5 } as const;
const ACCENT = { fill: '#ffffff', fillOpacity: 0.6 } as const;

function roomIconBody(kind: RoomIconKind) {
  switch (kind) {
    case 'infirmary':
      // Ward: a card with a medical cross.
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M10.7 7 h2.6 v3.4 h3.4 v2.6 h-3.4 v3.4 h-2.6 v-3.4 H7.3 v-2.6 H10.7 Z" {...ACCENT} />
        </>
      );
    case 'catacombs':
      // Skull over crossed bones — the crypt.
      return (
        <>
          <circle cx="12" cy="10" r="7" />
          <rect x="8" y="15" width="8" height="4.5" rx="1.5" />
          <circle cx="9.4" cy="10" r="1.8" {...HOLE} />
          <circle cx="14.6" cy="10" r="1.8" {...HOLE} />
          <path d="M11.2 13 h1.6 v2.6 h-1.6 Z" {...HOLE} />
        </>
      );
    case 'vault':
      // A strongbox / safe with a combination dial.
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <rect x="6" y="8" width="12" height="8" rx="1" {...HOLE} />
          <circle cx="12" cy="12" r="2.6" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.3" />
          <path d="M12 9.8 V12" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.3" />
        </>
      );
    case 'archive':
      // Rolled scroll with ruled lines.
      return (
        <>
          <path d="M8 4 h8 a2 2 0 0 1 2 2 v12 a2 2 0 0 1 -2 2 h-8 Z" />
          <rect x="4" y="4" width="4.5" height="16" rx="2.25" {...HOLE} />
          <path d="M10 9 H16 M10 12 H16 M10 15 H14" stroke="#fff" strokeOpacity="0.6" strokeWidth="1" fill="none" />
        </>
      );
    case 'library':
      // Three book spines with band lines.
      return (
        <>
          <rect x="4" y="5" width="4" height="14" rx="0.8" />
          <rect x="9.5" y="5" width="4" height="14" rx="0.8" />
          <rect x="15" y="6.5" width="4" height="12.5" rx="0.8" transform="rotate(9 17 13)" />
          <path d="M4.6 8 H7.4 M10.1 8 H12.9 M15.6 9.3 H18" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.9" fill="none" />
        </>
      );
    case 'astronomy':
      // Telescope on a tripod.
      return (
        <>
          <g transform="rotate(-35 12 12)">
            <rect x="3.5" y="9.6" width="13" height="4.6" rx="1.4" />
            <rect x="15.5" y="8.8" width="3" height="6.2" rx="1.2" {...ACCENT} />
          </g>
          <path d="M9 17 L6.5 22 M12.5 15.5 L16 22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </>
      );
    case 'adventuring':
      // Compass.
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 5.5 L14 12 L12 18.5 L10 12 Z" {...ACCENT} />
          <circle cx="12" cy="12" r="1.3" {...HOLE} />
        </>
      );
    case 'chapel':
      // Peaked-roof chapel with a cross.
      return (
        <>
          <path d="M6 21 V10 L12 4.5 L18 10 V21 Z" />
          <rect x="10.4" y="14" width="3.2" height="7" rx="1.4" {...HOLE} />
          <path d="M12 5.4 V8.4 M10.5 6.9 H13.5" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.2" />
        </>
      );
    case 'council':
      // Balance scales.
      return (
        <>
          <rect x="11" y="5" width="2" height="14" rx="0.6" />
          <rect x="6" y="18.5" width="12" height="2.2" rx="1" />
          <path d="M4.5 7 H19.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="6" r="1.4" />
          <path d="M4.5 7 L2.5 12 H6.5 Z" />
          <path d="M19.5 7 L17.5 12 H21.5 Z" />
        </>
      );
    case 'great-hall':
      // Classical facade: pediment over columns.
      return (
        <>
          <path d="M3 9.5 L12 4 L21 9.5 Z" />
          <rect x="4" y="9.5" width="16" height="2" />
          <rect x="5" y="12" width="2.2" height="7" />
          <rect x="9" y="12" width="2.2" height="7" />
          <rect x="12.8" y="12" width="2.2" height="7" />
          <rect x="16.8" y="12" width="2.2" height="7" />
          <rect x="3" y="19" width="18" height="2" />
        </>
      );
    case 'golem':
      // Blocky stone construct with glowing eyes.
      return (
        <>
          <rect x="6" y="4.5" width="12" height="11" rx="2" />
          <rect x="8" y="15.5" width="8" height="4.5" rx="1.2" />
          <circle cx="9.6" cy="10" r="1.6" fill="#fde68a" />
          <circle cx="14.4" cy="10" r="1.6" fill="#fde68a" />
        </>
      );
    case 'lab':
      // Bubbling flask.
      return (
        <>
          <path d="M9 3 H15 V8 L19 18 Q20 21 17 21 H7 Q4 21 5 18 L9 8 Z" />
          <path d="M8 3 H16" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" fill="none" />
          <circle cx="11" cy="16" r="1" {...ACCENT} />
          <circle cx="14" cy="18" r="0.8" {...ACCENT} />
        </>
      );
    case 'tavern':
      // Foaming mug.
      return (
        <>
          <path d="M5 7 H16 V18 a2 2 0 0 1 -2 2 H7 a2 2 0 0 1 -2 -2 Z" />
          <path d="M16 9 H19 a2 2 0 0 1 2 2 v2 a2 2 0 0 1 -2 2 H16" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <rect x="5" y="7" width="11" height="3" {...ACCENT} />
        </>
      );
    case 'workshop':
      // Cog (overlapping squares → 8 teeth) with a bored centre.
      return (
        <>
          <rect x="5" y="5" width="14" height="14" rx="2.5" />
          <rect x="5" y="5" width="14" height="14" rx="2.5" transform="rotate(45 12 12)" />
          <circle cx="12" cy="12" r="3.4" {...HOLE} />
        </>
      );
    case 'training':
      // Crossed swords.
      return (
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <path d="M5 19 L16 8" strokeWidth="2.2" />
          <path d="M19 19 L8 8" strokeWidth="2.2" />
          <path d="M14.5 5.5 L18.5 9.5" strokeWidth="1.4" />
          <path d="M5.5 9.5 L9.5 5.5" strokeWidth="1.4" />
          <path d="M5 19 L7 17 M19 19 L17 17" strokeWidth="2.2" />
        </g>
      );
    case 'dormitory':
      // Bed with a pillow.
      return (
        <>
          <rect x="2" y="13.5" width="20" height="4.5" rx="1" />
          <rect x="2" y="10.5" width="3.2" height="7.5" rx="1" />
          <rect x="6.5" y="11.5" width="6" height="3" rx="1.5" {...ACCENT} />
        </>
      );
    case 'guild':
      // Pennant banner on a pole.
      return (
        <>
          <rect x="5" y="3" width="1.8" height="18" rx="0.6" />
          <path d="M6.8 4 H19 L16 8 L19 12 H6.8 Z" />
        </>
      );
    case 'stores':
      // Shopfront with a striped awning.
      return (
        <>
          <path d="M3.5 8 L4.6 4 H19.4 L20.5 8 Z" />
          <rect x="4.5" y="8" width="15" height="12" rx="1" />
          <rect x="9" y="12" width="6" height="8" rx="0.8" {...HOLE} />
          <path d="M8.2 4 L7.6 8 M12 4 L12 8 M15.8 4 L16.4 8" stroke="#0b1020" strokeOpacity="0.45" strokeWidth="1.1" />
        </>
      );
    case 'staff':
      // Wand with a spark.
      return (
        <>
          <path d="M5 20 L15.5 9.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M18 4 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1 Z" {...ACCENT} />
        </>
      );
    case 'courtyard':
      // A single tree — the open green.
      return (
        <>
          <circle cx="12" cy="9" r="6" />
          <rect x="11" y="13.5" width="2" height="6.5" rx="0.8" />
          <path d="M9.5 8 a2.5 2.5 0 0 1 5 0" fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.9" />
        </>
      );
    case 'castle':
    default:
      // Crenellated keep — the generic fallback.
      return (
        <>
          <path d="M4 21 V8 H6 V5 H8.5 V8 H11 V5 H13 V8 H15.5 V5 H18 V8 H20 V21 Z" />
          <rect x="10" y="14" width="4" height="7" rx="0.4" {...HOLE} />
        </>
      );
  }
}

export function RoomIcon({
  name,
  className,
  size = 18,
}: IconProps & { name: string }) {
  const kind = roomIconKind(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={name}
      className={clsx('inline-block flex-shrink-0', className)}
      fill="currentColor"
    >
      <title>{name}</title>
      {roomIconBody(kind)}
    </svg>
  );
}
