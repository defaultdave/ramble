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
import { opsListPageSize } from '@/lib/tableQuery';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { reviews } from '@/server/db/schema';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { createOrderParents } from './orderParents';
import { insertBooking } from './reviewFixtures';

// Behaviours under test, against the real database:
// - every function refuses a guest, a host owner, an admin, and nobody with ForbiddenError, and writes nothing
// - the list is newest first, pages by cursor so each review shows once, and shows the first name, the experience and the status
// - the status filter returns only visible or only hidden reviews
// - a status that is not one lists every review; a cursor or review id that is not an id is refused before any query
// - hiding stores the hidden status and a new updated time, and writes one audit row naming the ops user, the review and the reason code
// - showing a hidden review again writes one audit row and no reason
// - hiding a hidden review and showing a visible one are no-ops that write no audit row and leave the row as it was
// - a hide that waits on another change finds the row already hidden once it gets the lock, and writes nothing
// - a review that is not there is not found and writes nothing
// - the result names the review's experience, so the caller can refresh its pages

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let moderation: typeof import('@/server/db/reviewModeration');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

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
  moderation = await import('@/server/db/reviewModeration');
  parents = await createOrderParents(client.db, 'review-moderation');
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM reviews`);
});

let counter = 0;
/** One review on its own booking, each a minute after the one before, so the order is known. */
async function review(over: Partial<typeof reviews.$inferInsert> = {}) {
  counter += 1;
  const order = await insertBooking(client.db, parents, {
    contactEmail: `guest${String(counter)}@example.com`,
  });
  const [row] = await client.db
    .insert(reviews)
    .values({
      orderId: order.id,
      experienceId: parents.experienceId,
      rating: 4,
      body: 'Lovely.',
      createdAt: new Date(Date.UTC(2026, 10, 1, 12, counter)),
      updatedAt: new Date(Date.UTC(2026, 10, 1, 12, counter)),
      ...over,
    })
    .returning();
  if (!row) throw new Error('expected a review');
  return row;
}

// The audit log is insert-only, so rows are counted against a count taken before, or read by the review they name.
const auditCount = async () =>
  Number(
    (await client.db.execute(sql`SELECT count(*) AS n FROM audit_log`)).rows[0]
      ?.n,
  );
const auditFor = (id: string) =>
  client.db.execute(
    sql`SELECT actor_id, action, subject_kind, details FROM audit_log WHERE subject_id = ${id} ORDER BY id`,
  );
const stored = async (id: string) =>
  (await client.db.select().from(reviews).where(eq(reviews.id, id)))[0];

describe('access', () => {
  it.each(refused)(
    '%s is refused by both functions and nothing is written',
    async (_who, caller) => {
      const { id } = await review();
      const before = await auditCount();
      await expect(
        moderation.readReviewsForModeration(caller, {
          status: null,
          cursor: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        moderation.setReviewVisibility(caller, {
          action: 'hide',
          id,
          reason: 'spam',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        moderation.setReviewVisibility(caller, { action: 'unhide', id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await stored(id))?.status).toBe('visible');
      expect(await auditCount()).toBe(before);
    },
  );
});

describe('readReviewsForModeration', () => {
  it('lists newest first with the experience, first name and status', async () => {
    const first = await review();
    const second = await review({ status: 'hidden' });
    const page = await moderation.readReviewsForModeration(ops, {
      status: null,
      cursor: null,
    });
    expect(page.rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(page.rows[0]).toMatchObject({
      firstName: 'Pat',
      status: 'hidden',
      ratingText: '4 out of 5',
    });
    expect(page.rows[0]?.experienceName).toEqual(expect.any(String));
    expect(page.nextCursor).toBeNull();
  });

  it('pages by cursor and shows each review once, even with the same time', async () => {
    const sameTime = new Date(Date.UTC(2026, 10, 1, 9));
    const made = [];
    for (let n = 0; n < opsListPageSize + 2; n += 1) {
      made.push(await review({ createdAt: sameTime, updatedAt: sameTime }));
    }
    const firstPage = await moderation.readReviewsForModeration(ops, {
      status: null,
      cursor: null,
    });
    expect(firstPage.rows).toHaveLength(opsListPageSize);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await moderation.readReviewsForModeration(ops, {
      status: null,
      cursor: firstPage.nextCursor,
    });
    const seen = [...firstPage.rows, ...secondPage.rows].map((row) => row.id);
    expect(new Set(seen).size).toBe(made.length);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('filters by status', async () => {
    const visible = await review();
    const hidden = await review({ status: 'hidden' });
    const ids = async (status: 'visible' | 'hidden' | null) =>
      (
        await moderation.readReviewsForModeration(ops, { status, cursor: null })
      ).rows.map((row) => row.id);
    expect(await ids('visible')).toEqual([visible.id]);
    expect(await ids('hidden')).toEqual([hidden.id]);
    expect(await ids(null)).toHaveLength(2);
  });
});

describe('inputs the data layer reads', () => {
  it('lists every review for a status that is not one', async () => {
    await review();
    await review({ status: 'hidden' });
    const page = await moderation.readReviewsForModeration(ops, {
      status: 'removed' as never,
      cursor: null,
    });
    expect(page.rows).toHaveLength(2);
  });

  it('refuses a cursor that is not an id before it reaches the query', async () => {
    await expect(
      moderation.readReviewsForModeration(ops, {
        status: null,
        cursor: "x'; drop table reviews; --",
      }),
    ).rejects.toThrow();
  });

  it('refuses a review id that is not one', async () => {
    const before = await auditCount();
    await expect(
      moderation.setReviewVisibility(ops, { action: 'unhide', id: 'abc' }),
    ).rejects.toThrow();
    expect(await auditCount()).toBe(before);
  });
});

describe('setReviewVisibility', () => {
  it('hides a review, moves its updated time, and audits the user, review and reason code', async () => {
    const row = await review();
    const result = await moderation.setReviewVisibility(ops, {
      action: 'hide',
      id: row.id,
      reason: 'spam',
    });
    expect(result).toEqual({
      outcome: 'hidden',
      experienceId: parents.experienceId,
    });
    const after = await stored(row.id);
    expect(after?.status).toBe('hidden');
    expect(after?.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
    expect((await auditFor(row.id)).rows).toEqual([
      {
        actor_id: opsUser,
        action: 'review.hidden',
        subject_kind: 'review',
        details: { reason: 'spam' },
      },
    ]);
  });

  it('shows a hidden review again and audits it with no reason', async () => {
    const row = await review({ status: 'hidden' });
    await expect(
      moderation.setReviewVisibility(ops, { action: 'unhide', id: row.id }),
    ).resolves.toEqual({
      outcome: 'unhidden',
      experienceId: parents.experienceId,
    });
    expect((await stored(row.id))?.status).toBe('visible');
    expect((await auditFor(row.id)).rows).toEqual([
      {
        actor_id: opsUser,
        action: 'review.unhidden',
        subject_kind: 'review',
        details: {},
      },
    ]);
  });

  it.each([
    ['hiding a hidden review', 'hidden', 'hide', 'already_hidden'],
    ['showing a visible review', 'visible', 'unhide', 'already_visible'],
  ] as const)(
    '%s changes nothing and writes no audit row',
    async (_name, status, action, outcome) => {
      const row = await review({ status });
      const before = await auditCount();
      const result = await moderation.setReviewVisibility(
        ops,
        action === 'hide'
          ? { action, id: row.id, reason: 'spam' }
          : { action, id: row.id },
      );
      expect(result).toEqual({ outcome, experienceId: parents.experienceId });
      expect(await stored(row.id)).toEqual(row);
      expect(await auditCount()).toBe(before);
    },
  );

  it('waits for another change and then leaves the row, so the check is made under the lock', async () => {
    const row = await review();
    const result = await raceAgainstOpenTransaction<
      Tx,
      { outcome: string; experienceId: string | null }
    >(
      (body) => client.db.transaction(body),
      async (tx) => {
        await tx
          .select()
          .from(reviews)
          .where(eq(reviews.id, row.id))
          .for('update');
      },
      () =>
        moderation.setReviewVisibility(ops, {
          action: 'hide',
          id: row.id,
          reason: 'abusive',
        }),
      {
        beforeCommit: async (tx) => {
          await tx
            .update(reviews)
            .set({ status: 'hidden' })
            .where(eq(reviews.id, row.id));
        },
      },
    );
    expect(result.outcome).toBe('already_hidden');
    expect((await auditFor(row.id)).rows).toHaveLength(0);
  });

  it('is not found for a review that is not there, and writes nothing', async () => {
    const before = await auditCount();
    await expect(
      moderation.setReviewVisibility(ops, {
        action: 'hide',
        id: randomUUID(),
        reason: 'spam',
      }),
    ).resolves.toEqual({ outcome: 'not_found', experienceId: null });
    expect(await auditCount()).toBe(before);
  });
});
