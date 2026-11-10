import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleConfirmSignIn, handleEndSession } from './forms';

const handleAuthRequest = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock('./handler', () => ({ handleAuthRequest }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - a post whose Origin is missing or another site's is refused with 403 and reaches Better Auth with nothing
// - the confirm post asks Better Auth to verify the token once, with the checked destination as the callback and /sign-in as the error page
// - a good link answers 303 to where Better Auth said, with every cookie it set and no-store
// - a refused link (Better Auth redirects to the error page) answers 303 to /sign-in with the error and the destination
// - a missing, odd, or oversized token or body never reaches Better Auth and answers 303 to /sign-in with the error
// - an unsafe `next` becomes home before it reaches Better Auth, in the callback and on the way back
// - an answer that is not a redirect is a failure, never a sign-in
// - sign out sends Better Auth's sign-out with the person's cookie, answers 303 home with the cleared cookie, and is a 502 when Better Auth refuses

const origin = 'http://localhost:3000';

const confirm = (body: string, headers: Record<string, string> = { origin }) =>
  new Request(`${origin}/api/auth/confirm-sign-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
  });

const verifyRequest = () => handleAuthRequest.mock.calls[0]?.[0] as Request;

function redirectFromBetterAuth(location: string, cookie?: string) {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append('Set-Cookie', cookie);
  headers.append('Set-Cookie', 'other=1; Path=/');
  return new Response(null, { status: 302, headers });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the confirm post origin', () => {
  it.each([
    [
      'null Origin with same-origin Sec-Fetch-Site',
      { origin: 'null', 'sec-fetch-site': 'same-origin' },
      true,
    ],
    [
      'no Origin with same-origin Sec-Fetch-Site',
      { 'sec-fetch-site': 'same-origin' },
      true,
    ],
    ['null Origin with no Sec-Fetch-Site', { origin: 'null' }, false],
    [
      'null Origin with cross-site Sec-Fetch-Site',
      { origin: 'null', 'sec-fetch-site': 'cross-site' },
      false,
    ],
  ])('%s is allowed: %s', async (_label, headers, allowed) => {
    handleAuthRequest.mockResolvedValue(redirectFromBetterAuth(`${origin}/`));

    const response = await handleConfirmSignIn(
      confirm('token=abc123&next=%2F', headers),
    );

    expect(response.status).toBe(allowed ? 303 : 403);
    expect(handleAuthRequest).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it.each([
    ['a dot-segment path', '%2F.%2F%2Fevil.com'],
    ['an encoded dot-segment path', '%2F%252e%2F%2Fevil.com'],
    ['a dot-dot path', '%2Fa%2F..%2F%2Fevil.com'],
  ])('turns %s into home before Better Auth sees it', async (_label, next) => {
    handleAuthRequest.mockResolvedValue(redirectFromBetterAuth(`${origin}/`));

    await handleConfirmSignIn(confirm(`token=abc123&next=${next}`));

    expect(new URL(verifyRequest().url).searchParams.get('callbackURL')).toBe(
      '/',
    );
  });
});

describe('the confirm post', () => {
  it.each([
    ['another site', { origin: 'https://evil.com' }],
    ['the string null', { origin: 'null' }],
    ['no Origin', {}],
  ])('is refused from %s', async (_label, headers) => {
    const response = await handleConfirmSignIn(
      confirm('token=abc123&next=%2F', headers),
    );

    expect(response.status).toBe(403);
    expect(handleAuthRequest).not.toHaveBeenCalled();
  });

  it('asks Better Auth to verify the token with the destination and the error page', async () => {
    handleAuthRequest.mockResolvedValue(
      redirectFromBetterAuth(`${origin}/account`),
    );

    await handleConfirmSignIn(
      confirm('token=abc123&next=%2Faccount%3Ftab%3D1'),
    );

    const url = new URL(verifyRequest().url);
    expect(verifyRequest().method).toBe('GET');
    expect(url.pathname).toBe('/api/auth/magic-link/verify');
    expect(url.searchParams.get('token')).toBe('abc123');
    expect(url.searchParams.get('callbackURL')).toBe('/account?tab=1');
    expect(url.searchParams.get('errorCallbackURL')).toBe(
      '/sign-in?next=%2Faccount%3Ftab%3D1',
    );
    expect(handleAuthRequest).toHaveBeenCalledTimes(1);
  });

  it('answers 303 to where Better Auth said, with every cookie and no-store', async () => {
    handleAuthRequest.mockResolvedValue(
      redirectFromBetterAuth(
        `${origin}/account`,
        'ramble.session_token=s1; Path=/; HttpOnly',
      ),
    );

    const response = await handleConfirmSignIn(
      confirm('token=abc123&next=%2Faccount'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${origin}/account`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual([
      'ramble.session_token=s1; Path=/; HttpOnly',
      'other=1; Path=/',
    ]);
  });

  it('sends a refused link back to /sign-in with the error and the destination', async () => {
    handleAuthRequest.mockResolvedValue(
      redirectFromBetterAuth(
        `${origin}/sign-in?next=%2Faccount&error=INVALID_TOKEN`,
      ),
    );

    const response = await handleConfirmSignIn(
      confirm('token=abc123&next=%2Faccount'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}/sign-in?next=%2Faccount&error=INVALID_TOKEN`,
    );
    expect(response.headers.getSetCookie()).not.toContain(
      expect.stringContaining('session_token'),
    );
  });

  it.each([
    ['a missing token', 'next=%2F'],
    ['an empty token', 'token=&next=%2F'],
    ['a token with a symbol', 'token=a-b&next=%2F'],
    ['a token that is too long', `token=${'a'.repeat(129)}`],
    ['a body past the limit', `token=abc&next=${'a'.repeat(3000)}`],
    ['no body', ''],
  ])('does not reach Better Auth with %s', async (_label, body) => {
    const response = await handleConfirmSignIn(confirm(body));

    expect(handleAuthRequest).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}/sign-in?next=%2F&error=INVALID_TOKEN`,
    );
  });

  it.each([
    ['a protocol-relative address', '%2F%2Fevil.com'],
    ['an absolute address', 'https%3A%2F%2Fevil.com'],
    ['a backslash', '%2F%5Cevil.com'],
  ])('turns %s into home before Better Auth sees it', async (_label, next) => {
    handleAuthRequest.mockResolvedValue(redirectFromBetterAuth(`${origin}/`));

    await handleConfirmSignIn(confirm(`token=abc123&next=${next}`));

    expect(new URL(verifyRequest().url).searchParams.get('callbackURL')).toBe(
      '/',
    );
  });

  it.each([
    ['a 200 with a body', new Response('{}', { status: 200 }), 200],
    ['a server error', new Response(null, { status: 500 }), 500],
    [
      'a redirect with no place to go',
      new Response(null, { status: 302 }),
      302,
    ],
  ])(
    'logs the status of %s and nothing else',
    async (_label, answer, status) => {
      handleAuthRequest.mockResolvedValue(answer);

      await handleConfirmSignIn(confirm('token=abc123&next=%2F'));

      expect(logError).toHaveBeenCalledWith(expect.any(String), { status });
    },
  );

  it('does not log an ordinary refusal', async () => {
    handleAuthRequest.mockResolvedValue(new Response(null, { status: 400 }));

    await handleConfirmSignIn(confirm('token=abc123&next=%2F'));

    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    ['a 200 with a body', new Response('{}', { status: 200 })],
    ['a redirect with no place to go', new Response(null, { status: 302 })],
    ['a server error', new Response(null, { status: 500 })],
  ])('treats %s as a failure and sets no cookie', async (_label, answer) => {
    handleAuthRequest.mockResolvedValue(answer);

    const response = await handleConfirmSignIn(
      confirm('token=abc123&next=%2F'),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('the sign-out post', () => {
  const signOut = (headers: Record<string, string> = { origin }) =>
    new Request(`${origin}/api/auth/end-session`, { method: 'POST', headers });

  it.each([
    ['another site', { origin: 'https://evil.com' }],
    ['no Origin', {}],
  ])('is refused from %s', async (_label, headers) => {
    const response = await handleEndSession(signOut(headers));

    expect(response.status).toBe(403);
    expect(handleAuthRequest).not.toHaveBeenCalled();
  });

  it('sends the cookie to Better Auth and answers 303 home with the cleared cookie', async () => {
    handleAuthRequest.mockResolvedValue(
      new Response('{"success":true}', {
        status: 200,
        headers: { 'Set-Cookie': 'ramble.session_token=; Max-Age=0; Path=/' },
      }),
    );

    const response = await handleEndSession(
      signOut({ origin, cookie: 'ramble.session_token=s1' }),
    );

    const sent = verifyRequest();
    expect(sent.method).toBe('POST');
    expect(new URL(sent.url).pathname).toBe('/api/auth/sign-out');
    expect(sent.headers.get('cookie')).toBe('ramble.session_token=s1');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.getSetCookie()).toEqual([
      'ramble.session_token=; Max-Age=0; Path=/',
    ]);
  });

  it('is a 502 when Better Auth refuses, so the page does not claim the session ended', async () => {
    handleAuthRequest.mockResolvedValue(new Response(null, { status: 500 }));

    const response = await handleEndSession(signOut());

    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
  });
});
