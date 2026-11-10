import { describe, expect, it } from 'vitest';
import {
  grantableRoles,
  isValidGrantScope,
  type GrantableRole,
} from './roleGrants';

// Behaviours under test:
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
