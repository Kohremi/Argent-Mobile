import type { GameState } from './types';

/**
 * Asserts the core board invariant: a Mage's `location` and the slot
 * `occupant` / `shadowOccupant` references always agree. Concretely:
 *
 *   - Every Mage on a slot (`location.kind === 'action-space'`) is referenced by
 *     exactly ONE slot — at the matching `spaceId` and position (`isShadowing`
 *     ⇔ the shadow position).
 *   - Every slot occupant / shadowOccupant references a Mage whose `location`
 *     agrees (same spaceId, matching position).
 *   - Mages in the office / infirmary are not referenced by any slot.
 *
 * Returns a human-readable description of the FIRST violation, or `null` when
 * the board is consistent. Used by tests (and a dev assertion) to catch the
 * location↔occupancy desyncs that hand-rolled board mutations used to cause.
 */
export function findBoardInconsistency(state: GameState): string | null {
  // Index every slot reference: mageId → list of { spaceId, position }.
  const slotRefs = new Map<string, { spaceId: string; position: 'base' | 'shadow' }[]>();
  const pushRef = (mageId: string, spaceId: string, position: 'base' | 'shadow') => {
    const list = slotRefs.get(mageId) ?? [];
    list.push({ spaceId, position });
    slotRefs.set(mageId, list);
  };
  for (const room of state.rooms) {
    for (const sp of room.actionSpaces) {
      if (sp.occupant) pushRef(sp.occupant.mageId, sp.id, 'base');
      if (sp.shadowOccupant) pushRef(sp.shadowOccupant.mageId, sp.id, 'shadow');
    }
  }

  // Every Mage must agree with its slot references.
  const allMageIds = new Set<string>();
  for (const p of state.players) {
    for (const m of p.mages) {
      allMageIds.add(m.id);
      const refs = slotRefs.get(m.id) ?? [];
      if (m.location.kind === 'action-space') {
        if (refs.length === 0) {
          return `mage ${m.id} (owner ${p.id}) location=action-space:${m.location.spaceId} but is on NO slot`;
        }
        if (refs.length > 1) {
          return `mage ${m.id} (owner ${p.id}) is on ${refs.length} slots: ${refs
            .map((r) => `${r.spaceId}[${r.position}]`)
            .join(', ')}`;
        }
        const ref = refs[0]!;
        if (ref.spaceId !== m.location.spaceId) {
          return `mage ${m.id} location says ${m.location.spaceId} but is on ${ref.spaceId}`;
        }
        const expected = m.isShadowing ? 'shadow' : 'base';
        if (ref.position !== expected) {
          return `mage ${m.id} on ${ref.spaceId} is ${ref.position} but isShadowing=${m.isShadowing} expects ${expected}`;
        }
      } else if (refs.length > 0) {
        return `mage ${m.id} (owner ${p.id}) location=${m.location.kind} but slot ${refs[0]!.spaceId}[${refs[0]!.position}] still lists it`;
      }
    }
  }

  // Every slot reference must point at a Mage that actually exists.
  for (const [mageId, refs] of slotRefs) {
    if (!allMageIds.has(mageId)) {
      return `slot ${refs[0]!.spaceId}[${refs[0]!.position}] references unknown mage ${mageId}`;
    }
  }

  return null;
}

/**
 * Throws if the board invariant is violated (see {@link findBoardInconsistency}).
 * Test-only helper — not called in production.
 */
export function assertBoardConsistent(state: GameState, context = ''): void {
  const problem = findBoardInconsistency(state);
  if (problem) {
    throw new Error(`Board invariant violated${context ? ` (${context})` : ''}: ${problem}`);
  }
}
