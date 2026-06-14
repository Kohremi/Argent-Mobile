import clsx from 'clsx';
import type { OwnedMage, Player } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { activePlayer, PLAYER_AURA, researchTotals } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from '../Board/MageToken';
import { PortraitBust } from './PortraitBust';
import { ResourceIcon } from '../icons';

/**
 * Left rail: compact rival panels (docs/UI_DESIGN.md §8). Shows each
 * non-active player's resources and their office students — which must be
 * visible because prompts can target them (Freezing Bolt wounds office
 * Mages). Wounded mages are NOT shown here: they live in the Infirmary ward
 * on the board (RoomScene bed grid), which renders + targets them and owns
 * their glide animation. Rendering them here too would duplicate the
 * framer-motion layoutId and make the bed tokens flicker out.
 */

function RailToken({ player, mage }: { player: Player; mage: OwnedMage }) {
  const { mageTargets, pickMage } = usePromptTargets();
  const targeted = mageTargets.has(mage.id);
  const token = (
    <MageToken
      color={mage.color}
      aura={PLAYER_AURA[player.color]}
      isWounded={mage.isWounded}
      size={30}
      glideId={mage.id}
    />
  );
  if (!targeted) return token;
  return (
    <button
      type="button"
      onClick={() => pickMage(mage.id)}
      className="animate-breathe cursor-pointer rounded-full transition hover:scale-110"
      style={{ filter: 'drop-shadow(0 0 7px #ff5d7d)' }}
      title="Choose this student"
    >
      {token}
    </button>
  );
}

export function OpponentRail() {
  const state = useGameStore((s) => s.state);
  if (!state) return null;
  const active = activePlayer(state);
  const rivals = state.players.filter((p) => p.id !== active?.id);
  if (rivals.length === 0) return null;

  return (
    <aside className="z-20 flex w-44 shrink-0 flex-col gap-2 overflow-y-auto p-2">
      {rivals.map((p) => {
        const aura = PLAYER_AURA[p.color];
        const office = p.mages.filter((m) => m.location.kind === 'office');
        const research = researchTotals(p);
        return (
          <section
            key={p.id}
            className="rounded-card bg-night-700/85 p-2 ring-1 ring-white/10 backdrop-blur"
            style={{ boxShadow: `inset 3px 0 0 ${aura}` }}
          >
            <p className="flex items-center gap-1.5 font-display text-sm font-bold" style={{ color: aura }}>
              <PortraitBust player={p} state={state} expression="neutral" size={26} />
              {p.name}
            </p>
            <p className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold text-white/80">
              <span><ResourceIcon kind="gold" size={11} /> {p.resources.gold}</span>
              <span><ResourceIcon kind="mana" size={11} /> {p.resources.mana}</span>
              <span><ResourceIcon kind="influence" size={11} /> {p.resources.influence}</span>
              <span><ResourceIcon kind="marks" size={11} /> {p.resources.marks}</span>
              <span title={`INT — ${research.intRemaining} unspent of ${research.intTotal} total`}>
                <ResourceIcon kind="intelligence" size={11} /> {research.intRemaining}
                <span className="text-white/45">/{research.intTotal}</span>
              </span>
              <span title={`WIS — ${research.wisRemaining} unspent of ${research.wisTotal} total`}>
                <ResourceIcon kind="wisdom" size={11} /> {research.wisRemaining}
                <span className="text-white/45">/{research.wisTotal}</span>
              </span>
            </p>
            <div className={clsx('flex flex-wrap items-end gap-0.5', office.length === 0 && 'hidden')}>
              {office.map((m) => (
                <RailToken key={m.id} player={p} mage={m} />
              ))}
            </div>
          </section>
        );
      })}
    </aside>
  );
}
