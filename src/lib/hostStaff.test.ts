import { describe, expect, it } from 'vitest';
import {
  hostInviteNotice,
  hostNavLinks,
  hostStaffGrant,
  hostStaffNotices,
  hostStaffResult,
  maxHostStaff,
} from './hostStaff';
import { isValidGrantScope } from './roleGrants';
import { staffReadLimit } from './staffAdmin';

// Behaviours under test, one per decision, branch or risk:
// - the grant a host owner gives is host staff on the named host, and fits its role
// - the staff cap fits in one staff read, so the page never hides a member
// - nobody signed in signs in; a caller who owns no host, host staff included, is refused
// - an owner with rows sees them; an owner who could not read them is refused
// - an owner is linked to the sessions and the staff page; staff only to the sessions
// - an invite refused for the cap or the owner's rate says so; every other result is ops staff's notice
// - every notice the page can name has text

const hostId = '00000000-0000-4000-8000-00000000000a';
const rows = [
  { userId: 'u1', email: 'staff@example.com', roles: ['host_staff'] },
] as const;

describe('hostStaffGrant', () => {
  it('is host staff on the host, a grant that fits its role', () => {
    expect(hostStaffGrant(hostId)).toEqual({ role: 'host_staff', hostId });
    expect(isValidGrantScope(hostStaffGrant(hostId))).toBe(true);
  });
});

describe('maxHostStaff', () => {
  it('is a small positive number that one staff read can show whole', () => {
    expect(maxHostStaff).toBeGreaterThan(0);
    expect(maxHostStaff).toBeLessThanOrEqual(staffReadLimit);
  });
});

describe('hostStaffResult', () => {
  it('sends nobody signed in to sign in, even with rows', () => {
    expect(hostStaffResult({ kind: 'signed_out' }, rows)).toEqual({
      status: 'signed_out',
    });
  });

  it.each([
    ['a caller with no host role', { kind: 'no_host_role' } as const],
    ['host staff', { kind: 'staff', hostId } as const],
  ])('refuses %s, even with rows', (_name, access) => {
    expect(hostStaffResult(access, rows)).toEqual({ status: 'refused' });
  });

  it('refuses an owner with no rows to show, and shows an owner theirs', () => {
    const owner = { kind: 'owner', hostId } as const;
    expect(hostStaffResult(owner, null)).toEqual({ status: 'refused' });
    expect(hostStaffResult(owner, rows)).toEqual({ status: 'ok', rows });
  });
});

describe('hostNavLinks', () => {
  it('links an owner to the sessions to manage and the staff page', () => {
    expect(hostNavLinks(true)).toEqual([
      { label: 'Manage sessions', href: '/host/sessions' },
      { label: 'Staff', href: '/host/staff' },
    ]);
  });

  it('links staff to the sessions to look at and nothing else', () => {
    expect(hostNavLinks(false)).toEqual([
      { label: 'Sessions', href: '/host/sessions' },
    ]);
  });
});

describe('hostInviteNotice', () => {
  it.each([
    ['cap_reached', true, 'staff_cap'],
    ['too_many_invites', true, 'invites_limited'],
    ['sent', true, 'invited'],
    ['rate_limited', true, 'granted_rate_limited'],
    ['failed', true, 'granted_invite_failed'],
    ['sent', false, 'invited'],
    ['rate_limited', false, 'rate_limited'],
    ['failed', false, 'invite_failed'],
    ['not_found', false, 'not_found'],
  ] as const)('%s (after an invite: %s) says %s', (result, after, notice) => {
    expect(hostInviteNotice(result, after)).toBe(notice);
    expect(hostStaffNotices[notice].title).not.toBe('');
  });

  it('names the cap in its notice', () => {
    expect(hostStaffNotices.staff_cap.title).toContain(String(maxHostStaff));
  });
});
