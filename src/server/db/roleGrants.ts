import 'server-only';
import { eq } from 'drizzle-orm';
import { maxGrantsPerUser, type RoleGrant } from '@/lib/roleGrants';
import { db } from './client';
import { roleGrants } from './schema';

export async function readRoleGrants(userId: string): Promise<RoleGrant[]> {
  return db
    .select({ role: roleGrants.role, hostId: roleGrants.hostId })
    .from(roleGrants)
    .where(eq(roleGrants.userId, userId))
    .orderBy(roleGrants.createdAt, roleGrants.id)
    .limit(maxGrantsPerUser);
}
