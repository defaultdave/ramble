import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  Role,
  hostReaderRoles,
  requireAnyRole,
  type Caller,
} from './caller';

// Behaviours under test, one per decision, branch, or risk:
// - the first listed role the caller holds is the one checked: staff pass on any resource, a host owner only on their host
// - a caller who holds none of the roles is refused as the first listed role
// - a host owner of another host, and a host owner asked about a resource with no host, are refused
// - the host readers are the owner and staff of that host only; one who owns a host and staffs another reads both

const roles = [Role.Ops, Role.Admin, Role.HostOwner] as const;
const caller = (held: Caller['roles'], hostIds: string[] = []): Caller => ({
  userId: null,
  roles: held,
  hostIds,
});

describe('requireAnyRole', () => {
  it.each([[Role.Ops], [Role.Admin]])(
    'lets %s through on any resource',
    (role) => {
      expect(() => {
        requireAnyRole(caller([role]), roles, {});
      }).not.toThrow();
    },
  );

  it('lets a host owner through on their host only', () => {
    const owner = caller([Role.HostOwner], ['h1']);
    expect(() => {
      requireAnyRole(owner, roles, { hostId: 'h1' });
    }).not.toThrow();
    expect(() => {
      requireAnyRole(owner, roles, { hostId: 'h2' });
    }).toThrow(ForbiddenError);
    expect(() => {
      requireAnyRole(owner, roles, {});
    }).toThrow(ForbiddenError);
  });

  it.each([[[]], [[Role.Guest]], [[Role.HostStaff]]])(
    'refuses a caller holding %j',
    (held) => {
      expect(() => {
        requireAnyRole(caller(held), roles, { hostId: 'h1' });
      }).toThrow(ForbiddenError);
    },
  );
});

describe('hostReaderRoles', () => {
  const grants = [
    { role: Role.HostOwner, hostId: 'h1' },
    { role: Role.HostStaff, hostId: 'h2' },
  ] as const;

  it.each([
    ['host staff on their host', Role.HostStaff, 'h1', true],
    ['host staff on another host', Role.HostStaff, 'h2', false],
    ['an owner on their host', Role.HostOwner, 'h1', true],
    ['an owner on another host', Role.HostOwner, 'h2', false],
  ])('%s', (_name, role, hostId, allowed) => {
    const reader = caller([role], ['h1']);
    const run = () => {
      requireAnyRole(reader, hostReaderRoles, { hostId });
    };
    if (allowed) expect(run).not.toThrow();
    else expect(run).toThrow(ForbiddenError);
  });

  it('lets someone who owns one host and staffs another read both, and not a third', () => {
    const both: Caller = {
      userId: 'u',
      roles: [Role.HostOwner, Role.HostStaff],
      hostIds: ['h1', 'h2'],
      hostGrants: grants,
    };
    for (const hostId of ['h1', 'h2']) {
      expect(() => {
        requireAnyRole(both, hostReaderRoles, { hostId });
      }).not.toThrow();
    }
    expect(() => {
      requireAnyRole(both, hostReaderRoles, { hostId: 'h3' });
    }).toThrow(ForbiddenError);
  });
});
