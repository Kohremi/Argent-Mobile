/**
 * Room art registry (docs/UI_DESIGN.md §7.2, function-first revision).
 *
 * Every room gets a procedural SVG vignette and an identity hue. The
 * vignette no longer paints the room interior — RoomScene renders it as a
 * dimmed sprite FRIEZE in the room's top wall band, so flavor lives on the
 * walls and the interior stays clear for the worker-placement column.
 *
 * To override a frieze with real art: drop an image (a wide strip, ~480×80
 * webp, reads best) into `public/art/rooms/` and set
 * `artUrl: '/art/rooms/<file>.webp'` on the entry below. The procedural
 * scene remains the fallback if the image is missing or fails to load.
 */

export interface RoomArt {
  hue: string;
  artUrl?: string;
  Scene: (props: { hue: string }) => JSX.Element;
}

/* ----------------------------- scene helpers ----------------------------- */

const Frame = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 240 90" className="h-full w-full" preserveAspectRatio="xMidYMax meet">
    {children}
  </svg>
);

/* ------------------------------ the scenes ------------------------------- */

const VaultScene = ({ hue }: { hue: string }) => (
  <Frame>
    <circle cx="120" cy="50" r="34" fill="#3a2f24" stroke={hue} strokeWidth="3" />
    <circle cx="120" cy="50" r="22" fill="#211a12" stroke={hue} strokeWidth="2" />
    {[0, 45, 90, 135].map((a) => (
      <rect key={a} x="118" y="20" width="4" height="60" rx="2" fill={hue} opacity=".5"
        transform={`rotate(${a} 120 50)`} />
    ))}
    <circle cx="120" cy="50" r="7" fill={hue} />
    <circle cx="64" cy="78" r="5" fill="#ffd93d" /><circle cx="74" cy="82" r="4" fill="#ffd93d" />
    <circle cx="176" cy="80" r="5" fill="#ffd93d" />
    <path d="M60 74 l3 -8 3 8 -3 3 Z" fill="#fff7cc" opacity=".9" />
  </Frame>
);

const LibraryScene = ({ hue }: { hue: string }) => (
  <Frame>
    {[20, 52, 168, 200].map((x, i) => (
      <g key={x}>
        <rect x={x} y={26 - (i % 2) * 8} width="24" height={62 + (i % 2) * 8} fill="#3a2f3f" rx="2" />
        {[0, 1, 2, 3, 4].map((s) => (
          <rect key={s} x={x + 2} y={32 - (i % 2) * 8 + s * 11} width="20" height="8"
            fill={['#b16cea', '#5aa9e6', hue, '#ffd166', '#6bcb77'][(s + i) % 5]} opacity=".75" rx="1" />
        ))}
      </g>
    ))}
    <g transform="rotate(-8 120 40)">
      <path d="M96 40 Q108 32 120 40 Q132 32 144 40 L144 52 Q132 45 120 52 Q108 45 96 52 Z"
        fill="#fdf8ec" stroke={hue} strokeWidth="1.5" />
    </g>
    <circle cx="120" cy="28" r="2.4" fill={hue} opacity=".9" />
    <rect x="106" y="62" width="28" height="26" fill="#4a3b2c" rx="2" />
    <rect x="110" y="66" width="20" height="3" fill="#2c2218" />
  </Frame>
);

const InfirmaryScene = ({ hue }: { hue: string }) => (
  <Frame>
    {[34, 138].map((x) => (
      <g key={x}>
        <rect x={x} y="58" width="68" height="22" rx="6" fill="#fdf8ec" stroke="#d9c8a8" />
        <rect x={x} y="50" width="16" height="18" rx="4" fill="#e8e0ce" />
        <rect x={x + 26} y="64" width="36" height="8" rx="4" fill={hue} opacity=".5" />
      </g>
    ))}
    <rect x="112" y="18" width="18" height="18" rx="3" fill="#fff" stroke={hue} strokeWidth="2" />
    <rect x="119" y="21" width="4" height="12" fill={hue} /><rect x="115" y="25" width="12" height="4" fill={hue} />
    <circle cx="58" cy="30" r="3" fill={hue} opacity=".55" />
    <circle cx="186" cy="24" r="2.5" fill={hue} opacity=".4" />
  </Frame>
);

const CouncilScene = ({ hue }: { hue: string }) => (
  <Frame>
    <rect x="50" y="70" width="140" height="14" rx="3" fill="#4a3b2c" />
    <rect x="64" y="60" width="112" height="12" rx="3" fill="#5d4a36" />
    {[84, 120, 156].map((x) => (
      <g key={x}>
        <rect x={x - 9} y="28" width="18" height="34" rx="3" fill="#3a2f24" />
        <rect x={x - 9} y="28" width="18" height="8" rx="3" fill={hue} opacity=".8" />
      </g>
    ))}
    {[28, 212].map((x) => (
      <path key={x} d={`M${x - 8} 12 h16 v34 l-8 -8 -8 8 Z`} fill={hue} opacity=".7" />
    ))}
  </Frame>
);

const TrainingScene = ({ hue }: { hue: string }) => (
  <Frame>
    <ellipse cx="120" cy="72" rx="74" ry="12" fill="none" stroke={hue} strokeWidth="2.5" strokeDasharray="8 6" />
    <g transform="rotate(-30 104 48)"><rect x="100" y="22" width="7" height="52" rx="3" fill="#8a6b4a" /></g>
    <g transform="rotate(30 136 48)"><rect x="132" y="22" width="7" height="52" rx="3" fill="#8a6b4a" /></g>
    <path d="M120 30 l4 8 -4 4 -4 -4 Z" fill={hue} />
    <circle cx="120" cy="26" r="3" fill="#fff7cc" />
    {[68, 172].map((x) => (
      <circle key={x} cx={x} cy="64" r="3" fill={hue} opacity=".6" />
    ))}
  </Frame>
);

const CatacombsScene = ({ hue }: { hue: string }) => (
  <Frame>
    <path d="M84 88 L84 40 Q120 16 156 40 L156 88 Z" fill="#16101e" stroke="#3a2f3f" strokeWidth="3" />
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={96 + i * 6} y={62 + i * 7} width={48 - i * 12} height="6" fill="#241a30" />
    ))}
    <circle cx="70" cy="46" r="6" fill="#e8e4da" opacity=".85" />
    <ellipse cx="70" cy="49" rx="3.6" ry="2" fill="#16101e" />
    <path d="M60 84 q14 -8 28 0" stroke={hue} strokeWidth="3" fill="none" opacity=".5" />
    <path d="M152 84 q14 -8 28 0" stroke={hue} strokeWidth="3" fill="none" opacity=".4" />
  </Frame>
);

const GuildsScene = ({ hue }: { hue: string }) => (
  <Frame>
    {[
      { x: 30, c: '#ff6b6b' },
      { x: 96, c: hue },
      { x: 162, c: '#5aa9e6' },
    ].map(({ x, c }) => (
      <g key={x}>
        <rect x={x} y="52" width="48" height="32" rx="2" fill="#4a3b2c" />
        <path d={`M${x - 4} 52 h56 l-6 -14 h-44 Z`} fill={c} opacity=".85" />
        <rect x={x + 18} y="64" width="12" height="20" fill="#2c2218" />
        <path d={`M${x + 24} 18 v22 l8 -5 -8 -5`} stroke={c} strokeWidth="3" fill={c} />
      </g>
    ))}
  </Frame>
);

const CourtyardScene = ({ hue }: { hue: string }) => (
  <Frame>
    <ellipse cx="96" cy="76" rx="34" ry="9" fill="#5aa9e6" opacity=".5" />
    <rect x="88" y="52" width="16" height="22" rx="3" fill="#9aa0b4" />
    <path d="M96 36 q-10 16 0 18 q10 -2 0 -18" fill="#bfe4ff" />
    <circle cx="176" cy="38" r="20" fill={hue} opacity=".8" />
    <circle cx="166" cy="30" r="12" fill={hue} opacity=".7" />
    <rect x="172" y="54" width="7" height="30" fill="#8a6b4a" />
    {[40, 150, 200].map((x, i) => (
      <circle key={x} cx={x} cy={24 + i * 6} r="2.5" fill="#ffb7c5" opacity=".8" />
    ))}
    <rect x="24" y="72" width="34" height="6" rx="3" fill="#8a6b4a" />
  </Frame>
);

const DormitoryScene = ({ hue }: { hue: string }) => (
  <Frame>
    <rect x="26" y="40" width="74" height="16" rx="4" fill="#fdf8ec" />
    <rect x="26" y="66" width="74" height="16" rx="4" fill="#fdf8ec" />
    <rect x="22" y="34" width="8" height="52" rx="2" fill="#8a6b4a" />
    <rect x="96" y="34" width="8" height="52" rx="2" fill="#8a6b4a" />
    <rect x="36" y="42" width="20" height="9" rx="4" fill={hue} opacity=".6" />
    <circle cx="178" cy="34" r="16" fill="#1f1b3f" stroke="#8a6b4a" strokeWidth="3" />
    <path d="M184 26 a10 10 0 1 0 2 16 a8 8 0 1 1 -2 -16" fill="#ffe9a8" />
    <path d="M150 82 q5 -10 12 0 q4 -8 9 0 l-2 4 h-18 Z" fill="#9aa0b4" />
    <path d="M168 78 q4 -6 2 -10" stroke="#9aa0b4" strokeWidth="2.5" fill="none" />
  </Frame>
);

const GreatHallScene = ({ hue }: { hue: string }) => (
  <Frame>
    {[36, 204].map((x) => (
      <rect key={x} x={x - 7} y="14" width="14" height="74" fill="#5d5468" rx="2" />
    ))}
    <rect x="56" y="64" width="128" height="10" rx="3" fill="#5d4a36" />
    <rect x="62" y="74" width="6" height="14" fill="#4a3b2c" /><rect x="172" y="74" width="6" height="14" fill="#4a3b2c" />
    <path d="M100 14 h40 l-4 10 h-32 Z" fill={hue} opacity=".7" />
    <circle cx="120" cy="36" r="9" fill="none" stroke={hue} strokeWidth="2" />
    {[-12, 0, 12].map((dx) => (
      <circle key={dx} cx={120 + dx} cy="40" r="2.4" fill="#ffe9a8" />
    ))}
  </Frame>
);

const LaboratoryScene = ({ hue }: { hue: string }) => (
  <Frame>
    <rect x="30" y="70" width="180" height="12" rx="3" fill="#4a3b2c" />
    <path d="M70 70 l-10 -26 a14 14 0 1 1 20 0 Z" fill="#6bcb77" opacity=".75" />
    <rect x="64" y="34" width="12" height="8" fill="#9aa0b4" />
    <path d="M120 70 v-22 l-8 -14 h16 l-8 14" stroke={hue} strokeWidth="3" fill="#ffd9a8" opacity=".8" />
    <circle cx="170" cy="56" r="13" fill="#b16cea" opacity=".7" />
    <rect x="166" y="40" width="8" height="8" fill="#9aa0b4" />
    {[58, 122, 168].map((x, i) => (
      <circle key={x} cx={x} cy={26 - i * 3} r="2.5" fill={hue} opacity=".6" />
    ))}
  </Frame>
);

const ArchiveScene = ({ hue }: { hue: string }) => (
  <Frame>
    {[40, 104, 168].map((x) => (
      <g key={x}>
        <rect x={x} y="34" width="44" height="50" rx="2" fill="#3a2f3f" />
        {[0, 1, 2].map((r) => (
          <g key={r}>
            <rect x={x + 4} y={38 + r * 15} width="36" height="11" rx="1.5" fill="#241a30" />
            <circle cx={x + 22} cy={44 + r * 15} r="1.6" fill={hue} />
          </g>
        ))}
      </g>
    ))}
    <path d="M84 24 q36 -12 72 0" stroke={hue} strokeWidth="2.5" fill="none" opacity=".6" strokeDasharray="3 5" />
  </Frame>
);

const GolemScene = ({ hue }: { hue: string }) => (
  <Frame>
    <rect x="92" y="76" width="56" height="10" rx="2" fill="#4a3b2c" />
    <rect x="104" y="40" width="32" height="38" rx="6" fill="#9aa0b4" />
    <rect x="110" y="24" width="20" height="18" rx="5" fill="#9aa0b4" />
    <circle cx="116" cy="32" r="2.6" fill={hue} /><circle cx="124" cy="32" r="2.6" fill={hue} />
    <rect x="92" y="44" width="12" height="26" rx="5" fill="#7e8496" />
    <rect x="136" y="44" width="12" height="26" rx="5" fill="#7e8496" />
    <circle cx="120" cy="56" r="7" fill={hue} opacity=".85" />
    <g transform="rotate(18 60 40)"><circle cx="60" cy="40" r="13" fill="none" stroke={hue} strokeWidth="4" strokeDasharray="6 5" /></g>
    <g transform="rotate(-22 184 52)"><circle cx="184" cy="52" r="9" fill="none" stroke="#7e8496" strokeWidth="4" strokeDasharray="5 4" /></g>
  </Frame>
);

const SynthesisScene = ({ hue }: { hue: string }) => (
  <Frame>
    <path d="M86 86 a34 22 0 0 1 68 0 Z" fill="#3a2f24" />
    <ellipse cx="120" cy="62" rx="34" ry="9" fill="#211a12" stroke={hue} strokeWidth="2" />
    <path d="M100 56 q8 -14 20 -8 q14 -8 20 8" stroke={hue} strokeWidth="3" fill="none" opacity=".8" />
    {[104, 120, 136].map((x, i) => (
      <circle key={x} cx={x} cy={40 - i * 6} r={3 - i * 0.5} fill={hue} opacity=".7" />
    ))}
    <rect x="48" y="46" width="10" height="38" rx="3" fill="#8a6b4a" />
    <path d="M53 34 l8 12 h-16 Z" fill="#ffd93d" />
    <rect x="182" y="52" width="14" height="32" rx="3" fill="#4a3b2c" />
    <circle cx="189" cy="48" r="6" fill="#ff7849" opacity=".85" />
  </Frame>
);

const BellTowerScene = ({ hue }: { hue: string }) => (
  <Frame>
    <path d="M96 88 V30 l24 -16 24 16 v58" fill="#5d5468" stroke="#3a2f3f" strokeWidth="2" />
    <path d="M108 50 a12 14 0 0 1 24 0 v8 h-24 Z" fill={hue} />
    <circle cx="120" cy="62" r="3" fill="#3a2f24" />
    <path d="M88 30 q32 -22 64 0" stroke="none" fill="none" />
  </Frame>
);

const DefaultScene = ({ hue }: { hue: string }) => (
  <Frame>
    {[52, 188].map((x) => (
      <rect key={x} x={x - 6} y="22" width="12" height="66" rx="2" fill="#5d5468" />
    ))}
    <ellipse cx="120" cy="72" rx="44" ry="11" fill="none" stroke={hue} strokeWidth="2.5" strokeDasharray="7 6" />
    <circle cx="120" cy="44" r="10" fill="none" stroke={hue} strokeWidth="2" />
    <circle cx="120" cy="44" r="3" fill={hue} />
  </Frame>
);

/* ------------------------------ the registry ----------------------------- */

const REGISTRY: Record<string, RoomArt> = {
  Vault: { hue: '#ff9f43', Scene: VaultScene },
  Library: { hue: '#5aa9e6', Scene: LibraryScene },
  Infirmary: { hue: '#ff8fab', Scene: InfirmaryScene },
  'Council Chamber': { hue: '#ffd166', Scene: CouncilScene },
  'Training Fields': { hue: '#ff5d5d', Scene: TrainingScene },
  Catacombs: { hue: '#b16cea', Scene: CatacombsScene },
  Guilds: { hue: '#6bcb77', Scene: GuildsScene },
  Courtyard: { hue: '#5fd068', Scene: CourtyardScene },
  Dormitory: { hue: '#b388eb', Scene: DormitoryScene },
  'Great Hall': { hue: '#ffd166', Scene: GreatHallScene },
  'Bell Tower': { hue: '#ffe9a8', Scene: BellTowerScene },
  Laboratory: { hue: '#ff9f43', Scene: LaboratoryScene },
  'Research Archive': { hue: '#ffd166', Scene: ArchiveScene },
  'Golem Lab': { hue: '#9aa0b4', Scene: GolemScene },
  'Synthesis Workshop': { hue: '#ff7849', Scene: SynthesisScene },
};

const FALLBACK: RoomArt = { hue: '#7ee8fa', Scene: DefaultScene };

export function roomArtFor(roomName: string): RoomArt {
  return REGISTRY[roomName] ?? FALLBACK;
}
