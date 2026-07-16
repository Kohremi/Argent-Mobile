// @vitest-environment happy-dom
// The hold-and-swipe gesture: pressing the fan spreads it, sliding the pointer
// previews the card under the finger, and releasing opens the previewed card.
// happy-dom has no layout, so elementFromPoint is stubbed to steer "which card
// is under the finger" per step.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { CardFan, type FanItem } from './CardFan';
import type { CardFace } from './GameCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function vaultLikeFace(name: string): CardFace {
  return {
    kind: 'vault',
    name,
    hue: '#ff9f43',
    typeLabel: 'Treasure',
    glyph: '💎',
    description: `${name} does a thing.`,
  };
}

function makeItems(onOpen: (name: string) => void): FanItem[] {
  return ['Alpha', 'Beta', 'Gamma'].map((name) => ({
    key: name,
    face: vaultLikeFace(name),
    onOpen: () => onOpen(name),
  }));
}

/** Point elementFromPoint at the fan card button with the given index. */
function fingerOver(index: number | null) {
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => {
    if (index == null) return null;
    return document.querySelector(`[data-fan-card="${index}"]`);
  });
}

describe('CardFan hold-and-swipe', () => {
  it('press → swipe across cards → release opens the last previewed card', () => {
    const opened: string[] = [];
    render(<CardFan label="vault" items={makeItems((n) => opened.push(n))} />);
    const fan = document.querySelector('[data-fan-card="0"]')!.parentElement!;

    // Finger lands on the first card: the fan spreads and previews it.
    fingerOver(0);
    fireEvent.pointerDown(fan, { clientX: 10, clientY: 10 });
    // Preview is portalled to the body; the fan's own copy + the preview both
    // carry the card title.
    expect(screen.getAllByTitle('Alpha').length).toBe(2);

    // Swipe across to the third card — the preview follows the finger.
    fingerOver(2);
    fireEvent.pointerMove(fan, { clientX: 60, clientY: 10 });
    expect(screen.getAllByTitle('Gamma').length).toBe(2);
    expect(screen.getAllByTitle('Alpha').length).toBe(1);

    // Release: the previewed card (not the first one pressed) opens.
    fireEvent.pointerUp(fan, { clientX: 60, clientY: 10 });
    expect(opened).toEqual(['Gamma']);
    // The preview is dismissed with the gesture.
    expect(screen.getAllByTitle('Gamma').length).toBe(1);
  });

  it('dragging off the fan before releasing selects nothing', () => {
    const opened: string[] = [];
    render(<CardFan label="vault" items={makeItems((n) => opened.push(n))} />);
    const fan = document.querySelector('[data-fan-card="0"]')!.parentElement!;

    fingerOver(1);
    fireEvent.pointerDown(fan, { clientX: 30, clientY: 10 });
    expect(screen.getAllByTitle('Beta').length).toBe(2);

    // Finger slides off the fan: preview clears, release opens nothing.
    fingerOver(null);
    fireEvent.pointerMove(fan, { clientX: 30, clientY: 300 });
    expect(screen.getAllByTitle('Beta').length).toBe(1);
    fireEvent.pointerUp(fan, { clientX: 30, clientY: 300 });
    expect(opened).toEqual([]);
  });

  it('a scroll-hijack pointercancel collapses without selecting', () => {
    const opened: string[] = [];
    render(<CardFan label="vault" items={makeItems((n) => opened.push(n))} />);
    const fan = document.querySelector('[data-fan-card="0"]')!.parentElement!;

    fingerOver(0);
    fireEvent.pointerDown(fan, { clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(fan);
    fireEvent.pointerUp(fan, { clientX: 10, clientY: 10 });
    expect(opened).toEqual([]);
  });

  it('keyboard activation still opens a card', () => {
    const opened: string[] = [];
    render(<CardFan label="vault" items={makeItems((n) => opened.push(n))} />);
    // Enter/Space on a focused button dispatches a click with detail 0.
    fireEvent.click(document.querySelector('[data-fan-card="1"]')!, { detail: 0 });
    expect(opened).toEqual(['Beta']);
  });
});
