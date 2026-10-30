import { describe, expect, it } from 'vitest';
import {
  orderAccessCookie,
  orderAccessCookieMaxAgeSeconds,
  orderAccessCookieName,
  orderAccessHandoff,
  pickOrderToken,
  tokenRouteHeaders,
} from './orderAccess';
import { orderConfirmationPath } from './routes';

// Behaviours under test, one per decision, branch, or risk.
// - a confirmation address with a well-formed token hands off to a clean path; every malformed
//   or missing part (reference, token, query key, other path, deeper path) hands off nothing
// - the cookie is HttpOnly, Lax, scoped to the one order's path, short-lived, and Secure only when told
// - the page takes the cookie before the address, and refuses a malformed value of either
// - an order's page carries noindex and no-store headers; other routes, the manage route included, carry none
// - the link the checkout builds is the address the handoff reads

const token = 'A'.repeat(43);
const reference = 'RMB-A3K7MN';

function handoff(pathname: string, query: string) {
  return orderAccessHandoff(pathname, new URLSearchParams(query));
}

describe('orderAccessHandoff', () => {
  it('takes the token and sends the guest to the same page without it', () => {
    expect(handoff(`/orders/${reference}`, `t=${token}`)).toEqual({
      reference,
      token,
      cleanPath: `/orders/${reference}`,
    });
  });

  it('reads the address the checkout builds', () => {
    const url = new URL(
      orderConfirmationPath(reference, token),
      'https://ramble.example',
    );
    expect(handoff(url.pathname, url.search)).not.toBeNull();
  });

  it.each([
    ['no token', `/orders/${reference}`, ''],
    ['a short token', `/orders/${reference}`, `t=${'A'.repeat(42)}`],
    [
      'a token with a bad character',
      `/orders/${reference}`,
      `t=${'A'.repeat(42)}!`,
    ],
    ['another query key', `/orders/${reference}`, `token=${token}`],
    ['a reference that is not one', '/orders/sample', `t=${token}`],
    ['a deeper path', `/orders/${reference}/a`, `t=${token}`],
    ['another route', `/manage/${reference}`, `t=${token}`],
  ])('hands off nothing for %s', (_name, pathname, query) => {
    expect(handoff(pathname, query)).toBeNull();
  });
});

describe('orderAccessCookie', () => {
  const cookie = orderAccessCookie(
    { reference, token, cleanPath: `/orders/${reference}` },
    true,
  );

  it('is HttpOnly, Lax, short-lived, and sent only to that order', () => {
    expect(cookie).toMatchObject({
      name: orderAccessCookieName,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: `/orders/${reference}`,
      maxAge: orderAccessCookieMaxAgeSeconds,
    });
    expect(orderAccessCookieMaxAgeSeconds).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it.each([true, false])('sets Secure to %s as told', (secure) => {
    expect(
      orderAccessCookie(
        { reference, token, cleanPath: `/orders/${reference}` },
        secure,
      ).secure,
    ).toBe(secure);
  });
});

describe('pickOrderToken', () => {
  const other = 'B'.repeat(43);

  it.each([
    ['the cookie alone', { cookie: token, query: undefined }, token],
    ['the address alone', { cookie: undefined, query: token }, token],
    ['the cookie over the address', { cookie: token, query: other }, token],
    [
      'the address when the cookie is malformed',
      { cookie: 'x', query: other },
      other,
    ],
    ['nothing when both are malformed', { cookie: 'x', query: 'y' }, null],
    [
      'nothing when there is neither',
      { cookie: undefined, query: undefined },
      null,
    ],
    [
      'nothing for a repeated query key',
      { cookie: undefined, query: [token, other] },
      null,
    ],
  ])('takes %s', (_name, input, expected) => {
    expect(pickOrderToken(input)).toBe(expected);
  });
});

describe('tokenRouteHeaders', () => {
  it.each([`/orders/${reference}`, `/orders/${reference}/`])(
    'keeps %s out of indexes and caches',
    (pathname) => {
      expect(tokenRouteHeaders(pathname)).toEqual([
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'Cache-Control', value: 'no-store' },
      ]);
    },
  );

  it.each([
    '/',
    '/new-york/browse',
    '/checkout/abc',
    '/orders',
    `/manage/${token}`,
  ])('adds nothing to %s', (pathname) => {
    expect(tokenRouteHeaders(pathname)).toEqual([]);
  });
});
