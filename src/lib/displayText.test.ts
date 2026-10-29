import { describe, expect, it } from 'vitest';
import { presentText, textLines } from './displayText';

// Behaviours under test, one per decision, branch or risk:
// - presentText trims the ends, and is null for no text or only blanks
// - textLines has one trimmed entry per non-blank line, and none for no text

describe('presentText', () => {
  it.each([
    ['text', 'Meet at the pier', 'Meet at the pier'],
    ['padded text', '  Meet at the pier \n', 'Meet at the pier'],
    ['inner spacing', 'Pier 4,  east gate', 'Pier 4,  east gate'],
    ['blank text', ' \t\n ', null],
    ['empty text', '', null],
    ['no text', null, null],
  ])('%s', (_name, value, expected) => {
    expect(presentText(value)).toBe(expected);
  });
});

describe('textLines', () => {
  it('has one entry per non-blank line, trimmed', () => {
    expect(textLines('  one \n\n two\n   \nthree')).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it.each([null, '', '  \n \n'])('has none for %j', (value) => {
    expect(textLines(value)).toEqual([]);
  });
});
