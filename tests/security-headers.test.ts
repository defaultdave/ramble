import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dynamicRoutePrefixes,
  isDynamicRoutePath,
  securityHeaders,
} from '@/lib/securityHeaders';
import nextConfig from '../next.config';

const root = path.resolve(import.meta.dirname, '..');
const appDir = path.join(root, 'src/app');

type PageRoute = { group: string; urlPath: string; dynamic: boolean };

function isDirectory(full: string): boolean {
  return statSync(full).isDirectory();
}

function childDirectories(dir: string): string[] {
  return readdirSync(dir)
    .map((entry) => path.join(dir, entry))
    .filter(isDirectory);
}

function isGroup(dir: string): boolean {
  return path.basename(dir).startsWith('(');
}

/** A route group inside a route group, such as `(site)` under `(checkout)`, is no part of the address. */
function isGroupSegment(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')');
}

function segmentToUrl(segment: string): string {
  if (isGroupSegment(segment)) return '';
  if (segment.startsWith('[...')) return 'sample/unknown';
  if (segment.startsWith('[')) return 'sample';
  return segment;
}

function pagesUnder(dir: string, segments: string[]): string[][] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (isDirectory(full)) return pagesUnder(full, [...segments, entry]);
    return entry === 'page.tsx' ? [segments] : [];
  });
}

function groupRendersPerRequest(group: string): boolean {
  const layout = readFileSync(path.join(appDir, group, 'layout.tsx'), 'utf8');
  return /export const instant = false/.test(layout);
}

/** Every page in the app, with whether its route group's root layout renders per request. */
function pageRoutes(): PageRoute[] {
  return childDirectories(appDir)
    .filter(isGroup)
    .map((dir) => path.basename(dir))
    .flatMap((group) => {
      const dynamic = groupRendersPerRequest(group);
      return pagesUnder(path.join(appDir, group), []).map((segments) => ({
        group,
        urlPath: `/${segments.map(segmentToUrl).filter(Boolean).join('/')}`,
        dynamic,
      }));
    });
}

/** Route groups are transparent to the URL: a position in the tree is every directory that shares it. */
function expandGroups(dirs: string[]): string[] {
  return dirs.flatMap((dir) => [
    dir,
    ...expandGroups(childDirectories(dir).filter(isGroup)),
  ]);
}

function childrenNamed(dirs: string[], test: (name: string) => boolean) {
  return dirs.flatMap((dir) =>
    childDirectories(dir).filter((child) => test(path.basename(child))),
  );
}

/**
 * The page a URL resolves to, the way Next.js matches: a literal segment first, then one
 * `[param]`, then a `[...catchAll]` for whatever is left.
 */
function resolvePage(dirs: string[], segments: string[]): string | undefined {
  const here = expandGroups(dirs);
  const [segment, ...rest] = segments;
  if (segment === undefined) {
    return here.map((dir) => path.join(dir, 'page.tsx')).find(existsSync);
  }
  const literal = childrenNamed(here, (name) => name === segment);
  const param = childrenNamed(
    here,
    (name) => name.startsWith('[') && !name.startsWith('[...'),
  );
  const catchAll = childrenNamed(here, (name) => name.startsWith('[...'));
  return (
    (literal.length ? resolvePage(literal, rest) : undefined) ??
    (param.length ? resolvePage(param, rest) : undefined) ??
    catchAll.map((dir) => path.join(dir, 'page.tsx')).find(existsSync)
  );
}

function groupOf(pagePath: string): string {
  const relative = path.relative(appDir, pagePath);
  const group = relative.split(path.sep).find(isGroupName);
  if (!group) throw new Error(`${relative} is outside every route group`);
  return group;
}

function isGroupName(segment: string): boolean {
  return segment.startsWith('(');
}

describe('next.config headers', () => {
  it('applies the security header set to every path', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules[0]).toEqual({
      source: '/:path*',
      headers: [...securityHeaders],
    });
  });

  it('adds nothing else but the BotID challenge proxy rule', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const others = rules.slice(1).map((rule) => rule.source);

    expect(others).toHaveLength(1);
    expect(others[0]).toMatch(/^\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/:path\*$/);
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

  const shapes = dynamicRoutePrefixes.flatMap((prefix) => [
    prefix,
    `${prefix}/a`,
    `${prefix}/a/b/c`,
  ]);

  // A path under a dynamic prefix that no page in a per-request group serves would fall through
  // to the guest catch-all's prerendered shell, whose scripts carry no nonce.
  it.each(shapes)(
    '%s resolves to a page in a group that renders per request',
    (urlPath) => {
      const page = resolvePage([appDir], urlPath.split('/').filter(Boolean));
      expect(page, 'no page').toBeDefined();
      expect(groupRendersPerRequest(groupOf(page ?? ''))).toBe(true);
    },
  );

  it.each(['/', '/gifts', '/gifts/a', '/a/b/c', '/experiences/sample'])(
    '%s resolves to a page in a cached group',
    (urlPath) => {
      const page = resolvePage([appDir], urlPath.split('/').filter(Boolean));
      expect(page, 'no page').toBeDefined();
      expect(groupRendersPerRequest(groupOf(page ?? ''))).toBe(false);
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
