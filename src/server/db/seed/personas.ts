import 'server-only';
import { sql } from 'drizzle-orm';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import { authUsers, roleGrants } from '@/server/db/schema';
import type { RoleGrant } from '@/lib/roleGrants';
import { hostId } from '@/lib/seed/rows';
import { seedId } from '@/lib/seed/ids';

// Seeded people who can sign in by link, one per role, so the authorization matrix and a person
// trying the app by hand have the same cast. Their addresses are on `.test`, which RFC 2606
// reserves, so no link sent to one reaches a real inbox. They hold no secret: sign-in is by link and
// there is nothing else to sign in with. The seed command leaves them out of `production-demo`.

/** Two curated hosts, each with experiences, so a host owner can be tested against the other host. */
export const personaHostSlugs = {
  a: 'hudson-paddle-club',
  b: 'kiln-and-clay',
} as const;

const personaDomain = 'ramble.test';

export type PersonaKey =
  'guest' | 'ownerA' | 'staffA' | 'ownerB' | 'staffB' | 'ops' | 'admin';

type PersonaFixture = {
  email: string;
  name: string;
  grants: readonly RoleGrant[];
};

const hostA = hostId(personaHostSlugs.a);
const hostB = hostId(personaHostSlugs.b);

export const personas: Record<PersonaKey, PersonaFixture> = {
  guest: {
    email: `guest@${personaDomain}`,
    name: 'Gwen Guest',
    grants: [],
  },
  ownerA: {
    email: `owner.a@${personaDomain}`,
    name: 'Olive Owner (host A)',
    grants: [{ role: 'host_owner', hostId: hostA }],
  },
  staffA: {
    email: `staff.a@${personaDomain}`,
    name: 'Sam Staff (host A)',
    grants: [{ role: 'host_staff', hostId: hostA }],
  },
  ownerB: {
    email: `owner.b@${personaDomain}`,
    name: 'Oren Owner (host B)',
    grants: [{ role: 'host_owner', hostId: hostB }],
  },
  staffB: {
    email: `staff.b@${personaDomain}`,
    name: 'Sasha Staff (host B)',
    grants: [{ role: 'host_staff', hostId: hostB }],
  },
  ops: {
    email: `ops@${personaDomain}`,
    name: 'Opal Ops',
    grants: [{ role: 'ops', hostId: null }],
  },
  admin: {
    email: `admin@${personaDomain}`,
    name: 'Ada Admin',
    grants: [{ role: 'admin', hostId: null }],
  },
};

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
