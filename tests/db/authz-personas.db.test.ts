import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { personaHostSlugs, personaKeys, personas } from '@/lib/seed/personas';
import { hostId } from '@/lib/seed/rows';
import { Role, type Caller } from '@/server/auth/caller';
import { seedCaller } from '@/server/db/seed/caller';
import { authUsers, hosts, roleGrants } from '@/server/db/schema';
import {
  client,
  personaSeed,
  setupAuthzDatabase,
  signInEverySubject,
  type Subject,
} from './authzFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database and the real Better Auth, one per decision, branch, or risk:
// - the seed writes seven people with fixed addresses on the reserved .test domain: one guest, an
//   owner and a staff member on each of two hosts, one ops, one admin
// - the two hosts the personas act for are seeded hosts, and are different hosts
// - every persona signs in by link and is the caller its grants describe: roles, hosts, and which
//   host role is held on which host
// - seeding again adds no person and no grant and changes no id, even after a persona has signed in
// - a person who already signed in at a persona's address keeps their id and gains the grants
// - the persona table is the whole cast: nothing else holds a grant in a seeded database

setupAuthzDatabase();

let people: Record<Subject, Caller>;

beforeAll(async () => {
  people = await signInEverySubject();
  hostA = hostId(personaHostSlugs.a);
  hostB = hostId(personaHostSlugs.b);
});

let hostA: string;
let hostB: string;

/** Roles and host grants each persona should sign in with. */
const expectedFor = (key: Subject) =>
  ({
    guest: { roles: [Role.Guest], grants: [] },
    ownerA: {
      roles: [Role.Guest, Role.HostOwner],
      grants: [{ role: 'host_owner', hostId: hostA }],
    },
    staffA: {
      roles: [Role.Guest, Role.HostStaff],
      grants: [{ role: 'host_staff', hostId: hostA }],
    },
    ownerB: {
      roles: [Role.Guest, Role.HostOwner],
      grants: [{ role: 'host_owner', hostId: hostB }],
    },
    staffB: {
      roles: [Role.Guest, Role.HostStaff],
      grants: [{ role: 'host_staff', hostId: hostB }],
    },
    ops: { roles: [Role.Guest, Role.Ops], grants: [] },
    admin: { roles: [Role.Guest, Role.Admin], grants: [] },
    anonymous: { roles: [], grants: [] },
  })[key];

describe('the seeded personas', () => {
  it('are seven fixed addresses on the reserved .test domain', () => {
    const emails = personaKeys.map((key) => personas[key].email);
    expect(emails).toHaveLength(7);
    expect(new Set(emails).size).toBe(7);
    for (const email of emails) {
      expect(email).toMatch(/^[a-z.]+@ramble\.test$/);
    }
  });

  it('act for two different seeded hosts', async () => {
    expect(hostA).not.toBe(hostB);
    const rows = await client.db
      .select({ id: hosts.id })
      .from(hosts)
      .where(inArray(hosts.id, [hostA, hostB]));
    expect(rows).toHaveLength(2);
  });

  it.each(personaKeys)(
    '%s signs in by link as the caller its grants describe',
    (key) => {
      const caller = people[key];
      const { roles, grants } = expectedFor(key);
      expect(caller.userId).not.toBeNull();
      expect(caller.roles).toEqual(roles);
      expect(caller.hostGrants).toEqual(grants);
      expect(caller.hostIds).toEqual(grants.map((grant) => grant.hostId));
    },
  );

  it('are the only people holding a grant', async () => {
    const holders = await client.db
      .selectDistinct({ email: authUsers.email })
      .from(roleGrants)
      .innerJoin(authUsers, eq(authUsers.id, roleGrants.userId));
    const granted = personaKeys
      .filter((key) => key !== 'guest')
      .map((key) => personas[key].email)
      .sort();
    expect(holders.map((row) => row.email).sort()).toEqual(granted);
  });
});

describe('seeding the personas again', () => {
  const snapshot = async () => ({
    users: await client.db
      .select({ id: authUsers.id, email: authUsers.email })
      .from(authUsers)
      .orderBy(authUsers.email),
    grants: await client.db
      .select({
        userId: roleGrants.userId,
        role: roleGrants.role,
        hostId: roleGrants.hostId,
        id: roleGrants.id,
      })
      .from(roleGrants)
      .orderBy(roleGrants.id),
  });

  it('changes no id and adds no person or grant', async () => {
    const before = await snapshot();
    expect(await personaSeed.seedPersonas(seedCaller)).toBe(7);
    expect(await snapshot()).toEqual(before);
  });

  it('gives the grants to a person who signed in at the address first', async () => {
    const email = personas.ownerA.email;
    await client.db.delete(authUsers).where(eq(authUsers.email, email));
    const [earlier] = await client.db
      .insert(authUsers)
      .values({ email })
      .returning({ id: authUsers.id });

    await personaSeed.seedPersonas(seedCaller);

    const grants = await client.db
      .select({ role: roleGrants.role, hostId: roleGrants.hostId })
      .from(roleGrants)
      .where(eq(roleGrants.userId, earlier?.id ?? ''));
    expect(grants).toEqual([{ role: 'host_owner', hostId: hostA }]);
  });
});
