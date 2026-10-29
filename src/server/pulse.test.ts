import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PURGE_BATCH, purgeExpiredRateLimits } from '@/server/db/rateLimits';
import { drainJobs } from '@/server/jobs/drain';
import { sendHeartbeat } from '@/server/monitoring/heartbeat';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { pulseResponse } from './pulse';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/jobs/drain', () => ({ drainJobs: vi.fn() }));
vi.mock('@/server/db/rateLimits', () => ({
  PURGE_BATCH: 1000,
  purgeExpiredRateLimits: vi.fn(),
}));
vi.mock('@/server/monitoring/heartbeat', () => ({ sendHeartbeat: vi.fn() }));
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk:
// - any method but POST gets 401 and does no work, even with the right secret
// - with no PULSE_SECRET configured, a missing header, a wrong secret, or the wrong scheme gets 401 and does no work
// - each of those is counted on the failure counter against the caller's own address (first x-forwarded-for entry, else "unknown")
// - a source past the failure limit gets 429 with Retry-After and does no work
// - a right secret is never counted on the failure counter, and is counted on the shared pulse cap; over the cap gets 429 and no work
// - a limiter store failure is thrown, not let through
// - a body over 1 KB (declared or streamed) gets 413, and a body that is not { asOf } gets 400, before any work
// - asOf while DEMO_CLOCK is off, or beyond 400 days, gets 400 and no work
// - a plain pulse drains on the system clock, purges until a short batch, pings the heartbeat once, and answers counts only
// - asOf with DEMO_CLOCK on drains on a clock fixed at asOf and sends no heartbeat
// - a drain or purge failure is thrown and sends no heartbeat
// - a heartbeat that fails does not fail the pulse

// The clock rule bans Date.now() here too; this reads the same instant.
const realNowMs = () => performance.timeOrigin + performance.now();
const secret = 's'.repeat(40);
const url = 'http://localhost/api/pulse';
const allowed = { allowed: true, remaining: 1 } as const;
const report = {
  claimed: 3,
  succeeded: 2,
  retried: 1,
  dead: 0,
  unrecorded: 0,
  left: 4,
};

function post(body = '', headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    body: body === '' ? null : body,
    headers: { authorization: `Bearer ${secret}`, ...headers },
  });
}

function expectNoWork() {
  expect(drainJobs).not.toHaveBeenCalled();
  expect(purgeExpiredRateLimits).not.toHaveBeenCalled();
  expect(sendHeartbeat).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const key of Object.keys(testEnv)) Reflect.deleteProperty(testEnv, key);
  Object.assign(testEnv, {
    PULSE_SECRET: secret,
    DEMO_CLOCK: 'off',
    BETTERSTACK_HEARTBEAT_URL: 'https://uptime.example/h/abc',
  });
  vi.mocked(consumeRateLimit).mockReset().mockResolvedValue(allowed);
  vi.mocked(drainJobs).mockReset().mockResolvedValue(report);
  vi.mocked(purgeExpiredRateLimits).mockReset().mockResolvedValue(0);
  vi.mocked(sendHeartbeat).mockReset().mockResolvedValue('sent');
});

describe('refusals', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    '%s gets 401 and does no work, with the right secret',
    async (method) => {
      const response = await pulseResponse(
        new Request(url, {
          method,
          headers: { authorization: `Bearer ${secret}` },
        }),
      );

      expect(response.status).toBe(401);
      expectNoWork();
    },
  );

  it.each([
    ['no header', {}],
    ['a wrong secret', { authorization: `Bearer ${'x'.repeat(40)}` }],
    [
      'a secret one character short',
      { authorization: `Bearer ${secret.slice(1)}` },
    ],
    ['the wrong scheme', { authorization: `Basic ${secret}` }],
    ['an empty token', { authorization: 'Bearer ' }],
  ])('%s gets 401, is counted, and does no work', async (_name, headers) => {
    const response = await pulseResponse(
      new Request(url, { method: 'POST', headers }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(consumeRateLimit).toHaveBeenCalledExactlyOnceWith(
      'pulse_failed',
      'unknown',
    );
    expectNoWork();
  });

  it('refuses everyone when no secret is configured', async () => {
    Reflect.deleteProperty(testEnv, 'PULSE_SECRET');

    const response = await pulseResponse(post());

    expect(response.status).toBe(401);
    expectNoWork();
  });

  it('counts a failure against the first forwarded address', async () => {
    await pulseResponse(
      new Request(url, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      }),
    );

    expect(consumeRateLimit).toHaveBeenCalledWith(
      'pulse_failed',
      '203.0.113.9',
    );
  });

  it('answers 429 with Retry-After past the failure limit', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });

    const response = await pulseResponse(new Request(url, { method: 'POST' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expectNoWork();
  });

  it('answers 429 past the shared cap, having counted only on the cap', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 7,
    });

    const response = await pulseResponse(post());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(consumeRateLimit).toHaveBeenCalledExactlyOnceWith(
      'pulse',
      'schedule',
    );
    expectNoWork();
  });

  it('throws when the limiter store fails, and does no work', async () => {
    vi.mocked(consumeRateLimit).mockRejectedValue(new Error('store down'));

    await expect(pulseResponse(post())).rejects.toThrow('store down');
    expectNoWork();
  });

  it('never counts a right secret on the failure counter', async () => {
    await pulseResponse(post());

    expect(consumeRateLimit).not.toHaveBeenCalledWith(
      'pulse_failed',
      expect.anything(),
    );
  });
});

describe('the body', () => {
  it('answers 413 for a declared length over 1 KB', async () => {
    const response = await pulseResponse(
      post('{}', { 'content-length': '2048' }),
    );

    expect(response.status).toBe(413);
    expectNoWork();
  });

  it('answers 413 for a streamed body over 1 KB', async () => {
    const response = await pulseResponse(
      post(`{"asOf":"${'9'.repeat(2000)}"}`),
    );

    expect(response.status).toBe(413);
    expectNoWork();
  });

  it.each([
    ['not JSON', 'nope'],
    ['an unknown field', '{"x":1}'],
    ['a date with no time', '{"asOf":"2026-11-02"}'],
  ])('answers 400 for %s', async (_name, body) => {
    const response = await pulseResponse(post(body));

    expect(response.status).toBe(400);
    expectNoWork();
  });

  it('answers 400 for asOf while DEMO_CLOCK is off', async () => {
    const response = await pulseResponse(
      post('{"asOf":"2026-11-02T09:30:00Z"}'),
    );

    expect(response.status).toBe(400);
    expectNoWork();
  });

  it('answers 400 for asOf more than 400 days from now', async () => {
    testEnv.DEMO_CLOCK = 'on';

    const response = await pulseResponse(
      post('{"asOf":"2099-01-01T00:00:00Z"}'),
    );

    expect(response.status).toBe(400);
    expectNoWork();
  });
});

describe('a good pulse', () => {
  it('drains on the system clock, purges to a short batch, pings once, and answers counts only', async () => {
    vi.mocked(purgeExpiredRateLimits)
      .mockResolvedValueOnce(PURGE_BATCH)
      .mockResolvedValueOnce(PURGE_BATCH)
      .mockResolvedValueOnce(17);

    const response = await pulseResponse(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...report, purged: 2017 });
    expect(purgeExpiredRateLimits).toHaveBeenCalledTimes(3);
    expect(sendHeartbeat).toHaveBeenCalledExactlyOnceWith(
      'https://uptime.example/h/abc',
    );
    const clock = vi.mocked(drainJobs).mock.calls[0]?.[0];
    expect(Math.abs((clock?.now().getTime() ?? 0) - realNowMs())).toBeLessThan(
      5000,
    );
  });

  it('stops purging when the time budget is spent', async () => {
    vi.mocked(purgeExpiredRateLimits).mockResolvedValue(PURGE_BATCH);
    const clockReads = vi.spyOn(performance, 'now');
    clockReads.mockReturnValueOnce(0).mockReturnValue(61_000);

    await pulseResponse(post());

    expect(purgeExpiredRateLimits).toHaveBeenCalledOnce();
    clockReads.mockRestore();
  });

  it('runs a manual time on a fixed clock and sends no heartbeat', async () => {
    testEnv.DEMO_CLOCK = 'on';
    const near = new Date(realNowMs() + 24 * 3600 * 1000);

    const response = await pulseResponse(
      post(JSON.stringify({ asOf: near.toISOString() })),
    );

    expect(response.status).toBe(200);
    const clock = vi.mocked(drainJobs).mock.calls[0]?.[0];
    expect(clock?.now()).toEqual(near);
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  it('is not failed by a heartbeat that fails', async () => {
    vi.mocked(sendHeartbeat).mockResolvedValue('failed');

    expect((await pulseResponse(post())).status).toBe(200);
  });

  it('throws when the drain fails, without a purge or heartbeat', async () => {
    vi.mocked(drainJobs).mockRejectedValue(new Error('drain down'));

    await expect(pulseResponse(post())).rejects.toThrow('drain down');
    expect(purgeExpiredRateLimits).not.toHaveBeenCalled();
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  it('throws when the purge fails, without a heartbeat', async () => {
    vi.mocked(purgeExpiredRateLimits).mockRejectedValue(
      new Error('purge down'),
    );

    await expect(pulseResponse(post())).rejects.toThrow('purge down');
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });
});
