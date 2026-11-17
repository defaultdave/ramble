import { describe, expect, it } from 'vitest';
import { scrollRegionTabIndex, scrollsSideways } from './scrollRegion';

// Behaviours under test:
// - a box whose content is wider than the box scrolls sideways; one that fits, or just fills it, does not
// - a region that scrolls is a tab stop whether or not it has focus; one that does not scroll is none, unless it holds focus, when it stays focusable out of the tab order

describe('scrollsSideways', () => {
  it.each([
    [900, 390, true],
    [391, 390, true],
    [390, 390, false],
    [0, 390, false],
  ])(
    'for content %i wide in a box %i wide: %s',
    (scrollWidth, clientWidth, expected) => {
      expect(scrollsSideways({ scrollWidth, clientWidth })).toBe(expected);
    },
  );
});

describe('scrollRegionTabIndex', () => {
  it.each([
    [true, false, 0],
    [true, true, 0],
    [false, true, -1],
    [false, false, undefined],
  ])('scrolls %s, holds focus %s: %s', (scrolls, hasFocus, expected) => {
    expect(scrollRegionTabIndex(scrolls, hasFocus)).toBe(expected);
  });
});
