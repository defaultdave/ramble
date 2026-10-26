import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDynamicRoutePath, securityHeaders } from '@/lib/securityHeaders';
import nextConfig from '../next.config';

const root = path.resolve(import.meta.dirname, '..');
const appDir = path.join(root, 'src/app');

type PageRoute = { group: string; urlPath: string; dynamic: boolean };

function segmentToUrl(segment: string): string {
  if (segment.startsWith('[...')) return 'sample/unknown';
  if (segment.startsWith('[')) return 'sample';
  return segment;
}

function pagesUnder(dir: string, segments: string[]): string[][] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return pagesUnder(full, [...segments, entry]);
    }
    return entry === 'page.tsx' ? [segments] : [];
  });
}

/** Every page in the app, with whether its route group's root layout renders per request. */
function pageRoutes(): PageRoute[] {
  return readdirSync(appDir)
    .filter((entry) => entry.startsWith('('))
    .flatMap((group) => {
      const groupDir = path.join(appDir, group);
      const layout = readFileSync(path.join(groupDir, 'layout.tsx'), 'utf8');
      const dynamic = /export const instant = false/.test(layout);
      return pagesUnder(groupDir, []).map((segments) => ({
        group,
        urlPath: `/${segments.map(segmentToUrl).join('/')}`,
        dynamic,
      }));
    });
}

describe('next.config headers', () => {
  it('applies the security header set to every path', async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([
      { source: '/:path*', headers: [...securityHeaders] },
    ]);
  });
});

describe('dynamic route prefixes', () => {
  const routes = pageRoutes();

  it('cover every route group in the app', () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes.map(({ group }) => group)).size).toBeGreaterThan(1);
  });

  it.each(routes)(
    '$urlPath in $group is dynamic: $dynamic',
    ({ urlPath, dynamic }) => {
      expect(isDynamicRoutePath(urlPath)).toBe(dynamic);
    },
  );
});

describe('security.txt', () => {
  const file = readFileSync(
    path.join(root, 'public/.well-known/security.txt'),
    'utf8',
  );
  const fields = new Map(
    file
      .trimEnd()
      .split('\n')
      .map((line) => line.split(/:\s(.*)/s, 2) as [string, string]),
  );

  it('names a contact', () => {
    expect(fields.get('Contact')).toMatch(/^(https:\/\/|mailto:)/);
  });

  it('expires on a date that has not passed (RFC 9116 wants it renewed yearly)', () => {
    const expires = new Date(fields.get('Expires') ?? '');
    expect(Number.isNaN(expires.getTime())).toBe(false);
    expect(expires.getTime()).toBeGreaterThan(Date.now());
  });

  it('ends with one newline', () => {
    expect(file.endsWith('\n')).toBe(true);
    expect(file.endsWith('\n\n')).toBe(false);
  });
});
