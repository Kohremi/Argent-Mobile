import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { BellTower } from '../Board/BellTower';

/**
 * The Bell Tower offerings as a top-anchored overlay rather than an inline board
 * panel: tapping the top-bar bell icon drops this menu out over the board (see
 * the `bell-drop` animation), so the offerings no longer eat permanent board
 * space. Tap the scrim to dismiss; claiming an offering closes it too.
 */
export function BellTowerSheet() {
  const state = useGameStore((s) => s.state);
  const open = useUiStore((s) => s.bellMenuOpen);
  const setOpen = useUiStore((s) => s.setBellMenuOpen);
  if (!state || !open) return null;

  return (
    <div className="absolute inset-0 z-40">
      <button
        type="button"
        aria-label="Close Bell Tower"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/40"
      />
      <div className="bell-drop absolute inset-x-2 top-2 max-h-[72vh] overflow-y-auto rounded-card shadow-card-lift ring-1 ring-starlight/30">
        <BellTower state={state} onClaim={() => setOpen(false)} />
      </div>
    </div>
  );
}
