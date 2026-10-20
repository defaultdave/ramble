import { NextResponse, type NextRequest } from 'next/server';

// Dynamic route prefixes get an enforcing nonce CSP. Everything else (cached shells,
// category pages) gets a report-only CSP with no nonce, so it can stay prerendered.
const DYNAMIC = ['/checkout', '/manage', '/ops'];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isDynamic = DYNAMIC.some((p) => path === p || path.startsWith(p + '/'));

  if (isDynamic) {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; img-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  const response = NextResponse.next();
  response.headers.set(
    'Content-Security-Policy-Report-Only',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
