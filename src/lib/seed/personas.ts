import type { RoleGrant } from '@/lib/roleGrants';
import { hostId } from './rows';

// Seeded people who can sign in by link, one per role, so the authorization matrix and a person
// trying the app by hand have the same cast. Their addresses are on `.test`, which RFC 2606
// reserves, so no link sent to one reaches a real inbox. They hold no secret: sign-in is by link and
// there is nothing else to sign in with. The seed command leaves them out of `production-demo`
// (`seedsPersonas`).

/** Two curated hosts, each with experiences, so a host owner can be tested against the other host. */
export const personaHostSlugs = {
  a: 'hudson-paddle-club',
  b: 'kiln-and-clay',
} as const;

const personaDomain = 'ramble.test';

export type PersonaKey =
  'guest' | 'ownerA' | 'staffA' | 'ownerB' | 'staffB' | 'ops' | 'admin';

export type PersonaFixture = {
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

export const personaKeys = Object.keys(personas) as PersonaKey[];
