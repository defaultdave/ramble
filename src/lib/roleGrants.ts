// The roles a person is given by a row in `role_grants`. Guest is not one of them: everyone signed in is a guest.

export const hostScopedRoles = ['host_owner', 'host_staff'] as const;
const unscopedRoles = ['ops', 'admin'] as const;
export const grantableRoles = [...hostScopedRoles, ...unscopedRoles] as const;

export type GrantableRole = (typeof grantableRoles)[number];

export type RoleGrant = { role: GrantableRole; hostId: string | null };

/** Host owner and host staff act for one host and name it; ops and admin act for none and name none. */
export function isValidGrantScope(grant: RoleGrant): boolean {
  const scoped = (hostScopedRoles as readonly string[]).includes(grant.role);
  return scoped === (grant.hostId !== null);
}

/** The most grants one read returns. A person holds a few; a larger result is cut, so the caller has fewer rights, never more. */
export const maxGrantsPerUser = 200;

export type HostGrant = {
  role: (typeof hostScopedRoles)[number];
  hostId: string;
};

/** What a person's grants add up to. Everyone signed in is a guest; each grant adds its role. */
export type GrantedAccess = {
  roles: readonly ('guest' | GrantableRole)[];
  hostIds: readonly string[];
  hostGrants: readonly HostGrant[];
};

const isHostScoped = (role: GrantableRole): role is HostGrant['role'] =>
  (hostScopedRoles as readonly string[]).includes(role);

/**
 * The roles, hosts, and role-and-host pairs a set of grants gives. A grant whose host does not
 * match its role (the table's CHECK refuses one) is skipped, never half used. Roles and hosts are
 * listed once each, in the order first met.
 */
export function accessFromGrants(grants: readonly RoleGrant[]): GrantedAccess {
  const valid = grants.filter(isValidGrantScope);
  const hostGrants = valid.flatMap((grant) =>
    grant.hostId !== null && isHostScoped(grant.role)
      ? [{ role: grant.role, hostId: grant.hostId }]
      : [],
  );
  return {
    roles: [...new Set(['guest' as const, ...valid.map((g) => g.role)])],
    hostIds: [...new Set(hostGrants.map((g) => g.hostId))],
    hostGrants,
  };
}

/**
 * Whether a caller holds this host role on this host. With pairs, the pair must exist, so owner of
 * one host and staff of another is not owner of both; without them, any host the caller acts for counts.
 */
export function ownsHostRole(
  access: { hostIds: readonly string[]; hostGrants?: readonly HostGrant[] },
  role: HostGrant['role'],
  hostId: string,
): boolean {
  return access.hostGrants
    ? access.hostGrants.some((g) => g.role === role && g.hostId === hostId)
    : access.hostIds.includes(hostId);
}

/** Every host role in `roles` on every host: what a test means by a caller with roles and hosts. */
export function pairEveryHostRole(
  roles: readonly string[],
  hostIds: readonly string[],
): HostGrant[] {
  return hostScopedRoles
    .filter((role) => roles.includes(role))
    .flatMap((role) => hostIds.map((hostId) => ({ role, hostId })));
}
