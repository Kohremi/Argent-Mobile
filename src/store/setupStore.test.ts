import { beforeEach, describe, expect, it } from 'vitest';
import { useSetupStore } from './setupStore';

const STAFF_A = 'archmage.room.archmages-staff.a';
const STAFF_B = 'archmage.room.archmages-staff.b';
const UC_ROOMS = [
  'base.room.council-chamber.a',
  'base.room.library.a',
  'base.room.infirmary.a',
];

/**
 * The Archmage's Staff is a *removable* default in the custom ("choose your
 * own") layout: turning the pack on pre-selects the Staff (side A), turning it
 * off clears it, and once the player edits that choice by hand it sticks.
 */
describe("setupStore — Archmage's Staff custom-layout default", () => {
  beforeEach(() => {
    useSetupStore.setState({
      selectedPackIds: ['base', 'mancers'],
      scenarioId: null,
      customRoomIds: [...UC_ROOMS],
    });
  });

  it('pre-selects the Staff (side A) when the pack is turned on', () => {
    useSetupStore.getState().togglePack('archmage');
    expect(useSetupStore.getState().customRoomIds).toContain(STAFF_A);
  });

  it('clears the Staff from the custom layout when the pack is turned off', () => {
    useSetupStore.getState().togglePack('archmage'); // on → adds side A
    useSetupStore.getState().togglePack('archmage'); // off → drops both sides
    const ids = useSetupStore.getState().customRoomIds;
    expect(ids).not.toContain(STAFF_A);
    expect(ids).not.toContain(STAFF_B);
  });

  it('keeps a player-flipped side and never duplicates on unrelated toggles', () => {
    useSetupStore.getState().togglePack('archmage'); // adds side A
    useSetupStore.getState().toggleCustomRoomSide(STAFF_B, STAFF_A); // flip to B
    useSetupStore.getState().togglePack('renovation'); // unrelated pack
    const ids = useSetupStore.getState().customRoomIds;
    expect(ids).toContain(STAFF_B);
    expect(ids).not.toContain(STAFF_A);
  });

  it('stays removed once the player unchecks it (removable, not locked)', () => {
    useSetupStore.getState().togglePack('archmage'); // adds side A
    useSetupStore.getState().toggleCustomRoomSide(STAFF_A, STAFF_B); // uncheck
    expect(useSetupStore.getState().customRoomIds).not.toContain(STAFF_A);
    // An unrelated pack toggle must not resurrect the removed default.
    useSetupStore.getState().togglePack('renovation');
    expect(useSetupStore.getState().customRoomIds).not.toContain(STAFF_A);
  });
});
