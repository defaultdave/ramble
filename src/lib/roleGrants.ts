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
