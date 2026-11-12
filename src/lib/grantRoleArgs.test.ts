import { describe, expect, it } from 'vitest';
import { parseGrantRoleArgs } from './grantRoleArgs';

// Behaviours under test:
// - ops and admin take an address and no host; host roles take both; the address is lower-cased
// - anything else is refused: a missing or repeated flag, an unknown flag or role, a host on an unscoped role, none on a scoped one, a bad address or host id, an odd count of arguments, an oversized value

const host = '3c3e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

describe('parseGrantRoleArgs', () => {
  it.each([
    [
      ['--email', 'Admin@Example.com', '--role', 'admin'],
      { email: 'admin@example.com', grant: { role: 'admin', hostId: null } },
    ],
    [
      ['--role', 'ops', '--email', 'a@example.com'],
      { email: 'a@example.com', grant: { role: 'ops', hostId: null } },
    ],
    [
      ['--email', 'a@example.com', '--role', 'host_staff', '--host', host],
      { email: 'a@example.com', grant: { role: 'host_staff', hostId: host } },
    ],
  ])('%j is accepted', (argv, expected) => {
    expect(parseGrantRoleArgs(argv)).toEqual(expected);
  });

  it.each([
    [[]],
    [['--email', 'a@example.com']],
    [['--role', 'ops']],
    [['--email', 'a@example.com', '--role', 'owner']],
    [['--email', 'not-an-address', '--role', 'ops']],
    [['--email', 'a@example.com', '--role', 'ops', '--host', host]],
    [['--email', 'a@example.com', '--role', 'host_owner']],
    [['--email', 'a@example.com', '--role', 'host_owner', '--host', 'nope']],
    [['--email', 'a@example.com', '--role', 'ops', '--force', 'yes']],
    [['--email', 'a@example.com', '--email', 'b@example.com', '--role', 'ops']],
    [['--email', 'a@example.com', '--role']],
    [['email', 'a@example.com', '--role', 'ops']],
    [['--email', `${'a'.repeat(400)}@example.com`, '--role', 'ops']],
    [['--email', 'a@example.com', '--role', 'ops', '--__proto__', 'x']],
  ])('%j is refused', (argv) => {
    expect(parseGrantRoleArgs(argv)).toBeNull();
  });
});
