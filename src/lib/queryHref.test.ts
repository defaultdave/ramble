import { describe, expect, it } from 'vitest';
import { hrefWithQuery } from './queryHref';

// Behaviours under test, one per decision, branch or risk:
// - no pairs gives the bare path, with no `?`
// - pairs keep their order, a repeated name survives, and values are encoded

describe('hrefWithQuery', () => {
  it.each([
    [[], '/p'],
    [[['a', '1']], '/p?a=1'],
    [
      [
        ['tag', 'x'],
        ['tag', 'y'],
        ['q', 'a&b c'],
      ],
      '/p?tag=x&tag=y&q=a%26b+c',
    ],
  ] as const)('%j -> %s', (entries, expected) => {
    expect(hrefWithQuery('/p', entries)).toBe(expected);
  });
});
