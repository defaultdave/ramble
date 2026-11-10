import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test:
// - a production or preview deployment with no APP_URL set refuses to build the auth, so no link points at localhost
// - the same deployment with APP_URL set builds it

const deployed = (vercelEnv: string) => ({
  NODE_ENV: 'production',
  VERCEL_ENV: vercelEnv,
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  SIGN_IN_LINK_SECRET: 'y'.repeat(40),
});

async function load(vercelEnv: string) {
  vi.resetModules();
  vi.doMock('@/server/env', () => ({ env: deployed(vercelEnv) }));
  return import('./auth');
}

afterEach(() => {
  vi.doUnmock('@/server/env');
  vi.unstubAllEnvs();
});

describe('getAuth', () => {
  it.each(['production', 'preview'])(
    'throws on %s when APP_URL is not set',
    async (vercelEnv) => {
      vi.stubEnv('APP_URL', '');
      const { getAuth } = await load(vercelEnv);

      expect(() => getAuth()).toThrow('APP_URL is not set');
    },
  );

  it('builds when APP_URL is set', async () => {
    vi.stubEnv('APP_URL', 'https://ramble.example');
    const { getAuth } = await load('production');

    expect(() => getAuth()).not.toThrow();
  });
});
