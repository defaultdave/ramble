export type Header = { key: string; value: string };

/**
 * Route trees whose root layout sets `export const instant = false`. They render per request,
 * so every script tag can carry the request's nonce and the policy can be enforced. Cached
 * routes serve a prerendered shell whose inline scripts have no nonce, so they get the
 * report-only policy instead. `tests/security-headers.test.ts` checks this list against the
 * layouts under `src/app`.
 */
export const dynamicRoutePrefixes = [
  '/checkout',
  '/gift',
  '/gifts/checkout',
  '/manage',
  '/orders',
  '/host',
  '/ops',
] as const;

export function isDynamicRoutePath(pathname: string): boolean {
  return dynamicRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Guest pages only. Vercel Analytics and Speed Insights load from the site's own origin on
// Vercel and from this host in development.
const vercelScriptHost = 'https://va.vercel-scripts.com';

// Guest pages only. Sentry's loader fetches the browser SDK from the second host and reports
// to the browser DSN's ingest host (docs/runbooks/alerting.md).
const sentryScriptHosts = [
  'https://js.sentry-cdn.com',
  'https://browser.sentry-cdn.com',
];
const sentryIngestHosts = [
  'https://*.ingest.sentry.io',
  'https://*.ingest.us.sentry.io',
];

// Inline `style` attributes are allowed on both tiers: React Aria Components position popovers
// and modals with them. A style cannot run script, and CSS exfiltration needs a cross-origin
// URL, which img-src, font-src, and connect-src refuse.
const sharedDirectives = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

function serialize(directives: readonly string[]): string {
  return directives.join('; ');
}

export type PolicyOptions = {
  /** React's development build evaluates code at runtime; production never gets `'unsafe-eval'`. */
  development: boolean;
};

function scriptSources(sources: string[], { development }: PolicyOptions) {
  return `script-src ${[...sources, ...(development ? ["'unsafe-eval'"] : [])].join(' ')}`;
}

/** The enforcing policy for a dynamic route. Only scripts carrying `nonce` (and what they load) run; nothing third-party. */
export function enforcedContentSecurityPolicy(
  nonce: string,
  options: PolicyOptions,
): string {
  return serialize([
    ...sharedDirectives,
    "connect-src 'self'",
    scriptSources(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"], options),
  ]);
}

/**
 * The report-only policy for a cached route. The prerendered shell's inline bootstrap scripts
 * have no nonce, so `'unsafe-inline'` keeps them out of the reports; violations show in the
 * browser console only, since no report endpoint exists yet.
 */
export function reportOnlyContentSecurityPolicy(
  options: PolicyOptions,
): string {
  return serialize([
    ...sharedDirectives,
    `connect-src 'self' ${sentryIngestHosts.join(' ')}`,
    scriptSources(
      ["'self'", "'unsafe-inline'", vercelScriptHost, ...sentryScriptHosts],
      options,
    ),
  ]);
}

export const enforcedHeaderName = 'Content-Security-Policy';
export const reportOnlyHeaderName = 'Content-Security-Policy-Report-Only';

/** Both names, because Next.js takes a nonce from either request header. */
export const contentSecurityPolicyHeaderNames = [
  enforcedHeaderName,
  reportOnlyHeaderName,
] as const;

/** The CSP header one page response carries, chosen by its path. */
export function contentSecurityPolicyHeader(
  pathname: string,
  nonce: string,
  options: PolicyOptions,
): Header {
  return isDynamicRoutePath(pathname)
    ? {
        key: enforcedHeaderName,
        value: enforcedContentSecurityPolicy(nonce, options),
      }
    : {
        key: reportOnlyHeaderName,
        value: reportOnlyContentSecurityPolicy(options),
      };
}

/**
 * Headers every response carries, static assets included, so `next.config.ts` sets them rather
 * than the proxy (whose matcher skips `_next/static`). `preload` is left off HSTS: it is a
 * commitment for a custom domain that does not exist yet, and `*.vercel.app` is already preloaded.
 */
export const securityHeaders: readonly Header[] = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];
