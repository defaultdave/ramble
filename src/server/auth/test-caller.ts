import 'server-only';
import { pairEveryHostRole } from '@/lib/roleGrants';
import { Role, type Caller } from './caller';

export const TEST_USER_ID = 'user-test';
export const TEST_HOST_ID = 'host-test';

/** A signed-in guest on no host, for unit and database tests. */
export function testCaller(overrides: Partial<Caller> = {}): Caller {
  const caller = {
    userId: TEST_USER_ID,
    roles: [Role.Guest],
    hostIds: [],
    ...overrides,
  };
  if (caller.hostGrants) return caller;
  // Every host role on every host, the shape the tests have always meant by `roles` and `hostIds`.
  return {
    ...caller,
    hostGrants: pairEveryHostRole(caller.roles, caller.hostIds),
  };
}
