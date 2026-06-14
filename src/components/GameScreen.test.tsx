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
import { lookupSpellCardDef, lookupVaultCardDef } from '../game/effects/helpers';
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

describe('Research sheet (visual research smoke)', () => {
  it('renders the tableau + hand as spell cards and drafts on click', () => {
    let s = errandsState();
    const draftTarget = s.spellTableau[0]!;
    const draftName = lookupSpellCardDef(s, draftTarget)!.name;
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              resources: { ...p.resources, intelligence: 1, wisdom: 1 },
              ownedSpells: [
                ...p.ownedSpells,
                {
                  cardId: 'base.spell.burn',
                  intPlaced: true,
                  wisPlacedLevel2: false,
                  wisPlacedLevel3: false,
                  exhausted: false,
                },
              ],
            }
          : p,
      ),
      pendingResolutionStack: [
        {
          id: 'pr-research',
          responderId: 'p1',
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'draft', label: 'Draft a Spell from the tableau (spend 1 INT)', payload: {} },
              { id: 'add-wis', label: 'Place 1 WIS to unlock the next level of an owned Spell', payload: {} },
              { id: 'discard', label: 'Discard 1 Research', payload: {} },
            ],
          },
          resume: { effectId: 'base.system.spend-research', context: {} },
          source: {
            kind: 'system',
            id: 'base.system.spend-research',
            triggeringPlayerId: 'p1',
            description: 'Research',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Visual sheet: section headers + the actual spells as cards (not the
    // old text options like "Draft a Spell from the tableau (spend 1 INT)").
    expect(screen.getByText(/Draft from the tableau/)).toBeTruthy();
    expect(screen.getByText(/Advance an owned spell/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Draft a Spell from the tableau (spend 1 INT)');

    // The tableau card is a clickable button (the board shelf renders the
    // same spell as a non-interactive div); click it to draft in one go.
    const draftButton = screen
      .getAllByTitle(draftName)
      .find((el) => el.tagName === 'BUTTON' && !(el as HTMLButtonElement).disabled)!;
    expect(draftButton).toBeTruthy();
    fireEvent.click(draftButton);

    const after = useGameStore.getState().state!;
    const p1 = after.players[0]!;
    expect(p1.ownedSpells.some((sp) => sp.cardId === draftTarget)).toBe(true);
    expect(p1.resources.intelligence).toBe(0);
    expect(after.pendingResolutionStack.length).toBe(0);
    expect(useUiStore.getState().lastError).toBeNull();
  });

  it('clicking an owned spell advances it to the next level (spend 1 WIS)', () => {
    let s = errandsState();
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              resources: { ...p.resources, intelligence: 0, wisdom: 1 },
              ownedSpells: [
                ...p.ownedSpells,
                {
                  cardId: 'base.spell.burn',
                  intPlaced: true,
                  wisPlacedLevel2: false,
                  wisPlacedLevel3: false,
                  exhausted: false,
                },
              ],
            }
          : p,
      ),
      pendingResolutionStack: [
        {
          id: 'pr-research-wis',
          responderId: 'p1',
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'add-wis', label: 'Place 1 WIS to unlock the next level of an owned Spell', payload: {} },
              { id: 'discard', label: 'Discard 1 Research', payload: {} },
            ],
          },
          resume: { effectId: 'base.system.spend-research', context: {} },
          source: {
            kind: 'system',
            id: 'base.system.spend-research',
            triggeringPlayerId: 'p1',
            description: 'Research',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Scope to the research sheet (the dock also renders a 'Burn' tome).
    const sheet = screen.getByText(/🔬 Research/).closest('.pointer-events-auto') as HTMLElement;
    const burnInSheet = Array.from(sheet.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Burn' && !b.disabled,
    )!;
    expect(burnInSheet).toBeTruthy();
    fireEvent.click(burnInSheet);

    const after = useGameStore.getState().state!;
    const burn = after.players[0]!.ownedSpells.find((sp) => sp.cardId === 'base.spell.burn')!;
    expect(burn.wisPlacedLevel2).toBe(true);
    expect(after.players[0]!.resources.wisdom).toBe(0);
    expect(after.pendingResolutionStack.length).toBe(0);
  });

  it('shows a unique single-level leader spell but disables advancing it', () => {
    let s = errandsState();
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              resources: { ...p.resources, intelligence: 0, wisdom: 1 },
              ownedSpells: [
                ...p.ownedSpells,
                // 3-level spell — advanceable.
                { cardId: 'base.spell.burn', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
                // Unique single-level leader spell — cannot be advanced.
                { cardId: 'base.spell.living-image', intPlaced: true, wisPlacedLevel2: false, wisPlacedLevel3: false, exhausted: false },
              ],
            }
          : p,
      ),
      pendingResolutionStack: [
        {
          id: 'pr-research-unique',
          responderId: 'p1',
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: 'add-wis', label: 'Place 1 WIS to unlock the next level of an owned Spell', payload: {} },
              { id: 'discard', label: 'Discard 1 Research', payload: {} },
            ],
          },
          resume: { effectId: 'base.system.spend-research', context: {} },
          source: {
            kind: 'system',
            id: 'base.system.spend-research',
            triggeringPlayerId: 'p1',
            description: 'Research',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    const sheet = screen.getByText(/🔬 Research/).closest('.pointer-events-auto') as HTMLElement;
    const cardByName = (name: string) =>
      Array.from(sheet.querySelectorAll('button')).find(
        (b) => b.getAttribute('title') === name,
      ) as HTMLButtonElement | undefined;

    const living = cardByName('Living Image');
    const burn = cardByName('Burn');
    // The leader spell is visible but not clickable; the 3-level spell is.
    expect(living).toBeTruthy();
    expect(living!.disabled).toBe(true);
    expect(burn).toBeTruthy();
    expect(burn!.disabled).toBe(false);
  });
});

describe('Research totals (INT/WIS remaining of total)', () => {
  it('shows remaining/total INT and WIS in the dock and on rival cards', () => {
    let s = errandsState();
    const placed = (cardId: string, l2 = false) => ({
      cardId,
      intPlaced: true,
      wisPlacedLevel2: l2,
      wisPlacedLevel3: false,
      exhausted: false,
    });
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              resources: { ...p.resources, intelligence: 2, wisdom: 1 },
              // 3 placed INT, 1 placed WIS → totals 5 INT / 2 WIS.
              ownedSpells: [
                placed('base.spell.burn', true),
                placed('base.spell.wrath-of-heaven'),
                placed('base.spell.will-of-the-divines'),
              ],
            }
          : {
              ...p,
              resources: { ...p.resources, intelligence: 0, wisdom: 0 },
              ownedSpells: [placed('base.spell.burn')], // 1 INT total, 0 WIS
            },
      ),
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Active player's dock: 2 unspent of 5 INT, 1 unspent of 2 WIS.
    expect(screen.getByTitle('INT — 2 unspent of 5 total')).toBeTruthy();
    expect(screen.getByTitle('WIS — 1 unspent of 2 total')).toBeTruthy();
    // Rival card on the left: 0 of 1 INT, 0 of 0 WIS.
    expect(screen.getByTitle('INT — 0 unspent of 1 total')).toBeTruthy();
    expect(screen.getByTitle('WIS — 0 unspent of 0 total')).toBeTruthy();
  });
});

describe('Draft a card from the shelf (tableau targeting smoke)', () => {
  it('clicks a vault tableau card to draft it instead of a text sheet', () => {
    let s = errandsState();
    const target = s.vaultTableau[0]!;
    const targetName = lookupVaultCardDef(s, target)!.name;
    s = {
      ...s,
      pendingResolutionStack: [
        {
          id: 'pr-vault-draft',
          responderId: 'p1',
          prompt: { kind: 'choose-vault-card', eligibleCardIds: [target] },
          resume: { effectId: 'base.system.noop', context: {} },
          source: {
            kind: 'system',
            id: 'base.system.draft-vault',
            triggeringPlayerId: 'p1',
            description: 'Draft a Vault Card',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Banner points at the board; no text option for the card name.
    expect(screen.getByText(/Choose a Vault card on the board/)).toBeTruthy();

    // The shelf card is the clickable draft target (title "Draft <name>").
    const card = screen.getByTitle(`Draft ${targetName}`);
    fireEvent.click(card);
    expect(useGameStore.getState().state!.pendingResolutionStack.length).toBe(0);
    expect(useUiStore.getState().lastError).toBeNull();
  });
});

describe('Draft from the Adventuring pool (shelf targeting smoke)', () => {
  it('clicks a card in the Adventuring pool to draft it', () => {
    let s = errandsState();
    const target = 'base.vault.the-arcane-eye';
    const targetName = lookupVaultCardDef(s, target)!.name;
    s = {
      ...s,
      adventuringBPool: { spells: [], vaultCards: [target], supporters: [] },
      pendingResolutionStack: [
        {
          id: 'pr-adv-draft',
          responderId: 'p1',
          prompt: {
            kind: 'choose-from-options',
            options: [
              { id: `vault::${target}`, label: `Vault: ${targetName}`, payload: {} },
              { id: 'pass', label: 'Pass — forgo this draft', payload: {} },
            ],
          },
          resume: { effectId: 'base.room.adventuring-b.draft', context: {} },
          source: {
            kind: 'system',
            id: 'base.room.adventuring-b.draft',
            triggeringPlayerId: 'p1',
            description: 'Adventuring draft',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Banner points at the pool; the card is the clickable draft target.
    expect(screen.getByText(/Choose a card from the Adventuring pool/)).toBeTruthy();
    fireEvent.click(screen.getByTitle(`Draft ${targetName}`));

    const after = useGameStore.getState().state!;
    expect(after.players[0]!.vaultCards.some((v) => v.cardId === target)).toBe(true);
    expect(after.adventuringBPool?.vaultCards ?? []).not.toContain(target);
    expect(after.pendingResolutionStack.length).toBe(0);
    expect(useUiStore.getState().lastError).toBeNull();
  });
});

describe('Mark a voter (Consortium targeting smoke)', () => {
  it('lights up eligible voters in the right panel and marks one on click', () => {
    let s = errandsState();
    expect(s.voters.length).toBeGreaterThan(1);
    const target = s.voters[0]!;
    const other = s.voters[1]!;
    s = {
      ...s,
      pendingResolutionStack: [
        {
          id: 'pr-mark',
          responderId: 'p1',
          prompt: { kind: 'choose-voter', eligibleVoterIds: [target.id] },
          resume: { effectId: 'base.system.noop', context: {} },
          source: {
            kind: 'system',
            id: 'base.system.gain-mark',
            triggeringPlayerId: 'p1',
            description: 'Gain a Mark',
          },
        },
      ],
    };
    useGameStore.setState({ state: s });
    useUiStore.setState({ selectedMageId: null, debugOpen: false, lastError: null });
    render(<GameScreen />);

    // Banner points at the panel instead of offering a text list.
    expect(screen.getByText(/Choose a voter/)).toBeTruthy();

    // The eligible voter is clickable; the other is not.
    const targetTile = screen.getByTitle(`Mark ${target.name}`);
    expect(screen.queryByTitle(`Mark ${other.name}`)).toBeNull();

    fireEvent.click(targetTile);
    expect(useGameStore.getState().state!.pendingResolutionStack.length).toBe(0);
    expect(useUiStore.getState().lastError).toBeNull();
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
