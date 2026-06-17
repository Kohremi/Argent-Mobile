import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import {
  activePlayer,
  buildMageIndex,
  eligiblePlacementSlots,
  eligibleShadowPlacementSlots,
  selectedMageOccupiedSlotPower,
  visibleRoomSpaces,
} from '../../utils/uiSelectors';
import { usePromptTargets } from '../Prompts/usePromptTargets';

import { RoomScene } from './RoomScene';
import { TableauShelf } from './TableauShelf';

/**
 * The university laid out as a readable, screen-fitting grid that mirrors the
 * engine console's room panel: each room occupies its real `roomLayout.grid`
 * cell, rooms flex to fill their column, and the whole board scrolls
 * vertically. Empty grid cells show a faint placeholder so the spatial shape
 * (which adjacency-aware spells care about) stays legible. Rooms render as
 * flat functional cards (see RoomScene) — no art, friezes, or beds.
 */

export function CampusBoard() {
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

  // Slots whose SHADOW position the selected Mage may drop into — Planar
  // Studies Side B (pay 1 Mana) or an active shadow-on-place buff.
  const shadowEligible = useMemo(() => {
    if (!state || !selectedMageId) return new Set<string>();
    const player = activePlayer(state);
    if (!player) return new Set<string>();
    return eligibleShadowPlacementSlots(state, player.id, selectedMageId);
  }, [state, selectedMageId]);

  // The selected Mage's occupied-slot power (Ars Magna / Natural Magick B), if
  // any — used to give occupied targets a distinct border + Mana cost label.
  const occupiedSlotPower = useMemo(() => {
    if (!state || !selectedMageId) return null;
    const mage = state.players
      .flatMap((p) => p.mages)
      .find((m) => m.id === selectedMageId);
    if (!mage) return null;
    return selectedMageOccupiedSlotPower(state, mage);
  }, [state, selectedMageId]);

  // Prompt-targeted slots must stay visible even in collapsed pool rooms.
  const { spaceTargets } = usePromptTargets();

  if (!state) return null;
  const { grid, cols } = state.roomLayout;
  const roomById = new Map(state.rooms.map((r) => [r.id, r] as const));

  // Shadowing costs 1 Mana via Planar Studies Side B, or is free under a
  // shadow-on-place buff (Zero Hour / Inversion).
  const activeId = activePlayer(state)?.id;
  const shadowIsFree =
    activeId !== undefined &&
    state.activeBuffs.some(
      (b) => b.kind === 'shadow-on-place' && b.casterPlayerId === activeId,
    );
  const shadowManaCost = shadowIsFree ? 0 : 1;

  const onPlace = (spaceId: string) => {
    const player = activePlayer(state);
    if (!player || !selectedMageId) return;
    tryDispatch({
      type: 'PLACE_WORKER',
      playerId: player.id,
      mageId: selectedMageId,
      actionSpaceId: spaceId,
    });
  };

  const onPlaceShadow = (spaceId: string) => {
    const player = activePlayer(state);
    if (!player || !selectedMageId) return;
    tryDispatch({
      type: 'PLACE_WORKER',
      playerId: player.id,
      mageId: selectedMageId,
      actionSpaceId: spaceId,
      isShadowing: true,
    });
  };

  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5">
        {/* the university rooms, in their real grid positions */}
        <div
          className="grid items-start gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {grid.flatMap((row, r) =>
            row.map((roomId, c) => {
              if (!roomId) {
                return (
                  <div
                    key={`empty-${r}-${c}`}
                    aria-hidden="true"
                    className="rounded border border-dashed border-slate-800 bg-slate-900/30 min-h-[6rem]"
                  />
                );
              }
              const room = roomById.get(roomId);
              if (!room) return null;
              const visible = visibleRoomSpaces(room, spaceTargets);
              return (
                <RoomScene
                  key={room.id}
                  room={room}
                  state={state}
                  eligible={eligible}
                  shadowEligible={shadowEligible}
                  shadowManaCost={shadowManaCost}
                  occupiedSlotPower={occupiedSlotPower}
                  onPlace={onPlace}
                  onPlaceShadow={onPlaceShadow}
                  mageIndex={mageIndex}
                  spaces={visible}
                />
              );
            }),
          )}
        </div>

        {/* the round's card offers, beneath the university */}
        <TableauShelf state={state} />
      </div>
    </div>
  );
}
