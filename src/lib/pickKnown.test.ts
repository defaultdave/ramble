import { describe, expect, it } from 'vitest';
import { pickKnown } from './pickKnown';

// Behaviours under test, one per decision, branch or risk:
// - a named allowed value is returned; anything else, including absent, gets the fallback

describe('pickKnown', () => {
  it.each([
    ['a', 'a'],
    ['b', 'b'],
    ['c', null],
    ['A', null],
    ['', null],
    [undefined, null],
    [null, null],
  ])('%j -> %j', (raw, expected) => {
    expect(pickKnown(raw, ['a', 'b'], null)).toBe(expected);
  });

  it('returns a string fallback as given', () => {
    expect(pickKnown('x', ['a'], 'neutral')).toBe('neutral');
  });
});
