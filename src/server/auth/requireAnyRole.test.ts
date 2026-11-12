import { describe, expect, it } from 'vitest';
import { ForbiddenError, Role, requireAnyRole, type Caller } from './caller';

// Behaviours under test, one per decision, branch, or risk:
// - the first listed role the caller holds is the one checked: staff pass on any resource, a host owner only on their host
// - a caller who holds none of the roles is refused as the first listed role
// - a host owner of another host, and a host owner asked about a resource with no host, are refused

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
