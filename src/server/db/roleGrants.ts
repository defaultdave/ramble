import 'server-only';
import { eq } from 'drizzle-orm';
import { maxGrantsPerUser, type RoleGrant } from '@/lib/roleGrants';
import { db } from './client';
import { authUsers, roleGrants } from './schema';

// `readRoleGrants` is called only from callerForHeaders (src/server/auth/caller.ts), which is where a caller is made.
export async function readRoleGrants(userId: string): Promise<RoleGrant[]> {
  return db
    .select({ role: roleGrants.role, hostId: roleGrants.hostId })
    .from(roleGrants)
    .where(eq(roleGrants.userId, userId))
    .orderBy(roleGrants.createdAt, roleGrants.id)
    .limit(maxGrantsPerUser);
}

/**
 * Whether the account for an address holds any role grant, whatever its role or host. One query
 * whether or not the account exists. `email` is already normalized, as stored addresses are.
 *
 * A subject-based read with no `Caller`, as `readRoleGrants` is: the sign-in decision
 * (src/server/auth/onScreenLink.ts) asks it before anyone is signed in, so there is no caller to
 * check. It returns a yes or no, never a grant.
 */
export async function holdsAnyRoleGrant(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId))
    .where(eq(authUsers.email, email))
    .limit(1);
  return rows.length > 0;
}
