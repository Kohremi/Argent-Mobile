import { MotionConfig } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useStateDiffFx } from '../FX/useStateDiffFx';
import { localPlayer, PLAYER_AURA } from '../../utils/uiSelectors';
import type { GameState, Player } from '../../game/types';
import { PromptDirector } from '../Prompts/PromptDirector';
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
import { RivalsView } from './RivalsView';
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
