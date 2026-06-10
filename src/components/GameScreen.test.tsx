// @vitest-environment happy-dom
// Render smoke test for the step-1 presentation layer: forces an errands
// state (same technique as engine.test.ts), renders GameScreen, selects a
// bench mage, and places it via a glowing slot.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

afterEach(cleanup);
import { GameScreen } from './GameScreen';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { initGame } from '../game/engine';
import type { GameState, OwnedMage } from '../game/types';

function errandsState(): GameState {
  const s = initGame({
    activePackIds: ['base'],
    playerNames: ['Akko', 'Diana'],
    rngSeed: 7,
  });
  const p1 = s.players[0]!;
  const mage: OwnedMage = {
    id: 'm-ui-1',
    cardId: 'base.mage.neutral',
    color: 'red',
    location: { kind: 'office', playerId: p1.id },
    isShadowing: false,
    isWounded: false,
  };
  return {
    ...s,
    firstPlayerIndex: 0,
    players: s.players.map((p, i) => (i === 0 ? { ...p, mages: [...p.mages, mage] } : p)),
    phase: {
      kind: 'errands',
      round: 1,
      activePlayerIndex: 0,
      actionUsed: false,
      fastActionUsed: false,
    },
  };
}

describe('GameScreen (step-1 smoke)', () => {
  it('renders the campus and completes a click-to-place flow', () => {
    useGameStore.setState({ state: errandsState() });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });

    render(<GameScreen />);

    // Campus renders rooms by name.
    expect(screen.getAllByText('Library').length).toBeGreaterThan(0);

    // Select the bench student.
    const benchButton = screen.getByTitle('red student');
    fireEvent.click(benchButton);
    expect(useUiStore.getState().selectedMageId).toBe('m-ui-1');

    // Eligible slots glow (data-available) — click one to place.
    const slots = document.querySelectorAll('button[data-available="true"]');
    expect(slots.length).toBeGreaterThan(0);
    fireEvent.click(slots[0]!);

    // Engine accepted the placement; selection cleared; student on board.
    const after = useGameStore.getState().state!;
    expect(useUiStore.getState().selectedMageId).toBeNull();
    expect(useUiStore.getState().lastError).toBeNull();
    const placed = after.players[0]!.mages.find((m) => m.id === 'm-ui-1')!;
    expect(placed.location.kind).toBe('action-space');
  });
});

describe('PromptDirector (step-2 smoke)', () => {
  it('drives target -> reaction cut-in -> choice sheet through a real Burn cast', () => {
    // Build: p1 has Burn researched + mana; p2 has a placed mage to scorch.
    let s = errandsState();
    s = {
      ...s,
      players: s.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            resources: { ...p.resources, mana: 3 },
            ownedSpells: [
              ...p.ownedSpells,
              { cardId: 'base.spell.burn', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
            ],
          };
        }
        return {
          ...p,
          mages: [
            ...p.mages,
            {
              id: 'm-victim',
              cardId: 'base.mage.neutral',
              color: 'off-white',
              location: { kind: 'office', playerId: p.id },
              isShadowing: false,
              isWounded: false,
            },
          ],
        };
      }),
    };
    // Seat the victim on a real slot via the engine's own placement rules:
    const slot = s.rooms
      .find((r) => !r.cannotBePlacedInDirectly && r.actionSpaces.some((sp) => !sp.occupant))!
      .actionSpaces.find((sp) => !sp.occupant)!;
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 1
          ? {
              ...p,
              mages: p.mages.map((m) =>
                m.id === 'm-victim'
                  ? { ...m, location: { kind: 'action-space', spaceId: slot.id } }
                  : m,
              ),
            }
          : p,
      ),
      rooms: s.rooms.map((r) => ({
        ...r,
        actionSpaces: r.actionSpaces.map((sp) =>
          sp.id === slot.id
            ? { ...sp, occupant: { mageId: 'm-victim', ownerId: 'p2', isShadowing: false } }
            : sp,
        ),
      })),
    };

    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null, reactionSlotPick: null });
    render(<GameScreen />);

    // Cast Burn from the spellbook UI: open the tome, pick Level 1.
    fireEvent.click(screen.getByTitle('Burn'));
    const levelButton = screen.getByText(/^L1/).closest('button')!;
    expect(levelButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(levelButton);

    // TargetBanner appears and the victim is lit on the board.
    expect(screen.getAllByText(/decides/).length).toBeGreaterThan(0);
    const targets = screen.getAllByTitle('Choose this student');
    expect(targets.length).toBeGreaterThan(0);
    fireEvent.click(targets[0]!);

    // Reaction window: the cut-in shows for Diana (pass-only window).
    expect(screen.getByText('⚡ Reaction!')).toBeTruthy();
    fireEvent.click(screen.getByText('Continue'));

    // Infirmary bonus choice sheet for the victim's owner.
    const after = useGameStore.getState().state!;
    const top = after.pendingResolutionStack[after.pendingResolutionStack.length - 1];
    if (top) {
      expect(top.prompt.kind).toBe('choose-from-options');
      const sheetButtons = document.querySelectorAll('.pointer-events-auto button');
      expect(sheetButtons.length).toBeGreaterThan(0);
      fireEvent.click(sheetButtons[0]!);
    }

    // Flow settled; the victim took the wound.
    const settled = useGameStore.getState().state!;
    expect(settled.pendingResolutionStack.length).toBe(0);
    const victim = settled.players[1]!.mages.find((m) => m.id === 'm-victim')!;
    expect(victim.isWounded).toBe(true);
    expect(victim.location.kind).toBe('infirmary');
  });
});

describe('Bell Tower + turn hand-off (step-3 smoke)', () => {
  it('claims a bell from the TopBar popover; the turn passes and the banner shows', () => {
    useGameStore.setState({ state: errandsState() });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null, reactionSlotPick: null });
    render(<GameScreen />);

    const before = useGameStore.getState().state!;
    const bellsBefore = before.bellTower.available.length;

    // Open the bell popover and claim the first claimable offering.
    fireEvent.click(screen.getByTitle('Bell Tower offerings remaining this round'));
    const claim = document.querySelector(
      '.absolute.left-0.top-10 button:not([disabled])',
    );
    expect(claim).toBeTruthy();
    fireEvent.click(claim!);

    let after = useGameStore.getState().state!;
    // Some bell cards push a prompt (e.g. gain-resource choice) — settle it.
    for (let i = 0; i < 4 && after.pendingResolutionStack.length > 0; i++) {
      const sheetButton = document.querySelector('.pointer-events-auto button');
      expect(sheetButton).toBeTruthy();
      fireEvent.click(sheetButton!);
      after = useGameStore.getState().state!;
    }

    expect(after.bellTower.available.length).toBe(bellsBefore - 1);
    // Claiming ends the turn — the hand-off banner greets the next player.
    if (after.phase.kind === 'errands') {
      expect(after.phase.activePlayerIndex).toBe(1);
      // Strip chip + hand-off banner both greet Diana.
      expect(screen.getAllByText('Diana').length).toBeGreaterThanOrEqual(2);
    }
  });
});
