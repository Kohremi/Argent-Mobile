import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  buildMageIndex,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
  selectedMageOccupiedSlotPower,
} from '../../utils/uiSelectors';

/**
 * Shared placement read-model + dispatchers for the campus, derived from the
 * active player and the currently picked-up Mage (`selectedMageId`). Used by
 * both the desktop `CampusBoard` and the mobile `RoomDetailSheet` so the two
 * compute eligibility / shadow cost / dispatch identically.
 */
export function usePlacement() {
  const state = useGameStore((s) => s.state);
  const selectedMageId = useUiStore((s) => s.selectedMageId);
  const tryDispatch = useUiStore((s) => s.tryDispatch);

  const mageIndex = useMemo(
    () => (state ? buildMageIndex(state) : new Map()),
    [state],
  );

  const eligible = useMemo(() => {
    if (!state || !selectedMageId) return new Set<string>();
    const player = activePlayer(state);
    if (!player) return new Set<string>();
    return eligiblePlacementSlots(state, player.id, selectedMageId);
  }, [state, selectedMageId]);

  const shadowEligible = useMemo(() => {
    if (!state || !selectedMageId) return new Set<string>();
    const player = activePlayer(state);
    if (!player) return new Set<string>();
    return eligibleShadowPlacementSlots(state, player.id, selectedMageId);
  }, [state, selectedMageId]);

  const occupiedSlotPower = useMemo(() => {
    if (!state || !selectedMageId) return null;
    const mage = state.players.flatMap((p) => p.mages).find((m) => m.id === selectedMageId);
    if (!mage) return null;
    return selectedMageOccupiedSlotPower(state, mage);
  }, [state, selectedMageId]);

  // Shadowing costs 1 Mana via Planar Studies Side B, or is free under a
  // shadow-on-place buff (Zero Hour / Inversion).
  const activeId = state ? activePlayer(state)?.id : undefined;
  const shadowIsFree =
    !!state &&
    activeId !== undefined &&
    state.activeBuffs.some(
      (b) => b.kind === 'shadow-on-place' && b.casterPlayerId === activeId,
    );
  const shadowManaCost = shadowIsFree ? 0 : 1;

  const onPlace = (spaceId: string) => {
    if (!state || !selectedMageId) return;
    const player = activePlayer(state);
    if (!player) return;
    tryDispatch({
      type: 'PLACE_WORKER',
      playerId: player.id,
      mageId: selectedMageId,
      actionSpaceId: spaceId,
    });
  };

  const onPlaceShadow = (spaceId: string) => {
    if (!state || !selectedMageId) return;
    const player = activePlayer(state);
    if (!player) return;
    tryDispatch({
      type: 'PLACE_WORKER',
      playerId: player.id,
      mageId: selectedMageId,
      actionSpaceId: spaceId,
      isShadowing: true,
    });
  };

  return {
    mageIndex,
    eligible,
    shadowEligible,
    occupiedSlotPower,
    shadowManaCost,
    onPlace,
    onPlaceShadow,
  };
}
