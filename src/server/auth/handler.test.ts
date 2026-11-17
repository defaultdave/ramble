import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAuthRequest, handleSignInFormRequest } from './handler';

const betterAuthHandler = vi.hoisted(() => vi.fn());
const consumeRateLimit = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
const onScreenSignInLink = vi.hoisted(() => vi.fn());
vi.mock('./onScreenLink', () => ({ onScreenSignInLink }));
vi.mock('./auth', () => ({
  getAuth: () => ({ handler: betterAuthHandler }),
}));
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - a sign-in link request is counted against its client address, then its lower-cased address, before Better Auth sees it
// - the 11th request from one client is refused with Retry-After, and the client limit spans addresses
// - another client can still ask for an address one client has used up its own limit on
// - one client at its limit leaves the address's count unspent, so another client is still allowed
// - a request the client count refuses never spends the address's count
// - a request with no usable forwarded address shares one 'unknown' client count
// - a refused count is a 429 with Retry-After, and Better Auth never sees the request
// - a counter that fails is a 503 and nothing is sent; the log holds the error name only
// - a body that is too long, not JSON, or not an address is refused unread by the counter and by Better Auth
// - Better Auth still receives the original body after it was read for the address
// - through the form's handler, a link the module returns is answered as `{ status: true, signInPath }`, no-store, and Better Auth is not asked; with none returned Better Auth answers as usual
// - through the API address's handler, the module is never asked and no link is answered
// - the module is asked with the normalized address and the checked destination, after the count, and never for a refused request
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

    expect(consumeRateLimit.mock.calls).toEqual([
      ['sign_in_link_client', 'unknown'],
      ['sign_in_link', 'sam@example.com'],
    ]);
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

describe('the client count', () => {
  const clientLimit = 10;
  const emailLimit = 20;
  const spent = new Map<string, number>();
  const spend = (surface: string, subject: string) => {
    const key = `${surface}:${subject}`;
    const n = (spent.get(key) ?? 0) + 1;
    spent.set(key, n);
    const limit = surface === 'sign_in_link_client' ? clientLimit : emailLimit;
    return n <= limit
      ? { allowed: true, remaining: limit - n }
      : { allowed: false, retryAfterSeconds: 900 };
  };
  const from = (client: string | null, email: string) => {
    const request = signIn(email);
    if (client) request.headers.set('x-forwarded-for', client);
    return handleAuthRequest(request);
  };

  beforeEach(() => {
    spent.clear();
    consumeRateLimit.mockImplementation((surface: string, subject: string) =>
      Promise.resolve(spend(surface, subject)),
    );
  });

  it('refuses the 11th request from one client with Retry-After, whatever the address, and sends nothing for it', async () => {
    for (let i = 0; i < clientLimit; i += 1) {
      expect(
        (await from('203.0.113.7', `a${String(i)}@example.com`)).status,
      ).toBe(200);
    }

    const refused = await from('203.0.113.7', 'b@example.com');

    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('900');
    expect(betterAuthHandler).toHaveBeenCalledTimes(clientLimit);
  });

  it('leaves another client free to ask for an address the first client used up its limit on', async () => {
    for (let i = 0; i < clientLimit + 1; i += 1) {
      await from('203.0.113.7', 'guest@example.com');
    }

    expect((await from('203.0.113.7', 'other@example.com')).status).toBe(429);
    expect((await from('198.51.100.2', 'guest@example.com')).status).toBe(200);
  });

  it('does not spend the address count on a request the client count refused', async () => {
    for (let i = 0; i < clientLimit + 5; i += 1) {
      await from('203.0.113.7', 'guest@example.com');
    }

    expect(spent.get('sign_in_link:guest@example.com')).toBe(clientLimit);
  });

  it('shares one count among requests with no usable forwarded address', async () => {
    for (let i = 0; i < clientLimit; i += 1) {
      await from(null, `a${String(i)}@example.com`);
    }

    expect((await from('not an address', 'z@example.com')).status).toBe(429);
    expect(spent.get('sign_in_link_client:unknown')).toBe(clientLimit + 1);
  });

  it('is refused with 503 when the client counter fails, and the address count is never reached', async () => {
    consumeRateLimit.mockRejectedValue(new TypeError('down'));

    const response = await from('203.0.113.7', 'guest@example.com');

    expect(response.status).toBe(503);
    expect(consumeRateLimit).toHaveBeenCalledOnce();
    expect(betterAuthHandler).not.toHaveBeenCalled();
  });

  it('is refused with 503 when the address counter fails after the client count passed', async () => {
    consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9 })
      .mockRejectedValueOnce(new TypeError('down'));

    const response = await from('203.0.113.7', 'guest@example.com');

    expect(response.status).toBe(503);
    expect(betterAuthHandler).not.toHaveBeenCalled();
  });
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

describe('a sign-in link request through the form handler', () => {
  const asked = (email: string, callbackURL?: string) =>
    handleSignInFormRequest(post(JSON.stringify({ email, callbackURL })));

  it('answers the link the module returns, no-store, and does not ask Better Auth', async () => {
    onScreenSignInLink.mockResolvedValue('/sign-in/confirm?token=AbC&next=%2F');

    const response = await asked('Sam@Example.COM', '/account');

    expect(await response.json()).toEqual({
      status: true,
      signInPath: '/sign-in/confirm?token=AbC&next=%2F',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(onScreenSignInLink).toHaveBeenCalledWith(
      'sam@example.com',
      '/account',
    );
    expect(betterAuthHandler).not.toHaveBeenCalled();
  });

  it('hands an unsafe destination on as home', async () => {
    onScreenSignInLink.mockResolvedValue(null);

    await asked('sam@example.com', '//evil.com');

    expect(onScreenSignInLink).toHaveBeenCalledWith('sam@example.com', '/');
  });

  it('answers as usual, with Better Auth, when the module returns no link', async () => {
    onScreenSignInLink.mockResolvedValue(null);

    const response = await asked('sam@example.com');

    expect(await response.json()).toEqual({ status: true });
    expect(betterAuthHandler).toHaveBeenCalledOnce();
  });

  it('never asks the module for a request the count refused', async () => {
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    const response = await asked('sam@example.com');

    expect(response.status).toBe(429);
    expect(onScreenSignInLink).not.toHaveBeenCalled();
  });

  it('is not asked for at the API address, which never asks', async () => {
    onScreenSignInLink.mockResolvedValue('/sign-in/confirm?token=AbC');

    const response = await handleAuthRequest(signIn('sam@example.com'));

    expect(await response.json()).toEqual({ status: true });
    expect(onScreenSignInLink).not.toHaveBeenCalled();
  });
});
