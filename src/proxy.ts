import { NextResponse, type NextRequest } from 'next/server';
import {
  contentSecurityPolicyHeader,
  enforcedHeaderName,
} from '@/lib/securityHeaders';

function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest) {
  const header = contentSecurityPolicyHeader(
    request.nextUrl.pathname,
    freshNonce(),
  );

  if (header.key !== enforcedHeaderName) {
    const response = NextResponse.next();
    response.headers.set(header.key, header.value);
    return response;
  }

  // Next.js reads the nonce from the request's policy header and puts it on every script it
  // renders, which is why the policy travels on the request as well as the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(header.key, header.value);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header.key, header.value);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      // A prefetch carries no document, so it needs no policy and must not spend a nonce.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
