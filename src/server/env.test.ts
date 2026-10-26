import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadEnv() {
  vi.resetModules();
  return (await import('./env')).env;
}

describe('environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads valid values', async () => {
    vi.stubEnv('APP_URL', 'https://ramble.example');

    const env = await loadEnv();

    expect(env.APP_URL).toBe('https://ramble.example');
  });

  it('falls back to the local origin when APP_URL is unset', async () => {
    vi.stubEnv('APP_URL', undefined);

    const env = await loadEnv();

    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it.each([
    ['APP_URL', 'not a url'],
    ['NODE_ENV', 'staging'],
  ])('fails at import when %s is %j', async (name, value) => {
    vi.stubEnv(name, value);

    await expect(loadEnv()).rejects.toThrow(
      new RegExp(`Invalid environment variables[\\s\\S]*${name}`),
    );
  });

  describe('FORM_GUARD_SECRET', () => {
    it('is optional', async () => {
      vi.stubEnv('FORM_GUARD_SECRET', undefined);

      const env = await loadEnv();

      expect(env.FORM_GUARD_SECRET).toBeUndefined();
    });

    it('is read when long enough', async () => {
      vi.stubEnv('FORM_GUARD_SECRET', 's'.repeat(32));

      const env = await loadEnv();

      expect(env.FORM_GUARD_SECRET).toBe('s'.repeat(32));
    });

    it.each([
      ['short', 's'.repeat(31)],
      ['empty', ''],
    ])('fails at import when %s', async (_name, value) => {
      vi.stubEnv('FORM_GUARD_SECRET', value);

      await expect(loadEnv()).rejects.toThrow(/FORM_GUARD_SECRET/);
    });
  });

  describe('database URLs', () => {
    const pooled = 'postgres://u:p@host-pooler.neon.tech/db';
    const direct = 'postgresql://u:p@host.neon.tech/db';

    it('are optional under test', async () => {
      vi.stubEnv('DATABASE_URL', undefined);
      vi.stubEnv('DATABASE_URL_UNPOOLED', undefined);

      const env = await loadEnv();

      expect(env.DATABASE_URL).toBeUndefined();
    });

    it('are read when set', async () => {
      vi.stubEnv('DATABASE_URL', pooled);
      vi.stubEnv('DATABASE_URL_UNPOOLED', direct);

      const env = await loadEnv();

      expect(env.DATABASE_URL).toBe(pooled);
      expect(env.DATABASE_URL_UNPOOLED).toBe(direct);
    });

    it.each(['DATABASE_URL', 'DATABASE_URL_UNPOOLED'])(
      'are required outside test: %s',
      async (missing) => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('DATABASE_URL', pooled);
        vi.stubEnv('DATABASE_URL_UNPOOLED', direct);
        vi.stubEnv(missing, undefined);

        await expect(loadEnv()).rejects.toThrow(
          new RegExp(`Invalid environment variables[\\s\\S]*${missing}`),
        );
      },
    );

    it('are not required while next build runs', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PHASE', 'phase-production-build');
      vi.stubEnv('DATABASE_URL', undefined);
      vi.stubEnv('DATABASE_URL_UNPOOLED', undefined);

      const env = await loadEnv();

      expect(env.DATABASE_URL).toBeUndefined();
    });

    it('must be Postgres URLs', async () => {
      vi.stubEnv('DATABASE_URL', 'https://example.com/db');

      await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
    });
  });

  describe('monitoring', () => {
    const dsn =
      'https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/2';
    const names = [
      'SENTRY_DSN',
      'SENTRY_BROWSER_DSN',
      'AXIOM_TOKEN',
      'AXIOM_DATASET',
      'VERCEL_ENV',
      'VERCEL_GIT_COMMIT_SHA',
    ] as const;

    it('is entirely optional', async () => {
      for (const name of names) vi.stubEnv(name, undefined);

      const env = await loadEnv();

      for (const name of names) expect(env[name]).toBeUndefined();
    });

    it.each(names)('reads an empty %s as not set', async (name) => {
      vi.stubEnv(name, '');

      const env = await loadEnv();

      expect(env[name]).toBeUndefined();
    });

    it('reads both DSNs and the Axiom pair when set', async () => {
      vi.stubEnv('SENTRY_DSN', dsn);
      vi.stubEnv('SENTRY_BROWSER_DSN', dsn);
      vi.stubEnv('AXIOM_TOKEN', 'xaat-0123456789');
      vi.stubEnv('AXIOM_DATASET', 'ramble-logs');
      vi.stubEnv('VERCEL_ENV', 'preview');

      const env = await loadEnv();

      expect(env).toMatchObject({
        SENTRY_DSN: dsn,
        SENTRY_BROWSER_DSN: dsn,
        AXIOM_TOKEN: 'xaat-0123456789',
        AXIOM_DATASET: 'ramble-logs',
        VERCEL_ENV: 'preview',
      });
    });

    it.each([
      ['SENTRY_DSN', 'not a url'],
      ['SENTRY_DSN', 'http://key@o1.ingest.sentry.io/2'],
      ['SENTRY_BROWSER_DSN', 'ftp://key@host/1'],
      ['AXIOM_DATASET', 'has space'],
      ['AXIOM_DATASET', 'a'.repeat(129)],
      ['AXIOM_TOKEN', 'short'],
      ['AXIOM_TOKEN', 'has space in it'],
      ['VERCEL_ENV', 'staging'],
    ])('fails at import when %s is %j', async (name, value) => {
      vi.stubEnv('AXIOM_TOKEN', 'xaat-0123456789');
      vi.stubEnv('AXIOM_DATASET', 'ramble-logs');
      vi.stubEnv(name, value);

      await expect(loadEnv()).rejects.toThrow(
        new RegExp(`Invalid environment variables[\\s\\S]*${name}`),
      );
    });

    it.each([
      ['AXIOM_TOKEN', 'AXIOM_DATASET'],
      ['AXIOM_DATASET', 'AXIOM_TOKEN'],
    ])('fails when only %s is set, naming %s', async (given, missing) => {
      vi.stubEnv('AXIOM_TOKEN', undefined);
      vi.stubEnv('AXIOM_DATASET', undefined);
      vi.stubEnv(
        given,
        given === 'AXIOM_TOKEN' ? 'xaat-0123456789' : 'ramble-logs',
      );

      await expect(loadEnv()).rejects.toThrow(
        new RegExp(`Invalid environment variables[\\s\\S]*${missing}`),
      );
    });
  });
});
