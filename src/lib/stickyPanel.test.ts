import { describe, expect, it } from 'vitest';
import { stickyTop } from './stickyPanel';

// Behaviours under test, one per decision or branch:
// - a panel that fits the window sticks at the offset whatever the scroll
// - a taller panel moves up with a downward scroll, and down with an upward one, by the same distance
// - going down it stops with its bottom edge the offset above the window's bottom
// - going up it stops with its top edge at the offset
// - no scroll leaves it where it was, so a panel that grows does not jump
// - a panel that shrinks while stuck low is pulled back inside the range
const base = { viewportHeight: 800, panelHeight: 1000, offset: 24 };
// The panel's top when its bottom edge is at the lowest allowed: 800 - 1000 - 24.
const lowest = -224;

describe('stickyTop', () => {
  it.each([
    [0, 0],
    [500, 300],
    [-500, 50],
  ])(
    'keeps a panel that fits at the offset (%i, scroll %i)',
    (previousTop, scrollDelta) => {
      expect(
        stickyTop({ ...base, panelHeight: 700, previousTop, scrollDelta }),
      ).toBe(24);
    },
  );

  it('treats a panel that fills the window exactly as fitting', () => {
    expect(
      stickyTop({
        ...base,
        panelHeight: 752,
        previousTop: 24,
        scrollDelta: 90,
      }),
    ).toBe(24);
  });

  it.each([
    ['down', 24, 100, -76],
    ['up', -100, -60, -40],
  ])(
    'moves with the page when scrolling %s',
    (_, previousTop, scrollDelta, top) => {
      expect(stickyTop({ ...base, previousTop, scrollDelta })).toBe(top);
    },
  );

  it('stops with the bottom edge above the window bottom when scrolling down', () => {
    expect(stickyTop({ ...base, previousTop: -200, scrollDelta: 500 })).toBe(
      lowest,
    );
  });

  it('stops with the top edge at the offset when scrolling up', () => {
    expect(stickyTop({ ...base, previousTop: -30, scrollDelta: -500 })).toBe(
      24,
    );
  });

  it('stays put without a scroll, so growth does not move the panel', () => {
    const before = stickyTop({ ...base, previousTop: -100, scrollDelta: 0 });
    const grown = stickyTop({
      ...base,
      panelHeight: 1100,
      previousTop: before,
      scrollDelta: 0,
    });
    expect(grown).toBe(before);
  });

  it('pulls a stuck-low panel back inside the range when it shrinks', () => {
    expect(
      stickyTop({
        ...base,
        panelHeight: 900,
        previousTop: lowest,
        scrollDelta: 0,
      }),
    ).toBe(-124);
  });
});
