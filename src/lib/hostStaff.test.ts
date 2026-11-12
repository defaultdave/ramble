import { describe, expect, it } from 'vitest';
import { hostStaffGrant, hostStaffResult } from './hostStaff';
import { isValidGrantScope } from './roleGrants';

// Behaviours under test, one per decision, branch or risk:
// - the grant a host owner gives is host staff on the named host, and fits its role
// - nobody signed in signs in; a caller who owns no host, host staff included, is refused
// - an owner with rows sees them; an owner who could not read them is refused

const hostId = '00000000-0000-4000-8000-00000000000a';
const rows = [{ userId: 'u1', email: 'staff@example.com' }];

describe('hostStaffGrant', () => {
  it('is host staff on the host, a grant that fits its role', () => {
    expect(hostStaffGrant(hostId)).toEqual({ role: 'host_staff', hostId });
    expect(isValidGrantScope(hostStaffGrant(hostId))).toBe(true);
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
