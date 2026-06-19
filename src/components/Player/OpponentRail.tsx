import clsx from 'clsx';
import type { OwnedMage, Player } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { activePlayer, PLAYER_AURA, researchTotals } from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';
import { MageToken } from '../Board/MageToken';
import { PortraitBust } from './PortraitBust';
import { PlayerBuffBadges } from './PlayerBuffBadges';
import { ResourceIcon } from '../icons';
import { RESOURCE_ORDER } from './PlayerDock';
import { getBotPersonality } from '../../game/ai';

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
      size={32}
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
  const setInspectPlayerId = useUiStore((s) => s.setInspectPlayerId);
  if (!state) return null;
  const active = activePlayer(state);
  const rivals = state.players.filter((p) => p.id !== active?.id);
  if (rivals.length === 0) return null;

  return (
    <aside className="z-20 flex w-64 shrink-0 flex-col gap-2 overflow-y-auto p-2">
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
            <button
              type="button"
              onClick={() => setInspectPlayerId(p.id)}
              title="Review full tableau — resources, spells, supporters, vault items & discards"
              className="group flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/5"
              style={{ color: aura }}
            >
              <PortraitBust player={p} state={state} expression="neutral" size={26} />
              <span className="truncate font-display text-sm font-bold">{p.name}</span>
              {p.controlledByBot && (
                <span
                  className="rounded-full bg-night-900/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-starlight ring-1 ring-starlight/40"
                  title="Played by an AI"
                >
                  🤖 {getBotPersonality(p.botPersonalityId).name}
                </span>
              )}
              <span
                className="ml-auto shrink-0 text-xs text-white/25 transition group-hover:text-starlight"
                aria-hidden
              >
                🔍
              </span>
            </button>
            <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold text-white/85">
              {RESOURCE_ORDER.map(({ kind, key }) => {
                const isInt = key === 'intelligence';
                const isWis = key === 'wisdom';
                if (isInt || isWis) {
                  const rem = isInt ? research.intRemaining : research.wisRemaining;
                  const total = isInt ? research.intTotal : research.wisTotal;
                  return (
                    <span
                      key={key}
                      className="flex items-center gap-0.5 whitespace-nowrap"
                      title={`${isInt ? 'INT' : 'WIS'} — ${rem} unspent of ${total} total`}
                    >
                      <ResourceIcon kind={kind} size={13} />
                      {rem}
                      <span className="text-white/45">/{total}</span>
                    </span>
                  );
                }
                return (
                  <span key={key} className="flex items-center gap-0.5 whitespace-nowrap" title={key}>
                    <ResourceIcon kind={kind} size={13} />
                    {(p.resources as unknown as Record<string, number>)[key] ?? 0}
                  </span>
                );
              })}
            </p>
            <PlayerBuffBadges state={state} playerId={p.id} className="mb-1.5" />
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
