import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleGrant } from '@/lib/roleGrants';
import {
  anonymousCaller,
  callerForHeaders,
  callerFromGrants,
  ForbiddenError,
  getCaller,
  requireRole,
  Role,
  type Resource,
} from './caller';
import { TEST_HOST_ID, TEST_USER_ID, testCaller } from './test-caller';

const ownHost = { hostId: TEST_HOST_ID };
const otherHost = { hostId: 'host-other' };
const ownRow = { ownerId: TEST_USER_ID };
const otherRow = { ownerId: 'user-other' };

const readSession = vi.hoisted(() => vi.fn());
const readRoleGrants = vi.hoisted(() => vi.fn());
const extendSessionExpiry = vi.hoisted(() => vi.fn());
const requestHeaders = vi.hoisted(() => vi.fn());
vi.mock('./session', () => ({ readSession }));
vi.mock('@/server/db/roleGrants', () => ({ readRoleGrants }));
vi.mock('@/server/db/authSessions', () => ({ extendSessionExpiry }));
vi.mock('next/headers', () => ({ headers: requestHeaders }));

// Behaviours under test for the session side, one per decision, branch, or risk:
// - everyone signed in is a guest; each grant adds its role; host roles add their hosts, once each
// - a grant whose host does not match its role is skipped, never half used
// - no session, or a session past its deadline or ceiling, is the anonymous caller and reads no grants
// - a live session gives the caller with its grants, and a request moves its deadline on
// - a failed read of the session or the grants is an error, never an anonymous pass
// - getCaller reads the request's own headers
// - the Caller built from grants passes and fails requireRole as the fixed test caller does

const host = 'b6a5f4d3-0000-4000-8000-000000000001';
const otherHostId = 'b6a5f4d3-0000-4000-8000-000000000002';
const now = new Date('2026-11-10T12:00:00.000Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);
const userId = 'b6a5f4d3-0000-4000-8000-0000000000aa';

describe('callerFromGrants', () => {
  it.each<[string, RoleGrant[], { roles: Role[]; hostIds: string[] }]>([
    ['no grants', [], { roles: [Role.Guest], hostIds: [] }],
    [
      'a host owner',
      [{ role: 'host_owner', hostId: host }],
      { roles: [Role.Guest, Role.HostOwner], hostIds: [host] },
    ],
    [
      'staff of two hosts, each host once',
      [
        { role: 'host_staff', hostId: host },
        { role: 'host_staff', hostId: otherHostId },
        { role: 'host_staff', hostId: host },
      ],
      { roles: [Role.Guest, Role.HostStaff], hostIds: [host, otherHostId] },
    ],
    [
      'ops, which has no host',
      [{ role: 'ops', hostId: null }],
      { roles: [Role.Guest, Role.Ops], hostIds: [] },
    ],
    [
      'a host role beside admin',
      [
        { role: 'host_owner', hostId: host },
        { role: 'admin', hostId: null },
      ],
      { roles: [Role.Guest, Role.HostOwner, Role.Admin], hostIds: [host] },
    ],
    [
      'a host role with no host, which is skipped',
      [{ role: 'host_owner', hostId: null }],
      { roles: [Role.Guest], hostIds: [] },
    ],
    [
      'ops with a host, which is skipped',
      [{ role: 'ops', hostId: host }],
      { roles: [Role.Guest], hostIds: [] },
    ],
  ])('gives %s', (_name, grants, expected) => {
    expect(callerFromGrants(userId, grants)).toEqual({ userId, ...expected });
  });

  it('builds a caller requireRole accepts for its own host and refuses for another', () => {
    const caller = callerFromGrants(userId, [
      { role: 'host_owner', hostId: host },
    ]);

    expect(() => {
      requireRole(caller, Role.HostOwner, { hostId: host });
    }).not.toThrow();
    expect(() => {
      requireRole(caller, Role.HostOwner, { hostId: otherHostId });
    }).toThrow(ForbiddenError);
    expect(() => {
      requireRole(caller, Role.Ops, {});
    }).toThrow(ForbiddenError);
  });

  it('builds a guest who owns their own rows only', () => {
    const caller = callerFromGrants(userId, []);

    expect(() => {
      requireRole(caller, Role.Guest, { ownerId: userId });
    }).not.toThrow();
    expect(() => {
      requireRole(caller, Role.Guest, { ownerId: 'someone-else' });
    }).toThrow(ForbiddenError);
  });
});

describe('callerForHeaders', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readRoleGrants.mockResolvedValue([{ role: 'ops', hostId: null }]);
  });

  const session = (expiresAt: Date, createdAt = minutes(-10)) => ({
    id: 'session-1',
    userId,
    createdAt,
    expiresAt,
  });

  it('is anonymous without a session, and reads no grants', async () => {
    readSession.mockResolvedValue(null);

    expect(await callerForHeaders(new Headers(), now)).toEqual(anonymousCaller);
    expect(readRoleGrants).not.toHaveBeenCalled();
  });

  it.each([
    ['past its idle deadline', session(minutes(-1))],
    ['at its idle deadline', session(minutes(0))],
    [
      'past the 8 hour ceiling though its deadline is later',
      session(minutes(20), minutes(-8 * 60 - 1)),
    ],
  ])(
    'is anonymous for a session %s, and writes nothing',
    async (_name, found) => {
      readSession.mockResolvedValue(found);

      expect(await callerForHeaders(new Headers(), now)).toEqual(
        anonymousCaller,
      );
      expect(readRoleGrants).not.toHaveBeenCalled();
      expect(extendSessionExpiry).not.toHaveBeenCalled();
    },
  );

  it('gives the person with their grants for a live session, and moves its deadline on', async () => {
    readSession.mockResolvedValue(session(minutes(10)));

    expect(await callerForHeaders(new Headers(), now)).toEqual({
      userId,
      roles: [Role.Guest, Role.Ops],
      hostIds: [],
    });
    expect(readRoleGrants).toHaveBeenCalledWith(userId);
    expect(extendSessionExpiry).toHaveBeenCalledWith(
      'session-1',
      minutes(30),
      now,
    );
  });

  it('writes nothing when the deadline is already within one touch interval of the new one', async () => {
    readSession.mockResolvedValue(session(minutes(29.5)));

    await callerForHeaders(new Headers(), now);

    expect(extendSessionExpiry).not.toHaveBeenCalled();
  });

  it.each([
    ['the session cannot be read', readSession],
    ['the grants cannot be read', readRoleGrants],
  ])(
    'fails closed when %s: the error reaches the caller',
    async (_name, failing) => {
      readSession.mockResolvedValue(session(minutes(10)));
      failing.mockRejectedValue(new Error('database down'));

      await expect(callerForHeaders(new Headers(), now)).rejects.toThrow(
        'database down',
      );
    },
  );
});

describe('getCaller', () => {
  it("reads the request's headers", async () => {
    const incoming = new Headers({ cookie: 'a=b' });
    requestHeaders.mockResolvedValue(incoming);
    readSession.mockResolvedValue(null);

    expect(await getCaller()).toEqual(anonymousCaller);
    expect(readSession).toHaveBeenCalledWith(incoming);
  });
});

describe('requireRole', () => {
  it.each<[string, Role, Resource, Partial<Parameters<typeof testCaller>[0]>]>([
    [
      'host owner on their own host',
      Role.HostOwner,
      ownHost,
      { roles: [Role.HostOwner], hostIds: [TEST_HOST_ID] },
    ],
    [
      'host staff on their own host',
      Role.HostStaff,
      ownHost,
      { roles: [Role.HostStaff], hostIds: [TEST_HOST_ID] },
    ],
    ['guest on their own row', Role.Guest, ownRow, {}],
    ['ops on any host', Role.Ops, otherHost, { roles: [Role.Ops] }],
    ['admin on any row', Role.Admin, otherRow, { roles: [Role.Admin] }],
    [
      'a caller holding several roles',
      Role.HostOwner,
      ownHost,
      { roles: [Role.Guest, Role.HostOwner], hostIds: [TEST_HOST_ID] },
    ],
  ])('allows %s', (_name, role, resource, overrides) => {
    expect(() => {
      requireRole(testCaller(overrides), role, resource);
    }).not.toThrow();
  });

  it.each<[string, Role, Resource, Partial<Parameters<typeof testCaller>[0]>]>([
    ['a caller without the role', Role.Ops, ownHost, {}],
    ['an anonymous caller', Role.Guest, ownRow, anonymousCaller],
    [
      'host owner on another host',
      Role.HostOwner,
      otherHost,
      { roles: [Role.HostOwner], hostIds: [TEST_HOST_ID] },
    ],
    [
      'host staff on another host',
      Role.HostStaff,
      otherHost,
      { roles: [Role.HostStaff], hostIds: [TEST_HOST_ID] },
    ],
    [
      'host owner when the resource names no host',
      Role.HostOwner,
      {},
      { roles: [Role.HostOwner], hostIds: [TEST_HOST_ID] },
    ],
    ['guest on another guest row', Role.Guest, otherRow, {}],
    ['guest when the resource names no owner', Role.Guest, {}, {}],
    [
      'a host role standing in for ops',
      Role.Ops,
      ownHost,
      { roles: [Role.HostOwner], hostIds: [TEST_HOST_ID] },
    ],
    ['ops standing in for admin', Role.Admin, ownHost, { roles: [Role.Ops] }],
  ])('denies %s', (_name, role, resource, overrides) => {
    expect(() => {
      requireRole(testCaller(overrides), role, resource);
    }).toThrow(ForbiddenError);
  });
});
