import 'server-only';
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { hostStaffGrant, type HostStaffRow } from '@/lib/hostStaff';
import { isValidGrantScope, type RoleGrant } from '@/lib/roleGrants';
import {
  groupStaff,
  revokeRefusal,
  staffReadLimit,
  type RevokeRefusal,
  type StaffRow,
} from '@/lib/staffAdmin';
import {
  roleGrantedEntry,
  roleRevokedEntry,
  staffListedEntry,
  type RoleActor,
} from '@/lib/staffAudit';
import {
  ForbiddenError,
  requireRole,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { recordAudit, requireOpsUserId, writeAudit } from './audit';
import { db, dbRead, type Transaction } from './client';
import { authUsers, hosts, roleGrants } from './schema';

// Who holds which role. The writes here are the one way a grant is made or taken back, so each
// writes its audit row in the same transaction. `grantRoleIn` is the contract other units call:
// it takes the actor to record and no caller, as `writeAudit` does, because its caller has
// already authorized the action.

export type GrantOutcome = 'granted' | 'already_held';
export type RevokeRoleResult = 'revoked' | 'not_found' | RevokeRefusal;

/**
 * Finds the account for an address, or makes it with the address marked verified: Better Auth's
 * first-sign-in step for an unverified account writes a row this schema's CHECK refuses, and the
 * person who gets the sign-in link is the only one it can reach. `email` is already normalized.
 */
export async function ensureAuthUserIn(
  tx: Transaction,
  email: string,
): Promise<string> {
  await tx
    .insert(authUsers)
    .values({ email, emailVerified: true })
    .onConflictDoNothing();
  const [user] = await tx
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, email));
  if (!user) throw new Error('The account was not found');
  return user.id;
}

/**
 * Gives a person a role in the caller's transaction, with its audit row, once: a role already held
 * writes nothing. The grant must fit its role (a host role names a host; ops and admin name none).
 */
export async function grantRoleIn(
  tx: Transaction,
  actor: RoleActor,
  userId: string,
  grant: RoleGrant,
): Promise<GrantOutcome> {
  if (!isValidGrantScope(grant)) {
    throw new Error('The grant does not fit its role');
  }
  const [row] = await tx
    .insert(roleGrants)
    .values({ userId, role: grant.role, hostId: grant.hostId })
    .onConflictDoNothing()
    .returning({ id: roleGrants.id });
  if (!row) return 'already_held';
  await writeAudit(tx, roleGrantedEntry(actor, userId, grant));
  return 'granted';
}

const hostMatches = (grant: RoleGrant): SQL =>
  grant.hostId === null
    ? isNull(roleGrants.hostId)
    : eq(roleGrants.hostId, grant.hostId);

/**
 * Makes the account for an address if there is none and gives it a role, in one transaction with
 * its audit row. Returns the person and whether the role was new. It is how an invite and the
 * grant command give a role to an address; the caller has already authorized the action.
 */
export async function grantRoleToAddress(
  actor: RoleActor,
  email: string,
  grant: RoleGrant,
): Promise<{ userId: string; outcome: GrantOutcome }> {
  return db.transaction(async (tx) => {
    const userId = await ensureAuthUserIn(tx, email);
    return { userId, outcome: await grantRoleIn(tx, actor, userId, grant) };
  });
}

async function deleteGrantIn(
  tx: Transaction,
  actorId: string,
  userId: string,
  grant: RoleGrant,
): Promise<'revoked' | 'not_found'> {
  const removed = await tx
    .delete(roleGrants)
    .where(
      and(
        eq(roleGrants.userId, userId),
        eq(roleGrants.role, grant.role),
        hostMatches(grant),
      ),
    )
    .returning({ id: roleGrants.id });
  if (removed.length === 0) return 'not_found';
  await writeAudit(tx, roleRevokedEntry(actorId, userId, grant));
  return 'revoked';
}

/** Ops takes a role back, with its audit row. Nobody removes their own access, and admin is removed from the command line. */
export async function revokeRole(
  caller: Caller,
  userId: string,
  grant: RoleGrant,
): Promise<RevokeRoleResult> {
  const actorId = requireOpsUserId(caller);
  if (!isValidGrantScope(grant)) {
    throw new Error('The grant does not fit its role');
  }
  const refusal = revokeRefusal(actorId, userId, grant);
  if (refusal !== null) return refusal;
  return db.transaction((tx) => deleteGrantIn(tx, actorId, userId, grant));
}

/** The signed-in user of a caller who owns this host; anyone else is refused before anything is written or sent. */
export function requireHostOwnerId(caller: Caller, hostId: string): string {
  requireRole(caller, Role.HostOwner, { hostId });
  if (caller.userId === null) throw new ForbiddenError(Role.HostOwner);
  return caller.userId;
}

/**
 * A host owner gives an address the read-only staff role on their own host, making the account if
 * there is none, with its audit row. It is the one door to `grantRoleIn` for a host role: the owner
 * is checked against the host before anything is written, and the role is always `host_staff`.
 */
export async function grantHostStaff(
  caller: Caller,
  hostId: string,
  email: string,
): Promise<{ userId: string; outcome: GrantOutcome }> {
  const actorId = requireHostOwnerId(caller, hostId);
  return db.transaction(async (tx) => {
    const userId = await ensureAuthUserIn(tx, email);
    const outcome = await grantRoleIn(
      tx,
      { kind: 'user', userId: actorId },
      userId,
      hostStaffGrant(hostId),
    );
    return { userId, outcome };
  });
}

/** A host owner takes the staff role back from one person on their own host, with its audit row. Owner access is never touched here. */
export async function revokeHostStaff(
  caller: Caller,
  hostId: string,
  userId: string,
): Promise<'revoked' | 'not_found'> {
  const actorId = requireHostOwnerId(caller, hostId);
  return db.transaction((tx) =>
    deleteGrantIn(tx, actorId, userId, hostStaffGrant(hostId)),
  );
}

/** Who holds the staff role on a host, oldest grant first. Only the host's owner reads it. */
export async function readHostStaff(
  caller: Caller,
  hostId: string,
): Promise<HostStaffRow[]> {
  requireRole(caller, Role.HostOwner, { hostId });
  return db
    .select({ userId: authUsers.id, email: authUsers.email })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .where(
      and(eq(roleGrants.role, 'host_staff'), eq(roleGrants.hostId, hostId)),
    )
    .orderBy(asc(roleGrants.createdAt), asc(roleGrants.id))
    .limit(staffReadLimit);
}

/** The address of a person who holds the staff role on this host, or null; where the owner's resend sends a fresh link. */
export async function readHostStaffAddress(
  caller: Caller,
  hostId: string,
  userId: string,
): Promise<string | null> {
  requireRole(caller, Role.HostOwner, { hostId });
  const [row] = await db
    .select({ email: authUsers.email })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .where(
      and(
        eq(roleGrants.userId, userId),
        eq(roleGrants.role, 'host_staff'),
        eq(roleGrants.hostId, hostId),
      ),
    );
  return row?.email ?? null;
}

/** Everyone who holds ops or admin, one row each, oldest grant first. Audited before it returns. */
export async function readStaffForOps(caller: Caller): Promise<StaffRow[]> {
  const actorId = requireOpsUserId(caller);
  const grants = await dbRead
    .select({
      userId: authUsers.id,
      email: authUsers.email,
      role: roleGrants.role,
    })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .where(inArray(roleGrants.role, ['ops', 'admin']))
    .orderBy(asc(roleGrants.createdAt), asc(roleGrants.id))
    .limit(staffReadLimit);
  await recordAudit(staffListedEntry(actorId));
  return groupStaff(grants);
}

/**
 * The address of a person who holds exactly this role, and the name of the host when the role is
 * scoped to one, or null when they do not hold it. Ops only: it is where an invite's link is sent.
 */
export async function readRoleHolder(
  caller: Caller,
  userId: string,
  grant: RoleGrant,
): Promise<{ email: string; hostName: string | null } | null> {
  requireRole(caller, Role.Ops, {});
  const [row] = await db
    .select({ email: authUsers.email, hostName: hosts.name })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .leftJoin(hosts, eq(hosts.id, roleGrants.hostId))
    .where(
      and(
        eq(roleGrants.userId, userId),
        eq(roleGrants.role, grant.role),
        hostMatches(grant),
      ),
    );
  return row ?? null;
}
