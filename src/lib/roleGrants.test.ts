import { describe, expect, it } from 'vitest';
import {
  grantableRoles,
  accessFromGrants,
  isValidGrantScope,
  ownsHostRole,
  pairEveryHostRole,
  type GrantableRole,
  type RoleGrant,
} from './roleGrants';

// Behaviours under test:
// - grants add up to roles, hosts, and role-and-host pairs, each listed once, with a mismatched grant skipped
// - a host role is owned on a host by its pair when pairs exist, and by any host when they do not
// - every host role pairs with every host, and other roles pair with none
// - a host role is valid with a host and not without; ops and admin are valid without one and not with one
// - guest is not grantable: it is what every signed-in person is

const host = '5f0a8f6e-6d51-4c41-9a2b-2f5a0d3f6b11';

describe('isValidGrantScope', () => {
  it.each<[GrantableRole, string | null, boolean]>([
    ['host_owner', host, true],
    ['host_staff', host, true],
    ['host_owner', null, false],
    ['host_staff', null, false],
    ['ops', null, true],
    ['admin', null, true],
    ['ops', host, false],
    ['admin', host, false],
  ])('%s with host %s is %s', (role, hostId, expected) => {
    expect(isValidGrantScope({ role, hostId })).toBe(expected);
  });
});

describe('grantableRoles', () => {
  it('does not include guest', () => {
    expect(grantableRoles).toEqual([
      'host_owner',
      'host_staff',
      'ops',
      'admin',
    ]);
  });
});

const hostB = '5f0a8f6e-6d51-4c41-9a2b-2f5a0d3f6b22';

describe('accessFromGrants', () => {
  it.each<[string, RoleGrant[], ReturnType<typeof accessFromGrants>]>([
    ['no grants', [], { roles: ['guest'], hostIds: [], hostGrants: [] }],
    [
      'staff of two hosts, each host once',
      [
        { role: 'host_staff', hostId: host },
        { role: 'host_staff', hostId: hostB },
        { role: 'host_staff', hostId: host },
      ],
      {
        roles: ['guest', 'host_staff'],
        hostIds: [host, hostB],
        hostGrants: [
          { role: 'host_staff', hostId: host },
          { role: 'host_staff', hostId: hostB },
          { role: 'host_staff', hostId: host },
        ],
      },
    ],
    [
      'a host role beside admin',
      [
        { role: 'host_owner', hostId: host },
        { role: 'admin', hostId: null },
      ],
      {
        roles: ['guest', 'host_owner', 'admin'],
        hostIds: [host],
        hostGrants: [{ role: 'host_owner', hostId: host }],
      },
    ],
    [
      'grants whose host does not match, which are skipped',
      [
        { role: 'host_owner', hostId: null },
        { role: 'ops', hostId: host },
      ],
      { roles: ['guest'], hostIds: [], hostGrants: [] },
    ],
  ])('gives %s', (_name, grants, expected) => {
    expect(accessFromGrants(grants)).toEqual(expected);
  });
});

describe('ownsHostRole', () => {
  const pairs = [
    { role: 'host_owner', hostId: host },
    { role: 'host_staff', hostId: hostB },
  ] as const;
  const access = { hostIds: [host, hostB], hostGrants: pairs };

  it.each([
    ['owner on its own host', 'host_owner', host, true],
    ['staff on its own host', 'host_staff', hostB, true],
    ['owner on the host it is only staff of', 'host_owner', hostB, false],
    ['staff on the host it is only owner of', 'host_staff', host, false],
    ['owner on an unknown host', 'host_owner', 'x', false],
  ] as const)('with pairs: %s is %s', (_name, role, hostId, expected) => {
    expect(ownsHostRole(access, role, hostId)).toBe(expected);
  });

  it('without pairs, counts any host the caller acts for', () => {
    expect(ownsHostRole({ hostIds: [host] }, 'host_owner', host)).toBe(true);
    expect(ownsHostRole({ hostIds: [host] }, 'host_owner', hostB)).toBe(false);
  });

  it('with an empty list of pairs, refuses every host', () => {
    expect(
      ownsHostRole({ hostIds: [host], hostGrants: [] }, 'host_owner', host),
    ).toBe(false);
  });
});

describe('pairEveryHostRole', () => {
  it.each([
    ['one host role on two hosts', ['guest', 'host_owner'], [host, hostB], 2],
    ['two host roles on one host', ['host_owner', 'host_staff'], [host], 2],
    ['no host role', ['guest', 'ops'], [host], 0],
    ['no hosts', ['host_owner'], [], 0],
  ])('%s gives %s pairs', (_name, roles, hostIds, count) => {
    expect(pairEveryHostRole(roles, hostIds)).toHaveLength(count);
  });
});
