import * as Sentry from '@sentry/nextjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAlert } from '@/lib/alerts';

type SentEvent = {
  level?: string;
  message?: string;
  fingerprint?: string[];
  environment?: string;
  release?: string;
  tags?: Record<string, string>;
  user?: { ip_address?: string };
  request?: unknown;
  contexts?: {
    alert?: { runbook_url?: string };
    details?: Record<string, unknown>;
  };
  exception?: {
    values: { value: string; stacktrace?: { frames: object[] } }[];
  };
};

// The real SDK runs; only its transport is replaced, so nothing leaves the process and the test
// reads exactly what would have been sent.
const sent = vi.hoisted(() => [] as unknown[]);

vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>();
  const init = (options: Parameters<typeof actual.init>[0]) =>
    actual.init({
      ...options,
      transport: () => ({
        send: (envelope: unknown) => {
          sent.push(envelope);
          return Promise.resolve({});
        },
        flush: () => Promise.resolve(true),
      }),
    });
  return new Proxy(actual, {
    get: (target, property, receiver) =>
      property === 'init'
        ? init
        : (Reflect.get(target, property, receiver) as unknown),
  });
});

const dsn = 'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/1';
const token = 'q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE';

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  sent.length = 0;
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  // Loaded after the reset so both modules share one request context.
  const { withRequestContext } = await import('./requestContext');
  return { ...(await import('./sentry')), withRequestContext };
}

async function events(): Promise<SentEvent[]> {
  await Sentry.flush(1_000);
  return (sent as [unknown, [{ type: string }, SentEvent][]][])
    .flatMap(([, items]) => items)
    .filter(([header]) => header.type === 'event')
    .map(([, payload]) => payload);
}

afterEach(async () => {
  await Sentry.close(100);
  vi.unstubAllEnvs();
});

describe('Sentry wrapper', () => {
  describe('without a DSN', () => {
    it('does not start, and every capture is a no-op that sends nothing', async () => {
      const { initSentry, captureException, captureAlert } = await load({
        SENTRY_DSN: undefined,
      });

      expect(initSentry()).toBe(false);
      expect(() => {
        captureException(new Error('boom'), { extra: { email: 'a@b.co' } });
        captureAlert(
          prepareAlert({ kind: 'ab', severity: 'error', dedupeKey: 'k' }),
          { note: 'x' },
        );
      }).not.toThrow();
      expect(sent).toEqual([]);
    });

    it('treats an empty DSN as not configured', async () => {
      const { initSentry } = await load({ SENTRY_DSN: '' });

      expect(initSentry()).toBe(false);
    });
  });

  describe('with a DSN', () => {
    it('sends an error report carrying the request ID and the environment', async () => {
      const { initSentry, captureException, withRequestContext } = await load({
        SENTRY_DSN: dsn,
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
      });
      expect(initSentry()).toBe(true);

      withRequestContext(new Headers({ 'x-request-id': 'req-77' }), () => {
        captureException(new Error('boom'), {
          tags: { route: '/manage/[token]' },
        });
      });

      const [event] = await events();
      expect(event?.tags).toMatchObject({
        request_id: 'req-77',
        route: '/manage/[token]',
      });
      expect(event?.environment).toBe('preview');
      expect(event?.release).toBe('abc123');
      expect(event?.exception?.values[0]?.value).toBe('boom');
    });

    it('redacts secrets in the error, its context, its breadcrumbs, and its tags', async () => {
      const { initSentry, captureException } = await load({ SENTRY_DSN: dsn });
      initSentry();
      Sentry.addBreadcrumb({
        category: 'fetch',
        message: `GET https://x.example/gift/${token}`,
        data: { to: 'a@b.co' },
      });

      captureException(
        new Error(
          `could not email a@b.co, card 4242 4242 4242 4242, link /manage/${token}`,
        ),
        {
          tags: { who: 'a@b.co' },
          extra: { guestEmail: 'a@b.co', order: { note: `token ${token}` } },
        },
      );

      const all = await events();
      const out = JSON.stringify(all);
      expect(all).toHaveLength(1);
      for (const secret of ['a@b.co', '4242 4242 4242 4242', token]) {
        expect(out).not.toContain(secret);
      }
      expect(out).toContain('could not email [redacted:email]');
    });

    it('never attaches user info, cookies, headers, or local variables on its own', async () => {
      const { initSentry, captureException } = await load({ SENTRY_DSN: dsn });
      initSentry();

      captureException(new Error('boom'));

      const [event] = await events();
      expect(event?.user?.ip_address).toBeUndefined();
      expect(event?.request).toBeUndefined();
      const frames = event?.exception?.values[0]?.stacktrace?.frames ?? [];
      expect(frames.some((frame) => 'vars' in frame)).toBe(false);
    });

    it('opens one issue per alert, grouped by kind and dedupe key, with the runbook link', async () => {
      const { initSentry, captureAlert } = await load({ SENTRY_DSN: dsn });
      initSentry();
      const alert = prepareAlert({
        kind: 'payment-mismatch',
        severity: 'critical',
        dedupeKey: 'order:ord_1',
      });

      captureAlert(alert, { orderId: 'ord_1', guestEmail: 'a@b.co' });

      const [event] = await events();
      expect(event?.level).toBe('fatal');
      expect(event?.message).toBe('payment-mismatch: order:ord_1');
      expect(event?.fingerprint).toEqual(['payment-mismatch', 'order:ord_1']);
      expect(event?.tags).toMatchObject({
        ramble_alert: 'true',
        alert_kind: 'payment-mismatch',
        alert_severity: 'critical',
        runbook:
          'https://github.com/defaultdave/ramble/blob/main/docs/runbooks/payment-mismatch.md',
      });
      expect(event?.contexts?.alert?.runbook_url).toBe(event?.tags?.runbook);
      expect(event?.contexts?.details?.orderId).toBe('ord_1');
      expect(JSON.stringify(event)).not.toContain('a@b.co');
    });

    it('keeps the platform request ID intact in the tag', async () => {
      const { initSentry, captureAlert, withRequestContext } = await load({
        SENTRY_DSN: dsn,
      });
      initSentry();
      const platformId = 'iad1::iad1::bhvbk-1730000000000-4f2a6c8e9b1d';

      withRequestContext(new Headers({ 'x-vercel-id': platformId }), () => {
        captureAlert(
          prepareAlert({ kind: 'ab', severity: 'warning', dedupeKey: 'k' }),
          {},
        );
      });

      expect((await events())[0]?.tags?.request_id).toBe(platformId);
    });
  });
});
