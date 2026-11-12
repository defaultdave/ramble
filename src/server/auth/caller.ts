import 'server-only';
import { isSessionLive, touchedSessionExpiry } from '@/lib/auth';
import {
  accessFromGrants,
  ownsHostRole,
  type HostGrant,
  type RoleGrant,
} from '@/lib/roleGrants';
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
  /**
   * Which host role is held on which host. When present, host roles are checked against these
   * pairs, so owner of one host and staff of another is not owner of both. A caller built without
   * it is checked against `hostIds` alone.
   */
  hostGrants?: readonly HostGrant[];
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

export function callerFromGrants(
  userId: string,
  grants: readonly RoleGrant[],
): Caller {
  return { userId, ...accessFromGrants(grants) };
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

/** The roles that may read a host's dashboard, sessions and guest lists; only the owner changes them. */
export const hostReaderRoles = [Role.HostOwner, Role.HostStaff] as const;

/**
 * `requireRole` for an action more than one role may take: it passes when any role in `roles` the
 * caller holds fits the resource, so owner of one host and staff of another reads either. Otherwise
 * the caller is refused as the first role they hold, or the first listed when they hold none.
 */
export function requireAnyRole(
  caller: Caller,
  roles: readonly [Role, ...Role[]],
  resource: Resource,
): void {
  const held = roles.filter((role) => caller.roles.includes(role));
  if (held.some((role) => ownsResource(caller, role, resource))) return;
  requireRole(caller, held[0] ?? roles[0], resource);
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
        ownsHostRole(caller, role, resource.hostId)
      );
    case Role.Guest:
      return (
        caller.userId !== null &&
        resource.ownerId !== undefined &&
        caller.userId === resource.ownerId
      );
  }
}
