import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { logger } = await import('./logger');
  const { withRequestContext } = await import('./requestContext');
  const lines = (spy: typeof out) =>
    spy.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
    );
  return {
    logger,
    withRequestContext,
    stdout: () => lines(out),
    stderr: () => lines(err),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the app logger', () => {
  it('writes info to stdout and warnings and errors to stderr, as JSON lines', async () => {
    const { logger, stdout, stderr } = await load();

    logger.info('hello');
    logger.warn('careful');
    logger.error('broken');

    expect(stdout().map((l) => l.message)).toEqual(['hello']);
    expect(stderr().map((l) => [l.level, l.message])).toEqual([
      ['warn', 'careful'],
      ['error', 'broken'],
    ]);
  });

  it('works with no Sentry or Axiom configured: redacts and carries the request ID', async () => {
    const { logger, withRequestContext, stderr } = await load({
      SENTRY_DSN: undefined,
      AXIOM_TOKEN: undefined,
      AXIOM_DATASET: undefined,
    });

    withRequestContext(new Headers({ 'x-request-id': 'req-5' }), () => {
      logger.error('mail to a@b.co failed', { card: '4242424242424242' });
    });

    expect(stderr()).toEqual([
      expect.objectContaining({
        message: 'mail to [redacted:email] failed',
        requestId: 'req-5',
        fields: { card: '[redacted]' },
      }),
    ]);
  });

  it('keeps a route pattern whole, placeholders included', async () => {
    const { logger, stdout } = await load();

    logger.info('request failed', { route: '/manage/[token]' });

    expect(stdout()[0]?.fields).toEqual({ route: '/manage/[token]' });
  });

  it('stamps the environment', async () => {
    const { logger, stdout } = await load({ VERCEL_ENV: 'preview' });

    logger.info('x');

    expect(stdout()[0]?.environment).toBe('preview');
  });

  it('sends warnings and errors, redacted, to Axiom when it is configured', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{}')),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { logger } = await load({
      AXIOM_TOKEN: 'xaat-test-token',
      AXIOM_DATASET: 'ramble-logs',
    });

    logger.info('not sent');
    logger.error('failed for a@b.co');
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.axiom.co/v1/datasets/ramble-logs/ingest');
    expect(init?.body).not.toContain('a@b.co');
    expect(init?.body).toContain('failed for [redacted:email]');
  });

  it('does not call the network when Axiom is not configured', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    const { logger } = await load({
      AXIOM_TOKEN: undefined,
      AXIOM_DATASET: undefined,
    });

    logger.error('x');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps a line under the size limit whatever it is given', async () => {
    const out = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    vi.resetModules();
    const { logger } = await import('./logger');

    logger.info('big', {
      blob: 'x '.repeat(50_000),
      more: Array(200).fill('y y y y'),
    });

    const line = String(out.mock.calls[0]?.[0]);
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(16_385);
  });
});
