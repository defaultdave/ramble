import 'server-only';
import { sql } from 'drizzle-orm';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import { authUsers, roleGrants } from '@/server/db/schema';
import { personas } from '@/lib/seed/personas';
import { seedId } from '@/lib/seed/ids';

const personaEntries = Object.values(personas);

/**
 * Writes the personas as Better Auth users with their `role_grants`. A rerun changes nothing, and a
 * person who already signed in at one of these addresses keeps their id and gains the grants.
 * Needs the seeded hosts, so it runs after the seed.
 */
export async function seedPersonas(caller: Caller): Promise<number> {
  requireRole(caller, Role.Ops, {});
  await db.transaction(async (tx) => {
    const users = await tx
      .insert(authUsers)
      .values(
        Object.entries(personas).map(([key, persona]) => ({
          id: seedId('persona', key),
          email: persona.email,
          name: persona.name,
          emailVerified: true,
        })),
      )
      .onConflictDoUpdate({
        target: authUsers.email,
        set: {
          name: sql`excluded.name`,
          emailVerified: sql`excluded.email_verified`,
        },
      })
      .returning({ id: authUsers.id, email: authUsers.email });
    const idByEmail = new Map(users.map((user) => [user.email, user.id]));
    const grants = personaEntries.flatMap((persona) => {
      const userId = idByEmail.get(persona.email);
      if (userId === undefined) {
        throw new Error(`The persona ${persona.email} was not written`);
      }
      return persona.grants.map((grant) => ({ userId, ...grant }));
    });
    await tx.insert(roleGrants).values(grants).onConflictDoNothing();
  });
  return personaEntries.length;
}
