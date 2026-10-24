import { describe, expect, it } from 'vitest';
import { ratingDescription, ratingLabel } from './rating';

describe('ratingLabel', () => {
  it.each([
    { average: 4.9, count: 12, expected: '4.9 (12)' },
    { average: 5, count: 5, expected: '5.0 (5)' },
    { average: 4.84, count: 230, expected: '4.8 (230)' },
    { average: 4.9, count: 4, expected: null },
    { average: 0, count: 0, expected: null },
  ])(
    'average $average from $count reviews is $expected',
    ({ average, count, expected }) => {
      expect(ratingLabel({ average, count })).toBe(expected);
    },
  );
});

describe('ratingDescription', () => {
  it.each([
    {
      average: 4.9,
      count: 12,
      expected: 'Rated 4.9 out of 5 from 12 reviews',
    },
    { average: 5, count: 5, expected: 'Rated 5.0 out of 5 from 5 reviews' },
    { average: 4.9, count: 4, expected: null },
  ])(
    'average $average from $count reviews is $expected',
    ({ average, count, expected }) => {
      expect(ratingDescription({ average, count })).toBe(expected);
    },
  );
});
