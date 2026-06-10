import clsx from 'clsx';
import type { MageColor } from '../../game/types';

/**
 * Tier-0 student token (docs/UI_DESIGN.md §6): flat SVG chibi — head + robe
 * silhouette per mage-color archetype, player-color aura ring at the feet,
 * status dressing layered on top (never replacing the token).
 */

const ROBE: Record<MageColor, string> = {
  red: '#ff5d5d',
  grey: '#9aa0b4',
  green: '#5fd068',
  purple: '#b16cea',
  blue: '#5aa9e6',
  orange: '#ff9f43',
  'off-white': '#e8e4da',
  rainbow: '#d9b3ff', // base; gradient hair carries the rainbow read
};

const SKIN = '#ffe8d6';

/** Archetype hair/prop overlay, keyed by mage color (distinct silhouettes). */
function ArchetypeOverlay({ color }: { color: MageColor }) {
  switch (color) {
    case 'red': // battle-mage: spiky twin-tails up like flames
      return (
        <g fill="#e03e3e">
          <path d="M20 16 C14 8 16 2 19 1 C19 7 23 10 25 13 Z" />
          <path d="M44 16 C50 8 48 2 45 1 C45 7 41 10 39 13 Z" />
          <path d="M21 13 C24 7 40 7 43 13 C40 10 24 10 21 13 Z" />
        </g>
      );
    case 'grey': // prefect: asymmetric hood
      return (
        <g fill="#6e7488">
          <path d="M18 22 C16 8 30 4 36 6 C48 9 48 20 46 24 C44 14 38 10 32 10 C26 10 20 14 18 22 Z" />
          <path d="M36 6 C40 2 46 2 49 6 C45 6 42 8 41 11 Z" />
        </g>
      );
    case 'green': // druid: leaf cowlick + satchel
      return (
        <g>
          <path d="M32 9 C32 3 38 0 42 2 C40 6 36 8 33 10 Z" fill="#2f9e44" />
          <circle cx="45" cy="52" r="6" fill="#a07840" />
          <rect x="43.5" y="44" width="3" height="9" rx="1.5" fill="#a07840" />
        </g>
      );
    case 'purple': // diviner: enormous hat brim over the eyes
      return (
        <g fill="#8a4ec0">
          <ellipse cx="32" cy="15" rx="19" ry="5.5" />
          <path d="M22 14 C23 5 41 5 42 14 C37 11 27 11 22 14 Z" />
          <path d="M40 7 C44 4 48 6 47 10 Z" fill="#ffd93d" />
        </g>
      );
    case 'blue': // star-scholar: orbiting grimoire
      return (
        <g>
          <path d="M20 14 C22 7 42 7 44 14 C38 10 26 10 20 14 Z" fill="#3a76c2" />
          <g transform="rotate(-12 52 30)">
            <rect x="47" y="26" width="11" height="8" rx="1.5" fill="#2b5d9e" />
            <rect x="48.2" y="27.2" width="8.6" height="5.6" rx="1" fill="#cfe6ff" />
          </g>
        </g>
      );
    case 'orange': // tinkerer: goggle band + backpack
      return (
        <g>
          <rect x="19" y="14" width="26" height="5" rx="2.5" fill="#7a4f1d" />
          <circle cx="27" cy="16.5" r="3.4" fill="#ffd9a8" stroke="#7a4f1d" />
          <circle cx="37" cy="16.5" r="3.4" fill="#ffd9a8" stroke="#7a4f1d" />
          <rect x="44" y="38" width="9" height="14" rx="3" fill="#b8742a" />
        </g>
      );
    case 'rainbow': // prodigy: gradient hair swirl
      return (
        <g>
          <defs>
            <linearGradient id="rainbow-hair" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff6b6b" />
              <stop offset="25%" stopColor="#ffd93d" />
              <stop offset="50%" stopColor="#6bcb77" />
              <stop offset="75%" stopColor="#4d96ff" />
              <stop offset="100%" stopColor="#b388eb" />
            </linearGradient>
          </defs>
          <path
            d="M18 18 C16 6 30 2 38 5 C46 8 48 16 46 20 C42 12 36 14 32 17 C28 20 22 20 18 18 Z"
            fill="url(#rainbow-hair)"
          />
        </g>
      );
    case 'off-white': // first-year: plain short hair
    default:
      return (
        <path d="M20 15 C21 8 43 8 44 15 C38 11 26 11 20 15 Z" fill="#cdc6b8" />
      );
  }
}

export interface MageTokenProps {
  color: MageColor;
  /** Owner aura hex (player identity ring). Omit for unowned/supply mages. */
  aura?: string;
  isWounded?: boolean;
  isShadowing?: boolean;
  /** Pixel height of the token (width scales to 4:5). */
  size?: number;
  className?: string;
}

export function MageToken({
  color,
  aura,
  isWounded = false,
  isShadowing = false,
  size = 44,
  className,
}: MageTokenProps) {
  const robe = ROBE[color];
  return (
    <svg
      viewBox="0 0 64 80"
      width={(size * 64) / 80}
      height={size}
      className={clsx(
        'overflow-visible select-none',
        isShadowing && 'opacity-55',
        className,
      )}
      style={
        isShadowing
          ? { filter: 'drop-shadow(0 0 5px #7ee8fa)' }
          : undefined
      }
      aria-label={`${color} mage`}
    >
      <g style={isWounded ? { filter: 'grayscale(.55) brightness(.9)' } : undefined}>
        {/* player aura ring at the feet */}
        {aura && (
          <ellipse cx="32" cy="72" rx="20" ry="6" fill={aura} opacity="0.85" />
        )}
        {aura && (
          <ellipse cx="32" cy="72" rx="13" ry="3.6" fill="#171430" opacity="0.45" />
        )}
        {/* robe */}
        <path
          d="M32 28 C19 33 14 50 16 68 L48 68 C50 50 45 33 32 28 Z"
          fill={robe}
          stroke="#00000022"
          strokeWidth="1"
        />
        {/* sash */}
        <path d="M19 50 C26 54 38 54 45 50 L45 55 C38 59 26 59 19 55 Z" fill="#00000018" />
        {/* head */}
        <circle cx="32" cy="20" r="13" fill={SKIN} stroke="#00000018" strokeWidth="1" />
        {/* eyes */}
        <circle cx="27" cy="22" r="1.8" fill="#2b2438" />
        <circle cx="37" cy="22" r="1.8" fill="#2b2438" />
        <ArchetypeOverlay color={color} />
      </g>
      {/* wounded badge */}
      {isWounded && (
        <g transform="translate(44 4)">
          <circle r="7" cx="7" cy="7" fill="#fdf8ec" stroke="#ff5d7d" strokeWidth="1.5" />
          <rect x="5.6" y="2.8" width="2.8" height="8.4" rx="1.2" fill="#ff5d7d" />
          <rect x="2.8" y="5.6" width="8.4" height="2.8" rx="1.2" fill="#ff5d7d" />
        </g>
      )}
    </svg>
  );
}
