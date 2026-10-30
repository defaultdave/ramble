import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '@/proxy';

const attacker = "script-src 'nonce-ATTACKER'";
const enforced = 'content-security-policy';
const reportOnly = 'content-security-policy-report-only';

function run(path: string, headers: Record<string, string> = {}) {
  const response = proxy(
    new NextRequest(`http://localhost${path}`, { headers }),
  );
  // NextResponse.next() encodes the request headers it forwards as these two fields.
  const forwarded = (
    response.headers.get('x-middleware-override-headers') ?? ''
  )
    .split(',')
    .filter(Boolean);
  return {
    response,
    forwarded,
    forwardedPolicy: response.headers.get(`x-middleware-request-${enforced}`),
  };
}

describe('proxy', () => {
  it('enforces its own policy on a dynamic path and forwards the same policy to the renderer', () => {
    const { response, forwardedPolicy } = run('/ops');
    const policy = response.headers.get(enforced);
    expect(policy).toMatch(/'nonce-[A-Za-z0-9+/=]{24}'/);
    expect(forwardedPolicy).toBe(policy);
    expect(response.headers.get(reportOnly)).toBeNull();
  });

  it('reports only on a cached path and forwards no policy', () => {
    const { response, forwarded, forwardedPolicy } = run('/');
    expect(response.headers.get(reportOnly)).not.toContain('nonce-');
    expect(response.headers.get(enforced)).toBeNull();
    expect(forwardedPolicy).toBeNull();
    expect(forwarded).not.toContain(enforced);
  });

  it('never allows eval in production', () => {
    expect(run('/ops').response.headers.get(enforced)).not.toContain(
      "'unsafe-eval'",
    );
  });

  it.each(['/ops', '/', '/checkout/sample'])(
    'drops a client-supplied policy header on %s',
    (path) => {
      const { response, forwardedPolicy, forwarded } = run(path, {
        [enforced]: attacker,
        [reportOnly]: attacker,
      });
      expect(forwardedPolicy ?? '').not.toContain('ATTACKER');
      expect(forwarded).not.toContain(reportOnly);
      expect(
        response.headers.get(`x-middleware-request-${reportOnly}`),
      ).toBeNull();
      expect(response.headers.get(enforced) ?? '').not.toContain('ATTACKER');
    },
  );

  it.each([
    ['next-router-prefetch', '1'],
    ['purpose', 'prefetch'],
  ])(
    'applies the tier to a prefetch (%s) like any other request',
    (name, value) => {
      const { response, forwarded, forwardedPolicy } = run('/ops', {
        [name]: value,
        [enforced]: attacker,
      });
      const policy = response.headers.get(enforced);
      expect(policy).toMatch(/'nonce-/);
      expect(policy).not.toContain('ATTACKER');
      expect(forwardedPolicy).toBe(policy);
      expect(forwarded).toContain(name);
    },
  );

  describe('a confirmation link', () => {
    const token = 'A'.repeat(43);

    it('moves the token into a cookie for that order and redirects to the page without it', () => {
      const { response } = run(`/orders/RMB-A3K7MN?t=${token}&utm=x`);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        'http://localhost/orders/RMB-A3K7MN',
      );
      const cookie = response.headers.get('set-cookie') ?? '';
      expect(cookie).toContain(`ramble_order_access=${token}`);
      expect(cookie).toContain('Path=/orders/RMB-A3K7MN');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it.each([
      `/orders/RMB-A3K7MN?t=short`,
      `/orders/sample?t=${token}`,
      `/orders/RMB-A3K7MN`,
    ])('leaves %s to the page, with no cookie', (path) => {
      const { response } = run(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('keeps the page itself out of indexes and caches', () => {
      const { response } = run('/orders/RMB-A3K7MN');
      expect(response.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('issues a different nonce per request', () => {
    const nonces = new Set(
      [1, 2, 3].map((n) =>
        run(`/ops?n=${String(n)}`).response.headers.get(enforced),
      ),
    );
    expect(nonces.size).toBe(3);
  });

  it('matches every page path and skips only the api, build asset, and favicon paths', () => {
    expect(config.matcher).toEqual([
      '/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)',
    ]);
    const pattern = new RegExp(`^${config.matcher[0] ?? ''}$`);
    for (const path of [
      '/',
      '/apiary',
      '/ops',
      '/favicon.ico.bak',
      '/.well-known/security.txt',
      '/_next/staticx',
      '/_next/imagex',
    ]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of [
      '/api',
      '/api/pulse',
      '/_next/static',
      '/_next/static/x.js',
      '/_next/image',
      '/_next/image/x',
      '/favicon.ico',
    ]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
