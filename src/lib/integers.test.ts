import { describe, expect, it } from 'vitest';
import { isSafeIntegerInRange, requireIntegerInRange } from './integers';

describe('isSafeIntegerInRange', () => {
  it.each([
    [0, 0, 5, true],
    [5, 0, 5, true],
    [-1, 0, 5, false],
    [6, 0, 5, false],
    [1.5, 0, 5, false],
    [Number.NaN, 0, 5, false],
    [Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY, false],
    [Number.MAX_SAFE_INTEGER + 1, 0, Number.MAX_SAFE_INTEGER + 1, false],
  ])('%s in %s..%s is %s', (value, min, max, expected) => {
    expect(isSafeIntegerInRange(value, min, max)).toBe(expected);
  });

  it('has no upper bound below the safe-integer limit when max is left out', () => {
    expect(isSafeIntegerInRange(Number.MAX_SAFE_INTEGER, 1)).toBe(true);
    expect(isSafeIntegerInRange(0, 1)).toBe(false);
  });
});

describe('requireIntegerInRange', () => {
  it('accepts both bounds', () => {
    expect(() => {
      requireIntegerInRange(0, 0, 3, 'Count');
      requireIntegerInRange(3, 0, 3, 'Count');
    }).not.toThrow();
  });

  it.each([-1, 4, 1.5, Number.NaN])(
    'refuses %s with the named message',
    (value) => {
      expect(() => {
        requireIntegerInRange(value, 0, 3, 'Count');
      }).toThrow(
        new RangeError(
          `Count must be an integer from 0 to 3, got ${String(value)}`,
        ),
      );
    },
  );
});
