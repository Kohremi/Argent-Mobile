import clsx from 'clsx';
import { ResourceIcon, type ResourceKind } from '../icons';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, PLAYER_AURA } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from '../Board/MageToken';
import { HandFans } from '../Cards/HandFans';
import { PortraitBust } from './PortraitBust';

/**
 * Bottom command center for the active player (docs/UI_DESIGN.md §8):
 * identity, resource chips, the mage bench (placement source — click a
 * student to pick them up, then click a glowing circle on the campus),
 * and turn controls. Hand fans/spellbook arrive in build step 3.
 */

const RESOURCE_ORDER: { kind: ResourceKind; key: string }[] = [
  { kind: 'gold', key: 'gold' },
  { kind: 'mana', key: 'mana' },
  { kind: 'influence', key: 'influence' },
  { kind: 'intelligence', key: 'intelligence' },
  { kind: 'wisdom', key: 'wisdom' },
  { kind: 'marks', key: 'marks' },
  { kind: 'merit-badge', key: 'meritBadges' },
];

export function PlayerDock() {
  const state = useGameStore((s) => s.state);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const selectMage = useUiStore((s) => s.selectMage);
  const tryDispatch = useUiStore((s) => s.tryDispatch);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  const { mageTargets, pickMage } = usePromptTargets();
  if (!state) return null;

  const player = activePlayer(state);
  const pendings = state.pendingResolutionStack.length;

  if (!player) {
    return (
      <footer className="z-30 flex h-16 items-center justify-center gap-3 bg-night-800/95 ring-1 ring-white/10">
        <p className="text-sm text-white/60">
          {state.phase.kind === 'final-scoring' || state.phase.kind === 'complete'
            ? 'The election is underway…'
            : 'Between turns — use the console to advance.'}
        </p>
        <button
          type="button"
          onClick={() => setDebugOpen(true)}
          className="rounded-full bg-starlight px-3 py-1 text-xs font-bold text-ink-900"
        >
          Open console
        </button>
      </footer>
    );
  }

  const aura = PLAYER_AURA[player.color];
  const bench = player.mages.filter((m) => m.location.kind === 'office');
  const infirmary = player.mages.filter((m) => m.location.kind === 'infirmary');

  return (
    <footer
      className="z-30 flex flex-col bg-night-800/95 px-4 py-1.5 ring-1 ring-white/10 backdrop-blur"
      style={{ boxShadow: `inset 0 3px 0 ${aura}` }}
    >
      {/* row 2: hands (rendered first so popovers escape upward cleanly) */}
      <HandFans state={state} player={player} />

      <div className="flex items-stretch gap-4">
      {/* identity */}
      <div className="flex min-w-[150px] items-center gap-2.5">
        <PortraitBust player={player} state={state} expression="neutral" size={44} />
        <div>
          <p className="font-display text-base font-bold leading-tight" style={{ color: aura }}>
            {player.name}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/40">
            your move
          </p>
        </div>
      </div>

      {/* resources */}
      <div className="flex items-center gap-1.5">
        {RESOURCE_ORDER.map(({ kind, key }) => (
          <span
            key={key}
            className="flex items-center gap-1 rounded-full bg-night-700 px-2 py-1 text-xs font-bold ring-1 ring-white/10"
            title={key}
          >
            <ResourceIcon kind={kind} className="h-3.5 w-3.5" />
            {(player.resources as unknown as Record<string, number>)[key] ?? 0}
          </span>
        ))}
      </div>

      {/* bench */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        <p className="mr-1 shrink-0 text-[10px] uppercase tracking-widest text-white/40">
          bench
        </p>
        {bench.map((m) => {
          const targeted = mageTargets.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                targeted ? pickMage(m.id) : selectMage(selectedMageId === m.id ? null : m.id)
              }
              className={clsx(
                'rounded-xl px-1 pt-1 transition-all duration-150',
                targeted && 'animate-breathe',
                selectedMageId === m.id
                  ? 'scale-110 bg-night-600 ring-2 ring-starlight shadow-glow-sm'
                  : 'hover:-translate-y-1 hover:bg-night-700',
              )}
              style={
                targeted
                  ? { filter: 'drop-shadow(0 0 7px #ff5d7d)' }
                  : selectedMageId === m.id
                    ? ({ '--glow': '#ffe9a866' } as React.CSSProperties)
                    : undefined
              }
              title={`${m.color} student${m.isWounded ? ' (wounded)' : ''}`}
            >
              <MageToken color={m.color} aura={aura} isWounded={m.isWounded} size={42} glideId={m.id} />
            </button>
          );
        })}
        {bench.length === 0 && (
          <p className="text-xs italic text-white/35">no students in the office</p>
        )}
        {infirmary.length > 0 && (
          <span className="ml-2 flex items-center gap-0.5 opacity-60" title="In the Infirmary">
            <span className="text-[10px] uppercase tracking-widest text-white/40">infirmary</span>
            {infirmary.map((m) => {
              const targeted = mageTargets.has(m.id);
              const token = (
                <MageToken key={m.id} color={m.color} aura={aura} isWounded size={30} glideId={m.id} />
              );
              return targeted ? (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickMage(m.id)}
                  className="animate-breathe cursor-pointer rounded-full hover:scale-110"
                  style={{ filter: 'drop-shadow(0 0 7px #ff5d7d)' }}
                >
                  {token}
                </button>
              ) : (
                token
              );
            })}
          </span>
        )}
      </div>

      {/* turn controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pendings > 0}
          onClick={() => tryDispatch({ type: 'PASS_TURN', playerId: player.id })}
          className="rounded-full bg-gradient-to-b from-starlight to-amber-300 px-4 py-1.5 font-display text-sm font-bold text-ink-900 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-lift active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0"
        >
          End turn
        </button>
      </div>
      </div>
    </footer>
  );
}
