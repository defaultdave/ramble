import { NextResponse, type NextRequest } from 'next/server';
import {
  orderAccessCookie,
  orderAccessHandoff,
  tokenRouteHeaders,
} from '@/lib/orderAccess';
import {
  contentSecurityPolicyHeader,
  contentSecurityPolicyHeaderNames,
  enforcedHeaderName,
} from '@/lib/securityHeaders';
import { env } from '@/server/env';

function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest) {
  // A confirmation link carries its token in the address once: it moves into a cookie for that
  // order's path and the guest is sent to the same page without it, so the token is not in
  // history, the next request's Referer, or a refresh (audit BC-20).
  const handoff = orderAccessHandoff(
    request.nextUrl.pathname,
    request.nextUrl.searchParams,
  );
  if (handoff !== null) {
    const redirect = NextResponse.redirect(
      new URL(handoff.cleanPath, request.url),
      303,
    );
    redirect.cookies.set(
      orderAccessCookie(handoff, env.NODE_ENV === 'production'),
    );
    for (const { key, value } of tokenRouteHeaders(handoff.cleanPath)) {
      redirect.headers.set(key, value);
    }
    return redirect;
  }

  // Next.js reads the nonce from the request's policy header and puts it on every script it
  // renders, so a client must never get to supply one. The policy travels on the request only
  // when this proxy wrote it.
  const requestHeaders = new Headers(request.headers);
  for (const name of contentSecurityPolicyHeaderNames) {
    requestHeaders.delete(name);
  }

  const header = contentSecurityPolicyHeader(
    request.nextUrl.pathname,
    freshNonce(),
    { development: env.NODE_ENV === 'development' },
  );
  if (header.key === enforcedHeaderName) {
    requestHeaders.set(header.key, header.value);
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header.key, header.value);
  for (const { key, value } of tokenRouteHeaders(request.nextUrl.pathname)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)',
  ],
};
