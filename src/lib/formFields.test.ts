import { describe, expect, it } from 'vitest';
import { readTextFields } from './formFields';

// Behaviours under test:
// - text fields are read as sent, untrimmed
// - a file, null or missing field reads as empty
// - a value over the limit is kept one character over, never emptied, so validation can refuse it
// - a value at the limit is kept whole

const fields = ['a', 'b'] as const;

describe('readTextFields', () => {
  it('reads strings as sent and anything else as empty', () => {
    const sent: Record<string, unknown> = {
      a: ' x ',
      b: new File(['x'], 'x.txt'),
    };
    expect(readTextFields(fields, (f) => sent[f], 10)).toEqual({
      a: ' x ',
      b: '',
    });
    expect(readTextFields(fields, () => null, 10)).toEqual({ a: '', b: '' });
  });

  it.each([
    ['at the limit', 10, 10],
    ['over the limit', 11, 11],
    ['far over the limit', 500, 11],
  ])('keeps a value %s', (_name, length, kept) => {
    const value = 'x'.repeat(length);
    expect(readTextFields(['a'], () => value, 10).a).toHaveLength(kept);
  });
});
