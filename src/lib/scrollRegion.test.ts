import { describe, expect, it } from 'vitest';
import { scrollsSideways } from './scrollRegion';

// Behaviours under test:
// - a box whose content is wider than the box scrolls sideways; one that fits, or just fills it, does not

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
