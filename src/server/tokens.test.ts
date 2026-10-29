import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test, one per decision, branch or risk.
// - derivation: the HMAC-SHA256 of kind:id:version under the secret, base64url, deterministic
// - it differs by kind, id, version, and secret
// - hashToken is the hex SHA-256
// - no secret outside test throws; test has a fixed one
// - resolveToken refuses a token of the wrong shape before it queries
// The database behaviours (resolve, bump, re-hash) are in tests/db/tokens.db.test.ts.

const rowId = '3e1c3a40-0000-4000-8000-000000000001';
const secret = 's'.repeat(40);

async function load() {
  vi.resetModules();
  return import('./tokens');
}

describe('capability tokens', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the base64url HMAC-SHA256 of kind, id, and version under the secret', async () => {
    vi.stubEnv('CAPABILITY_TOKEN_SECRET', secret);
    const { capabilityToken } = await load();

    expect(capabilityToken('manage', rowId, 2)).toBe(
      createHmac('sha256', secret)
        .update(`manage:${rowId}:2`)
        .digest('base64url'),
    );
  });

  it('gives the same token every time', async () => {
    vi.stubEnv('CAPABILITY_TOKEN_SECRET', secret);
    const { capabilityToken } = await load();

    expect(capabilityToken('order', rowId, 1)).toBe(
      capabilityToken('order', rowId.toUpperCase(), 1),
    );
  });

  it('differs by kind, id, version, and secret', async () => {
    vi.stubEnv('CAPABILITY_TOKEN_SECRET', secret);
    const first = await load();
    const tokens = [
      first.capabilityToken('manage', rowId, 1),
      first.capabilityToken('order', rowId, 1),
      first.capabilityToken('manage', rowId.replace(/1$/, '2'), 1),
      first.capabilityToken('manage', rowId, 2),
    ];
    vi.stubEnv('CAPABILITY_TOKEN_SECRET', 't'.repeat(40));
    const second = await load();
    tokens.push(second.capabilityToken('manage', rowId, 1));

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('is 43 characters of base64url', async () => {
    vi.stubEnv('CAPABILITY_TOKEN_SECRET', secret);
    const { capabilityToken } = await load();

    expect(capabilityToken('manage', rowId, 1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes a token to its hex SHA-256', async () => {
    const { hashToken } = await load();

    expect(hashToken('abc')).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
  });

  it('uses the fixed test secret when none is configured under test', async () => {
    vi.stubEnv('CAPABILITY_TOKEN_SECRET', undefined);
    const { capabilityToken } = await load();

    expect(capabilityToken('manage', rowId, 1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each(['development', 'production'])(
    'refuses to make a token with no secret in %s',
    async (nodeEnv) => {
      vi.stubEnv('CAPABILITY_TOKEN_SECRET', undefined);
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/d');
      vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgres://u:p@localhost:5432/d');
      const { capabilityToken } = await load();

      expect(() => capabilityToken('manage', rowId, 1)).toThrow(
        'CAPABILITY_TOKEN_SECRET is not set',
      );
    },
  );

  it.each(['', 'short', `${'A'.repeat(42)}+`, 'A'.repeat(10_000)])(
    'resolves a token of the wrong shape to nothing without a query: %j',
    async (token) => {
      const { resolveToken } = await load();

      await expect(resolveToken('manage', token)).resolves.toBeNull();
    },
  );

  it('resolves an order token with no usable reference to nothing without a query', async () => {
    const { resolveToken } = await load();

    await expect(
      resolveToken('order', 'A'.repeat(43), 'not a reference'),
    ).resolves.toBeNull();
  });
});
