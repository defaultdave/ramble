import { isCapabilityTokenShape } from './capabilityTokens';
import { isOrderReference } from './orders';
import { orderPath, orderTokenParam } from './routes';

// How a guest keeps access to one order's confirmation page after the token has left the address
// bar (audit BC-20): the token arrives once in the URL, the proxy moves it into a cookie scoped to
// that order's path, and every later view reads the cookie. The page still checks the token
// against the order, so a cookie holds no more power than the link it came from.

export const orderAccessCookieName = 'ramble_order_access';

/** Long enough for a guest to refresh and come back to the tab; the email's manage link is the lasting way back. */
export const orderAccessCookieMaxAgeSeconds = 2 * 60 * 60;

const confirmationPathPattern = /^\/orders\/([^/]+)\/?$/;

export type OrderAccessHandoff = {
  reference: string;
  token: string;
  /** Where the guest lands: the same page, with nothing in the query. */
  cleanPath: string;
};

/**
 * What the proxy does with a request for an order page: a handoff when the address carries a
 * well-formed token for a well-formed reference, otherwise nothing, and the page answers as it
 * would for any bad link. A malformed token never reaches a cookie.
 */
export function orderAccessHandoff(
  pathname: string,
  search: URLSearchParams,
): OrderAccessHandoff | null {
  const reference = confirmationPathPattern.exec(pathname)?.[1];
  const token = search.get(orderTokenParam);
  if (
    reference === undefined ||
    token === null ||
    !isOrderReference(reference) ||
    !isCapabilityTokenShape(token)
  ) {
    return null;
  }
  return { reference, token, cleanPath: orderPath(reference) };
}

/** The cookie that keeps one order's page open: HttpOnly, and sent only to that order's path. */
export function orderAccessCookie(
  handoff: OrderAccessHandoff,
  secure: boolean,
) {
  return {
    name: orderAccessCookieName,
    value: handoff.token,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: handoff.cleanPath,
    maxAge: orderAccessCookieMaxAgeSeconds,
  } as const;
}

/**
 * The token a page request carries. The cookie wins, because the address has none after the
 * handoff; a token still in the address (a request the proxy did not see) is the fallback.
 */
export function pickOrderToken(input: {
  cookie: string | undefined;
  query: string | string[] | undefined;
}): string | null {
  const query = typeof input.query === 'string' ? input.query : undefined;
  for (const candidate of [input.cookie, query]) {
    if (candidate !== undefined && isCapabilityTokenShape(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Headers for a page whose address is a capability: nothing indexes it and nothing caches it.
 * Referrer-Policy stays the site's own, which the security header suite pins for every path; the
 * order address holds no token once the handoff has run, and the page's metadata asks for no Referer.
 */
export function tokenRouteHeaders(
  pathname: string,
): readonly { key: string; value: string }[] {
  return confirmationPathPattern.test(pathname)
    ? [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'Cache-Control', value: 'no-store' },
      ]
    : [];
}
