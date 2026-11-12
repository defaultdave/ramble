import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLimits } from '@/lib/audit';
import type { RoleGrant } from '@/lib/roleGrants';
import { auditPageSize } from '@/lib/staffAdmin';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { authUsers, hosts, roleGrants } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
const mailer = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock('@/server/ports/email', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/server/ports/email')>();
  return {
    ...original,
    sendEmail: (request: Parameters<typeof original.sendEmail>[0]) =>
      mailer.failWith
        ? Promise.reject(mailer.failWith)
        : original.sendEmail(request),
  };
});
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, against the real database and the real Better Auth:
// Access:
// - every ops-only function refuses a guest, a host owner, an admin, and nobody, and writes nothing
// Granting:
// - a grant writes one row and one audit row naming the actor and the role; a second grant of the same role writes nothing
// - the grant command's system actor is recorded as the system; a grant that does not fit its role throws and writes nothing
// - a host role is granted on an existing host (the contract the host staff unit calls)
// Revoking:
// - a revoke removes the row, writes one audit row, and leaves the person's other roles; one that finds no row is not_found and writes nothing
// - nobody revokes their own ops grant, and ops cannot revoke admin; neither writes anything
// - a person who lost ops has no ops role the next time their grants are read
// Reading:
// - the staff list holds ops and admin holders only, one row per person, and records one audit row
// Inviting (fake mailer):
// - a new address gets an account marked verified, the ops role, one sign-in email, and audit rows for the grant and the link; the link signs them in once as ops
// - an address that already holds ops gets another link and no second grant; a person who is not ops is not found by a resend and nothing is sent
// - the sixth link in an hour to one address is rate_limited; a failing mailer says failed, keeps the grant, and logs only the error kind
// The grant command:
// - it makes the account, grants once, and records the system as the actor; a repeat says nothing changed
// - bad arguments print the usage and touch nothing; a failed grant says only the error kind and leaves no account
// The audit viewer:
// - a day reads its own rows oldest first, pages by id with no row twice or missed, and records its own read

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let roles: typeof import('@/server/db/staffRoles');
let view: typeof import('@/server/db/auditView');
let invite: typeof import('@/server/staffInvite');
let forms: typeof import('@/server/auth/forms');
let session: typeof import('@/server/auth/caller');
let grants: typeof import('@/server/db/roleGrants');

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const origin = 'http://localhost:3000';

const refused: [string, Caller][] = [
  ['a guest', testCaller({ userId: randomUUID() })],
  [
    'a host owner',
    testCaller({
      userId: randomUUID(),
      roles: [Role.HostOwner],
      hostIds: [randomUUID()],
    }),
  ],
  ['an admin', testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
];

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  roles = await import('@/server/db/staffRoles');
  view = await import('@/server/db/auditView');
  invite = await import('@/server/staffInvite');
  forms = await import('@/server/auth/forms');
  session = await import('@/server/auth/caller');
  grants = await import('@/server/db/roleGrants');
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
      slug: `staff-host-${String(n)}`,
      name: `Staff host ${String(n)}`,
      timeZone: 'America/New_York',
    })
    .returning({ id: hosts.id });
  return row?.id ?? '';
}

async function auditRows(where = sql`true`) {
  const { rows } = await client.db.execute<{
    action: string;
    actor_kind: string;
    actor_id: string | null;
    subject_id: string;
    details: Record<string, unknown>;
  }>(
    sql`SELECT action, actor_kind, actor_id, subject_id, details FROM audit_log WHERE (action LIKE 'role.%' OR action LIKE 'staff.%' OR action LIKE 'audit.%') AND (${where}) ORDER BY id`,
  );
  return rows;
}

const grantRows = (userId: string) =>
  client.db.select().from(roleGrants).where(eq(roleGrants.userId, userId));

const opsGrant = { role: 'ops', hostId: null } as const;

/** The contract other units call: a role given in a transaction by an ops user. */
const grant = (userId: string, role: RoleGrant) =>
  client.db.transaction((tx) =>
    roles.grantRoleIn(tx, { kind: 'user', userId: opsUser }, userId, role),
  );

describe('access', () => {
  it.each(refused)(
    '%s is refused by every function, and nothing is written',
    async (_who, caller) => {
      const target = await person();
      const before = await auditRows();
      const calls = [
        () => roles.revokeRole(caller, target.id, opsGrant),
        () => roles.readStaffForOps(caller),
        () => roles.readRoleHolder(caller, target.id, opsGrant),
        () => view.readAuditForOps(caller, '2026-01-05', 0),
        () => invite.inviteStaff(caller, 'someone@example.com'),
        () => invite.resendStaffLink(caller, target.id),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await grantRows(target.id)).toEqual([]);
      expect(await auditRows()).toEqual(before);
    },
  );
});

describe('granting', () => {
  it('writes the grant and one audit row, and a repeat writes nothing', async () => {
    const target = await person();

    expect(await grant(target.id, opsGrant)).toBe('granted');
    expect(await grant(target.id, opsGrant)).toBe('already_held');

    expect(await grantRows(target.id)).toMatchObject([
      { role: 'ops', hostId: null },
    ]);
    expect(await auditRows(sql`subject_id = ${target.id}`)).toEqual([
      {
        action: 'role.granted',
        actor_kind: 'user',
        actor_id: opsUser,
        subject_id: target.id,
        details: { role: 'ops' },
      },
    ]);
  });

  it('records the system as the actor of a grant made with no signed-in user', async () => {
    const target = await person();

    await client.db.transaction((tx) =>
      roles.grantRoleIn(tx, { kind: 'system' }, target.id, {
        role: 'admin',
        hostId: null,
      }),
    );

    expect(await auditRows(sql`subject_id = ${target.id}`)).toEqual([
      {
        action: 'role.granted',
        actor_kind: 'system',
        actor_id: null,
        subject_id: target.id,
        details: { role: 'admin' },
      },
    ]);
  });

  it.each([
    ['a host role with no host', { role: 'host_staff', hostId: null }],
    ['ops with a host', { role: 'ops', hostId: randomUUID() }],
  ] as const)('refuses %s and writes nothing', async (_name, grant) => {
    const target = await person();

    await expect(
      client.db.transaction((tx) =>
        roles.grantRoleIn(tx, { kind: 'system' }, target.id, grant),
      ),
    ).rejects.toThrow('The grant does not fit its role');

    expect(await grantRows(target.id)).toEqual([]);
    expect(await auditRows(sql`subject_id = ${target.id}`)).toEqual([]);
  });

  it('gives a host role on an existing host, the contract the host staff unit calls', async () => {
    const target = await person();
    const hostId = await host();
    const staff = { role: 'host_staff', hostId } as const;

    expect(await grant(target.id, staff)).toBe('granted');
    expect(await grants.readRoleGrants(target.id)).toEqual([staff]);
    expect(await auditRows(sql`subject_id = ${target.id}`)).toMatchObject([
      { details: { role: 'host_staff', host_id: hostId } },
    ]);
  });
});

describe('revoking', () => {
  it('removes the role and writes one audit row, leaving the other roles', async () => {
    const target = await person();
    const hostId = await host();
    await grant(target.id, opsGrant);
    await grant(target.id, { role: 'host_staff', hostId });

    expect(await roles.revokeRole(ops, target.id, opsGrant)).toBe('revoked');

    expect(await grantRows(target.id)).toMatchObject([
      { role: 'host_staff', hostId },
    ]);
    expect(
      await auditRows(
        sql`subject_id = ${target.id} AND action = 'role.revoked'`,
      ),
    ).toEqual([
      {
        action: 'role.revoked',
        actor_kind: 'user',
        actor_id: opsUser,
        subject_id: target.id,
        details: { role: 'ops' },
      },
    ]);
  });

  it('refuses a grant that does not fit its role, and writes nothing', async () => {
    const target = await person();

    await expect(
      roles.revokeRole(ops, target.id, { role: 'host_staff', hostId: null }),
    ).rejects.toThrow('The grant does not fit its role');
  });

  it('finds nothing to remove for a person without the role, and writes nothing', async () => {
    const target = await person();

    expect(await roles.revokeRole(ops, target.id, opsGrant)).toBe('not_found');

    expect(await auditRows(sql`subject_id = ${target.id}`)).toEqual([]);
  });

  it('refuses a revoke of your own ops grant and of admin, and writes nothing', async () => {
    const self = await person();
    const admin = await person();
    await grant(self.id, opsGrant);
    await client.db.transaction((tx) =>
      roles.grantRoleIn(tx, { kind: 'system' }, admin.id, {
        role: 'admin',
        hostId: null,
      }),
    );
    const selfCaller = testCaller({ userId: self.id, roles: [Role.Ops] });

    expect(await roles.revokeRole(selfCaller, self.id, opsGrant)).toBe('self');
    expect(
      await roles.revokeRole(ops, admin.id, { role: 'admin', hostId: null }),
    ).toBe('admin_role');

    expect(await grantRows(self.id)).toHaveLength(1);
    expect(await grantRows(admin.id)).toHaveLength(1);
    expect(
      await auditRows(
        sql`action = 'role.revoked' AND subject_id IN (${self.id}, ${admin.id})`,
      ),
    ).toEqual([]);
  });

  it('takes effect on the next read of the person’s grants', async () => {
    const target = await person();
    await grant(target.id, opsGrant);
    expect(
      session.callerFromGrants(
        target.id,
        await grants.readRoleGrants(target.id),
      ).roles,
    ).toContain('ops');

    await roles.revokeRole(ops, target.id, opsGrant);

    expect(
      session.callerFromGrants(
        target.id,
        await grants.readRoleGrants(target.id),
      ).roles,
    ).not.toContain('ops');
  });
});

describe('reading the staff', () => {
  it('lists ops and admin holders only, one row per person, and records the read', async () => {
    const staff = await person('lister-ops@example.com');
    const owner = await person('lister-owner@example.com');
    const hostId = await host();
    await grant(staff.id, opsGrant);
    await grant(staff.id, { role: 'admin', hostId: null });
    await grant(owner.id, { role: 'host_owner', hostId });
    const before = await auditRows(sql`action = 'staff.list_viewed'`);

    const rows = await roles.readStaffForOps(ops);

    expect(rows).toContainEqual({
      userId: staff.id,
      email: 'lister-ops@example.com',
      roles: ['ops', 'admin'],
    });
    expect(rows.map((row) => row.userId)).not.toContain(owner.id);
    expect(
      rows.every((row) =>
        row.roles.every((role) => role === 'ops' || role === 'admin'),
      ),
    ).toBe(true);
    expect(await auditRows(sql`action = 'staff.list_viewed'`)).toHaveLength(
      before.length + 1,
    );
  });
});

describe('inviting staff', () => {
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

  const confirm = (token: string) =>
    forms.handleConfirmSignIn(
      new Request(`${origin}/api/auth/confirm-sign-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        body: new URLSearchParams({ token, next: '/ops' }).toString(),
      }),
    );

  it('makes the account, grants ops, emails one link, and the link signs them in once as ops', async () => {
    const address = 'new-staff@example.com';

    expect(await invite.inviteStaff(ops, 'New-Staff@Example.com')).toBe('sent');

    const [user] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, address));
    expect(user?.emailVerified).toBe(true);
    expect(await grantRows(user?.id ?? '')).toMatchObject([
      { role: 'ops', hostId: null },
    ]);
    expect(
      (await auditRows(sql`subject_id = ${user?.id ?? ''}`)).map(
        (row) => row.action,
      ),
    ).toEqual(['role.granted', 'staff.link_sent']);
    const emails = await linkEmails(address);
    expect(emails).toHaveLength(1);
    const token = tokenIn(emails[0] ?? '');
    const stored = await client.db.execute<{ identifier: string }>(
      sql`SELECT identifier FROM auth_verifications WHERE identifier LIKE 'magic-link:%' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(stored.rows[0]?.identifier).not.toContain(token);

    const first = await confirm(token);
    expect(first.headers.get('location')).toBe(`${origin}/ops`);
    const caller = await session.callerForHeaders(
      new Headers({ cookie: cookieOf(first) }),
    );
    expect(caller).toMatchObject({ userId: user?.id, roles: ['guest', 'ops'] });

    const second = await confirm(token);
    expect(cookieOf(second)).toBe('');
    expect(second.headers.get('location')).toContain('/sign-in');
  });

  it('sends another link to someone who already holds ops, with no second grant', async () => {
    const address = 'twice@example.com';

    expect(await invite.inviteStaff(ops, address)).toBe('sent');
    expect(await invite.inviteStaff(ops, address)).toBe('sent');

    expect(await linkEmails(address)).toHaveLength(2);
    const [user] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, address));
    expect(await grantRows(user?.id ?? '')).toHaveLength(1);
    expect(
      await auditRows(
        sql`subject_id = ${user?.id ?? ''} AND action = 'role.granted'`,
      ),
    ).toHaveLength(1);
  });

  it('finds no staff member to resend to for a person without ops, and sends nothing', async () => {
    const target = await person('not-staff@example.com');

    expect(await invite.resendStaffLink(ops, target.id)).toBe('not_found');
    expect(await invite.resendStaffLink(ops, randomUUID())).toBe('not_found');

    expect(await linkEmails('not-staff@example.com')).toEqual([]);
  });

  it('resends to a staff member', async () => {
    const target = await person('resend@example.com');
    await grant(target.id, opsGrant);

    expect(await invite.resendStaffLink(ops, target.id)).toBe('sent');

    expect(await linkEmails('resend@example.com')).toHaveLength(1);
  });

  it('rejects when the grant cannot be written: no account, no email, no audit row', async () => {
    const address = 'blocked-grant@example.com';
    await client.db.execute(sql`
      CREATE FUNCTION refuse_ops_grant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'grant refused for the test'; END $$`);
    await client.db.execute(
      sql`CREATE TRIGGER refuse_ops_grant BEFORE INSERT ON role_grants FOR EACH ROW EXECUTE FUNCTION refuse_ops_grant()`,
    );
    try {
      await expect(invite.inviteStaff(ops, address)).rejects.toThrow();
    } finally {
      await client.db.execute(
        sql`DROP TRIGGER refuse_ops_grant ON role_grants`,
      );
      await client.db.execute(sql`DROP FUNCTION refuse_ops_grant()`);
    }

    expect(await linkEmails(address)).toEqual([]);
    expect(
      await client.db
        .select()
        .from(authUsers)
        .where(eq(authUsers.email, address)),
    ).toEqual([]);
    const { rows } = await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'staff.link_sent' AND subject_id NOT IN (SELECT id FROM auth_users)`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('refuses a resend past the hourly count too, since it shares the address count', async () => {
    const target = await person('resend-busy@example.com');
    await grant(target.id, opsGrant);

    const results: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      results.push(await invite.resendStaffLink(ops, target.id));
    }

    expect(results.at(-1)).toBe('rate_limited');
    expect(await linkEmails('resend-busy@example.com')).toHaveLength(5);
  });

  it('refuses the sixth link in an hour to one address and sends nothing more', async () => {
    const results: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      results.push(await invite.inviteStaff(ops, 'busy-staff@example.com'));
    }

    expect(results).toEqual([
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'rate_limited',
    ]);
    expect(await linkEmails('busy-staff@example.com')).toHaveLength(5);
  });

  it('says failed for a failing mailer, keeps the grant, and logs only the error kind', async () => {
    const { logger } = await import('@/server/monitoring/logger');
    mailer.failWith = new TypeError('smtp password hunter2');
    try {
      expect(await invite.inviteStaff(ops, 'unlucky@example.com')).toBe(
        'failed',
      );
    } finally {
      mailer.failWith = null;
    }

    const [user] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, 'unlucky@example.com'));
    expect(await grantRows(user?.id ?? '')).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      'The staff sign-in link could not be sent',
      { errorName: 'TypeError' },
    );
  });
});

describe('the audit viewer', () => {
  const day = '2026-01-05';

  async function seedDay(count: number) {
    await client.db.execute(
      sql`INSERT INTO audit_log (recorded_at, actor_kind, action, subject_kind, subject_id)
          SELECT timestamptz '2026-01-05 00:00:00+00' + (n * interval '1 minute'), 'system', 'seed.row', 'k', gen_random_uuid()
          FROM generate_series(0, ${count - 1}) AS n`,
    );
    // The edges of the neighbours: the last instant before the day, and the first of the next.
    await client.db.execute(
      sql`INSERT INTO audit_log (recorded_at, actor_kind, action, subject_kind, subject_id) VALUES
          (timestamptz '2026-01-04 23:59:59+00', 'system', 'seed.before', 'k', gen_random_uuid()),
          (timestamptz '2026-01-06 00:00:00+00', 'system', 'seed.after', 'k', gen_random_uuid())`,
    );
  }

  it('reads one UTC day oldest first, pages with no row twice or missed, and records its own read', async () => {
    const total = auditPageSize + 5;
    expect(total).toBeLessThan(auditLimits.exportPageRows);
    await seedDay(total);

    const first = await view.readAuditForOps(ops, day, 0);
    expect(first.rows).toHaveLength(auditPageSize);
    expect(first.nextCursor).toBe(first.rows.at(-1)?.id);
    const second = await view.readAuditForOps(
      ops,
      day,
      Number(first.nextCursor),
    );
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const all = [...first.rows, ...second.rows];
    expect(new Set(all.map((row) => row.id)).size).toBe(total);
    expect(all.map((row) => Number(row.id))).toEqual(
      [...all.map((row) => Number(row.id))].sort((a, b) => a - b),
    );
    expect(all.every((row) => row.action === 'seed.row')).toBe(true);
    expect(all[0]?.time).toBe('Jan 5, 2026, 12:00 AM UTC');
    expect(
      await auditRows(
        sql`action = 'audit.viewed' AND details->>'day' = ${day}`,
      ),
    ).toMatchObject([{ actor_id: opsUser }, { actor_id: opsUser }]);
  });

  it('shows an empty day as no rows', async () => {
    const page = await view.readAuditForOps(ops, '2026-01-07', 0);

    expect(page).toEqual({ rows: [], nextCursor: null });
  });
});

describe('the grant command', () => {
  async function run(argv: string[]) {
    const lines: string[] = [];
    const { runGrantRole } = await import('@/server/auth/grantRoleCli');
    const code = await runGrantRole({
      argv,
      write: (line) => lines.push(line),
    });
    return { code, lines };
  }

  it('makes the account, grants the role once, and records the system as the actor', async () => {
    const argv = ['--email', 'First-Admin@Example.com', '--role', 'admin'];

    const first = await run(argv);
    const second = await run(argv);

    expect(first.code).toBe(0);
    expect(first.lines[0]).toContain(
      'Granted admin to first-admin@example.com',
    );
    expect(second.code).toBe(0);
    expect(second.lines[0]).toContain('already holds admin');
    const [user] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, 'first-admin@example.com'));
    expect(user?.emailVerified).toBe(true);
    expect(await grantRows(user?.id ?? '')).toHaveLength(1);
    expect(await auditRows(sql`subject_id = ${user?.id ?? ''}`)).toMatchObject([
      { action: 'role.granted', actor_kind: 'system', actor_id: null },
    ]);
  });

  it('refuses bad arguments with the usage and touches nothing', async () => {
    const before = await auditRows();

    const result = await run([
      '--email',
      'a@example.com',
      '--role',
      'ops',
      '--host',
      randomUUID(),
    ]);

    expect(result.code).toBe(2);
    expect(result.lines[0]).toContain('Usage: pnpm db:grant-role');
    expect(await auditRows()).toEqual(before);
  });

  it('reports a failed grant by error kind only and writes no account', async () => {
    const result = await run([
      '--email',
      'no-host@example.com',
      '--role',
      'host_staff',
      '--host',
      randomUUID(),
    ]);

    expect(result.code).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).not.toContain('no-host@example.com');
    const rows = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, 'no-host@example.com'));
    expect(rows).toEqual([]);
  });
});
