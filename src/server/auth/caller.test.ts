import { describe, expect, it } from 'vitest';
import {
  anonymousCaller,
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

describe('getCaller', () => {
  it('is anonymous until sessions exist', async () => {
    expect(await getCaller()).toEqual(anonymousCaller);
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
