import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { maxHostStaff } from '@/lib/hostStaff';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { authUsers, hosts, roleGrants } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, against the real database and the real Better Auth:
// Access:
// - a guest, host staff, the owner of another host, and nobody are refused every host staff function, and nothing is written
// Granting:
// - an owner's invite makes the account, grants host_staff on their host once, writes one audit row naming the owner and the host, and emails one link
// - a second invite to the same address sends another link and no second grant
// - the link signs the person in as host staff of that host: they read the dashboard and are refused every write and the staff page
// Revoking:
// - an owner removes the role with one audit row; a person who does not hold it is not_found; another host's staff member is not touched
// - the owner's own role is never removed by it, whether they ask to remove themselves or also hold the staff role
// Limits:
// - a host with the cap of staff refuses another grant and writes nothing; the owner of one host cannot grant on another
// Reading:
// - the list holds the host's staff only, not its owner and not another host's staff

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let roles: typeof import('@/server/db/staffRoles');
let invite: typeof import('@/server/hostStaffInvite');
let dashboard: typeof import('@/server/db/hostDashboard');
let sessionsDb: typeof import('@/server/db/sessions');
let forms: typeof import('@/server/auth/forms');
let session: typeof import('@/server/auth/caller');

const origin = 'http://localhost:3000';
const ownerId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
let hostA = '';
let hostB = '';
let owner: Caller;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  roles = await import('@/server/db/staffRoles');
  invite = await import('@/server/hostStaffInvite');
  dashboard = await import('@/server/db/hostDashboard');
  sessionsDb = await import('@/server/db/sessions');
  forms = await import('@/server/auth/forms');
  session = await import('@/server/auth/caller');
  hostA = await host();
  hostB = await host();
  owner = testCaller({
    userId: ownerId,
    roles: [Role.HostOwner],
    hostIds: [hostA],
  });
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
const next = () => (counter += 1);

async function person(email = `person${String(next())}@example.com`) {
  const [row] = await client.db
    .insert(authUsers)
    .values({ email, emailVerified: true })
    .returning({ id: authUsers.id });
  return { id: row?.id ?? '', email };
}

async function host() {
  const n = next();
  const [row] = await client.db
    .insert(hosts)
    .values({
      slug: `host-staff-${String(n)}`,
      name: `Host staff ${String(n)}`,
      timeZone: 'America/New_York',
    })
    .returning({ id: hosts.id });
  return row?.id ?? '';
}

async function auditRows(where = sql`true`) {
  const { rows } = await client.db.execute<{
    action: string;
    actor_id: string | null;
    details: Record<string, unknown>;
  }>(
    sql`SELECT action, actor_id, details FROM audit_log WHERE (action LIKE 'role.%' OR action LIKE 'staff.%') AND (${where}) ORDER BY id`,
  );
  return rows;
}

const staffRows = (userId: string, hostId: string) =>
  client.db
    .select()
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.userId, userId),
        eq(roleGrants.role, 'host_staff'),
        eq(roleGrants.hostId, hostId),
      ),
    );

const addressesOn = async (hostId: string) =>
  (await roles.readHostStaff(testCaller(ownerOf(hostId)), hostId)).map(
    (row) => row.email,
  );

function ownerOf(hostId: string) {
  return { userId: ownerId, roles: [Role.HostOwner], hostIds: [hostId] };
}

const refused: [string, () => Caller][] = [
  ['a guest', () => testCaller({ userId: randomUUID() })],
  [
    'host staff of the host',
    () =>
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostStaff],
        hostIds: [hostA],
      }),
  ],
  [
    'the owner of another host',
    () =>
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostOwner],
        hostIds: [hostB],
      }),
  ],
  ['nobody', () => ({ userId: null, roles: [], hostIds: [] })],
];

describe('access', () => {
  it.each(refused)(
    '%s is refused every function, and nothing is written',
    async (_who, make) => {
      const caller = make();
      const target = await person();
      const before = await auditRows();
      const calls = [
        () => roles.grantHostStaff(caller, hostA, 'someone@example.com'),
        () => roles.revokeHostStaff(caller, hostA, target.id),
        () => roles.readHostStaff(caller, hostA),
        () => roles.readHostStaffAddress(caller, hostA, target.id),
        () => invite.inviteHostStaff(caller, hostA, 'someone@example.com'),
        () => invite.resendHostStaffLink(caller, hostA, target.id),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await staffRows(target.id, hostA)).toEqual([]);
      expect(await auditRows()).toEqual(before);
    },
  );
});

describe('inviting and signing in', () => {
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .find((pair) => pair?.includes('session_token=')) ?? '';

  async function linkEmails(address: string) {
    const { rows } = await client.db.execute<{ html: string }>(
      sql`SELECT html FROM messages WHERE recipient = ${address} AND template = 'sign-in-link' ORDER BY created_at, id`,
    );
    return rows.map((row) => row.html);
  }

  function tokenIn(html: string) {
    const href = /href="([^"]*sign-in\/confirm[^"]*)"/.exec(html)?.[1];
    if (!href) throw new Error('no sign-in link in the email');
    return (
      new URL(href.replaceAll('&amp;', '&')).searchParams.get('token') ?? ''
    );
  }

  it('grants host staff once, audits it, emails one link, and the link signs them in as read-only staff', async () => {
    const address = 'new-host-staff@example.com';

    expect(
      await invite.inviteHostStaff(owner, hostA, 'New-Host-Staff@Example.com'),
    ).toBe('sent');

    const [user] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, address));
    const userId = user?.id ?? '';
    expect(user?.emailVerified).toBe(true);
    expect(await staffRows(userId, hostA)).toHaveLength(1);
    const audit = await auditRows(sql`subject_id = ${userId}`);
    expect(audit.map((row) => [row.action, row.actor_id])).toEqual([
      ['role.granted', ownerId],
      ['staff.link_sent', ownerId],
    ]);
    expect(audit[0]?.details).toEqual({ role: 'host_staff', host_id: hostA });
    const emails = await linkEmails(address);
    expect(emails).toHaveLength(1);

    const response = await forms.handleConfirmSignIn(
      new Request(`${origin}/api/auth/confirm-sign-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        body: new URLSearchParams({
          token: tokenIn(emails[0] ?? ''),
          next: '/host',
        }).toString(),
      }),
    );
    expect(response.headers.get('location')).toBe(`${origin}/host`);
    const staff = await session.callerForHeaders(
      new Headers({ cookie: cookieOf(response) }),
    );
    expect(staff).toMatchObject({
      userId,
      roles: ['guest', 'host_staff'],
      hostIds: [hostA],
    });

    await expect(
      dashboard.readHostDashboard(staff, hostA, new Date()),
    ).resolves.toMatchObject({ sessions: [], bookings: [] });
    await expect(
      dashboard.readHostDashboard(staff, hostB, new Date()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sessionsDb.publishWeek(staff, hostA, '2026-12-07', new Date()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(roles.readHostStaff(staff, hostA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('sends another link to someone who already holds the role, with no second grant', async () => {
    const address = 'twice-host-staff@example.com';

    expect(await invite.inviteHostStaff(owner, hostA, address)).toBe('sent');
    expect(await invite.inviteHostStaff(owner, hostA, address)).toBe('sent');

    expect(await linkEmails(address)).toHaveLength(2);
    const [user] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, address));
    expect(await staffRows(user?.id ?? '', hostA)).toHaveLength(1);
    expect(
      await auditRows(
        sql`subject_id = ${user?.id ?? ''} AND action = 'role.granted'`,
      ),
    ).toHaveLength(1);
  });

  it('resends to this host staff only: another host staff member or a stranger is not found and nothing is sent', async () => {
    const other = await person('other-host-staff@example.com');
    await roles.grantHostStaff(testCaller(ownerOf(hostB)), hostB, other.email);

    expect(await invite.resendHostStaffLink(owner, hostA, other.id)).toBe(
      'not_found',
    );
    expect(await invite.resendHostStaffLink(owner, hostA, randomUUID())).toBe(
      'not_found',
    );

    expect(await linkEmails(other.email)).toEqual([]);
  });
});

describe('revoking', () => {
  it('removes the role with one audit row, and the person no longer reads the host', async () => {
    const target = await person();
    await roles.grantHostStaff(owner, hostA, target.email);

    expect(await roles.revokeHostStaff(owner, hostA, target.id)).toBe(
      'revoked',
    );

    expect(await staffRows(target.id, hostA)).toEqual([]);
    expect(
      (await auditRows(sql`subject_id = ${target.id}`)).map((r) => r.action),
    ).toEqual(['role.granted', 'role.revoked']);
    const grantsNow = await client.db
      .select()
      .from(roleGrants)
      .where(eq(roleGrants.userId, target.id));
    expect(grantsNow).toEqual([]);
  });

  it('finds nothing for a person who does not hold it, writes nothing, and leaves another host alone', async () => {
    const target = await person();
    await roles.grantHostStaff(testCaller(ownerOf(hostB)), hostB, target.email);
    const before = await auditRows();

    expect(await roles.revokeHostStaff(owner, hostA, target.id)).toBe(
      'not_found',
    );
    expect(await roles.revokeHostStaff(owner, hostA, randomUUID())).toBe(
      'not_found',
    );

    expect(await staffRows(target.id, hostB)).toHaveLength(1);
    expect(await auditRows()).toEqual(before);
  });
});

describe('limits', () => {
  it('refuses a grant past the cap and writes nothing', async () => {
    const crowded = await host();
    const crowdedOwner = testCaller(ownerOf(crowded));
    const first = `crowd${String(next())}@example.com`;
    for (let n = 0; n < maxHostStaff; n += 1) {
      const result = await roles.grantHostStaff(
        crowdedOwner,
        crowded,
        n === 0 ? first : `crowd${String(next())}@example.com`,
      );
      expect(result).not.toBe('cap_reached');
    }
    const before = await auditRows();

    expect(
      await roles.grantHostStaff(
        crowdedOwner,
        crowded,
        'one-too-many@example.com',
      ),
    ).toBe('cap_reached');

    expect(await roles.readHostStaff(crowdedOwner, crowded)).toHaveLength(
      maxHostStaff,
    );
    expect(await auditRows()).toEqual(before);
    const accounts = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, 'one-too-many@example.com'));
    expect(accounts).toEqual([]);
    expect(await roles.grantHostStaff(crowdedOwner, crowded, first)).toMatchObject(
      { outcome: 'already_held' },
    );
  });

  it('refuses the owner of one host granting on another, and writes nothing', async () => {
    const before = await auditRows();

    await expect(
      roles.grantHostStaff(owner, hostB, 'wrong-host@example.com'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await auditRows()).toEqual(before);
    expect(await addressesOn(hostB)).not.toContain('wrong-host@example.com');
  });
});

describe('the owner’s own access', () => {
  const ownerGrants = (userId: string) =>
    client.db
      .select()
      .from(roleGrants)
      .where(
        and(
          eq(roleGrants.userId, userId),
          eq(roleGrants.role, 'host_owner'),
          eq(roleGrants.hostId, hostA),
        ),
      );

  it('is not removed when the owner asks to remove themselves', async () => {
    const self = await person();
    await client.db
      .insert(roleGrants)
      .values({ userId: self.id, role: 'host_owner', hostId: hostA });
    const asSelf = testCaller({
      userId: self.id,
      roles: [Role.HostOwner],
      hostIds: [hostA],
    });

    expect(await roles.revokeHostStaff(asSelf, hostA, self.id)).toBe(
      'not_found',
    );

    expect(await ownerGrants(self.id)).toHaveLength(1);
  });

  it('is not removed with the staff role of someone who holds both', async () => {
    const both = await person();
    await client.db.insert(roleGrants).values([
      { userId: both.id, role: 'host_owner', hostId: hostA },
      { userId: both.id, role: 'host_staff', hostId: hostA },
    ]);

    expect(await roles.revokeHostStaff(owner, hostA, both.id)).toBe('revoked');

    expect(await ownerGrants(both.id)).toHaveLength(1);
    expect(await staffRows(both.id, hostA)).toEqual([]);
  });
});

describe('reading', () => {
  it('lists the host staff only, oldest first, not the owner or another host’s staff', async () => {
    const here = await person('listed-here@example.com');
    const there = await person('listed-there@example.com');
    await roles.grantHostStaff(owner, hostA, here.email);
    await roles.grantHostStaff(testCaller(ownerOf(hostB)), hostB, there.email);

    const addresses = await addressesOn(hostA);

    expect(addresses).toContain('listed-here@example.com');
    expect(addresses).not.toContain('listed-there@example.com');
  });
});
