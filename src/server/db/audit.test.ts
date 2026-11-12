import { describe, expect, it } from 'vitest';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { requireOpsUserId, requireUserId } from './audit';

// Behaviours under test:
// - a caller with a user gives its id; one with none is refused with the role that was asked
// - the ops variant also refuses a caller without the ops role

const withUser = testCaller({ userId: 'u-1', roles: [Role.Ops] });
const noUser = testCaller({ userId: null, roles: [Role.Ops] });

describe('requireUserId', () => {
  it('returns the id of the user', () => {
    expect(requireUserId(withUser, Role.Admin)).toBe('u-1');
  });

  it('refuses a caller with no user, naming the role it was asked for', () => {
    expect(() => requireUserId(noUser, Role.Admin)).toThrow(ForbiddenError);
    expect(() => requireUserId(noUser, Role.Admin)).toThrow(/admin/);
  });
});

describe('requireOpsUserId', () => {
  it('returns the id of an ops user', () => {
    expect(requireOpsUserId(withUser)).toBe('u-1');
  });

  it.each([
    ['an ops caller with no user', noUser],
    ['a guest', testCaller({ userId: 'u-1', roles: [Role.Guest] })],
  ])('refuses %s', (_name, caller) => {
    expect(() => requireOpsUserId(caller)).toThrow(ForbiddenError);
  });
});
