import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authUsers, roleGrants } from '@/server/db/schema';
import {
  createFreshDatabase,
  expectConstraint,
  type FreshDatabase,
} from './harness';

// Behaviours under test, against the real database and the real Better Auth, one per decision, branch, or risk:
// - asking for a link answers the same for a known and an unknown address, and sends one email to the lower-cased address
// - the link's token is stored only as a keyed hash: not in the row, and the row is the hash of the token in the email
// - the link works once: the second use is refused and sets no cookie
// - the link lapses 5 minutes after it was made: the row says so, and a lapsed link is refused
// - a session starts with a 30 minute idle deadline and a cookie that lasts 8 hours, and keeps no browser address or user agent
// - a request moves the idle deadline on; one inside a minute of the last does not write
// - a session past its idle deadline is anonymous; so is one past 8 hours however busy; the deadline never passes the ceiling
// - getCaller reads grants: guest only with none; host roles with their hosts; ops and admin with none; requireRole accepts and refuses them unchanged
// - role_grants: a host role needs a host, ops and admin refuse one, a grant is unique per person, role, and host (a null host counts), and leaves with its person
// - the sixth request in an hour for one address is 429 with Retry-After and sends nothing; spellings of one address share the count; another address is unaffected
// - a malformed request is 400 and not counted
// - the database refuses an address Zod would refuse

const origin = 'http://localhost:3000';
const minute = 60_000;

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let handle: typeof import('@/server/auth/handler').handleAuthRequest;
let caller: typeof import('@/server/auth/caller');
let hash: typeof import('@/server/hash');
let hostA: string;
let hostB: string;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  handle = (await import('@/server/auth/handler')).handleAuthRequest;
  caller = await import('@/server/auth/caller');
  hash = await import('@/server/hash');
  const hosts = await client.db.execute<{ id: string }>(sql`
    INSERT INTO hosts (slug, name, time_zone)
    VALUES ('host-a', 'Host A', 'America/New_York'), ('host-b', 'Host B', 'America/New_York')
    RETURNING id`);
  hostA = hosts.rows[0]?.id ?? '';
  hostB = hosts.rows[1]?.id ?? '';
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
const newEmail = () => `person${String((counter += 1))}@example.com`;

const askForLink = (body: unknown) =>
  handle(
    new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

async function emailsTo(address: string) {
  const { rows } = await client.db.execute<{ html: string }>(
    sql`SELECT html FROM messages WHERE recipient = ${address} AND template = 'sign-in-link' ORDER BY created_at, id`,
  );
  return rows.map((row) => row.html);
}

/** Asks for a link and returns the address in the email, the way a person would find it. */
async function linkFor(address: string) {
  const response = await askForLink({ email: address, callbackURL: '/' });
  expect(response.status).toBe(200);
  const html = (await emailsTo(address.toLowerCase())).at(-1) ?? '';
  const href = /href="([^"]*magic-link\/verify[^"]*)"/.exec(html)?.[1];
  if (!href) throw new Error('no sign-in link in the email');
  const url = href.replaceAll('&amp;', '&');
  return { url, token: new URL(url).searchParams.get('token') ?? '' };
}

const followLink = (url: string, cookie?: string) =>
  handle(
    new Request(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (test)',
        'x-forwarded-for': '203.0.113.7',
        ...(cookie ? { cookie } : {}),
      },
    }),
  );

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .find((pair) => pair?.includes('session_token')) ?? '';

async function signIn(address = newEmail()) {
  const { url } = await linkFor(address);
  const response = await followLink(url);
  expect(response.status).toBe(302);
  return { address, cookie: cookieOf(response), response };
}

async function sessionRow(address: string) {
  const { rows } = await client.db.execute<{
    id: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
  }>(sql`
    SELECT s.id, s.user_id AS "userId", s.expires_at AS "expiresAt", s.created_at AS "createdAt"
    FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
    WHERE u.email = ${address} ORDER BY s.created_at DESC LIMIT 1`);
  const row = rows[0];
  if (!row) throw new Error('no session');
  // A raw query returns times as text.
  return {
    ...row,
    expiresAt: new Date(row.expiresAt),
    createdAt: new Date(row.createdAt),
  };
}

const callerFor = (cookie: string) =>
  caller.callerForHeaders(new Headers({ cookie }));

describe('asking for a link', () => {
  it('answers a known and an unknown address alike, and sends one email to the lower-cased address', async () => {
    const known = (await signIn()).address;
    const unknown = newEmail();

    const first = await askForLink({ email: known });
    const second = await askForLink({ email: unknown.toUpperCase() });

    expect(first.status).toBe(second.status);
    expect(await first.json()).toEqual(await second.json());
    expect(await emailsTo(unknown)).toHaveLength(1);
  });

  it('stores the token only as a keyed hash, and the row is the hash of the token in the email', async () => {
    const { token } = await linkFor(newEmail());

    const { rows } = await client.db.execute<{
      identifier: string;
      value: string;
    }>(
      sql`SELECT identifier, value FROM auth_verifications WHERE identifier LIKE '%' || ${token} || '%' OR value LIKE '%' || ${token} || '%'`,
    );
    const expected = createHmac(
      'sha256',
      'development-only-sign-in-link-secret-0000',
    )
      .update(token)
      .digest('hex');
    const stored = await client.db.execute(
      sql`SELECT 1 FROM auth_verifications WHERE identifier = ${`magic-link:${expected}`}`,
    );

    expect(token).toMatch(/^[A-Za-z]{32}$/);
    expect(rows).toEqual([]);
    expect(stored.rows).toHaveLength(1);
  });
});

describe('using a link', () => {
  it('works once: the second use is refused and sets no cookie', async () => {
    const { url } = await linkFor(newEmail());

    const first = await followLink(url);
    const second = await followLink(url);

    expect(first.status).toBe(302);
    expect(cookieOf(first)).toContain('session_token=');
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(cookieOf(second)).toBe('');
  });

  it('lapses 5 minutes after it was made: the row says so, and a lapsed link is refused', async () => {
    const { url, token } = await linkFor(newEmail());
    const stored = createHmac(
      'sha256',
      'development-only-sign-in-link-secret-0000',
    )
      .update(token)
      .digest('hex');
    const { rows } = await client.db.execute<{ seconds: number }>(sql`
      SELECT EXTRACT(EPOCH FROM expires_at - created_at)::int AS seconds
      FROM auth_verifications WHERE identifier = ${`magic-link:${stored}`}`);

    expect(rows[0]?.seconds).toBe(300);

    await client.db.execute(
      sql`UPDATE auth_verifications SET expires_at = now() - interval '1 second' WHERE identifier = ${`magic-link:${stored}`}`,
    );
    const late = await followLink(url);

    expect(late.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(cookieOf(late)).toBe('');
  });

  it('refuses a token that was never issued', async () => {
    const response = await followLink(
      `${origin}/api/auth/magic-link/verify?token=${'x'.repeat(32)}&callbackURL=%2F`,
    );

    expect(response.headers.get('location')).toContain('error=INVALID_TOKEN');
  });

  it('is no-store', async () => {
    const { response } = await signIn();

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('a session', () => {
  it('starts with a 30 minute idle deadline and a cookie that lasts 8 hours', async () => {
    const { address, response } = await signIn();

    const row = await sessionRow(address);
    const idle = row.expiresAt.getTime() - row.createdAt.getTime();
    const cookie = response.headers
      .getSetCookie()
      .find((header) => header.includes('session_token'));

    expect(Math.abs(idle - 30 * minute)).toBeLessThan(5000);
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).toContain('HttpOnly');
  });

  it('keeps no browser address or user agent, though the request carried both', async () => {
    const { address } = await signIn();

    const { rows } = await client.db.execute(sql`
      SELECT s.ip_address, s.user_agent FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
      WHERE u.email = ${address}`);

    expect(rows).toEqual([{ ip_address: null, user_agent: null }]);
  });

  it('moves the deadline on with a request, and writes nothing inside a minute of the last', async () => {
    const { address, cookie } = await signIn();
    const row = await sessionRow(address);
    await client.db.execute(
      sql`UPDATE auth_sessions SET expires_at = now() + interval '10 minutes' WHERE id = ${row.id}`,
    );

    await callerFor(cookie);
    const moved = (await sessionRow(address)).expiresAt.getTime() - Date.now();
    await client.db.execute(
      sql`UPDATE auth_sessions SET expires_at = now() + interval '29 minutes 30 seconds' WHERE id = ${row.id}`,
    );
    const before = (await sessionRow(address)).expiresAt;
    await callerFor(cookie);

    expect(Math.abs(moved - 30 * minute)).toBeLessThan(5000);
    expect((await sessionRow(address)).expiresAt).toEqual(before);
  });

  it('is anonymous past its idle deadline, and the lapsed session cannot be brought back by a late request', async () => {
    const { address, cookie } = await signIn();
    expect((await callerFor(cookie)).userId).not.toBeNull();
    const row = await sessionRow(address);
    await client.db.execute(
      sql`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE id = ${row.id}`,
    );

    expect(await callerFor(cookie)).toEqual(caller.anonymousCaller);

    await caller.callerForHeaders(new Headers({ cookie }));
    const { rows } = await client.db.execute(
      sql`SELECT 1 FROM auth_sessions WHERE id = ${row.id} AND expires_at > now()`,
    );
    expect(rows).toEqual([]);
  });

  it('is anonymous past 8 hours even with a later deadline', async () => {
    const { address, cookie } = await signIn();
    await client.db.execute(sql`
      UPDATE auth_sessions SET created_at = now() - interval '8 hours 1 minute', expires_at = now() + interval '20 minutes'
      WHERE user_id = (SELECT id FROM auth_users WHERE email = ${address})`);

    expect(await callerFor(cookie)).toEqual(caller.anonymousCaller);
  });

  it('never moves the deadline past 8 hours from the sign-in', async () => {
    const { address, cookie } = await signIn();
    await client.db.execute(sql`
      UPDATE auth_sessions SET created_at = now() - interval '7 hours 50 minutes', expires_at = now() + interval '5 minutes'
      WHERE user_id = (SELECT id FROM auth_users WHERE email = ${address})`);

    expect((await callerFor(cookie)).userId).not.toBeNull();

    const row = await sessionRow(address);
    const toCeiling =
      row.createdAt.getTime() + 8 * 60 * minute - row.expiresAt.getTime();
    expect(Math.abs(toCeiling)).toBeLessThan(1000);
  });

  it('is anonymous with no cookie, a cookie that was never issued, and a cookie from a session that is gone', async () => {
    const { address, cookie } = await signIn();
    await client.db.execute(
      sql`DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM auth_users WHERE email = ${address})`,
    );

    expect(await caller.callerForHeaders(new Headers())).toEqual(
      caller.anonymousCaller,
    );
    expect(await callerFor('better-auth.session_token=forged.value')).toEqual(
      caller.anonymousCaller,
    );
    expect(await callerFor(cookie)).toEqual(caller.anonymousCaller);
  });
});

describe('the caller from role grants', () => {
  async function grant(
    userId: string,
    role: 'host_owner' | 'host_staff' | 'ops' | 'admin',
    hostId: string | null,
  ) {
    await client.db.insert(roleGrants).values({ userId, role, hostId });
  }

  it('is a guest with no grants, who owns their own rows only', async () => {
    const { address, cookie } = await signIn();
    const { userId } = await sessionRow(address);

    const found = await callerFor(cookie);

    expect(found).toEqual({
      userId,
      roles: [caller.Role.Guest],
      hostIds: [],
      hostGrants: [],
    });
    expect(() => {
      caller.requireRole(found, caller.Role.Guest, { ownerId: userId });
    }).not.toThrow();
    expect(() => {
      caller.requireRole(found, caller.Role.Ops, {});
    }).toThrow(caller.ForbiddenError);
  });

  it('carries host roles with their hosts, and requireRole accepts the own host and refuses the other', async () => {
    const { address, cookie } = await signIn();
    const { userId } = await sessionRow(address);
    await grant(userId, 'host_owner', hostA);
    await grant(userId, 'host_staff', hostB);

    const found = await callerFor(cookie);

    expect(found.roles).toEqual(
      expect.arrayContaining([
        caller.Role.Guest,
        caller.Role.HostOwner,
        caller.Role.HostStaff,
      ]),
    );
    expect([...found.hostIds].sort()).toEqual([hostA, hostB].sort());
    expect(() => {
      caller.requireRole(found, caller.Role.HostOwner, { hostId: hostA });
    }).not.toThrow();
    expect(() => {
      caller.requireRole(found, caller.Role.HostStaff, { hostId: hostB });
    }).not.toThrow();
    expect(() => {
      caller.requireRole(found, caller.Role.HostOwner, {
        hostId: '00000000-0000-4000-8000-000000000000',
      });
    }).toThrow(caller.ForbiddenError);
  });

  it('keeps each host role with its host: owner of A and staff of B is not owner of B', async () => {
    const { address, cookie } = await signIn();
    const { userId } = await sessionRow(address);
    await grant(userId, 'host_owner', hostA);
    await grant(userId, 'host_staff', hostB);

    const found = await callerFor(cookie);
    const allowed = (
      role: Parameters<typeof caller.requireRole>[1],
      hostId: string,
    ) => {
      try {
        caller.requireRole(found, role, { hostId });
        return true;
      } catch {
        return false;
      }
    };

    expect({
      ownerOfA: allowed(caller.Role.HostOwner, hostA),
      staffOfB: allowed(caller.Role.HostStaff, hostB),
      ownerOfB: allowed(caller.Role.HostOwner, hostB),
      staffOfA: allowed(caller.Role.HostStaff, hostA),
    }).toEqual({
      ownerOfA: true,
      staffOfB: true,
      ownerOfB: false,
      staffOfA: false,
    });
  });

  it('carries ops and admin with no host, for any resource', async () => {
    const { address, cookie } = await signIn();
    const { userId } = await sessionRow(address);
    await grant(userId, 'ops', null);
    await grant(userId, 'admin', null);

    const found = await callerFor(cookie);

    expect(found.roles).toEqual(
      expect.arrayContaining([caller.Role.Ops, caller.Role.Admin]),
    );
    expect(found.hostIds).toEqual([]);
    expect(() => {
      caller.requireRole(found, caller.Role.Ops, { hostId: hostA });
    }).not.toThrow();
    expect(() => {
      caller.requireRole(found, caller.Role.Admin, {});
    }).not.toThrow();
  });

  it('gives a grant made after sign-in on the next request, and takes it away when the row goes', async () => {
    const { address, cookie } = await signIn();
    const { userId } = await sessionRow(address);

    await grant(userId, 'ops', null);
    expect((await callerFor(cookie)).roles).toContain(caller.Role.Ops);
    await client.db.delete(roleGrants).where(eq(roleGrants.userId, userId));

    expect((await callerFor(cookie)).roles).toEqual([caller.Role.Guest]);
  });

  it('is what getCaller returns for the request in flight', async () => {
    const { cookie } = await signIn();
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      headers: () => Promise.resolve(new Headers({ cookie })),
    }));
    const fresh = await import('@/server/auth/caller');

    expect((await fresh.getCaller()).userId).not.toBeNull();

    vi.doUnmock('next/headers');
  });
});

describe('role_grants constraints', () => {
  async function person() {
    const [user] = await client.db
      .insert(authUsers)
      .values({ email: newEmail() })
      .returning({ id: authUsers.id });
    return user?.id ?? '';
  }

  it.each([
    ['a host owner with no host', 'host_owner', null],
    ['host staff with no host', 'host_staff', null],
    ['ops with a host', 'ops', 'A'],
    ['admin with a host', 'admin', 'A'],
  ] as const)('refuses %s', async (_name, role, host) => {
    const userId = await person();

    await expectConstraint(
      client.db
        .insert(roleGrants)
        .values({ userId, role, hostId: host === 'A' ? hostA : null }),
      'role_grants_host_iff_host_role',
    );
  });

  it.each([
    ['the same host role twice', 'host_owner', 'A'],
    ['the same ops role twice, though its host is null', 'ops', null],
  ] as const)('refuses %s', async (_name, role, host) => {
    const userId = await person();
    const row = { userId, role, hostId: host === 'A' ? hostA : null };
    await client.db.insert(roleGrants).values(row);

    await expectConstraint(
      client.db.insert(roleGrants).values(row),
      'role_grants_user_role_host_unique',
    );
  });

  it('allows one role on two hosts, and removes a person’s grants with the person', async () => {
    const userId = await person();
    await client.db.insert(roleGrants).values([
      { userId, role: 'host_staff', hostId: hostA },
      { userId, role: 'host_staff', hostId: hostB },
    ]);

    await client.db.delete(authUsers).where(eq(authUsers.id, userId));

    const left = await client.db
      .select()
      .from(roleGrants)
      .where(eq(roleGrants.userId, userId));
    expect(left).toEqual([]);
  });

  it('refuses an address Zod refuses, and a second row for one address', async () => {
    const address = newEmail();

    await expectConstraint(
      client.db.insert(authUsers).values({ email: 'Mixed@Example.com' }),
      'auth_users_email_shape',
    );
    await client.db.insert(authUsers).values({ email: address });
    await expect(
      client.db.insert(authUsers).values({ email: address }),
    ).rejects.toMatchObject({
      cause: { constraint: 'auth_users_email_unique' },
    });
  });
});

describe('the sign-in rate limit', () => {
  it('refuses the sixth request in an hour with Retry-After and sends nothing; spellings of one address share the count, another address does not', async () => {
    const address = newEmail();
    const spellings = [
      address,
      address.toUpperCase(),
      ` ${address}`.trim(),
      address,
      address.replace('person', 'PERSON'),
    ];

    for (const spelling of spellings) {
      expect((await askForLink({ email: spelling })).status).toBe(200);
    }
    const refused = await askForLink({ email: address });

    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(3500);
    expect(wait).toBeLessThanOrEqual(3600);
    expect(await emailsTo(address)).toHaveLength(5);
    expect((await askForLink({ email: newEmail() })).status).toBe(200);
    const { rows } = await client.db.execute(
      sql`SELECT count FROM rate_limits WHERE key = ${`sign_in_link:${hash.sha256Hex(address)}`}`,
    );
    expect(rows).toEqual([{ count: 6 }]);
  });

  it.each([
    ['not JSON', '{"email":'],
    ['no address', '{}'],
    ['a bad address', '{"email":"not-an-address"}'],
  ])('answers %s with 400 and counts nothing', async (_name, body) => {
    const before = await client.db.execute(
      sql`SELECT count(*)::int AS n FROM rate_limits WHERE key LIKE 'sign_in_link:%'`,
    );

    const response = await askForLink(body);

    expect(response.status).toBe(400);
    expect(
      await client.db.execute(
        sql`SELECT count(*)::int AS n FROM rate_limits WHERE key LIKE 'sign_in_link:%'`,
      ),
    ).toMatchObject({ rows: before.rows });
  });
});
