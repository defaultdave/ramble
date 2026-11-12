import { describe, expect, it } from 'vitest';
import {
  hostAccessFor,
  hostAreaResult,
  hostDashboardResult,
  hostIdToRead,
  readableHostId,
  type HostAccess,
  type HostAccessInput,
} from './hostAccess';

// Behaviours under test, one per decision, branch or risk:
// - nobody signed in is told to sign in
// - a guest, ops, and admin are signed in but hold no host role
// - an owner gets the host they own, and host staff the host they staff, from their grants and nowhere else
// - owner of one host and staff of another gets the owned host, not the staffed one
// - an owner of several hosts gets the first granted
// - only an owner or staff has a host to read
// - the page's outcome: sign in for nobody, refused for no host role or a missing host, the view for an owner (who may manage) or staff (who may not)

const hostA = '00000000-0000-4000-8000-00000000000a';
const hostB = '00000000-0000-4000-8000-00000000000b';

const signedIn = (
  hostGrants?: HostAccessInput['hostGrants'],
): HostAccessInput => ({ userId: 'user-1', hostGrants });

describe('hostAccessFor', () => {
  it('signs out nobody', () => {
    expect(hostAccessFor({ userId: null, hostGrants: [] })).toEqual({
      kind: 'signed_out',
    });
  });

  it.each([
    ['a guest, ops, or admin', signedIn([])],
    ['a caller with no grants listed', signedIn()],
  ])('holds no host role for %s', (_name, caller) => {
    expect(hostAccessFor(caller)).toEqual({ kind: 'no_host_role' });
  });

  it('gives host staff the host they staff, the first granted of several', () => {
    expect(
      hostAccessFor(
        signedIn([
          { role: 'host_staff', hostId: hostB },
          { role: 'host_staff', hostId: hostA },
        ]),
      ),
    ).toEqual({ kind: 'staff', hostId: hostB });
  });

  it('gives an owner their host', () => {
    expect(
      hostAccessFor(signedIn([{ role: 'host_owner', hostId: hostA }])),
    ).toEqual({ kind: 'owner', hostId: hostA });
  });

  it('gives the owned host to someone who owns one and is staff on another', () => {
    expect(
      hostAccessFor(
        signedIn([
          { role: 'host_staff', hostId: hostA },
          { role: 'host_owner', hostId: hostB },
        ]),
      ),
    ).toEqual({ kind: 'owner', hostId: hostB });
  });

  it('gives the first granted of several owned hosts', () => {
    expect(
      hostAccessFor(
        signedIn([
          { role: 'host_owner', hostId: hostB },
          { role: 'host_owner', hostId: hostA },
        ]),
      ),
    ).toEqual({ kind: 'owner', hostId: hostB });
  });
});

describe('readableHostId', () => {
  it.each([
    [{ kind: 'owner', hostId: hostA } as const, hostA],
    [{ kind: 'staff', hostId: hostB } as const, hostB],
    [{ kind: 'no_host_role' } as const, null],
    [{ kind: 'signed_out' } as const, null],
  ] satisfies [HostAccess, string | null][])(
    'reads %j as %s',
    (access, expected) => {
      expect(readableHostId(access)).toBe(expected);
    },
  );
});

describe('hostIdToRead', () => {
  it.each([
    ['an owner', { kind: 'owner', hostId: hostA } as const, false, hostA],
    ['an owner', { kind: 'owner', hostId: hostA } as const, true, hostA],
    ['host staff', { kind: 'staff', hostId: hostB } as const, false, null],
    ['host staff', { kind: 'staff', hostId: hostB } as const, true, hostB],
    ['no host role', { kind: 'no_host_role' } as const, false, null],
    ['no host role', { kind: 'no_host_role' } as const, true, null],
    ['nobody signed in', { kind: 'signed_out' } as const, false, null],
    ['nobody signed in', { kind: 'signed_out' } as const, true, null],
  ] satisfies [string, HostAccess, boolean, string | null][])(
    'for %s with allowStaff %s reads %s',
    (_who, access, allowStaff, expected) => {
      expect(hostIdToRead(access, allowStaff)).toBe(expected);
    },
  );
});

describe('hostAreaResult', () => {
  const ok = (value: string) => ({ status: 'ok' as const, value });
  const staff = { kind: 'staff', hostId: hostA } as const;

  it('refuses staff unless the page allows them', () => {
    expect(hostAreaResult(staff, 'data', ok)).toEqual({ status: 'refused' });
    expect(hostAreaResult(staff, 'data', ok, false)).toEqual({
      status: 'refused',
    });
  });

  it('admits staff when the page allows them', () => {
    expect(hostAreaResult(staff, 'data', ok, true)).toEqual({
      status: 'ok',
      value: 'data',
    });
  });

  it('admits an owner either way, and refuses a gone host either way', () => {
    const owner = { kind: 'owner', hostId: hostA } as const;
    expect(hostAreaResult(owner, 'data', ok)).toEqual(ok('data'));
    expect(hostAreaResult(owner, null, ok, true)).toEqual({
      status: 'refused',
    });
  });
});

describe('hostDashboardResult', () => {
  const data = { hostName: 'Harbor Co', sessions: [], bookings: [] };

  it.each([
    ['without data', null],
    ['with data', data],
  ])('sends nobody signed in to sign in %s', (_name, given) => {
    expect(hostDashboardResult({ kind: 'signed_out' }, given)).toEqual({
      status: 'signed_out',
    });
  });

  it.each([
    [
      'a caller with no host role, even with data',
      { kind: 'no_host_role' } as const,
      data,
    ],
    [
      'an owner whose host is gone',
      { kind: 'owner', hostId: hostA } as const,
      null,
    ],
  ])('refuses %s', (_name, access, given) => {
    expect(hostDashboardResult(access, given)).toEqual({ status: 'refused' });
  });

  it.each([
    ['an owner', { kind: 'owner', hostId: hostA } as const, true],
    ['host staff', { kind: 'staff', hostId: hostA } as const, false],
  ])(
    'builds the view for %s, who may manage: %s',
    (_name, access, canManage) => {
      expect(hostDashboardResult(access, data)).toEqual({
        status: 'ok',
        view: { hostName: 'Harbor Co', sessions: [], bookings: [] },
        canManage,
      });
    },
  );
});
