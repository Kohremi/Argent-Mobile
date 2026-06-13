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

describe('Advance button (between-turns smoke)', () => {
  it('offers an Advance button between turns and advances the phase on click', () => {
    // A fresh game sits in round-setup — no active player, so the dock shows
    // the between-turns controls instead of a hand.
    const s = initGame({ activePackIds: ['base'], playerNames: ['Akko', 'Diana'], rngSeed: 7 });
    expect(s.phase.kind).toBe('round-setup');
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // The old "use the console to advance" guidance is gone.
    expect(screen.queryByText(/use the console to advance/i)).toBeNull();
    const advance = screen.getByText(/Advance/).closest('button')!;
    fireEvent.click(advance);

    const after = useGameStore.getState().state!;
    expect(after.phase.kind).toBe('errands');
    expect(useUiStore.getState().lastError).toBeNull();
  });
});

describe('Scoring ceremony (step-6 smoke)', () => {
  it('reveals voter awards and crowns the archmage on a completed game', () => {
    // A finished game: force phase complete with revealed voters and give
    // Akko a decisive resource lead so awards have a clear winner.
    let s = errandsState();
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, resources: { ...p.resources, gold: 9, mana: 9, influence: 9 } } : p,
      ),
      voters: s.voters.map((v) => ({ ...v, revealed: true })),
      phase: { kind: 'complete', archmage: 'p1' },
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null, reactionSlotPick: null });
    render(<GameScreen />);

    expect(screen.getByText('The Election')).toBeTruthy();
    // Skip the staged reveal straight to the finale.
    fireEvent.click(screen.getByText('Skip to result'));
    expect(screen.getByText('archmage-elect')).toBeTruthy();
    expect(screen.getByText('New game')).toBeTruthy();
    // Every voter's award row is on screen.
    const state = useGameStore.getState().state!;
    for (const v of state.voters) {
      expect(screen.getAllByText(new RegExp(v.name)).length).toBeGreaterThan(0);
    }
  });
});

describe('Slot tooltip (polish smoke)', () => {
  it('shows the slot effect text on hover', () => {
    useGameStore.setState({ state: errandsState() });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null, reactionSlotPick: null, hoveredSlot: null });
    render(<GameScreen />);

    // Find a slot with a description and hover its wrapper.
    const state = useGameStore.getState().state!;
    const space = state.rooms
      .flatMap((r) => r.actionSpaces)
      .find((sp) => sp.description && sp.description.length > 0)!;
    const circle = document.querySelector(`button[data-available]`)!.parentElement!;
    fireEvent.pointerEnter(circle);
    // The store-driven tooltip is up (any slot's description renders).
    const hovered = useUiStore.getState().hoveredSlot;
    expect(hovered).not.toBeNull();
    // The effect text shows on the room face AND in the hover tooltip.
    expect(
      screen.getAllByText(hovered!.space.description ?? 'No effect text.').length,
    ).toBeGreaterThanOrEqual(2);
    fireEvent.pointerLeave(circle);
    expect(useUiStore.getState().hoveredSlot).toBeNull();
    expect(space).toBeTruthy();
  });
});

describe('Infirmary ward (board smoke)', () => {
  it('renders beds: one open bed, plus a white bed per resting wounded mage', () => {
    let s = errandsState();
    // No wounded mages yet: the ward shows exactly one open bed
    // (side A has no reward slots).
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    const view = render(<GameScreen />);
    expect(document.querySelectorAll('[data-bed="open"]').length).toBe(1);
    expect(document.querySelectorAll('[data-bed="rest"]').length).toBe(0);
    view.unmount();

    // Wound a mage into a numbered ward bed: a rest bed appears beside the
    // open one.
    const woundInto = (st: GameState, bed: string): GameState => ({
      ...st,
      players: st.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              mages: p.mages.map((m) =>
                m.id === 'm-ui-1'
                  ? { ...m, isWounded: true, location: { kind: 'infirmary' as const, bed } }
                  : m,
              ),
            }
          : p,
      ),
    });
    s = woundInto(s, 'bed-1');
    useGameStore.setState({ state: s });
    const view2 = render(<GameScreen />);
    expect(document.querySelectorAll('[data-bed="rest"]').length).toBe(1);
    expect(document.querySelectorAll('[data-bed="open"]').length).toBe(1);
    view2.unmount();

    // Side B buffed bonus taken: the mage's bed is the reward bed id, so it
    // occupies the gold reward bed — no separate white rest bed for them.
    s = {
      ...woundInto(s, '4goldbed'),
      rooms: s.rooms.map((r) =>
        r.name === 'Infirmary'
          ? {
              ...r,
              side: 'B' as const,
              actionSpaces: [
                {
                  id: 'base.room.infirmary.b.slot-1',
                  roomId: r.id,
                  index: 0,
                  slotType: 'regular' as const,
                  occupant: null,
                  effectId: 'base.system.noop',
                  description: 'When wounded: gain 4 Gold and occupy this slot.',
                },
                {
                  id: 'base.room.infirmary.b.slot-2',
                  roomId: r.id,
                  index: 1,
                  slotType: 'regular' as const,
                  occupant: null,
                  effectId: 'base.system.noop',
                  description: 'When wounded: gain 2 Mana and occupy this slot.',
                },
              ],
            }
          : r,
      ),
    };
    useGameStore.setState({ state: s });
    render(<GameScreen />);
    expect(document.querySelectorAll('[data-bed="reward"]').length).toBe(2);
    expect(document.querySelectorAll('[data-bed="rest"]').length).toBe(0);
    expect(document.querySelectorAll('[data-bed="open"]').length).toBe(1);
  });
});

describe('Tableau shelf (board smoke)', () => {
  it('shows the three standing tableaus and temporary reveals under the castle', () => {
    let s = errandsState();
    s = {
      ...s,
      spellTableau: ['base.spell.burn'],
      vaultTableau: ['base.vault.the-arcane-eye'],
      supporterTableau: ['base.supporter.adelaide-chivers'],
      vaultARevealed: ['base.vault.ancient-armor'],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    expect(screen.getByText('Spells on offer')).toBeTruthy();
    expect(screen.getByText('Vault on offer')).toBeTruthy();
    expect(screen.getByText('Supporters on offer')).toBeTruthy();
    // Card faces render with their function text (getAll: the active
    // player's own hand may hold copies of the same cards).
    expect(screen.getAllByText('Gain a Mark.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Gain 2 Research/).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Burn').length).toBeGreaterThan(0);
    // The temporary reveal stall is up while the engine holds cards there.
    expect(screen.getByText('Vault reveal')).toBeTruthy();
    expect(screen.getAllByTitle('Ancient Armor').length).toBeGreaterThan(0);
    // No adventuring pool seeded — no stall.
    expect(screen.queryByText('Adventuring pool')).toBeNull();
  });
});

describe('Hand fans (card-face smoke)', () => {
  it('fans spells, vault items, and supporters with their function on the face', () => {
    let s = errandsState();
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              ownedSpells: [
                ...p.ownedSpells,
                { cardId: 'base.spell.burn', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
              ],
              vaultCards: [...p.vaultCards, { cardId: 'base.vault.the-arcane-eye', exhausted: false }],
              supporters: [...p.supporters, 'base.supporter.adelaide-chivers'],
            }
          : p,
      ),
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // All three fan groups render with the gained cards.
    expect(screen.getByText('spells')).toBeTruthy();
    expect(screen.getByText('vault')).toBeTruthy();
    expect(screen.getByText('allies')).toBeTruthy();
    expect(screen.getByTitle('Burn')).toBeTruthy();

    // Function text is printed on the card faces, not hidden in tooltips.
    // (getAll: the tableau shelf may legitimately offer copies of the same
    // cards on the board below the castle.)
    expect(screen.getAllByText('Gain a Mark.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Gain 2 Research/).length).toBeGreaterThan(0);
    // Spell tomes carry per-level rules text + timing stamps on the face.
    const tome = screen.getByTitle('Burn');
    expect(tome.textContent).toMatch(/Burn/);
    expect(tome.querySelectorAll('[title^="Level"]').length).toBeGreaterThan(0);
    expect(tome.textContent).toMatch(/fast|action|reaction/);
    // Vault/supporter faces stamp their timing next to the card type
    // (the hand card is a button; tableau-shelf copies are display divs).
    const handFace = screen
      .getAllByText('Gain a Mark.')
      .map((el) => el.closest('button'))
      .find(Boolean)!;
    expect(handFace.textContent).toMatch(/treasure.*action/);
  });
});

describe('Privacy flows (peek smoke)', () => {
  it('active player can hold-to-peek a voter they marked; others stay sealed', () => {
    let s = errandsState();
    const hidden = s.voters.filter((v) => !v.revealed && !v.isAlwaysFaceUp);
    expect(hidden.length).toBeGreaterThan(1);
    const mine = hidden[0]!;
    const theirs = hidden[1]!;
    s = {
      ...s,
      voterMarks: [
        { voterId: mine.id, playerId: 'p1' },
        { voterId: theirs.id, playerId: 'p2' },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Only the voter p1 marked offers the peek (it's p1's turn).
    const peekButtons = screen.getAllByTitle('You marked this voter — hold to peek');
    expect(peekButtons.length).toBe(1);
    expect(screen.queryByText(mine.name)).toBeNull();

    fireEvent.pointerDown(peekButtons[0]!);
    expect(screen.getByText(mine.name)).toBeTruthy();
    expect(screen.queryByText(theirs.name)).toBeNull(); // rival's stays sealed

    fireEvent.pointerUp(peekButtons[0]!);
    expect(screen.queryByText(mine.name)).toBeNull();
  });

  it('peeked-supporter prompts hide the cards behind the privacy curtain', () => {
    let s = errandsState();
    const cardIds = s.supporterDeck.slice(0, 2);
    expect(cardIds.length).toBe(2);
    s = {
      ...s,
      pendingResolutionStack: [
        {
          id: 'pr-peek-test',
          responderId: 'p1',
          prompt: { kind: 'choose-peeked-supporter', eligibleCardIds: cardIds },
          resume: { effectId: 'base.system.noop', context: {} },
          source: {
            kind: 'vault-card',
            id: 'test.lantern',
            triggeringPlayerId: 'p1',
            description: 'Mystic Lantern',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null, privacyRevealedForId: null });
    render(<GameScreen />);

    // Curtain up: secret card names are NOT in the DOM.
    expect(screen.getByText(/eyes away/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('choose a Supporter');

    fireEvent.click(screen.getByText('👁 Reveal to me'));
    // Now the sheet shows; picking a card resolves the pending.
    expect(screen.getAllByText(/choose a Supporter/).length).toBeGreaterThan(0);
    const sheetButtons = document.querySelectorAll('.pointer-events-auto button');
    expect(sheetButtons.length).toBeGreaterThan(0);
    fireEvent.click(sheetButtons[0]!);
    expect(useGameStore.getState().state!.pendingResolutionStack.length).toBe(0);
  });

  it('choose-deck shows the top 3 behind a curtain, then hides on Done', () => {
    let s = errandsState();
    s = {
      ...s,
      pendingResolutionStack: [
        {
          id: 'pr-deck-test',
          responderId: 'p1',
          prompt: { kind: 'choose-deck', eligibleDecks: ['supporter'] },
          resume: { effectId: 'base.system.noop', context: {} },
          source: {
            kind: 'spell',
            id: 'test.insight',
            triggeringPlayerId: 'p1',
            description: 'Arcane Insight',
          },
        },
      ],
    };
    const top3 = s.supporterDeck.slice(0, 3);
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null, peek: null, peekRevealed: false });
    render(<GameScreen />);

    // Pick the supporter deck from the sheet.
    fireEvent.click(screen.getByText('supporter deck'));
    // Curtain first — the peeked names are not visible yet.
    expect(screen.getByText('A private glimpse…')).toBeTruthy();
    fireEvent.click(screen.getByText('👁 Reveal to me'));
    // The top-3 names render.
    expect(top3.length).toBe(3);
    expect(screen.getByText(/Top 3 of the supporter deck/)).toBeTruthy();
    fireEvent.click(screen.getByText('Done — hide it'));
    expect(useUiStore.getState().peek).toBeNull();
  });
});
