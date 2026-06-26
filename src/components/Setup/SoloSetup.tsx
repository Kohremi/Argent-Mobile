import { useState } from 'react';
import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { defaultRoomCountForPlayerCount } from '../../store/setupStore';
import { getBotPersonality } from '../../game/ai';
import { randomSeed } from '../../utils/rng';
import type { Department, GameConfig, MageAbilitySide } from '../../game/types';

/**
 * Single-player start: you versus a table of bots, in a couple of taps. Builds a
 * GameConfig with seat 0 as the lone human and the rest as auto-driven bots,
 * then `startAs` binds this client to seat 0 (sets `localPlayerId`). The whole
 * table is otherwise standard, so the same game is reachable later by a join-room
 * flow that assigns each client a different seat.
 */

const MAGE_SIDES: Record<Department, MageAbilitySide> = {
  sorcery: 'A',
  mysticism: 'A',
  'natural-magick': 'A',
  'planar-studies': 'A',
  divinity: 'A',
  technomancy: 'A',
  students: 'A',
  wild: 'A',
};

const MIX_CYCLE = ['klank', 'malfoy', 'thickhide', 'darthpotter'] as const;

const SKILLS: { id: string; label: string; persona: string | null; blurb: string }[] = [
  { id: 'mixed', label: 'Mixed', persona: null, blurb: 'A different bot personality per seat' },
  { id: 'thickhide', label: 'Relaxed', persona: 'thickhide', blurb: 'Loose, instinct-driven play' },
  { id: 'klank', label: 'Balanced', persona: 'klank', blurb: 'Solid greedy heuristics' },
  { id: 'malfoy', label: 'Cunning', persona: 'malfoy', blurb: 'Grabs mana, researches big spells' },
  { id: 'darthpotter', label: 'Ruthless', persona: 'darthpotter', blurb: 'Reads voters, plays to win' },
];

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-xl px-3 py-2 text-sm font-bold ring-1 transition active:scale-95',
        active
          ? 'bg-gradient-to-b from-starlight to-amber-300 text-ink-900 ring-starlight'
          : 'bg-night-700 text-white/80 ring-white/15',
      )}
    >
      {children}
    </button>
  );
}

export function SoloSetup({ onAdvanced }: { onAdvanced?: () => void }) {
  const startGame = useGameStore((s) => s.start);
  const [name, setName] = useState('You');
  const [opponents, setOpponents] = useState(2);
  const [skill, setSkill] = useState('mixed');

  const start = () => {
    const total = 1 + opponents;
    const personaFor = (i: number) =>
      skill === 'mixed' ? MIX_CYCLE[i % MIX_CYCLE.length]! : skill;
    const playerNames = [name.trim() || 'You'];
    const controlledByBot = [false];
    const botPersonalityIds: (string | undefined)[] = [undefined];
    for (let i = 0; i < opponents; i++) {
      const pid = personaFor(i);
      playerNames.push(skill === 'mixed' ? getBotPersonality(pid).name : `Rival ${i + 1}`);
      controlledByBot.push(true);
      botPersonalityIds.push(pid);
    }

    const config: GameConfig = {
      activePackIds: ['base'],
      playerNames,
      controlledByBot,
      botPersonalityIds,
      rngSeed: randomSeed(),
      useCandidateDraft: true,
      numberOfRooms: defaultRoomCountForPlayerCount(total),
      roomLayoutMode: { kind: 'random' },
      mageAbilitySides: MAGE_SIDES,
      totalRounds: 5,
    };
    startGame(config);
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-night-900 to-night-800 px-5 py-8 text-slate-100">
      <div className="w-full max-w-sm">
        <h1 className="text-center font-display text-3xl font-extrabold tracking-wide text-starlight">
          Argent
        </h1>
        <p className="mb-6 text-center text-sm text-white/55">The Consortium · single player</p>

        <label className="mb-1 block px-1 text-[11px] font-bold uppercase tracking-widest text-white/40">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={16}
          className="mb-5 w-full rounded-xl bg-night-700 px-3 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 outline-none focus:ring-starlight/60"
        />

        <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest text-white/40">
          Opponents
        </p>
        <div className="mb-5 grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Choice key={n} active={opponents === n} onClick={() => setOpponents(n)}>
              {n}
            </Choice>
          ))}
        </div>

        <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest text-white/40">
          Difficulty
        </p>
        <div className="mb-1 grid grid-cols-3 gap-1.5">
          {SKILLS.map((s) => (
            <Choice key={s.id} active={skill === s.id} onClick={() => setSkill(s.id)}>
              {s.label}
            </Choice>
          ))}
        </div>
        <p className="mb-6 px-1 text-[11px] text-white/45">
          {SKILLS.find((s) => s.id === skill)?.blurb}
        </p>

        <button
          type="button"
          onClick={start}
          className="w-full rounded-full bg-gradient-to-b from-starlight to-amber-300 px-5 py-3 font-display text-base font-extrabold text-ink-900 shadow-card transition active:scale-[.98]"
        >
          Start game ▸
        </button>

        {onAdvanced && (
          <button
            type="button"
            onClick={onAdvanced}
            className="mt-4 w-full text-center text-xs text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
          >
            Advanced setup (packs, scenarios, hot-seat)
          </button>
        )}
      </div>
    </div>
  );
}
