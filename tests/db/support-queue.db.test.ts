import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { supportLimits } from '@/lib/support';
import { supportQueuePageSize } from '@/lib/supportQueue';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { supportRequests } from '@/server/db/schema';
import {
  createFreshDatabase,
  expectConstraint,
  raceAgainstOpenTransaction,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, against the real database:
// - every function refuses a guest, a host owner, an admin, and nobody with ForbiddenError, and writes nothing
// - the queue lists newest first, pages by cursor so each request shows once, and records one audit row per page
// - the status filter returns only open or only resolved requests
// - resolving stores the note and a time, and writes one audit row naming the ops user and the request by id, with no note in it
// - a second resolve leaves the first note and writes no second audit row, including one that waits on another resolver's lock and finds the request resolved when it gets it
// - a missing request is not found and writes nothing
// - the database refuses a resolution time without a note, a note without a time, a blank or long note, and a time out of range

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let queue: typeof import('@/server/db/supportQueue');

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });

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
  queue = await import('@/server/db/supportQueue');
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM support_requests`);
});

let counter = 0;
/** One request, each a minute after the one before, so the order is known. */
async function request(
  over: Partial<typeof supportRequests.$inferInsert> = {},
) {
  counter += 1;
  const [row] = await client.db
    .insert(supportRequests)
    .values({
      name: `Guest ${String(counter)}`,
      email: `guest${String(counter)}@example.com`,
      topic: 'booking',
      message: 'Where do we meet?',
      createdAt: new Date(Date.UTC(2026, 10, 1, 12, counter)),
      ...over,
    })
    .returning();
  if (!row) throw new Error('expected a request');
  return row;
}

// The audit log is insert-only, so rows are counted against a count taken before, or read by the request they name.
const auditCount = async () =>
  Number(
    (await client.db.execute(sql`SELECT count(*) AS n FROM audit_log`)).rows[0]
      ?.n,
  );
const resolvedAudit = (id: string) =>
  client.db.execute(
    sql`SELECT actor_id, subject_kind, subject_id, details FROM audit_log WHERE action = 'support.resolved' AND subject_id = ${id}`,
  );
const stored = async (id: string) =>
  (
    await client.db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
  )[0];

describe('access', () => {
  it.each(refused)(
    '%s is refused by both functions and nothing is written',
    async (_who, caller) => {
      const { id } = await request();
      const before = await auditCount();
      await expect(
        queue.readSupportQueue(caller, { status: null, cursor: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        queue.resolveSupportRequest(caller, { id, note: 'Done.' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await stored(id))?.resolvedAt).toBeNull();
      expect(await auditCount()).toBe(before);
    },
  );
});

describe('readSupportQueue', () => {
  it('lists newest first and records one audit row per page', async () => {
    const first = await request();
    const second = await request();
    const before = await auditCount();
    const page = await queue.readSupportQueue(ops, {
      status: null,
      cursor: null,
    });
    expect(page.rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(page.nextCursor).toBeNull();
    expect(await auditCount()).toBe(before + 1);
  });

  it('pages by cursor and shows each request once, even with the same time', async () => {
    const sameTime = new Date(Date.UTC(2026, 10, 1, 9));
    const made = [];
    for (let n = 0; n < supportQueuePageSize + 2; n += 1) {
      made.push(await request({ createdAt: sameTime }));
    }
    const firstPage = await queue.readSupportQueue(ops, {
      status: null,
      cursor: null,
    });
    expect(firstPage.rows).toHaveLength(supportQueuePageSize);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await queue.readSupportQueue(ops, {
      status: null,
      cursor: firstPage.nextCursor,
    });
    const seen = [...firstPage.rows, ...secondPage.rows].map((row) => row.id);
    expect(new Set(seen).size).toBe(made.length);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('filters by status', async () => {
    const open = await request();
    const done = await request();
    await queue.resolveSupportRequest(ops, { id: done.id, note: 'Done.' });
    const ids = async (status: 'open' | 'resolved' | null) =>
      (await queue.readSupportQueue(ops, { status, cursor: null })).rows.map(
        (row) => row.id,
      );
    expect(await ids('open')).toEqual([open.id]);
    expect(await ids('resolved')).toEqual([done.id]);
    expect(await ids(null)).toHaveLength(2);
  });

  it('shows the reason in words', async () => {
    await request({ topic: 'accessibility' });
    const page = await queue.readSupportQueue(ops, {
      status: null,
      cursor: null,
    });
    expect(page.rows[0]?.reason).toBe('Accessibility');
  });
});

describe('resolveSupportRequest', () => {
  it('stores the note and a time, and audits the ops user and the request without the note', async () => {
    const { id } = await request();
    await expect(
      queue.resolveSupportRequest(ops, { id, note: 'Replied by email.' }),
    ).resolves.toBe('resolved');
    const row = await stored(id);
    expect(row?.resolutionNote).toBe('Replied by email.');
    expect(row?.resolvedAt).toBeInstanceOf(Date);
    const audit = (await resolvedAudit(id)).rows;
    expect(audit).toEqual([
      {
        actor_id: opsUser,
        subject_kind: 'support_request',
        subject_id: id,
        details: {},
      },
    ]);
  });

  it('leaves a resolved request as it was', async () => {
    const { id } = await request();
    await queue.resolveSupportRequest(ops, { id, note: 'First.' });
    const before = await stored(id);
    await expect(
      queue.resolveSupportRequest(ops, { id, note: 'Second.' }),
    ).resolves.toBe('already_resolved');
    expect(await stored(id)).toEqual(before);
    expect((await resolvedAudit(id)).rows).toHaveLength(1);
  });

  it('waits for another resolver and then leaves its note, so the check is made under the lock', async () => {
    const { id } = await request();
    const answer = await raceAgainstOpenTransaction<Tx, string>(
      (body) => client.db.transaction(body),
      async (tx) => {
        await tx
          .select()
          .from(supportRequests)
          .where(eq(supportRequests.id, id))
          .for('update');
      },
      () => queue.resolveSupportRequest(ops, { id, note: 'Second.' }),
      {
        beforeCommit: async (tx) => {
          await tx
            .update(supportRequests)
            .set({
              resolvedAt: sql`clock_timestamp()`,
              resolutionNote: 'First.',
            })
            .where(eq(supportRequests.id, id));
        },
      },
    );
    expect(answer).toBe('already_resolved');
    expect((await stored(id))?.resolutionNote).toBe('First.');
    expect((await resolvedAudit(id)).rows).toHaveLength(0);
  });

  it('is not found for a request that is not there, and writes nothing', async () => {
    const before = await auditCount();
    await expect(
      queue.resolveSupportRequest(ops, { id: randomUUID(), note: 'Done.' }),
    ).resolves.toBe('not_found');
    expect(await auditCount()).toBe(before);
  });
});

describe('the support_requests resolution columns', () => {
  const resolved = new Date('2026-11-10T12:00:00Z');
  const bad = (set: Record<string, unknown>) =>
    request().then(({ id }) =>
      client.db
        .update(supportRequests)
        .set(set)
        .where(eq(supportRequests.id, id)),
    );

  it.each([
    ['a time without a note', { resolvedAt: resolved }],
    ['a note without a time', { resolutionNote: 'Done.' }],
    ['a blank note', { resolvedAt: resolved, resolutionNote: '   ' }],
    [
      'a note over the limit',
      {
        resolvedAt: resolved,
        resolutionNote: 'x'.repeat(supportLimits.resolutionNoteMaxChars + 1),
      },
    ],
    [
      'a time out of range',
      { resolvedAt: new Date('0900-01-01T00:00:00Z'), resolutionNote: 'Done.' },
    ],
  ])('refuses %s', async (_name, set) => {
    await expectConstraint(bad(set), 'support_requests_resolution_shape');
  });

  it('accepts a note of exactly the limit', async () => {
    await expect(
      bad({
        resolvedAt: resolved,
        resolutionNote: 'x'.repeat(supportLimits.resolutionNoteMaxChars),
      }),
    ).resolves.toBeDefined();
  });
});
