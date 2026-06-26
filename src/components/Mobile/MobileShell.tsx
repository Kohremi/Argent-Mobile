import { MotionConfig } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useStateDiffFx } from '../FX/useStateDiffFx';
import { localPlayer, PLAYER_AURA } from '../../utils/uiSelectors';
import { getBotPersonality } from '../../game/ai';
import type { GameState, Player } from '../../game/types';
import { PromptDirector } from '../Prompts/PromptDirector';
import { OpponentInspector } from '../Player/OpponentInspector';
import { ScoringCeremony } from '../Modals/ScoringCeremony';
import { TurnBanner } from '../HUD/TurnBanner';
import { PortraitBust } from '../Player/PortraitBust';
import { PlayerTableau } from '../Player/PlayerTableau';
import { DebugControls } from '../DebugControls';
import { PeekModal, ErrorToast } from '../GameScreen';
import { MobileTopBar } from './MobileTopBar';
import { MobileActionRow } from './MobileActionRow';
import { MobileDock } from './MobileDock';
import { TabBar } from './TabBar';
import { CampusMap } from './CampusMap';
import { RoomDetailSheet } from './RoomDetailSheet';
import { CardDetailSheet } from './CardDetailSheet';
import { TableauView } from './TableauView';
import { CouncilView } from './CouncilView';

/**
 * Mobile shell (< lg): a focal "stage" switched by a bottom tab bar, a compact
 * top status bar, and the active-player dock above the tabs. Reuses the engine
 * drivers and global overlays from the desktop GameScreen; the per-tab views
 * reuse existing components (CampusBoard, CouncilTower, PlayerTableau, the
 * OpponentInspector overlay). Phase B replaces the Campus tab with a spatial
 * map + drill-in room view.
 */
export function MobileShell() {
  const state = useGameStore((s) => s.state);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const mobileTab = useUiStore((s) => s.mobileTab);
  const debugOpen = useUiStore((s) => s.debugOpen);
  const setDebugOpen = useUiStore((s) => s.setDebugOpen);
  useStateDiffFx();
  if (!state) return null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full flex-col overflow-hidden bg-night-900">
        <MobileTopBar />
        <MobileActionRow />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {mobileTab === 'campus' && <CampusMap />}
          {mobileTab === 'tableau' && <TableauView state={state} />}
          {mobileTab === 'board' && <MyBoardView state={state} localPlayerId={localPlayerId} />}
          {mobileTab === 'rivals' && <RivalsView state={state} localPlayerId={localPlayerId} />}
          {mobileTab === 'council' && <CouncilView />}

          {/* drilled-in enlarged room view (over the Campus map) */}
          {mobileTab === 'campus' && <RoomDetailSheet />}
        </main>

        <MobileDock />
        <TabBar />

        {/* global overlays (shared with the desktop shell) */}
        <CardDetailSheet />
        <PromptDirector />
        <OpponentInspector />
        <PeekModal />
        <TurnBanner />
        <ScoringCeremony />
        <ErrorToast />

        {debugOpen && (
          <div className="absolute inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto border-t border-white/15 bg-slate-950/97 shadow-card-lift backdrop-blur">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-950/95 px-4 py-2 ring-1 ring-white/10">
              <p className="font-display text-sm font-bold text-starlight">Engine console</p>
              <button
                type="button"
                onClick={() => setDebugOpen(false)}
                className="rounded-full bg-night-700 px-3 py-1 text-xs text-white/80 ring-1 ring-white/15"
              >
                ✕ Close
              </button>
            </div>
            <DebugControls />
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

/** The seat shown as "mine" — the bound local seat in single-player, else the
 *  active seat (legacy hot-seat). */
function selfPlayer(state: GameState, localPlayerId: string | null): Player {
  return localPlayer(state, localPlayerId) ?? state.players[0]!;
}

function MyBoardView({ state, localPlayerId }: { state: GameState; localPlayerId: string | null }) {
  const player = selfPlayer(state, localPlayerId);
  const aura = PLAYER_AURA[player.color];
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="flex items-center gap-3">
        <PortraitBust player={player} state={state} expression="neutral" size={40} />
        <div className="min-w-0">
          <p className="font-display text-lg font-bold leading-tight" style={{ color: aura }}>
            {player.name}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/40">your tableau</p>
        </div>
      </div>
      <PlayerTableau state={state} player={player} />
    </div>
  );
}

function RivalsView({ state, localPlayerId }: { state: GameState; localPlayerId: string | null }) {
  const setInspect = useUiStore((s) => s.setInspectPlayerId);
  const self = selfPlayer(state, localPlayerId);
  const rivals = state.players.filter((p) => p.id !== self.id);
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-3">
      {rivals.map((p) => {
        const aura = PLAYER_AURA[p.color];
        const office = p.mages.filter((m) => m.location.kind === 'office').length;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setInspect(p.id)}
            className="flex items-center gap-3 rounded-card bg-night-700/80 p-2.5 text-left ring-1 ring-white/10"
            style={{ boxShadow: `inset 0 2px 0 ${aura}` }}
          >
            <PortraitBust player={p} state={state} expression="neutral" size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold" style={{ color: aura }}>
                {p.name}
                {p.controlledByBot && (
                  <span className="ml-1.5 rounded-full bg-night-900/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-starlight ring-1 ring-starlight/40">
                    🤖 {getBotPersonality(p.botPersonalityId).name}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-white/55">
                {p.ownedSpells.length} spells · {p.supporters.length} allies · {office} in office
              </p>
            </div>
            <span className="text-white/30">›</span>
          </button>
        );
      })}
    </div>
  );
}
