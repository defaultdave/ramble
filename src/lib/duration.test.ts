import { describe, expect, it } from 'vitest';
import { durationLabel } from './duration';

// Behaviours under test, one per decision, branch or risk:
// - a duration reads as minutes, hours, or half hours, and falls back to hours and minutes
// - a no-break space joins each number to its unit, so a narrow card cannot split "2" from "hr";
//   the space between hours and minutes may still break

describe('durationLabel', () => {
  it.each([
    [45, '45\u00a0min'],
    [59, '59\u00a0min'],
    [60, '1\u00a0hr'],
    [90, '1.5\u00a0hr'],
    [120, '2\u00a0hr'],
    [150, '2.5\u00a0hr'],
    [135, '2\u00a0hr 15\u00a0min'],
    [1440, '24\u00a0hr'],
  ])('writes %i minutes as %s', (minutes, label) => {
    expect(durationLabel(minutes)).toBe(label);
  });

  it('breaks only between the hours and the minutes', () => {
    expect(durationLabel(135).split(' ')).toEqual(['2\u00a0hr', '15\u00a0min']);
  });
});
