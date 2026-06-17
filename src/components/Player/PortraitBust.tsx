import type { Candidate, Department, GameState, Player } from '../../game/types';
import { lookupCandidate } from '../../game/effects/helpers';
import { DEPT_HUE, PLAYER_AURA } from '../../utils/uiSelectors';

/**
 * Tier-1 portrait busts (docs/UI_DESIGN.md §6, hybrid model): a procedural
 * anime-style bust generated deterministically from the player's candidate
 * (hair style/color, skin tone, accessory), framed in the player's aura,
 * with an expression chosen by context (§13.5 — worried under attack,
 * determined on their turn, smug when crowned).
 *
 * To override with real art: drop an image (square, ~256px) into
 * `public/art/portraits/` and add `'<candidateId>': '/art/portraits/<f>.webp'`
 * to PORTRAIT_ART below. The procedural bust remains the fallback.
 */

export type Expression = 'neutral' | 'determined' | 'smug' | 'worried';

const PORTRAIT_ART: Record<string, string> = {
  // 'base.candidate.larimore-burman': '/art/portraits/larimore.webp',
};

/* ----------------------------- deterministic looks ---------------------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const HAIR_COLORS = ['#4a4063', '#8a5a3b', '#cfd4e8', '#e88aa8', '#3f8f8a', '#e8c46a'];
const SKIN_TONES = ['#ffe8d6', '#f2cba8', '#c98e6a'];

/* ------------------------------- face parts ------------------------------ */

function Eyes({ ex }: { ex: Expression }) {
  switch (ex) {
    case 'determined':
      return (
        <g fill="#2b2438">
          <path d="M30 50 a6 5 0 0 1 12 0 v2 h-12 Z" />
          <path d="M54 50 a6 5 0 0 1 12 0 v2 h-12 Z" />
          <circle cx="36" cy="50" r="2" fill="#fff" opacity=".9" />
          <circle cx="60" cy="50" r="2" fill="#fff" opacity=".9" />
        </g>
      );
    case 'smug':
      return (
        <g fill="#2b2438">
          <path d="M30 50 h12 a6 4 0 0 1 -12 0 Z" />
          <path d="M54 50 h12 a6 4 0 0 1 -12 0 Z" />
        </g>
      );
    case 'worried':
      return (
        <g>
          <circle cx="36" cy="50" r="6.5" fill="#fff" stroke="#2b2438" strokeWidth="1.5" />
          <circle cx="60" cy="50" r="6.5" fill="#fff" stroke="#2b2438" strokeWidth="1.5" />
          <circle cx="36" cy="51" r="2.2" fill="#2b2438" />
          <circle cx="60" cy="51" r="2.2" fill="#2b2438" />
        </g>
      );
    default:
      return (
        <g fill="#2b2438">
          <circle cx="36" cy="50" r="4.5" />
          <circle cx="60" cy="50" r="4.5" />
          <circle cx="38" cy="48" r="1.6" fill="#fff" />
          <circle cx="62" cy="48" r="1.6" fill="#fff" />
        </g>
      );
  }
}

function Brows({ ex }: { ex: Expression }) {
  const stroke = { stroke: '#2b2438', strokeWidth: 2.4, strokeLinecap: 'round' as const, fill: 'none' };
  switch (ex) {
    case 'determined':
      return (
        <g {...stroke}>
          <path d="M29 42 l13 3" />
          <path d="M67 42 l-13 3" />
        </g>
      );
    case 'smug':
      return (
        <g {...stroke}>
          <path d="M29 41 q6 -4 13 -1" />
          <path d="M54 44 q6 -2 12 -1" />
        </g>
      );
    case 'worried':
      return (
        <g {...stroke}>
          <path d="M29 44 q7 -4 13 -1" transform="rotate(8 35 42)" />
          <path d="M54 43 q7 -3 13 1" transform="rotate(-8 61 42)" />
        </g>
      );
    default:
      return (
        <g {...stroke}>
          <path d="M30 42 q6 -3 12 -1" />
          <path d="M54 41 q6 -2 12 1" />
        </g>
      );
  }
}

function Mouth({ ex }: { ex: Expression }) {
  switch (ex) {
    case 'determined':
      return <path d="M42 64 h12" stroke="#2b2438" strokeWidth="2.4" strokeLinecap="round" />;
    case 'smug':
      return <path d="M42 63 q8 5 13 -2" stroke="#2b2438" strokeWidth="2.4" fill="none" strokeLinecap="round" />;
    case 'worried':
      return <path d="M42 65 q4 -3 6 0 q3 3 6 0" stroke="#2b2438" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
    default:
      return <path d="M43 63 q5 4 10 0" stroke="#2b2438" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
  }
}

/** Hair styles, drawn around the head circle (cx 48, cy 48, r 22). */
function Hair({ variant, color }: { variant: number; color: string }) {
  switch (variant % 6) {
    case 0: // long flowing
      return (
        <g fill={color}>
          <path d="M22 50 C20 22 40 16 48 16 C56 16 76 22 74 50 C74 66 70 78 66 84 L62 60 C62 44 56 36 48 36 C40 36 34 44 34 60 L30 84 C26 78 22 66 22 50 Z" />
        </g>
      );
    case 1: // short spiky
      return (
        <g fill={color}>
          <path d="M26 46 C22 26 36 14 48 16 C60 14 74 26 70 46 L64 36 L58 42 L52 32 L46 42 L40 32 L34 44 Z" />
        </g>
      );
    case 2: // bob + hairpin
      return (
        <g>
          <path d="M24 52 C22 26 38 16 48 16 C58 16 74 26 72 52 C72 58 68 62 64 62 L64 42 C58 36 38 36 32 42 L32 62 C28 62 24 58 24 52 Z" fill={color} />
          <path d="M60 24 l8 4 -7 5 Z" fill="#ffd93d" />
        </g>
      );
    case 3: // high ponytail
      return (
        <g fill={color}>
          <path d="M26 48 C24 26 38 16 48 16 C58 16 72 26 70 48 L62 40 C56 34 40 34 34 40 Z" />
          <path d="M64 22 C76 18 82 30 76 46 C72 58 66 62 64 70 C62 60 66 50 68 42 C70 32 68 26 64 22 Z" />
        </g>
      );
    case 4: // hooded
      return (
        <g>
          <path d="M20 60 C16 26 36 12 48 12 C60 12 80 26 76 60 C74 70 70 76 66 80 L66 56 C66 40 58 32 48 32 C38 32 30 40 30 56 L30 80 C26 76 22 70 20 60 Z" fill="#4d4458" />
          <path d="M34 42 C38 36 58 36 62 42 L60 38 C54 33 42 33 36 38 Z" fill={color} />
        </g>
      );
    default: // curly
      return (
        <g fill={color}>
          <circle cx="32" cy="34" r="11" /><circle cx="48" cy="26" r="12" /><circle cx="64" cy="34" r="11" />
          <circle cx="26" cy="48" r="8" /><circle cx="70" cy="48" r="8" />
        </g>
      );
  }
}

function Accessory({ variant, hue }: { variant: number; hue: string }) {
  switch (variant % 4) {
    case 0: // round glasses
      return (
        <g fill="none" stroke="#3a3050" strokeWidth="2">
          <circle cx="36" cy="50" r="9" /><circle cx="60" cy="50" r="9" />
          <path d="M45 50 h6" />
        </g>
      );
    case 1: // star earring
      return <path d="M70 60 l2 4 4 1 -3 3 1 4 -4 -2 -4 2 1 -4 -3 -3 4 -1 Z" fill={hue} />;
    case 2: // forehead gem
      return <circle cx="48" cy="38" r="3" fill={hue} stroke="#fff" strokeWidth="1" />;
    default:
      return null;
  }
}

/* ------------------------------ the core bust ---------------------------- */

/**
 * The framed procedural bust (or real art), deterministic from `seed`. Shared
 * by `PortraitBust` (player, framed in player aura) and `CandidatePortrait`
 * (faction leader, framed in department hue) so both stay visually identical.
 */
function FramedBust({
  seed,
  robeHue,
  frameHue,
  expression,
  size,
  artUrl,
  title,
  alt,
  className,
}: {
  seed: number;
  robeHue: string;
  frameHue: string;
  expression: Expression;
  size: number;
  artUrl?: string | undefined;
  title?: string | undefined;
  alt: string;
  className?: string | undefined;
}) {
  const hairColor = HAIR_COLORS[seed % HAIR_COLORS.length]!;
  const skin = SKIN_TONES[(seed >> 4) % SKIN_TONES.length]!;

  return (
    <span
      className={className}
      title={title}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: size / 5,
        overflow: 'hidden',
        background: `radial-gradient(circle at 50% 30%, ${frameHue}33, #1f1b3f 75%)`,
        boxShadow: `0 0 0 2px ${frameHue}, 0 3px 8px #00000088`,
        flexShrink: 0,
      }}
    >
      {artUrl ? (
        <img src={artUrl} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <svg viewBox="0 0 96 96" width={size} height={size}>
          {/* shoulders / robe */}
          <path d="M14 96 C16 76 30 68 48 68 C66 68 80 76 82 96 Z" fill={robeHue} />
          <path d="M40 70 L48 84 L56 70 C53 68 43 68 40 70 Z" fill="#fdf8ec" />
          {/* neck + head */}
          <rect x="42" y="58" width="12" height="14" rx="5" fill={skin} />
          <circle cx="48" cy="48" r="22" fill={skin} />
          {/* blush */}
          <ellipse cx="30" cy="57" rx="4" ry="2.4" fill="#ff8fab" opacity=".5" />
          <ellipse cx="66" cy="57" rx="4" ry="2.4" fill="#ff8fab" opacity=".5" />
          <Eyes ex={expression} />
          <Brows ex={expression} />
          <Mouth ex={expression} />
          <Hair variant={seed >> 8} color={hairColor} />
          <Accessory variant={seed >> 12} hue={frameHue} />
          {/* worried sweat drop */}
          {expression === 'worried' && (
            <path d="M74 40 q-5 8 0 10 q5 -2 0 -10" fill="#7ee8fa" opacity=".9" />
          )}
        </svg>
      )}
    </span>
  );
}

/* ------------------------------ the components ---------------------------- */

export interface PortraitBustProps {
  player: Player;
  state: GameState;
  expression?: Expression;
  /** Pixel size (square). */
  size?: number;
  className?: string;
}

export function PortraitBust({
  player,
  state,
  expression = 'neutral',
  size = 56,
  className,
}: PortraitBustProps) {
  const aura = PLAYER_AURA[player.color];
  const candidate = player.candidateId ? lookupCandidate(state, player.candidateId) : null;
  const artUrl = player.candidateId ? PORTRAIT_ART[player.candidateId] : undefined;
  const seed = hash(player.candidateId || `${player.id}:${player.color}`);
  const robeHue = candidate ? (DEPT_HUE[candidate.department] ?? aura) : aura;

  return (
    <FramedBust
      seed={seed}
      robeHue={robeHue}
      frameHue={aura}
      expression={expression}
      size={size}
      artUrl={artUrl}
      title={candidate ? `${player.name} — ${candidate.name}, ${candidate.title}` : player.name}
      alt={player.name}
      className={className}
    />
  );
}

export interface CandidatePortraitProps {
  candidate: Pick<Candidate, 'id' | 'name' | 'title' | 'department'>;
  /** Pixel size (square). */
  size?: number;
  expression?: Expression;
  className?: string;
}

/**
 * Portrait for a faction leader that is NOT yet bound to a player (e.g. the
 * candidate-draft screen). Seeded on the candidate id so it matches the bust
 * that player will carry once they pick this leader, and framed in the
 * department hue. Real art still comes from `PORTRAIT_ART`.
 */
export function CandidatePortrait({
  candidate,
  size = 48,
  expression = 'neutral',
  className,
}: CandidatePortraitProps) {
  const hue = DEPT_HUE[candidate.department as Department] ?? '#9aa0b4';
  return (
    <FramedBust
      seed={hash(candidate.id)}
      robeHue={hue}
      frameHue={hue}
      expression={expression}
      size={size}
      artUrl={PORTRAIT_ART[candidate.id]}
      title={`${candidate.name} — ${candidate.title}`}
      alt={candidate.name}
      className={className}
    />
  );
}
