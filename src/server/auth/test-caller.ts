import 'server-only';
import { Role, type Caller } from './caller';

export const TEST_USER_ID = 'user-test';
export const TEST_HOST_ID = 'host-test';

/** A signed-in guest on no host, for unit and database tests. */
export function testCaller(overrides: Partial<Caller> = {}): Caller {
  return {
    userId: TEST_USER_ID,
    roles: [Role.Guest],
    hostIds: [],
    ...overrides,
  };
}
