import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR 0007: Sentry's browser script stays off checkout, which carries no third-party tags
// (PCI SAQ A, ADR 0003). The check follows every import from the checkout route group, so a
// script reached through a shared component is caught as well as one named in a layout.

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src');
const checkoutGroup = path.join(src, 'app', '(checkout)');
const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveImport(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(src, specifier.slice(2));
  else if (specifier.startsWith('.'))
    base = path.resolve(path.dirname(from), specifier);
  else return null;
  const hit = ['', ...extensions].map((suffix) => base + suffix).find(isFile);
  return hit && /\.tsx?$/.test(hit) ? hit : null;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  );
}

/** Every module the checkout route group can load, with the specifiers that reached it. */
function checkoutClosure() {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  // global-error replaces the root layout for every group, checkout included, when it renders.
  const queue = [
    path.join(src, 'app', 'global-error.tsx'),
    ...listFiles(checkoutGroup).filter((f) => /\.(ts|tsx)$/.test(f)),
  ];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      specifiers.add(specifier);
      const next = resolveImport(specifier, file);
      if (next) queue.push(next);
    }
  }
  return { files: [...seen], specifiers: [...specifiers] };
}

describe('the checkout route group', () => {
  const { files, specifiers } = checkoutClosure();

  it('reaches a meaningful set of modules', () => {
    expect(files.length).toBeGreaterThan(8);
    expect(files.some((f) => f.endsWith('SiteShell.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('global-error.tsx'))).toBe(true);
  });

  it('imports no Sentry package and no Sentry browser script', () => {
    expect(specifiers.filter((s) => /sentry/i.test(s))).toEqual([]);
    expect(files.filter((f) => /sentry/i.test(f))).toEqual([]);
  });

  it('names no Sentry host or loader in any module it loads', () => {
    const offenders = files.filter((file) =>
      /sentry-cdn|ingest\.sentry|SENTRY_BROWSER_DSN/i.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('is not given a Sentry browser SDK by the framework either', () => {
    const clientEntries = readdirSync(src).filter((name) =>
      name.startsWith('instrumentation-client'),
    );
    const nextConfig = readFileSync(path.join(root, 'next.config.ts'), 'utf8');

    for (const entry of clientEntries) {
      expect(readFileSync(path.join(src, entry), 'utf8')).not.toMatch(
        /sentry/i,
      );
    }
    expect(nextConfig).not.toMatch(/sentry/i);
  });

  it('is given BotID only through the guest-page guard in the framework client entry', () => {
    const entry = readFileSync(
      path.join(src, 'instrumentation-client.ts'),
      'utf8',
    );

    expect(entry).toMatch(
      /if \(shouldLoadBotId\(window\.location\.pathname\)\)/,
    );
    expect(specifiers.filter((s) => /botid/i.test(s))).toEqual([]);
  });
});
