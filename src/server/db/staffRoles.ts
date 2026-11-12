import 'server-only';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { isValidGrantScope, type RoleGrant } from '@/lib/roleGrants';
import {
  grantRefusal,
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
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { recordAudit, requireOpsUserId, writeAudit } from './audit';
import { db, dbRead, type Transaction } from './client';
import { authUsers, hosts, roleGrants } from './schema';

// Who holds which role. The writes here are the one way a grant is made or taken back, so each
// writes its audit row in the same transaction. `grantRoleIn` is the contract other units call:
// it takes the actor to record and no caller, as `writeAudit` does, because its caller has
// already authorized the action.

export type GrantOutcome = 'granted' | 'already_held';
export type GrantRoleResult =
  GrantOutcome | 'user_not_found' | 'host_not_found' | 'admin_role';
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

/**
 * Ops gives an existing person a role. Admin is refused here, a missing person or host is named,
 * and a role already held is a no-op.
 */
export async function grantRole(
  caller: Caller,
  userId: string,
  grant: RoleGrant,
): Promise<GrantRoleResult> {
  const actorId = requireOpsUserId(caller);
  if (grantRefusal(grant) !== null) return 'admin_role';
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, userId));
    if (!user) return 'user_not_found';
    if (grant.hostId !== null) {
      const [host] = await tx
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.id, grant.hostId));
      if (!host) return 'host_not_found';
    }
    return grantRoleIn(tx, { kind: 'user', userId: actorId }, userId, grant);
  });
}

/** Ops takes a role back, with its audit row. Nobody removes their own access, and admin is removed from the command line. */
export async function revokeRole(
  caller: Caller,
  userId: string,
  grant: RoleGrant,
): Promise<RevokeRoleResult> {
  const actorId = requireOpsUserId(caller);
  const refusal = revokeRefusal(actorId, userId, grant);
  if (refusal !== null) return refusal;
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(roleGrants)
      .where(
        and(
          eq(roleGrants.userId, userId),
          eq(roleGrants.role, grant.role),
          grant.hostId === null
            ? isNull(roleGrants.hostId)
            : eq(roleGrants.hostId, grant.hostId),
        ),
      )
      .returning({ id: roleGrants.id });
    if (removed.length === 0) return 'not_found';
    await writeAudit(tx, roleRevokedEntry(actorId, userId, grant));
    return 'revoked';
  });
}

/** Everyone who holds ops or admin, oldest grant first. Audited before it returns. */
export async function readStaffForOps(caller: Caller): Promise<StaffRow[]> {
  const actorId = requireOpsUserId(caller);
  const rows = await dbRead
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
  return rows;
}

/** The address a sign-in link for this staff member goes to, or null when the person does not hold ops. */
export async function readStaffInviteTarget(
  caller: Caller,
  userId: string,
): Promise<{ email: string } | null> {
  requireRole(caller, Role.Ops, {});
  const [row] = await db
    .select({ email: authUsers.email })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .where(and(eq(roleGrants.userId, userId), eq(roleGrants.role, 'ops')));
  return row ?? null;
}
