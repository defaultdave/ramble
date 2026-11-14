import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { holdsOpsRole, opsLandingLinks, opsNavLinks } from './opsNav';

// Behaviours under test:
// - the nav starts with the dashboard and has no duplicate link
// - every link points at a page that exists, so the nav has no dead link
// - the landing lists every area except the landing page itself
// - only the ops role counts as ops, not admin

describe('opsNavLinks', () => {
  it('starts with the dashboard and repeats no address', () => {
    expect(opsNavLinks[0]?.href).toBe('/ops');
    const hrefs = opsNavLinks.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it.each(opsNavLinks.map((link) => [link.href]))(
    '%s is a page in the ops group',
    (href) => {
      const page = join(process.cwd(), 'src/app/(ops)', href, 'page.tsx');
      expect(existsSync(page)).toBe(true);
    },
  );
});

describe('opsLandingLinks', () => {
  it('lists every area but the landing page', () => {
    expect(opsLandingLinks().map((link) => link.href)).toEqual([
      '/ops/mailbox',
      '/ops/hosts',
      '/ops/experiences',
      '/ops/support',
      '/ops/review',
      '/ops/staff',
      '/ops/sessions',
      '/ops/audit',
      '/ops/bookings',
    ]);
  });
});

describe('holdsOpsRole', () => {
  it.each([
    [['ops'], true],
    [['guest', 'ops'], true],
    [['admin'], false],
    [['guest', 'host_owner', 'host_staff'], false],
    [[], false],
  ])('%j is %s', (roles, expected) => {
    expect(holdsOpsRole(roles)).toBe(expected);
  });
});
