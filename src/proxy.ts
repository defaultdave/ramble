import { NextResponse, type NextRequest } from 'next/server';
import {
  contentSecurityPolicyHeader,
  contentSecurityPolicyHeaderNames,
  enforcedHeaderName,
  isPrefetchRequest,
} from '@/lib/securityHeaders';
import { env } from '@/server/env';

function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest) {
  // Next.js reads the nonce from the request's policy header and puts it on every script it
  // renders, so a client must never get to supply one. The policy travels on the request only
  // when this proxy wrote it.
  const requestHeaders = new Headers(request.headers);
  for (const name of contentSecurityPolicyHeaderNames) {
    requestHeaders.delete(name);
  }

  if (isPrefetchRequest(request.headers)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
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
  return response;
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)'],
};
