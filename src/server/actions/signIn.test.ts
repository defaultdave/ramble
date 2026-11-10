import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSignInLink } from './signIn';

const handleAuthRequest = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/server/auth/handler', () => ({ handleAuthRequest }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - a valid address is asked for through the same handler as the API, lower-cased, with the checked destination as the callback
// - the answer becomes the form's state: sent, rate limited with the wait, or failed
// - an address that is blank, malformed, or too long is invalid and never sent
// - an unsafe destination becomes home before the request is made
// - a handler that throws is a failed state, and the log holds the error kind and no address

const idle = { status: 'idle' } as const;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const sentRequest = () => handleAuthRequest.mock.calls[0]?.[0] as Request;

beforeEach(() => {
  vi.resetAllMocks();
  handleAuthRequest.mockResolvedValue(Response.json({ status: true }));
});

describe('requestSignInLink', () => {
  it('asks for a link for the lower-cased address and reports it sent', async () => {
    const state = await requestSignInLink(
      idle,
      form({ email: ' Sam@Example.COM ', next: '/account' }),
    );

    expect(state).toEqual({ status: 'sent', email: 'sam@example.com' });
    const request = sentRequest();
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/auth/sign-in/magic-link');
    expect(request.headers.get('origin')).toBe('http://localhost:3000');
    expect(await request.json()).toEqual({
      email: 'sam@example.com',
      callbackURL: '/account',
    });
  });

  it('reports a counted-out request with the wait from Retry-After', async () => {
    handleAuthRequest.mockResolvedValue(
      new Response(null, { status: 429, headers: { 'Retry-After': '1800' } }),
    );

    expect(
      await requestSignInLink(idle, form({ email: 'sam@example.com' })),
    ).toEqual({
      status: 'rate_limited',
      email: 'sam@example.com',
      retryAfterMinutes: 30,
    });
  });

  it('reports a refused request as failed', async () => {
    handleAuthRequest.mockResolvedValue(new Response(null, { status: 503 }));

    expect(
      await requestSignInLink(idle, form({ email: 'sam@example.com' })),
    ).toEqual({ status: 'failed', email: 'sam@example.com' });
  });

  it.each([
    ['blank', ''],
    ['without an at sign', 'sam'],
    ['with a display name', 'Sam <sam@example.com>'],
    ['too long', `${'a'.repeat(250)}@example.com`],
  ])('does not send an address that is %s', async (_label, email) => {
    const state = await requestSignInLink(idle, form({ email }));

    expect(state).toEqual({ status: 'invalid', email });
    expect(handleAuthRequest).not.toHaveBeenCalled();
  });

  it('does not send when the field is missing', async () => {
    expect(await requestSignInLink(idle, new FormData())).toEqual({
      status: 'invalid',
      email: '',
    });
    expect(handleAuthRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['a protocol-relative address', '//evil.com'],
    ['an absolute address', 'https://evil.com'],
    ['no destination', ''],
  ])('uses home for %s', async (_label, next) => {
    await requestSignInLink(idle, form({ email: 'sam@example.com', next }));

    expect(
      ((await sentRequest().json()) as { callbackURL: string }).callbackURL,
    ).toBe('/');
  });

  it('is a failed state when the handler throws, and logs the kind but not the address', async () => {
    handleAuthRequest.mockRejectedValue(new TypeError('boom sam@example.com'));

    expect(
      await requestSignInLink(idle, form({ email: 'sam@example.com' })),
    ).toEqual({ status: 'failed', email: 'sam@example.com' });
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      'sam@example.com',
    );
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
