import { describe, expect, it } from 'vitest';
import { secureEqual } from './secureEqual';

// Behaviours under test, one per branch:
// - equal strings match, including non-ASCII ones
// - a different string, a prefix, a longer string, and an empty string each fail without throwing

describe('secureEqual', () => {
  it.each(['secret', 'clé secrète', ''])('matches %j with itself', (value) => {
    expect(secureEqual(value, value)).toBe(true);
  });

  it.each([
    ['a different string', 'secret', 'Secret'],
    ['a prefix', 'secret', 'secre'],
    ['a longer string', 'secret', 'secret!'],
    ['empty against a value', 'secret', ''],
    ['a value against empty', '', 'secret'],
  ])('refuses %s', (_label, a, b) => {
    expect(secureEqual(a, b)).toBe(false);
  });
});
