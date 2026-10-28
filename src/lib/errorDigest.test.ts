import { describe, expect, it } from 'vitest';
import { errorDigest } from './errorDigest';

// Behaviours under test, one per decision, branch or risk:
// - an error with a string digest gives the digest
// - an error with no digest, a digest that is not a string, and a thrown value that is not an Error give nothing,
//   and none of them gives the message

describe('errorDigest', () => {
  it('gives the digest of an error that has one', () => {
    expect(
      errorDigest(Object.assign(new Error('secret'), { digest: '12345' })),
    ).toBe('12345');
  });

  it.each([
    ['an error with no digest', new Error('secret')],
    [
      'an error whose digest is not a string',
      Object.assign(new Error('secret'), { digest: 12345 }),
    ],
    ['a string', 'secret'],
    ['an object that only looks like an error', { digest: '12345' }],
    ['nothing', undefined],
  ])('gives nothing for %s', (_name, thrown) => {
    expect(errorDigest(thrown)).toBeUndefined();
  });
});
