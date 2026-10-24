import { describe, expect, it } from 'vitest';
import { stepperLimits, steppedValue } from './stepper';

describe('stepperLimits', () => {
  it.each([
    { value: 0, min: 0, max: 8, expected: { atMin: true, atMax: false } },
    { value: 3, min: 0, max: 8, expected: { atMin: false, atMax: false } },
    { value: 8, min: 0, max: 8, expected: { atMin: false, atMax: true } },
    { value: 2, min: 2, max: 2, expected: { atMin: true, atMax: true } },
    { value: -1, min: 0, max: 8, expected: { atMin: true, atMax: false } },
  ])('value $value in $min to $max', ({ value, min, max, expected }) => {
    expect(stepperLimits(value, min, max)).toEqual(expected);
  });
});

describe('steppedValue', () => {
  it.each([
    { value: 3, delta: 1, expected: 4 },
    { value: 3, delta: -1, expected: 2 },
    { value: 8, delta: 1, expected: 8 },
    { value: 0, delta: -1, expected: 0 },
  ])('$value moved by $delta is $expected', ({ value, delta, expected }) => {
    expect(steppedValue(value, delta, 0, 8)).toBe(expected);
  });
});
