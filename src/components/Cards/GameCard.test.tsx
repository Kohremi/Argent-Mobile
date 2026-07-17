// @vitest-environment happy-dom
// Spell faces: unresearched levels draw locked (in-hand / rival views), offer
// views show everything unlocked, and the zoomed `expanded` mode unclamps
// descriptions so long text can scroll inside the card shape.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SpellCard } from '../../game/types';
import { CardZoom, GameCard, spellFace } from './GameCard';

afterEach(cleanup);

const LONG = 'A very long rules paragraph that would never fit on a thumbnail. '.repeat(4);

function spellDef(overrides?: Partial<SpellCard>): SpellCard {
  return {
    id: 'test.spell.threebook',
    name: 'Threebook',
    sourcePackId: 'base',
    department: 'sorcery',
    levels: [
      { level: 1, title: 'One', manaCost: 0, effectId: 'x', timing: 'action', description: LONG },
      { level: 2, title: 'Two', manaCost: 2, effectId: 'x', timing: 'action', description: LONG },
      { level: 3, title: 'Three', manaCost: 3, effectId: 'x', timing: 'fast', description: LONG },
    ],
    ...overrides,
  } as SpellCard;
}

describe('spellFace research locks', () => {
  it('marks unresearched levels locked when the owner research is passed', () => {
    const face = spellFace(spellDef(), {
      intPlaced: true,
      wisPlacedLevel2: false,
      wisPlacedLevel3: false,
    });
    expect(face.kind).toBe('spell');
    if (face.kind !== 'spell') return;
    expect(face.levels.map((l) => l.locked)).toEqual([false, true, true]);
  });

  it('shows every level unlocked when no research is passed (offer view)', () => {
    const face = spellFace(spellDef());
    if (face.kind !== 'spell') return;
    expect(face.levels.every((l) => l.locked === false)).toBe(true);
  });

  it('never locks a unique leader spell, whatever its flags say', () => {
    const face = spellFace(
      spellDef({ unique: true, levels: spellDef().levels.slice(0, 1) }),
      { intPlaced: false, wisPlacedLevel2: false, wisPlacedLevel3: false },
    );
    if (face.kind !== 'spell') return;
    expect(face.levels[0]!.locked).toBe(false);
  });

  it('renders a lock in place of the level number on locked rows', () => {
    const face = spellFace(spellDef(), {
      intPlaced: true,
      wisPlacedLevel2: false,
      wisPlacedLevel3: false,
    });
    render(<GameCard face={face} />);
    // L2 + L3 locked → two lock badges; L1 keeps its number.
    expect(screen.getAllByTitle('Not yet researched').length).toBe(2);
    expect(screen.getByText('1').textContent).toBe('1');
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.queryByText('3')).toBeNull();
  });
});

describe('GameCard expanded (zoom) mode', () => {
  it('clamps descriptions on thumbnails, unclamps + scrolls when expanded', () => {
    const face = spellFace(spellDef());
    const { container, rerender } = render(<GameCard face={face} />);
    // 3 level descriptions + the banner name (which stays clamped always).
    expect(container.querySelectorAll('.line-clamp-2').length).toBe(4);
    expect(container.querySelector('.overflow-y-auto')).toBeNull();

    rerender(<GameCard face={face} expanded />);
    // Only the banner name clamp remains; the level area scrolls instead.
    expect(container.querySelectorAll('.line-clamp-2').length).toBe(1);
    expect(container.querySelector('.overflow-y-auto')).not.toBeNull();
  });

  it('CardZoom renders its card in expanded mode', () => {
    const face = spellFace(spellDef());
    const { container } = render(<CardZoom face={face} onClose={() => {}} />);
    expect(container.querySelector('.overflow-y-auto')).not.toBeNull();
    expect(container.querySelectorAll('.line-clamp-2').length).toBe(1);
  });
});
