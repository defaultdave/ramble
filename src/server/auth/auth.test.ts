import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test:
// - a production or preview deployment with no APP_URL set refuses to build the auth, so no link points at localhost
// - the same deployment with APP_URL set builds it

async function load(vercelEnv: string, appUrlConfigured: boolean) {
  vi.resetModules();
  vi.doMock('@/server/env', () => ({
    appUrlConfigured,
    env: {
      NODE_ENV: 'production',
      VERCEL_ENV: vercelEnv,
      APP_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      SIGN_IN_LINK_SECRET: 'y'.repeat(40),
    },
  }));
  return import('./auth');
}

afterEach(() => {
  vi.doUnmock('@/server/env');
});

describe('getAuth', () => {
  it.each(['production', 'preview'])(
    'throws on %s when APP_URL is not set',
    async (vercelEnv) => {
      const { getAuth } = await load(vercelEnv, false);

      expect(() => getAuth()).toThrow('APP_URL is not set');
    },
  );

  it('builds when APP_URL is set', async () => {
    const { getAuth } = await load('production', true);

    expect(() => getAuth()).not.toThrow();
  });
});
