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

  describe('email settings', () => {
    const resend = {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_key',
      EMAIL_FROM: 'Ramble <hello@ramble.example>',
      EMAIL_REPLY_TO: 'support@ramble.example',
      EMAIL_WEBHOOK_SECRET: `whsec_${'x'.repeat(32)}`,
    };

    function stub(values: Record<string, string | undefined>) {
      for (const [name, value] of Object.entries(values)) {
        vi.stubEnv(name, value);
      }
    }

    it('default to the fake provider in sink mode with nothing set', async () => {
      const env = await loadEnv();

      expect(env).toMatchObject({
        EMAIL_MODE: 'sink',
        EMAIL_PROVIDER: 'fake',
        EMAIL_ALLOWLIST: [],
      });
    });

    it('read a complete Resend setup and an allowlist', async () => {
      stub({
        ...resend,
        EMAIL_MODE: 'allowlist',
        EMAIL_ALLOWLIST: 'A@x.io, @y.io',
      });

      const env = await loadEnv();

      expect(env.EMAIL_PROVIDER).toBe('resend');
      expect(env.EMAIL_ALLOWLIST).toEqual(['a@x.io', '@y.io']);
    });

    it.each([
      [
        'a Resend provider without its key',
        { ...resend, RESEND_API_KEY: undefined },
        'RESEND_API_KEY',
      ],
      [
        'live mode outside production',
        { ...resend, EMAIL_MODE: 'live' },
        'EMAIL_MODE',
      ],
      [
        'live mode with the fake provider',
        {
          EMAIL_MODE: 'live',
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://u:p@h/db',
          DATABASE_URL_UNPOOLED: 'postgres://u:p@h/db',
        },
        'EMAIL_PROVIDER',
      ],
      [
        'allowlist mode with no entries',
        { EMAIL_MODE: 'allowlist' },
        'EMAIL_ALLOWLIST',
      ],
      ['an unknown mode', { EMAIL_MODE: 'everyone' }, 'EMAIL_MODE'],
      ['an unknown provider', { EMAIL_PROVIDER: 'sendgrid' }, 'EMAIL_PROVIDER'],
      [
        'a bad allowlist entry',
        { EMAIL_MODE: 'allowlist', EMAIL_ALLOWLIST: 'nobody' },
        'EMAIL_ALLOWLIST',
      ],
      [
        'a webhook secret under 32 characters',
        { EMAIL_WEBHOOK_SECRET: 'short' },
        'EMAIL_WEBHOOK_SECRET',
      ],
      [
        'a dev mailbox secret under 32 characters',
        { DEV_MAILBOX_SECRET: 'short' },
        'DEV_MAILBOX_SECRET',
      ],
      [
        'a sender with a line break',
        {
          ...resend,
          EMAIL_FROM: 'Ramble\r\nBcc: x@y.io <hello@ramble.example>',
        },
        'EMAIL_FROM',
      ],
    ])('refuse %s', async (_label, values, name) => {
      stub(values);

      await expect(loadEnv()).rejects.toThrow(
        new RegExp(`Invalid environment variables[\\s\\S]*${name}`),
      );
    });

    it('allow live mode in a production deployment with a real provider', async () => {
      stub({
        ...resend,
        EMAIL_MODE: 'live',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@h/db',
        DATABASE_URL_UNPOOLED: 'postgres://u:p@h/db',
        STORAGE_PROVIDER: 'vercel-blob',
        BLOB_PUBLIC_READ_WRITE_TOKEN:
          'vercel_blob_rw_teststore1_notarealsecret',
        BLOB_PRIVATE_READ_WRITE_TOKEN: 'test-private-token',
      });

      const env = await loadEnv();

      expect(env.EMAIL_MODE).toBe('live');
    });

    it('refuse live mode in a Vercel preview even though NODE_ENV is production', async () => {
      stub({
        ...resend,
        EMAIL_MODE: 'live',
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        DATABASE_URL: 'postgres://u:p@h/db',
        DATABASE_URL_UNPOOLED: 'postgres://u:p@h/db',
      });

      await expect(loadEnv()).rejects.toThrow(/EMAIL_MODE/);
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

  describe('storage', () => {
    const publicToken = 'vercel_blob_rw_teststore1_notarealsecret';

    it('refuses the fake in a production deployment', async () => {
      vi.stubEnv('STORAGE_PROVIDER', undefined);
      vi.stubEnv('VERCEL_ENV', 'production');

      await expect(loadEnv()).rejects.toThrow(
        /Invalid environment variables[\s\S]*STORAGE_PROVIDER/,
      );
    });

    it.each(['preview', 'development'])(
      'allows the fake in a %s deployment',
      async (vercelEnv) => {
        vi.stubEnv('STORAGE_PROVIDER', undefined);
        vi.stubEnv('VERCEL_ENV', vercelEnv);

        const env = await loadEnv();

        expect(env.STORAGE_PROVIDER).toBe('fake');
      },
    );

    it('allows the fake with NODE_ENV production when this is not a Vercel deployment (a local build or CI)', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL_ENV', undefined);
      vi.stubEnv('STORAGE_PROVIDER', undefined);
      vi.stubEnv('NEXT_PHASE', 'phase-production-build');

      const env = await loadEnv();

      expect(env.STORAGE_PROVIDER).toBe('fake');
    });

    it('refuses a public token that does not carry a store id', async () => {
      vi.stubEnv('STORAGE_PROVIDER', 'vercel-blob');
      vi.stubEnv('BLOB_PUBLIC_READ_WRITE_TOKEN', 'test-public-token');
      vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', 'test-private-token');

      await expect(loadEnv()).rejects.toThrow(
        /Invalid environment variables[\s\S]*BLOB_PUBLIC_READ_WRITE_TOKEN/,
      );
    });

    it('uses the fake with no keys', async () => {
      vi.stubEnv('STORAGE_PROVIDER', undefined);

      const env = await loadEnv();

      expect(env.STORAGE_PROVIDER).toBe('fake');
    });

    it('treats an empty token from a dashboard as unset', async () => {
      vi.stubEnv('BLOB_PUBLIC_READ_WRITE_TOKEN', '');

      const env = await loadEnv();

      expect(env.BLOB_PUBLIC_READ_WRITE_TOKEN).toBeUndefined();
    });

    it('fails on a provider that does not exist', async () => {
      vi.stubEnv('STORAGE_PROVIDER', 's3');

      await expect(loadEnv()).rejects.toThrow(
        /Invalid environment variables[\s\S]*STORAGE_PROVIDER/,
      );
    });

    it.each([
      ['BLOB_PUBLIC_READ_WRITE_TOKEN', 'BLOB_PRIVATE_READ_WRITE_TOKEN'],
      ['BLOB_PRIVATE_READ_WRITE_TOKEN', 'BLOB_PUBLIC_READ_WRITE_TOKEN'],
    ])('names %s when vercel-blob has only %s', async (missing, given) => {
      vi.stubEnv('STORAGE_PROVIDER', 'vercel-blob');
      vi.stubEnv(given, publicToken);
      vi.stubEnv(missing, undefined);

      await expect(loadEnv()).rejects.toThrow(
        new RegExp(`Invalid environment variables[\\s\\S]*${missing}`),
      );
    });

    it('accepts vercel-blob with both tokens', async () => {
      vi.stubEnv('STORAGE_PROVIDER', 'vercel-blob');
      vi.stubEnv('BLOB_PUBLIC_READ_WRITE_TOKEN', publicToken);
      vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', 'test-private-token');

      const env = await loadEnv();

      expect(env.STORAGE_PROVIDER).toBe('vercel-blob');
    });
  });
});
