import { describe, expect, it } from 'vitest';
import type { AuditRow } from './audit';
import {
  auditDetailsLabel,
  auditViewRow,
  grantRefusal,
  parseAuditCursor,
  parseAuditDay,
  parseStaffEmail,
  revokeNotice,
  revokeRefusal,
  staffInviteNotice,
  staffLinkData,
  staffNoticeCodes,
  staffNotices,
} from './staffAdmin';

// Behaviours under test:
// - the invite form's address is trimmed and lower-cased; blank, too long, or not an address is refused
// - ops may not give or take back admin; nobody takes back their own access; any other grant may go
// - the invite email links to the confirm page, lands on /ops, and says how long the link lives
// - every outcome of an invite or a revoke has a notice
// - the audit day is the one named, or today in UTC for a missing, repeated, or impossible one
// - the audit cursor is digits that fit a safe integer, else the start of the day
// - an audit row shows its UTC time, actor, subject and details without a name or an address

const userId = '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const otherId = '2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const opsGrant = { role: 'ops', hostId: null } as const;

describe('parseStaffEmail', () => {
  it.each([
    ['  Name@Example.com ', 'name@example.com'],
    ['plain@example.org', 'plain@example.org'],
    ['', null],
    ['   ', null],
    ['not an address', null],
    ['Name <name@example.com>', null],
    [`${'a'.repeat(250)}@example.com`, null],
    [undefined, null],
    [42, null],
  ])('%j is %j', (typed, expected) => {
    expect(parseStaffEmail(() => typed)).toBe(expected);
  });
});

describe('grantRefusal and revokeRefusal', () => {
  it.each([
    ['ops', null],
    ['host_staff', null],
    ['admin', 'admin_role'],
  ] as const)('giving %s is %j', (role, expected) => {
    expect(grantRefusal({ role, hostId: null })).toBe(expected);
  });

  it.each([
    [userId, otherId, opsGrant, null],
    [userId, userId, opsGrant, 'self'],
    [userId, otherId, { role: 'admin', hostId: null }, 'admin_role'],
    [userId, userId, { role: 'admin', hostId: null }, 'admin_role'],
  ] as const)(
    '%s taking back from %s a %j is %j',
    (actor, target, grant, expected) => {
      expect(revokeRefusal(actor, target, grant)).toBe(expected);
    },
  );
});

describe('staffLinkData', () => {
  it('points at the confirm page, lands on the ops area, and states the lifetime', () => {
    const data = staffLinkData(
      'abcdefghijklmnopqrstuvwxyzABCDEF',
      'https://ramble.test',
    );
    const url = new URL(data.url);
    expect(url.origin).toBe('https://ramble.test');
    expect(url.searchParams.get('token')).toBe(
      'abcdefghijklmnopqrstuvwxyzABCDEF',
    );
    expect(url.searchParams.get('next')).toBe('/ops');
    expect(data.expiresInMinutes).toBeGreaterThan(0);
  });
});

describe('notices', () => {
  it.each([
    ['sent', 'invited'],
    ['rate_limited', 'rate_limited'],
    ['failed', 'invite_failed'],
    ['not_found', 'not_found'],
  ] as const)('an invite that is %s says %s', (result, code) => {
    expect(staffInviteNotice(result)).toBe(code);
  });

  it.each([
    ['revoked', 'revoked'],
    ['not_found', 'not_found'],
    ['self', 'revoke_self'],
    ['admin_role', 'revoke_refused'],
  ] as const)('a revoke that is %s says %s', (outcome, code) => {
    expect(revokeNotice(outcome)).toBe(code);
  });

  it('has text for every code', () => {
    for (const code of staffNoticeCodes) {
      expect(staffNotices[code].title).not.toBe('');
    }
  });
});

describe('parseAuditDay', () => {
  const now = new Date('2026-11-11T23:30:00Z');
  it.each([
    ['2026-11-01', '2026-11-01'],
    [undefined, '2026-11-11'],
    [['2026-11-01', '2026-11-02'], '2026-11-11'],
    ['2026-02-30', '2026-11-11'],
    ['yesterday', '2026-11-11'],
    ['1999-12-31', '2026-11-11'],
  ])('%j is %s', (raw, expected) => {
    expect(parseAuditDay(raw, now)).toBe(expected);
  });
});

describe('parseAuditCursor', () => {
  it.each([
    ['42', 42],
    [undefined, 0],
    [['1', '2'], 0],
    ['-1', 0],
    ['1e3', 0],
    ['4 2', 0],
    ['', 0],
    ['9'.repeat(16), 0],
    ['9'.repeat(15), 999999999999999],
  ])('%j is %j', (raw, expected) => {
    expect(parseAuditCursor(raw)).toBe(expected);
  });
});

describe('the audit viewer row', () => {
  const row = (overrides: Partial<AuditRow> = {}): AuditRow => ({
    id: 7,
    recordedAt: new Date('2026-11-11T09:05:03.250Z'),
    actorKind: 'user',
    actorId: userId,
    action: 'role.granted',
    subjectKind: 'auth_user',
    subjectId: otherId,
    details: { role: 'ops' },
    ...overrides,
  });

  it('shows the time in UTC, the actor and subject by id, and the details', () => {
    expect(auditViewRow(row())).toEqual({
      id: '7',
      time: '09:05:03 UTC',
      actor: `user ${userId}`,
      action: 'role.granted',
      subject: `auth_user ${otherId}`,
      details: 'role: ops',
    });
  });

  it('names the kind alone for an actor with no id', () => {
    expect(
      auditViewRow(row({ actorKind: 'system', actorId: null })).actor,
    ).toBe('system');
  });

  it.each([
    [{}, '—'],
    [null, '—'],
    ['text', '—'],
    [
      { role: 'host_staff', host_id: otherId, flag: true, n: 3, gone: null },
      `role: host_staff, host_id: ${otherId}, flag: true, n: 3, gone: null`,
    ],
  ])('details %j read %s', (details, expected) => {
    expect(auditDetailsLabel(details)).toBe(expected);
  });
});
