import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAuthRequest } from './handler';

const betterAuthHandler = vi.hoisted(() => vi.fn());
const consumeRateLimit = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock('./auth', () => ({
  getAuth: () => ({ handler: betterAuthHandler }),
}));
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - a sign-in link request is counted against its lower-cased address on the sign_in_link surface before Better Auth sees it
// - a refused count is a 429 with Retry-After, and Better Auth never sees the request
// - a counter that fails is a 503 and nothing is sent; the log holds the error name only
// - a body that is too long, not JSON, or not an address is refused unread by the counter and by Better Auth
// - Better Auth still receives the original body after it was read for the address
// - every other request, the verify address included, passes to Better Auth uncounted
// - every response is no-store and keeps every cookie Better Auth set

const origin = 'http://localhost:3000';
const post = (body: string) =>
  new Request(`${origin}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body,
  });
const signIn = (email: string) => post(JSON.stringify({ email }));

beforeEach(() => {
  vi.resetAllMocks();
  betterAuthHandler.mockImplementation(() =>
    Promise.resolve(Response.json({ status: true })),
  );
  consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
});

describe('a sign-in link request', () => {
  it('is counted against the lower-cased address, then handed on with its body intact', async () => {
    const response = await handleAuthRequest(signIn('Sam@Example.COM'));

    expect(consumeRateLimit).toHaveBeenCalledWith(
      'sign_in_link',
      'sam@example.com',
    );
    expect(response.status).toBe(200);
    const handed = betterAuthHandler.mock.calls[0]?.[0] as Request;
    expect(await handed.json()).toEqual({ email: 'Sam@Example.COM' });
  });

  it('hands on a rebuilt request with no stale content-length, for a body of multi-byte characters', async () => {
    const body = JSON.stringify({
      email: 'sam@example.com',
      name: 'Zoë 日本語',
    });
    const request = post(body);
    request.headers.set('content-length', '5');

    await handleAuthRequest(request);

    const handed = betterAuthHandler.mock.calls[0]?.[0] as Request;
    expect(handed.headers.get('content-length')).toBeNull();
    expect(await handed.text()).toBe(body);
  });

  it('is refused with Retry-After when the count is spent, and reaches no one', async () => {
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 1234,
    });

    const response = await handleAuthRequest(signIn('sam@example.com'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1234');
    expect(betterAuthHandler).not.toHaveBeenCalled();
  });

  it('is refused with 503 when the counter fails, logging the error name and nothing else', async () => {
    const failure = new TypeError('connection to postgres://u:p@host failed');
    consumeRateLimit.mockRejectedValue(failure);

    const response = await handleAuthRequest(signIn('sam@example.com'));

    expect(response.status).toBe(503);
    expect(betterAuthHandler).not.toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).not.toContain('postgres://');
    expect(JSON.stringify(logError.mock.calls)).not.toContain('sam@example');
    expect(logError.mock.calls[0]?.[1]).toEqual({ errorName: 'TypeError' });
  });

  it.each([
    ['not JSON', post('{"email":'), 400],
    ['a JSON array', post('[]'), 400],
    ['no address', post('{}'), 400],
    ['a bad address', post('{"email":"sam"}'), 400],
    [
      'a body past 4096 bytes',
      post(JSON.stringify({ email: 'a'.repeat(5000) })),
      413,
    ],
    [
      'a declared length past 4096 bytes',
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-length': '99999' },
        body: '{}',
      }),
      413,
    ],
  ])(
    'refuses %s without counting it or sending it on',
    async (_n, request, status) => {
      const response = await handleAuthRequest(request);

      expect(response.status).toBe(status);
      expect(consumeRateLimit).not.toHaveBeenCalled();
      expect(betterAuthHandler).not.toHaveBeenCalled();
    },
  );
});

describe('every other request', () => {
  it.each([
    [
      'the verify address',
      new Request(`${origin}/api/auth/magic-link/verify?token=abc`),
    ],
    ['reading the session', new Request(`${origin}/api/auth/get-session`)],
    [
      'a GET at the sign-in path',
      new Request(`${origin}/api/auth/sign-in/magic-link`),
    ],
  ])('passes %s to Better Auth uncounted', async (_n, request) => {
    await handleAuthRequest(request);

    expect(betterAuthHandler).toHaveBeenCalledOnce();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });
});

describe('the response', () => {
  it('is no-store and keeps every Set-Cookie and the status and location', async () => {
    const upstream = new Response(null, { status: 302 });
    upstream.headers.set('location', '/account');
    upstream.headers.append('set-cookie', 'a=1; Path=/');
    upstream.headers.append('set-cookie', 'b=2; Path=/');
    betterAuthHandler.mockResolvedValue(upstream);

    const response = await handleAuthRequest(
      new Request(`${origin}/api/auth/magic-link/verify?token=abc`),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/account');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual([
      'a=1; Path=/',
      'b=2; Path=/',
    ]);
  });

  it('marks a refusal no-store too', async () => {
    const response = await handleAuthRequest(post('{}'));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
