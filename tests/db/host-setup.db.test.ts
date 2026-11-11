import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HostCreateInput } from '@/lib/hostSetup';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { authUsers, hosts, roleGrants } from '@/server/db/schema';
import { doc } from './editorialFixtures';
import {
  createFreshDatabase,
  expectConstraint,
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

// Behaviours under test, against the real database and the real Better Auth, one per decision, branch, or risk:
// Access:
// - every function refuses guest, host owner, admin, and nobody with ForbiddenError and writes nothing; admin is not ops
// Creating a host:
// - one transaction makes the host, an owner account, the owner's grant, and an audit row naming the ops user and the owner by id
// - an owner address that already has an account is reused, never duplicated, and leaves it as it was
// - with no agreement published, a ticked box refuses the whole setup and writes no host, account, grant, or audit row; unticked, the host is made
// - a ticked box for a version that is no longer current is refused the same way and writes nothing
// - a ticked box for the current version records one acceptance against the host and one audit row
// Accepting on its own:
// - records once, a second try is already_accepted, and two at once record one row and one audit row
// - a version published since the page was read is stale and records nothing; a missing host is not_found
// - a host that accepted an older version has not accepted the new one until it does
// Updating:
// - a changed field saves and writes one audit row flagging the field; the same values write nothing and no audit row; a missing host is not_found
// Reading:
// - the list pages by name with a cursor, each host once, and records one audit row per page; owners and agreement standing are each host's own
// - one host reads with its owners and acceptances and records its view; an unknown id reads null and records nothing
// - the new-host form read records its view and offers the current agreement version
// Inviting the owner (real Better Auth, the fake mailer):
// - the email goes to the owner's address from the grant, carries a confirm link for a token stored only as a keyed hash, and an audit row is written
// - the link works once: it signs the owner in as host owner of this host, and a second use is refused
// - a person who is not this host's owner is not_found and nothing is sent; the sixth link in an hour to one address is rate_limited and sends nothing
// - a failing mailer is `failed`, logs only the error kind, and the audit row already exists

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let setup: typeof import('@/server/db/hostSetup');
let legal: typeof import('@/server/db/legal');
let invite: typeof import('@/server/hostInvite');
let forms: typeof import('@/server/auth/forms');
let session: typeof import('@/server/auth/caller');

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
  setup = await import('@/server/db/hostSetup');
  legal = await import('@/server/db/legal');
  invite = await import('@/server/hostInvite');
  forms = await import('@/server/auth/forms');
  session = await import('@/server/auth/caller');
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
const next = () => (counter += 1);

function input(overrides: Partial<HostCreateInput> = {}): HostCreateInput {
  const n = next();
  return {
    name: `Host ${String(n)}`,
    slug: `host-${String(n)}`,
    description: null,
    timeZone: 'America/New_York',
    notificationEmail: null,
    ownerEmail: `owner${String(n)}@example.com`,
    acceptedLegalDocumentId: null,
    ...overrides,
  };
}

async function created(overrides: Partial<HostCreateInput> = {}) {
  const result = await setup.createHost(ops, input(overrides));
  if (result.status !== 'created') throw new Error('expected a host');
  return result;
}

async function auditRows(where = sql`true`) {
  const { rows } = await client.db.execute<{
    action: string;
    actor_id: string | null;
    subject_id: string;
    details: Record<string, unknown>;
  }>(
    sql`SELECT action, actor_id, subject_id, details FROM audit_log WHERE action LIKE 'host.%' AND (${where}) ORDER BY id`,
  );
  return rows;
}

const count = async (table: string, where = sql`true`) =>
  (
    await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${where}`,
    )
  ).rows[0]?.n ?? 0;

async function publishAgreement() {
  const draft = await legal.createLegalDraft(ops, {
    doc: 'host-agreement',
    title: 'Host agreement',
    body: doc('Terms and content rights.'),
  });
  const published = await legal.publishLegalDocument(ops, draft.id);
  if (published.status !== 'published') throw new Error('not published');
  return published.value;
}

async function snapshot() {
  return {
    hosts: await count('hosts'),
    users: await count('auth_users'),
    grants: await count('role_grants'),
    accepted: await count('legal_acceptances'),
    audit: await count('audit_log'),
  };
}

describe('access', () => {
  const hostId = randomUUID();
  const calls: [string, (caller: Caller) => Promise<unknown>][] = [
    ['createHost', (c) => setup.createHost(c, input())],
    [
      'updateHost',
      (c) =>
        setup.updateHost(c, hostId, {
          name: 'x',
          slug: 'x',
          description: null,
          timeZone: 'UTC',
          notificationEmail: null,
        }),
    ],
    ['readHostsForOps', (c) => setup.readHostsForOps(c, null)],
    ['readHostForOps', (c) => setup.readHostForOps(c, hostId)],
    ['readNewHostForm', (c) => setup.readNewHostForm(c)],
    [
      'readHostInviteTarget',
      (c) => setup.readHostInviteTarget(c, hostId, hostId),
    ],
    [
      'recordHostAcceptance',
      (c) => legal.recordHostAcceptance(c, hostId, hostId),
    ],
    ['readHostAcceptances', (c) => legal.readHostAcceptances(c, [hostId])],
    ['inviteHostOwner', (c) => invite.inviteHostOwner(c, hostId, hostId)],
  ];

  it.each(
    refused.flatMap(([who, caller]) =>
      calls.map(([name, run]) => [who, name, caller, run] as const),
    ),
  )(
    'refuses %s calling %s and writes nothing',
    async (_who, _name, caller, run) => {
      const before = await snapshot();

      await expect(run(caller)).rejects.toBeInstanceOf(ForbiddenError);

      expect(await snapshot()).toEqual(before);
    },
  );
});

describe('creating a host without a published agreement', () => {
  it('makes the host, an owner account, the grant, and one audit row naming the user and the owner by id', async () => {
    const { hostId, ownerUserId } = await created({
      ownerEmail: 'first-owner@example.com',
      description: 'Two cycling teachers.',
    });

    const [host] = await client.db
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId));
    const [owner] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, ownerUserId));
    const grants = await client.db
      .select()
      .from(roleGrants)
      .where(eq(roleGrants.hostId, hostId));
    const audit = await auditRows(sql`subject_id = ${hostId}`);

    expect(host).toMatchObject({
      description: 'Two cycling teachers.',
      timeZone: 'America/New_York',
    });
    expect(owner).toMatchObject({
      email: 'first-owner@example.com',
      emailVerified: true,
    });
    expect(grants).toMatchObject([
      { userId: ownerUserId, role: 'host_owner', hostId },
    ]);
    expect(audit).toEqual([
      {
        action: 'host.created',
        actor_id: opsUser,
        subject_id: hostId,
        details: { owner_user_id: ownerUserId },
      },
    ]);
  });

  it('reuses an owner address that already has an account, and leaves it as it was', async () => {
    await client.db
      .insert(authUsers)
      .values({ email: 'known@example.com', emailVerified: false });

    const first = await created({ ownerEmail: 'known@example.com' });
    const second = await created({ ownerEmail: 'known@example.com' });

    expect(second.ownerUserId).toBe(first.ownerUserId);
    expect(await count('auth_users', sql`email = 'known@example.com'`)).toBe(1);
    const [owner] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, first.ownerUserId));
    expect(owner?.emailVerified).toBe(false);
  });

  it('refuses a ticked box when there is no agreement, and writes nothing at all', async () => {
    const before = await snapshot();

    const result = await setup.createHost(
      ops,
      input({ acceptedLegalDocumentId: randomUUID() }),
    );

    expect(result).toEqual({
      status: 'agreement_refused',
      reason: 'no_current_document',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('refuses accepting on its own with no agreement, and finds no host for a missing id', async () => {
    const { hostId } = await created();

    expect(await legal.recordHostAcceptance(ops, hostId, randomUUID())).toBe(
      'no_current_document',
    );
    expect(
      await legal.recordHostAcceptance(ops, randomUUID(), randomUUID()),
    ).toBe('not_found');
  });

  it('shows no agreement to offer on the new-host form', async () => {
    expect(await setup.readNewHostForm(ops)).toBeNull();
  });
});

describe('acceptance', () => {
  let current: { id: string; version: number };

  beforeAll(async () => {
    current = await publishAgreement();
  });

  it('offers the current version on the new-host form and records the view', async () => {
    const before = await count('audit_log', sql`action = 'host.form_viewed'`);

    expect(await setup.readNewHostForm(ops)).toEqual({
      id: current.id,
      version: 1,
      title: 'Host agreement',
    });
    expect(await count('audit_log', sql`action = 'host.form_viewed'`)).toBe(
      before + 1,
    );
  });

  it('records one acceptance and its audit row when the box was ticked for the current version', async () => {
    const { hostId } = await created({ acceptedLegalDocumentId: current.id });

    expect(
      await count(
        'legal_acceptances',
        sql`subject_id = ${hostId} AND subject_kind = 'host'`,
      ),
    ).toBe(1);
    expect(
      await auditRows(
        sql`subject_id = ${hostId} AND action = 'host.agreement_accepted'`,
      ),
    ).toEqual([
      {
        action: 'host.agreement_accepted',
        actor_id: opsUser,
        subject_id: hostId,
        details: { legal_document_id: current.id },
      },
    ]);
  });

  it('refuses a ticked box for a version that is not current and writes nothing', async () => {
    const before = await snapshot();

    const result = await setup.createHost(
      ops,
      input({ acceptedLegalDocumentId: randomUUID() }),
    );

    expect(result).toEqual({ status: 'agreement_refused', reason: 'stale' });
    expect(await snapshot()).toEqual(before);
  });

  it('makes the host with no acceptance when the box is left empty', async () => {
    const { hostId } = await created();

    expect(await count('legal_acceptances', sql`subject_id = ${hostId}`)).toBe(
      0,
    );
  });

  it('records once on its own, and the second try is already accepted', async () => {
    const { hostId } = await created();

    expect(await legal.recordHostAcceptance(ops, hostId, current.id)).toBe(
      'recorded',
    );
    expect(await legal.recordHostAcceptance(ops, hostId, current.id)).toBe(
      'already_accepted',
    );

    expect(await count('legal_acceptances', sql`subject_id = ${hostId}`)).toBe(
      1,
    );
    expect(
      await auditRows(
        sql`subject_id = ${hostId} AND action = 'host.agreement_accepted'`,
      ),
    ).toHaveLength(1);
  });

  it('records one acceptance and one audit row when two tabs accept at once', async () => {
    const { hostId } = await created();

    const outcomes = await Promise.all([
      legal.recordHostAcceptance(ops, hostId, current.id),
      legal.recordHostAcceptance(ops, hostId, current.id),
    ]);

    expect([...outcomes].sort()).toEqual(['already_accepted', 'recorded']);
    expect(await count('legal_acceptances', sql`subject_id = ${hostId}`)).toBe(
      1,
    );
    expect(
      await auditRows(
        sql`subject_id = ${hostId} AND action = 'host.agreement_accepted'`,
      ),
    ).toHaveLength(1);
  });

  it('treats a version published since as stale, and a host on the old one as not yet on the new one', async () => {
    const { hostId } = await created({ acceptedLegalDocumentId: current.id });
    const next2 = await publishAgreement();
    const before = await count('legal_acceptances');

    expect(await legal.recordHostAcceptance(ops, hostId, current.id)).toBe(
      'stale',
    );
    expect(await count('legal_acceptances')).toBe(before);
    const detail = await setup.readHostForOps(ops, hostId);
    expect(detail?.agreement).toMatchObject({ id: next2.id, version: 2 });
    expect(detail?.acceptances.map((a) => a.version)).toEqual([1]);

    expect(await legal.recordHostAcceptance(ops, hostId, next2.id)).toBe(
      'recorded',
    );
    expect(
      (await setup.readHostForOps(ops, hostId))?.acceptances.map(
        (a) => a.version,
      ),
    ).toEqual([2, 1]);
    current = next2;
  });
});

describe('updating a host', () => {
  const same = (h: { name: string; slug: string }) => ({
    name: h.name,
    slug: h.slug,
    description: null,
    timeZone: 'America/New_York',
    notificationEmail: null,
  });

  it('saves a changed field and records which field changed, never its value', async () => {
    const { hostId } = await created({ name: 'Before', slug: 'before' });

    const result = await setup.updateHost(ops, hostId, {
      ...same({ name: 'After', slug: 'before' }),
      notificationEmail: 'bookings@example.com',
    });

    expect(result).toEqual({ status: 'updated' });
    const [host] = await client.db
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId));
    expect(host).toMatchObject({
      name: 'After',
      notificationEmail: 'bookings@example.com',
    });
    expect(
      await auditRows(sql`subject_id = ${hostId} AND action = 'host.updated'`),
    ).toEqual([
      {
        action: 'host.updated',
        actor_id: opsUser,
        subject_id: hostId,
        details: { changed_name: true, changed_notification_email: true },
      },
    ]);
  });

  it('writes nothing, audit row included, when nothing differs', async () => {
    const { hostId } = await created({ name: 'Same', slug: 'same' });

    expect(
      await setup.updateHost(ops, hostId, same({ name: 'Same', slug: 'same' })),
    ).toEqual({
      status: 'unchanged',
    });

    expect(
      await auditRows(sql`subject_id = ${hostId} AND action = 'host.updated'`),
    ).toEqual([]);
  });

  it('finds no host for an id that is none', async () => {
    expect(
      await setup.updateHost(ops, randomUUID(), same({ name: 'x', slug: 'x' })),
    ).toEqual({ status: 'not_found' });
  });
});

describe('reading', () => {
  it('pages the list by name with a cursor, each host once, and records one audit row per page', async () => {
    await client.db.insert(hosts).values(
      Array.from({ length: 30 }, (_, index) => ({
        slug: `paged-${String(index)}`,
        name: `Paged ${String(index).padStart(2, '0')}`,
        timeZone: 'UTC',
      })),
    );
    const total = await count('hosts');
    const seen: string[] = [];
    let cursor: string | null = null;
    const viewsBefore = await count(
      'audit_log',
      sql`action = 'host.list_viewed'`,
    );
    let pages = 0;

    do {
      const page: Awaited<ReturnType<typeof setup.readHostsForOps>> =
        await setup.readHostsForOps(ops, cursor);
      expect(page.rows.length).toBeLessThanOrEqual(25);
      seen.push(...page.rows.map((row) => row.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(pages).toBeGreaterThan(1);
    expect(await count('audit_log', sql`action = 'host.list_viewed'`)).toBe(
      viewsBefore + pages,
    );
  });

  it('lists each host in name order with its own owners and standing', async () => {
    const { hostId } = await created({
      name: 'Zzz Last Host',
      slug: 'zzz-last',
      ownerEmail: 'zzz@example.com',
    });

    let cursor: string | null = null;
    let row;
    do {
      const page: Awaited<ReturnType<typeof setup.readHostsForOps>> =
        await setup.readHostsForOps(ops, cursor);
      row = page.rows.find((candidate) => candidate.id === hostId) ?? row;
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(row).toMatchObject({
      name: 'Zzz Last Host',
      ownerEmails: ['zzz@example.com'],
      acceptance: 'missing',
    });
  });

  it('starts an unknown cursor at nothing, not at the first page', async () => {
    expect((await setup.readHostsForOps(ops, randomUUID())).rows).toEqual([]);
  });

  it('reads one host with its owners and records the view', async () => {
    const { hostId, ownerUserId } = await created({
      ownerEmail: 'view@example.com',
    });

    const detail = await setup.readHostForOps(ops, hostId);

    expect(detail?.owners).toEqual([
      { userId: ownerUserId, email: 'view@example.com' },
    ]);
    expect(
      await auditRows(sql`subject_id = ${hostId} AND action = 'host.viewed'`),
    ).toMatchObject([{ actor_id: opsUser }]);
  });

  it('reads null for an unknown host and records nothing', async () => {
    const before = await count('audit_log', sql`action = 'host.viewed'`);

    expect(await setup.readHostForOps(ops, randomUUID())).toBeNull();

    expect(await count('audit_log', sql`action = 'host.viewed'`)).toBe(before);
  });
});

describe('host slugs are unique', () => {
  const base = (slug: string) => ({
    name: 'Same slug',
    slug,
    description: null,
    timeZone: 'UTC',
    notificationEmail: null,
  });

  it('refuses a second host with a taken slug on create, writing nothing', async () => {
    await created({ slug: 'taken-on-create' });
    const before = await snapshot();

    const result = await setup.createHost(
      ops,
      input({ slug: 'taken-on-create' }),
    );

    expect(result).toEqual({ status: 'slug_taken' });
    expect(await snapshot()).toEqual(before);
  });

  it('refuses a rename to a taken slug on update, changing nothing', async () => {
    await created({ slug: 'taken-on-update' });
    const { hostId } = await created({ slug: 'free-on-update' });
    const before = await snapshot();

    const result = await setup.updateHost(ops, hostId, base('taken-on-update'));

    expect(result).toEqual({ status: 'slug_taken' });
    expect(await snapshot()).toEqual(before);
    const [host] = await client.db
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId));
    expect(host?.slug).toBe('free-on-update');
  });

  it('lets a host keep its own slug while changing another field', async () => {
    const { hostId } = await created({ slug: 'keeps-its-slug' });

    expect(await setup.updateHost(ops, hostId, base('keeps-its-slug'))).toEqual(
      {
        status: 'updated',
      },
    );
  });

  it('is enforced by the database', async () => {
    await created({ slug: 'db-unique' });

    await expectConstraint(
      client.db
        .insert(hosts)
        .values({ slug: 'db-unique', name: 'Dup', timeZone: 'UTC' }),
      'hosts_slug_unique',
    );
  });
});

describe('inviting the owner', () => {
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .find((pair) => pair?.includes('session_token=')) ?? '';

  async function inviteEmails(address: string) {
    const { rows } = await client.db.execute<{ html: string }>(
      sql`SELECT html FROM messages WHERE recipient = ${address} AND template = 'host-invite' ORDER BY created_at, id`,
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
        body: new URLSearchParams({ token, next: '/host' }).toString(),
      }),
    );

  it('emails the owner a link that signs them in once, as owner of this host, and audits the request', async () => {
    const { hostId, ownerUserId } = await created({
      name: 'Invite Host',
      slug: 'invite-host',
      ownerEmail: 'invitee@example.com',
    });

    expect(await invite.inviteHostOwner(ops, hostId, ownerUserId)).toBe('sent');

    const [html] = await inviteEmails('invitee@example.com');
    expect(html).toContain('Invite Host');
    const token = tokenIn(html ?? '');
    expect(
      await auditRows(
        sql`subject_id = ${hostId} AND action = 'host.owner_invited'`,
      ),
    ).toEqual([
      {
        action: 'host.owner_invited',
        actor_id: opsUser,
        subject_id: hostId,
        details: { owner_user_id: ownerUserId },
      },
    ]);
    const stored = await client.db.execute<{
      identifier: string;
      value: string;
    }>(
      sql`SELECT identifier, value FROM auth_verifications WHERE identifier LIKE 'magic-link:%' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(stored.rows[0]?.identifier).toMatch(/^magic-link:[0-9a-f]{64}$/);
    expect(stored.rows[0]?.identifier).not.toContain(token);

    const first = await confirm(token);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`${origin}/host`);
    const caller = await session.callerForHeaders(
      new Headers({ cookie: cookieOf(first) }),
    );
    expect(caller).toMatchObject({
      userId: ownerUserId,
      roles: ['guest', 'host_owner'],
      hostIds: [hostId],
    });
    const [owner] = await client.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, ownerUserId));
    expect(owner?.emailVerified).toBe(true);

    const second = await confirm(token);
    expect(cookieOf(second)).toBe('');
    expect(second.headers.get('location')).toContain('/sign-in');
  });

  it('finds no owner for a person who does not own this host and sends nothing', async () => {
    const a = await created({ ownerEmail: 'a-owner@example.com' });
    const b = await created({ ownerEmail: 'b-owner@example.com' });

    expect(await invite.inviteHostOwner(ops, a.hostId, b.ownerUserId)).toBe(
      'not_found',
    );

    expect(await inviteEmails('b-owner@example.com')).toEqual([]);
    expect(
      await auditRows(
        sql`action = 'host.owner_invited' AND subject_id = ${a.hostId}`,
      ),
    ).toEqual([]);
  });

  it('refuses the sixth link in an hour to one address and sends nothing more', async () => {
    const { hostId, ownerUserId } = await created({
      ownerEmail: 'busy@example.com',
    });

    const results: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      results.push(await invite.inviteHostOwner(ops, hostId, ownerUserId));
    }

    expect(results).toEqual([
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'rate_limited',
    ]);
    expect(await inviteEmails('busy@example.com')).toHaveLength(5);
  });

  it('reports a failing mailer as failed, leaves its audit row, and logs only the error kind', async () => {
    const { hostId, ownerUserId } = await created({
      ownerEmail: 'broken@example.com',
    });
    mailer.failWith = new Error('smtp password hunter2 for broken@example.com');
    const { logger } = await import('@/server/monitoring/logger');

    const result = await invite.inviteHostOwner(ops, hostId, ownerUserId);
    mailer.failWith = null;

    expect(result).toBe('failed');
    expect(
      await auditRows(
        sql`subject_id = ${hostId} AND action = 'host.owner_invited'`,
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'hunter2',
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'broken@example.com',
    );
  });
});
