import clsx from 'clsx';
import type {
  Department,
  SpellCard,
  SupporterCard,
  VaultCard,
} from '../../game/types';
import { DEPT_HUE } from '../../utils/uiSelectors';
import { TIMING_HUE, TIMING_LABEL } from './HandFans';

/**
 * The shared card face for Spells, Vault items, and Supporters — a real card
 * shape rather than a label chip. Spells use a tarot ratio (11:19); Vault and
 * Supporters use the trading-card ratio (5:7). The face is fully fluid: the
 * caller sets the width (via `className`/`style`) and everything inside scales
 * off container-query units, so the exact same markup reads as a thumbnail in
 * the hand and as a full card in the zoom overlay. The big "art window" is a
 * deliberate placeholder — drop illustrations in there later and these become
 * the beautiful cards. Purely presentational; play/cast logic stays at the
 * call site (and in CardZoom's action bar).
 */

const RATIO = {
  spell: '11 / 19', // tarot — 2.75" × 4.75"
  item: '5 / 7', // trading card — 2.5" × 3.5"
} as const;

/** Placeholder art glyph until real illustrations land. */
const DEPT_GLYPH: Record<string, string> = {
  sorcery: '🔥',
  mysticism: '🌙',
  'natural-magick': '🌿',
  'planar-studies': '🌀',
  divinity: '✨',
  technomancy: '⚙️',
  students: '🎓',
  wild: '✦',
};

export type CardStatus = 'playable' | 'draftable' | 'exhausted' | null;

export type CardFace =
  | {
      kind: 'spell';
      name: string;
      department: Department;
      hue: string;
      levels: {
        level: number;
        title: string;
        cost: string;
        timing: string;
        description?: string | undefined;
      }[];
    }
  | {
      kind: 'vault' | 'supporter';
      name: string;
      hue: string;
      typeLabel: string;
      subtitle?: string | undefined;
      cost?: string | undefined;
      timing?: string | undefined;
      glyph: string;
      description?: string | undefined;
    };

export function spellFace(def: SpellCard): CardFace {
  return {
    kind: 'spell',
    name: def.name,
    department: def.department,
    hue: DEPT_HUE[def.department] ?? '#ffe9a8',
    levels: def.levels.map((l) => ({
      level: l.level,
      title: l.title ?? `Level ${l.level}`,
      cost: l.manaCost > 0 ? `${l.manaCost}✦` : 'free',
      timing: l.timing,
      description: l.description,
    })),
  };
}

export function vaultFace(def: VaultCard): CardFace {
  return {
    kind: 'vault',
    name: def.name,
    hue: '#ff9f43',
    typeLabel: def.type === 'treasure' ? 'Treasure' : 'Consumable',
    cost: def.goldCost > 0 ? `${def.goldCost}g` : undefined,
    timing: def.timing,
    glyph: def.type === 'treasure' ? '💎' : '🧪',
    description: def.description,
  };
}

export function supporterFace(def: SupporterCard): CardFace {
  return {
    kind: 'supporter',
    name: def.name,
    hue: DEPT_HUE[def.department] ?? '#e8e4da',
    typeLabel: 'Supporter',
    subtitle: def.title,
    timing: def.timing,
    glyph: DEPT_GLYPH[def.department] ?? '🎓',
    description: def.description,
  };
}

/** A faint heraldic watermark behind the art glyph (placeholder texture). */
function ArtWindow({ hue, glyph, className }: { hue: string; glyph: string; className?: string }) {
  return (
    <div
      className={clsx(
        'relative flex items-center justify-center overflow-hidden rounded-[0.28em] ring-1 ring-black/10',
        className,
      )}
      style={{
        background: `radial-gradient(120% 90% at 50% 18%, ${hue}33, ${hue}10 55%, #0b0f1e10)`,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, #000 0, #000 1px, transparent 1px, transparent 6px)',
        }}
      />
      <span className="select-none text-[2em] leading-none drop-shadow">{glyph}</span>
    </div>
  );
}

function TimingStamp({ timing }: { timing: string }) {
  return (
    <span
      className="font-bold uppercase tracking-wide"
      style={{ color: TIMING_HUE[timing] }}
    >
      {TIMING_LABEL[timing] ?? timing}
    </span>
  );
}

function SpellBody({ face }: { face: Extract<CardFace, { kind: 'spell' }> }) {
  return (
    <>
      <Banner hue={face.hue} name={face.name} sub={face.department.replace('-', ' ')} />
      <ArtWindow hue={face.hue} glyph={DEPT_GLYPH[face.department] ?? '✦'} className="h-[30%]" />
      <div className="flex min-h-0 flex-1 flex-col gap-[0.18em]">
        {face.levels.map((lvl) => (
          <div key={lvl.level} className="rounded-[0.22em] bg-white/65 px-[0.3em] py-[0.2em]">
            <div className="flex items-center gap-[0.28em]">
              <span
                className="flex h-[1.15em] w-[1.15em] shrink-0 items-center justify-center rounded-full font-arcane text-[0.62em] font-bold text-ink-900"
                style={{ background: face.hue }}
              >
                {lvl.level}
              </span>
              <span className="truncate text-[0.56em] font-bold text-ink-900">{lvl.title}</span>
              <span className="ml-auto shrink-0 text-[0.55em] font-bold text-black/65">
                {lvl.cost}
              </span>
            </div>
            <p className="mt-[0.12em] line-clamp-2 text-[0.5em] leading-snug text-black/70">
              <span className="mr-[0.4em] text-[0.92em]">
                <TimingStamp timing={lvl.timing} />
              </span>
              {lvl.description}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

function ItemBody({ face }: { face: Extract<CardFace, { kind: 'vault' | 'supporter' }> }) {
  return (
    <>
      <Banner hue={face.hue} name={face.name} sub={face.subtitle} cost={face.cost} />
      <ArtWindow hue={face.hue} glyph={face.glyph} className="h-[42%]" />
      <p className="mt-[0.1em] flex items-center gap-[0.4em] text-[0.5em] font-bold uppercase tracking-wide text-black/50">
        <span>{face.typeLabel}</span>
        {face.timing && (
          <span>
            · <TimingStamp timing={face.timing} />
          </span>
        )}
      </p>
      <p className="mt-[0.18em] line-clamp-5 flex-1 text-[0.54em] leading-snug text-black/75">
        {face.description}
      </p>
    </>
  );
}

function Banner({
  hue,
  name,
  sub,
  cost,
}: {
  hue: string;
  name: string;
  sub?: string | undefined;
  cost?: string | undefined;
}) {
  return (
    <div
      className="flex items-start gap-[0.3em] rounded-[0.28em] px-[0.4em] py-[0.3em] shadow-sm ring-1 ring-black/10"
      style={{ background: `linear-gradient(180deg, ${hue}, ${hue}cc)` }}
    >
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[0.62em] font-bold uppercase leading-tight tracking-wide text-ink-900">
          {name}
        </p>
        {sub && (
          <p className="truncate text-[0.46em] font-bold uppercase tracking-wider text-black/55">
            {sub}
          </p>
        )}
      </div>
      {cost && (
        <span className="shrink-0 rounded-full bg-ink-900/85 px-[0.4em] py-[0.1em] text-[0.55em] font-bold text-amber-200">
          {cost}
        </span>
      )}
    </div>
  );
}

const STATUS_RING: Record<NonNullable<CardStatus>, string> = {
  playable: 'ring-2 ring-leyline/70',
  draftable: 'animate-breathe ring-2 ring-leyline shadow-glow-sm',
  exhausted: 'ring-1 ring-black/15',
};

export function GameCard({
  face,
  status,
  onClick,
  className,
  style,
  title,
}: {
  face: CardFace;
  status?: CardStatus;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const ratio = face.kind === 'spell' ? RATIO.spell : RATIO.item;
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title ?? face.name}
      className={clsx(
        'group block shrink-0 appearance-none border-0 bg-transparent p-0 text-left transition active:scale-[.97]',
        className,
      )}
      style={{ aspectRatio: ratio, containerType: 'inline-size', ...style }}
    >
      <div
        className={clsx(
          'flex h-full w-full flex-col gap-[0.22em] overflow-hidden rounded-[0.5em] border border-black/20 bg-parchment-50 p-[0.32em] shadow-card',
          status === 'exhausted' && 'opacity-60 saturate-50',
          status ? STATUS_RING[status] : 'ring-1 ring-black/10',
        )}
        style={{
          fontSize: '9cqw',
          ...(status === 'draftable' ? ({ '--glow': '#7ee8fa88' } as React.CSSProperties) : {}),
        }}
      >
        {face.kind === 'spell' ? <SpellBody face={face} /> : <ItemBody face={face} />}
      </div>
    </Wrapper>
  );
}

/**
 * Full-screen "pick it up for a close look" overlay: a dimmed scrim (tap to
 * close) with the card blown up to a readable size, plus an optional action bar
 * (cast / play / draft controls) beneath it.
 */
export function CardZoom({
  face,
  onClose,
  children,
}: {
  face: CardFace;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const width = face.kind === 'spell' ? 'min(68vw, 270px)' : 'min(74vw, 300px)';
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-zoom-out bg-black/70 backdrop-blur-sm"
      />
      <div className="zoom-in relative">
        <GameCard face={face} style={{ width }} />
      </div>
      {children && (
        <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="relative rounded-full bg-night-700 px-4 py-1.5 text-sm font-bold text-white/85 ring-1 ring-white/20"
      >
        ✕ Close
      </button>
    </div>
  );
}
