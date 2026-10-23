import 'server-only';

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

// TODO(U-004a): read the Better Auth session and role grants.
export function getCaller(): Promise<Caller> {
  return Promise.resolve(anonymousCaller);
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
