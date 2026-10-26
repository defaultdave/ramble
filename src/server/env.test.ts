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

  describe('email settings', () => {
    const resend = {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_key',
      EMAIL_FROM: 'Ramble <hello@ramble.example>',
      EMAIL_REPLY_TO: 'support@ramble.example',
      EMAIL_WEBHOOK_SECRET: 'whsec_0123456789abcdef0123456789abcdef',
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
});
