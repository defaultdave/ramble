import { describe, expect, it } from 'vitest';
import { requireEnv } from './requireEnv';

describe('requireEnv', () => {
  it('returns a value that is set', () => {
    expect(requireEnv('abc', 'THING_TOKEN')).toBe('abc');
  });

  it('names the missing setting', () => {
    expect(() => requireEnv(undefined, 'THING_TOKEN')).toThrow(
      'THING_TOKEN is not set',
    );
  });
});
