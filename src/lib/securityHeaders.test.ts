import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicyHeader,
  contentSecurityPolicyHeaderNames,
  dynamicRoutePrefixes,
  enforcedContentSecurityPolicy,
  enforcedHeaderName,
  isDynamicRoutePath,
  isPrefetchRequest,
  reportOnlyContentSecurityPolicy,
  reportOnlyHeaderName,
  securityHeaders,
} from './securityHeaders';

const nonce = 'dGVzdC1ub25jZQ==';
const production = { development: false };
const development = { development: true };

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
}

describe('isDynamicRoutePath', () => {
  it.each(dynamicRoutePrefixes)('%s and its children are dynamic', (prefix) => {
    expect(isDynamicRoutePath(prefix)).toBe(true);
    expect(isDynamicRoutePath(`${prefix}/sample`)).toBe(true);
    expect(isDynamicRoutePath(`${prefix}/sample/unknown`)).toBe(true);
  });

  it.each(['/', '/gifts', '/giftsy', '/checkoutx', '/experiences/sample'])(
    '%s is cached',
    (path) => {
      expect(isDynamicRoutePath(path)).toBe(false);
    },
  );
});

describe('enforcedContentSecurityPolicy', () => {
  const policy = enforcedContentSecurityPolicy(nonce, production);

  it('allows only scripts that carry the nonce and what they load', () => {
    expect(directive(policy, 'script-src')).toBe(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
  });

  it('never allows inline scripts', () => {
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('allows eval only for the development build', () => {
    expect(policy).not.toContain("'unsafe-eval'");
    expect(
      directive(
        enforcedContentSecurityPolicy(nonce, development),
        'script-src',
      ),
    ).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`);
  });
});

describe('reportOnlyContentSecurityPolicy', () => {
  const policy = reportOnlyContentSecurityPolicy(production);

  it('carries no nonce, so a prerendered shell can serve it', () => {
    expect(policy).not.toContain('nonce-');
  });

  it("allows the shell's inline bootstrap and the Vercel measurement scripts", () => {
    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
    );
  });

  it('allows eval only for the development build', () => {
    expect(policy).not.toContain("'unsafe-eval'");
    expect(reportOnlyContentSecurityPolicy(development)).toContain(
      "'unsafe-eval'",
    );
  });
});

describe('both policies', () => {
  it.each([
    ["default-src 'self'"],
    ["style-src 'self' 'unsafe-inline'"],
    ["img-src 'self' blob: data:"],
    ["font-src 'self'"],
    ["connect-src 'self'"],
    ["object-src 'none'"],
    ["base-uri 'self'"],
    ["form-action 'self'"],
    ["frame-ancestors 'none'"],
  ])('share %s', (expected) => {
    const name = expected.split(' ')[0] ?? '';
    expect(
      directive(enforcedContentSecurityPolicy(nonce, production), name),
    ).toBe(expected);
    expect(directive(reportOnlyContentSecurityPolicy(production), name)).toBe(
      expected,
    );
  });
});

describe('contentSecurityPolicyHeader', () => {
  it('enforces on a dynamic path', () => {
    expect(
      contentSecurityPolicyHeader('/checkout/sample', nonce, production),
    ).toEqual({
      key: enforcedHeaderName,
      value: enforcedContentSecurityPolicy(nonce, production),
    });
  });

  it('reports only on a cached path', () => {
    expect(contentSecurityPolicyHeader('/', nonce, production)).toEqual({
      key: reportOnlyHeaderName,
      value: reportOnlyContentSecurityPolicy(production),
    });
  });

  it('names both headers Next.js reads a nonce from', () => {
    expect(contentSecurityPolicyHeaderNames).toEqual([
      'Content-Security-Policy',
      'Content-Security-Policy-Report-Only',
    ]);
  });
});

describe('isPrefetchRequest', () => {
  it.each([
    [{ 'next-router-prefetch': '1' }, true],
    [{ purpose: 'prefetch' }, true],
    [{ Purpose: 'Prefetch' }, true],
    [{ purpose: 'navigation' }, false],
    [{}, false],
  ])('%j is a prefetch: %s', (headers, expected) => {
    expect(isPrefetchRequest(new Headers(headers))).toBe(expected);
  });
});

describe('securityHeaders', () => {
  it.each([
    ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', 'DENY'],
    [
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=()',
    ],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
  ])('sets %s once', (key, value) => {
    const matches = securityHeaders.filter((header) => header.key === key);
    expect(matches).toEqual([{ key, value }]);
  });

  it('holds nothing else', () => {
    expect(securityHeaders).toHaveLength(7);
  });
});
