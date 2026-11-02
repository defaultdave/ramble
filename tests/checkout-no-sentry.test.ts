import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasServerActionDirective,
  importClosure,
  listFiles,
  root,
  src,
} from './support/importGraph';

// ADR 0007: Sentry's browser script stays off checkout, which carries no third-party tags
// (PCI SAQ A, ADR 0003). The check follows every import from the checkout route group, so a
// script reached through a shared component is caught as well as one named in a layout.

const checkoutGroup = path.join(src, 'app', '(checkout)');

/** Every module the checkout route group can load, with the specifiers that reached it. */
function checkoutClosure() {
  return importClosure([
    // global-error replaces the root layout for every group, checkout included, when it renders.
    path.join(src, 'app', 'global-error.tsx'),
    ...listFiles(checkoutGroup).filter((f) => /\.(ts|tsx)$/.test(f)),
  ]);
}

describe('the checkout route group', () => {
  const { files, specifiers } = checkoutClosure();

  it('reaches a meaningful set of modules', () => {
    expect(files.length).toBeGreaterThan(8);
    expect(files.some((f) => f.endsWith('GuestShell.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('global-error.tsx'))).toBe(true);
  });

  it('imports no Sentry package and no Sentry browser script', () => {
    expect(specifiers.filter((s) => /sentry/i.test(s))).toEqual([]);
    expect(files.filter((f) => /sentry/i.test(f))).toEqual([]);
  });

  it('names no Sentry host or loader in any module it loads', () => {
    // The validated env module names the variable so the guest layout can read it, and loads no
    // script. Only that name is allowed there; a Sentry host or loader is not.
    const envModule = path.join(src, 'server', 'env.ts');
    const offenders = files.filter((file) =>
      (file === envModule
        ? /sentry-cdn|ingest\.sentry/i
        : /sentry-cdn|ingest\.sentry|SENTRY_BROWSER_DSN/i
      ).test(readFileSync(file, 'utf8')),
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

  it('is given BotID only through the guest-page guard in the client entry wrapper', () => {
    const entry = readFileSync(
      path.join(src, 'instrumentation-client.ts'),
      'utf8',
    );

    const wrapper = readFileSync(
      path.join(src, 'server', 'ports', 'rate-limit', 'botid-client.ts'),
      'utf8',
    );

    expect(entry).toMatch(/startBotChallenge\(window\.location\.pathname\)/);
    expect(wrapper).toMatch(/if \(!shouldLoadBotId\(pathname\)\) return;/);
    expect(specifiers.filter((s) => /botid/i.test(s))).toEqual([]);
  });
});

describe("the 'use server' seam the closure stops at", () => {
  it.each([
    ["'use server';\nimport x from './x';", true],
    ['"use server"\nimport x from "./x";', true],
    ["// A comment first.\n\n'use server';\nimport x from './x';", true],
    ["'use client';\nimport x from './x';", false],
    ["import x from './x';\n'use server';", false],
    ["const note = 'use server';\nimport x from './x';", false],
    ["export const a = 1;\n// 'use server'\n", false],
    ['', false],
  ])('reads %j as an action module: %s', (text, expected) => {
    expect(hasServerActionDirective(text)).toBe(expected);
  });
});
