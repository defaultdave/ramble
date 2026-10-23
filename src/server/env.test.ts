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
});
