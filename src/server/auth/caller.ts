import 'server-only';
import { isSessionLive, touchedSessionExpiry } from '@/lib/auth';
import { isValidGrantScope, type RoleGrant } from '@/lib/roleGrants';
import { systemClock } from '@/server/ports/clock';

export const Role = {
  Guest: 'guest',
  HostOwner: 'host_owner',
  HostStaff: 'host_staff',
  Ops: 'ops',
  Admin: 'admin',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export type Caller = {
  /** Null when nobody is signed in. */
  userId: string | null;
  roles: readonly Role[];
  /** Hosts the caller acts for; read only for host owner and host staff. */
  hostIds: readonly string[];
};

/** The row a data-layer function is about to read or write. */
export type Resource = {
  hostId?: string;
  /** The user the row belongs to, such as the guest on an order. */
  ownerId?: string;
};

export class ForbiddenError extends Error {
  constructor(role: Role) {
    super(`Caller may not act as ${role} on this resource`);
    this.name = 'ForbiddenError';
  }
}

export const anonymousCaller: Caller = {
  userId: null,
  roles: [],
  hostIds: [],
};

/**
 * Everyone signed in is a guest. Each grant adds its role, and a host role adds its host. A grant
 * whose host does not match its role (the table's CHECK refuses one) is skipped, never half used.
 */
export function callerFromGrants(
  userId: string,
  grants: readonly RoleGrant[],
): Caller {
  const valid = grants.filter(isValidGrantScope);
  return {
    userId,
    roles: [...new Set<Role>([Role.Guest, ...valid.map((g) => g.role)])],
    hostIds: [
      ...new Set(valid.flatMap((g) => (g.hostId === null ? [] : [g.hostId]))),
    ],
  };
}

/** The caller a request's cookies name: anonymous without a live session, otherwise the person with their grants. */
export async function callerForHeaders(
  requestHeaders: Headers,
  now: Date = systemClock.now(),
): Promise<Caller> {
  // Loaded here, not at the top: nearly every data-layer file imports this one for `requireRole`,
  // and none of them should load Better Auth and the database client with it.
  const [{ readSession }, { readRoleGrants }, { extendSessionExpiry }] =
    await Promise.all([
      import('./session'),
      import('@/server/db/roleGrants'),
      import('@/server/db/authSessions'),
    ]);
  const session = await readSession(requestHeaders);
  if (session === null || !isSessionLive(session, now)) return anonymousCaller;

  const extended = touchedSessionExpiry(session, now);
  if (extended !== null) await extendSessionExpiry(session.id, extended, now);

  return callerFromGrants(session.userId, await readRoleGrants(session.userId));
}

export async function getCaller(): Promise<Caller> {
  const { headers } = await import('next/headers');
  return callerForHeaders(await headers());
}

/**
 * Throws ForbiddenError unless the caller holds `role` and, for the roles
 * that are scoped to a row, owns the resource. Ops and admin are not scoped.
 * A scoped role checked without the field it needs on the resource fails.
 */
export function requireRole(
  caller: Caller,
  role: Role,
  resource: Resource,
): void {
  if (!caller.roles.includes(role) || !ownsResource(caller, role, resource)) {
    throw new ForbiddenError(role);
  }
}

function ownsResource(caller: Caller, role: Role, resource: Resource) {
  switch (role) {
    case Role.Ops:
    case Role.Admin:
      return true;
    case Role.HostOwner:
    case Role.HostStaff:
      return (
        resource.hostId !== undefined &&
        caller.hostIds.includes(resource.hostId)
      );
    case Role.Guest:
      return (
        caller.userId !== null &&
        resource.ownerId !== undefined &&
        caller.userId === resource.ownerId
      );
  }
}
