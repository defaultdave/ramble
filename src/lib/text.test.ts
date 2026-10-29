import { describe, expect, it } from 'vitest';
import {
  everyJsonNode,
  isStorableJson,
  notBlankPattern,
  requiredText,
} from './text';

// Behaviours under test, one per decision, branch or risk.
// - blank means exactly what JavaScript's \s matches: every one of the 65,536 UTF-16 units agrees with /\S/,
//   and U+00A0 and U+FEFF alone are blank (Postgres [[:space:]] would call them text)
// - everyJsonNode visits keys, strings, and children, stops at the first false, and handles a very wide array

describe('blank text', () => {
  it('agrees with /\\S/ on every UTF-16 unit', () => {
    const regex = new RegExp(notBlankPattern);
    const disagreements: number[] = [];
    for (let unit = 0; unit <= 0xffff; unit += 1) {
      const character = String.fromCharCode(unit);
      if (regex.test(character) !== /\S/.test(character)) {
        disagreements.push(unit);
      }
    }

    expect(disagreements).toEqual([]);
  });

  it.each([
    ['U+00A0', ' '],
    ['U+FEFF', '﻿'],
    ['U+2028', ' '],
    ['U+3000', '　'],
    ['a space', ' '],
    ['empty', ''],
    ['a run of mixed blanks', ' \t ﻿\n'],
  ])('refuses %s as required text', (_name, value) => {
    expect(requiredText(10).safeParse(value).success).toBe(false);
  });

  it.each([
    ['a letter among blanks', ' a﻿'],
    ['U+0085, which \\s does not match', '\u0085'],
    ['a zero-width space, which \\s does not match', '​'],
  ])('accepts %s', (_name, value) => {
    expect(requiredText(10).safeParse(value).success).toBe(true);
  });
});

describe('everyJsonNode', () => {
  it('visits the value, each key, and each child', () => {
    const seen: unknown[] = [];
    everyJsonNode({ a: [1, 'x'] }, (node) => {
      seen.push(node);
      return true;
    });

    expect(seen).toEqual(
      expect.arrayContaining([{ a: [1, 'x'] }, 'a', [1, 'x'], 1, 'x']),
    );
    expect(seen).toHaveLength(5);
  });

  it('stops at the first node the visitor refuses', () => {
    let visits = 0;
    const result = everyJsonNode([1, 2, 3], (node) => {
      visits += 1;
      return node !== 2;
    });

    expect(result).toBe(false);
    expect(visits).toBeLessThan(5);
  });

  it('walks an array far wider than the argument limit without throwing', () => {
    const wide = new Array<number>(500_000).fill(1);

    expect(isStorableJson({ data: wide })).toBe(true);
  });
});
