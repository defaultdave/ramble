import { describe, expect, it } from 'vitest';
import {
  capabilityTokenKinds,
  capabilityTokenMessage,
  isCapabilityTokenShape,
  isTokenHash,
  maxTokenVersion,
  nextTokenVersion,
  pickCapabilityTokenSecret,
  storesHash,
} from './capabilityTokens';

// Behaviours under test, one per decision, branch or risk.
// - the message the HMAC covers: unique per kind, id, and version; refuses a bad id or version
// - which kinds store a hash
// - token and hash shapes, checked before any lookup and bounded
// - the next version: plus one, refused at the integer limit
// - the secret: configured, fixed only in test, none elsewhere

const rowId = '3e1c3a40-0000-4000-8000-000000000001';

describe('capabilityTokenMessage', () => {
  it('covers the kind, the lower-cased id, and the version', () => {
    expect(capabilityTokenMessage('manage', rowId.toUpperCase(), 3)).toBe(
      `manage:${rowId}:3`,
    );
  });

  it('differs for every kind', () => {
    const messages = capabilityTokenKinds.map((kind) =>
      capabilityTokenMessage(kind, rowId, 1),
    );
    expect(new Set(messages).size).toBe(capabilityTokenKinds.length);
  });

  it.each([0, -1, 1.5, Number.NaN, maxTokenVersion + 1])(
    'refuses version %s',
    (version) => {
      expect(() => capabilityTokenMessage('manage', rowId, version)).toThrow(
        RangeError,
      );
    },
  );

  it.each(['', 'not-a-uuid', `${rowId}:2`])('refuses id %j', (id) => {
    expect(() => capabilityTokenMessage('manage', id, 1)).toThrow(RangeError);
  });
});

describe('storesHash', () => {
  it.each([
    ['manage', true],
    ['order', false],
  ] as const)('%s stores a hash: %s', (kind, expected) => {
    expect(storesHash(kind)).toBe(expected);
  });
});

describe('token shapes', () => {
  it.each([
    ['43 base64url characters', 'A'.repeat(42) + '_', true],
    ['with a hyphen', `${'a'.repeat(42)}-`, true],
    ['42 characters', 'A'.repeat(42), false],
    ['44 characters', 'A'.repeat(44), false],
    ['a plus sign', `${'A'.repeat(42)}+`, false],
    ['padding', `${'A'.repeat(42)}=`, false],
    ['empty', '', false],
    ['unbounded', 'A'.repeat(1_000_000), false],
  ])('judges a token of %s', (_name, token, expected) => {
    expect(isCapabilityTokenShape(token)).toBe(expected);
  });

  it.each([
    ['64 hex characters', 'a1'.repeat(32), true],
    ['upper case', 'A1'.repeat(32), false],
    ['63 characters', 'a'.repeat(63), false],
    ['65 characters', 'a'.repeat(65), false],
    ['non-hex', 'g'.repeat(64), false],
  ])('judges a hash of %s', (_name, hash, expected) => {
    expect(isTokenHash(hash)).toBe(expected);
  });
});

describe('nextTokenVersion', () => {
  it('adds one', () => {
    expect(nextTokenVersion(1)).toBe(2);
    expect(nextTokenVersion(maxTokenVersion - 1)).toBe(maxTokenVersion);
  });

  it('refuses to pass the integer limit', () => {
    expect(() => nextTokenVersion(maxTokenVersion)).toThrow(RangeError);
  });

  it.each([0, 1.5])('refuses the current version %s', (version) => {
    expect(() => nextTokenVersion(version)).toThrow(RangeError);
  });
});

describe('pickCapabilityTokenSecret', () => {
  it.each(['development', 'test', 'production'] as const)(
    'uses the configured secret in %s',
    (nodeEnv) => {
      expect(pickCapabilityTokenSecret('configured-secret', nodeEnv)).toBe(
        'configured-secret',
      );
    },
  );

  it('falls back to a fixed secret in test only', () => {
    expect(pickCapabilityTokenSecret(undefined, 'test')).toMatch(/^test-only-/);
  });

  it.each(['development', 'production'] as const)(
    'has none in %s, so the caller refuses',
    (nodeEnv) => {
      expect(pickCapabilityTokenSecret(undefined, nodeEnv)).toBeNull();
      expect(pickCapabilityTokenSecret('', nodeEnv)).toBeNull();
    },
  );
});
