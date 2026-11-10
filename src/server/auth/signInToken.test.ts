import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test:
// - the stored form of a token is a 64-digit lower-case hex string that does not contain the token
// - the same token and secret give the same value; another secret gives another value, so a rotation voids waiting links
// - in production with no secret configured it throws rather than hashing under a known key

const token = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf';

async function load(env: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@/server/env', () => ({ env }));
  return import('./signInToken');
}

afterEach(() => {
  vi.doUnmock('@/server/env');
});

describe('hashSignInToken', () => {
  it('stores hex that does not hold the token', async () => {
    const { hashSignInToken } = await load({ NODE_ENV: 'test' });

    const stored = await hashSignInToken(token);

    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
  });

  it('is stable for one secret and different for another', async () => {
    const first = await load({
      NODE_ENV: 'production',
      SIGN_IN_LINK_SECRET: 'a'.repeat(40),
    });
    const again = await first.hashSignInToken(token);
    const second = await load({
      NODE_ENV: 'production',
      SIGN_IN_LINK_SECRET: 'b'.repeat(40),
    });

    expect(await first.hashSignInToken(token)).toBe(again);
    expect(await second.hashSignInToken(token)).not.toBe(again);
  });

  it('throws in production when no secret is set', async () => {
    const { hashSignInToken } = await load({ NODE_ENV: 'production' });

    await expect(hashSignInToken(token)).rejects.toThrow('SIGN_IN_LINK_SECRET');
  });
});
