import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { opsListPageSize } from '@/lib/tableQuery';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { privateRequests } from '@/server/db/schema';
import { catalogFixtures } from './catalogFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, against the real database:
// - a guest, a host owner, an admin and nobody are refused with ForbiddenError, and nothing is written
// - the queue lists newest first, each request with its experience's name, and records one audit row per page
// - the queue pages by cursor and shows each request once, even with the same time
// - an empty queue is an empty page
// - a read whose audit row cannot be written throws and returns no rows
// - the audit row names the ops user and the requests area and holds no guest text

const audit = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock('@/server/db/audit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/db/audit')>();
  return {
    ...original,
    recordAudit: (entry: Parameters<typeof original.recordAudit>[0]) =>
      audit.failWith
        ? Promise.reject(audit.failWith)
        : original.recordAudit(entry),
  };
});

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let queue: typeof import('@/server/db/privateRequests');
let experienceId: string;

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
  queue = await import('@/server/db/privateRequests');
  const fixtures = catalogFixtures(() => client.db);
  experienceId = (
    await fixtures.insertExperience(await fixtures.parents(), {
      name: 'Pasta night',
      status: 'live',
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM private_requests`);
});

let counter = 0;
/** One request, each a minute after the one before, so the order is known. */
async function request(
  over: Partial<typeof privateRequests.$inferInsert> = {},
) {
  counter += 1;
  const [row] = await client.db
    .insert(privateRequests)
    .values({
      experienceId,
      requestedDate: '2099-01-15',
      groupSize: 12,
      budgetMinor: 120_000,
      name: `Guest ${String(counter)}`,
      email: `guest${String(counter)}@example.com`,
      message: 'A birthday.',
      createdAt: new Date(Date.UTC(2026, 10, 1, 12, counter)),
      ...over,
    })
    .returning();
  if (!row) throw new Error('expected a request');
  return row;
}

const auditCount = async () =>
  Number(
    (await client.db.execute(sql`SELECT count(*) AS n FROM audit_log`)).rows[0]
      ?.n,
  );

describe('readOpsPrivateRequests', () => {
  it.each(refused)(
    'refuses %s and writes no audit row',
    async (_who, caller) => {
      await request();
      const before = await auditCount();
      await expect(
        queue.readOpsPrivateRequests(caller, { cursor: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await auditCount()).toBe(before);
    },
  );

  it('lists newest first with the experience name and records one audit row per page', async () => {
    const first = await request();
    const second = await request({ message: null });
    const before = await auditCount();
    const page = await queue.readOpsPrivateRequests(ops, { cursor: null });
    expect(page.rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(page.rows[0]).toMatchObject({
      experienceName: 'Pasta night',
      groupLabel: '12 guests',
      budgetLabel: '$1,200',
      message: null,
    });
    expect(page.nextCursor).toBeNull();
    expect(await auditCount()).toBe(before + 1);
  });

  it('is an empty page when there are no requests', async () => {
    expect(await queue.readOpsPrivateRequests(ops, { cursor: null })).toEqual({
      rows: [],
      nextCursor: null,
    });
  });

  it('pages by cursor and shows each request once, even with the same time', async () => {
    const sameTime = new Date(Date.UTC(2026, 10, 1, 9));
    const made = [];
    for (let n = 0; n < opsListPageSize + 2; n += 1) {
      made.push(await request({ createdAt: sameTime }));
    }
    const firstPage = await queue.readOpsPrivateRequests(ops, { cursor: null });
    expect(firstPage.rows).toHaveLength(opsListPageSize);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await queue.readOpsPrivateRequests(ops, {
      cursor: firstPage.nextCursor,
    });
    const seen = [...firstPage.rows, ...secondPage.rows].map((row) => row.id);
    expect(new Set(seen).size).toBe(made.length);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('returns no rows when the audit row cannot be written', async () => {
    await request();
    audit.failWith = new Error('audit unavailable');
    try {
      await expect(
        queue.readOpsPrivateRequests(ops, { cursor: null }),
      ).rejects.toThrow('audit unavailable');
    } finally {
      audit.failWith = null;
    }
  });

  it('writes an audit row naming the ops user and the area, with no guest text', async () => {
    await request();
    await queue.readOpsPrivateRequests(ops, { cursor: null });
    // The audit log is insert-only, so rows from the pages read above are still there.
    const { rows } = await client.db.execute(
      sql`SELECT DISTINCT actor_id, subject_kind, subject_id, details FROM audit_log WHERE action = 'requests.list_viewed'`,
    );
    expect(rows).toEqual([
      {
        actor_id: opsUser,
        subject_kind: 'ops_area',
        subject_id: '00000000-0000-4000-8000-0000000000a9',
        details: {},
      },
    ]);
  });
});
