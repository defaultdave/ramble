import { describe, expect, it } from 'vitest';
import { timeSlotState } from './timeSlot';

describe('timeSlotState', () => {
  it.each([
    { spacesLeft: 8, selected: false, expected: 'open' },
    { spacesLeft: 2, selected: false, expected: 'few-left' },
    { spacesLeft: 0, selected: false, expected: 'sold-out' },
    { spacesLeft: 8, selected: true, expected: 'selected' },
    { spacesLeft: 2, selected: true, expected: 'selected' },
    { spacesLeft: 0, selected: true, expected: 'sold-out' },
  ])(
    '$spacesLeft left, selected $selected is $expected',
    ({ spacesLeft, selected, expected }) => {
      expect(timeSlotState(spacesLeft, selected)).toBe(expected);
    },
  );
});
