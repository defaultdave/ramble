import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { reviewFixtures } from '@/lib/seed/fixtures/reviews';
import { personas } from '@/lib/seed/personas';
import { experienceId } from '@/lib/seed/rows';
import { ForbiddenError } from '@/server/auth/caller';
import { guests, orders, reviews, sessions } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - the seed writes every fixture as a confirmed booking of a finished session, with the reviews the fixtures carry:
//   at least five reviews on at least four experiences, all visible, none for the guest persona's finished sessions
// - the guest persona has at least two finished sessions to review, and the invite sweep invites exactly the bookings that have no review
// - a rerun adds no row and changes no id; a past session the seed has written keeps its time when the clock has moved on
// - a rerun puts back the seats a past session sold, and leaves a review a booker later changed alone
// - a caller that is not ops is refused before a row is read or written

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let seeding: typeof import('@/server/db/seed/run');
let past: typeof import('@/server/db/seed/reviews');
let schedule: typeof import('@/server/jobs/reviewInviteSchedule');
let seedCaller: typeof import('@/server/db/seed/caller').seedCaller;

const now = new Date();

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  seeding = await import('@/server/db/seed/run');
  past = await import('@/server/db/seed/reviews');
  schedule = await import('@/server/jobs/reviewInviteSchedule');
  ({ seedCaller } = await import('@/server/db/seed/caller'));
  await seeding.runSeed({ caller: seedCaller, now });
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

async function snapshot() {
  const rows = await Promise.all(
    [
      'orders',
      'order_items',
      'holds',
      'hold_items',
      'reviews',
      'guests',
      'sessions',
    ].map(
      async (table) =>
        (
          await client.db.execute(
            sql`SELECT * FROM ${sql.identifier(table)} ORDER BY 1, 2`,
          )
        ).rows,
    ),
  );
  return JSON.stringify(rows);
}

describe('seedReviews', () => {
  it('writes the bookings and reviews the fixtures carry', async () => {
    expect(await past.seedReviews(seedCaller, now)).toEqual({
      bookings: reviewFixtures.length,
      reviews: reviewFixtures.filter((f) => f.review !== null).length,
    });

    const booked = await client.db
      .select({ status: orders.status, kind: orders.kind })
      .from(orders);
    expect(booked).toHaveLength(reviewFixtures.length);
    expect(
      booked.every((o) => o.status === 'confirmed' && o.kind === 'booking'),
    ).toBe(true);
    const written = await client.db.select().from(reviews);
    expect(written.length).toBeGreaterThanOrEqual(5);
    expect(
      new Set(written.map((r) => r.experienceId)).size,
    ).toBeGreaterThanOrEqual(4);
    expect(written.every((r) => r.status === 'visible')).toBe(true);
    const [kayak] = await client.db
      .select({ n: count() })
      .from(reviews)
      .where(
        eq(reviews.experienceId, experienceId('sunset-kayak-on-the-hudson')),
      );
    expect(kayak?.n).toBe(5);
  });

  it('leaves the guest persona at least two finished sessions to review, and the sweep invites exactly the unreviewed bookings', async () => {
    const [guest] = await client.db
      .select({ id: guests.id })
      .from(guests)
      .where(eq(guests.email, personas.guest.email));
    const unreviewed = await client.db
      .select({ id: orders.id })
      .from(orders)
      .leftJoin(reviews, eq(reviews.orderId, orders.id))
      .where(
        and(eq(orders.guestId, guest?.id ?? ''), sql`${reviews.id} IS NULL`),
      );
    expect(unreviewed.length).toBeGreaterThanOrEqual(2);
    const ended = await client.db
      .select({ endsAt: sessions.endsAt })
      .from(orders)
      .innerJoin(sessions, eq(sessions.id, orders.sessionId));
    expect(ended.every((s) => s.endsAt.getTime() < now.getTime())).toBe(true);

    const queued = await schedule.scheduleReviewInvites(now);

    expect(queued).toBe(reviewFixtures.filter((f) => f.review === null).length);
    const jobs = await client.db.execute<{ payload: { orderId: string } }>(
      sql`SELECT payload FROM jobs WHERE kind = 'review-invite'`,
    );
    expect(new Set(jobs.rows.map((r) => r.payload.orderId))).toEqual(
      new Set(unreviewed.map((o) => o.id)),
    );
  });

  it('adds no row and changes no id on a rerun, even when the clock has moved on', async () => {
    const before = await snapshot();
    await past.seedReviews(
      seedCaller,
      new Date(now.getTime() + 3 * 86_400_000),
    );
    expect(await snapshot()).toBe(before);
  });

  it('puts back the seats a past session sold, and leaves an edited review alone', async () => {
    await client.db.execute(
      sql`UPDATE sessions SET seats_sold = 0 WHERE template_id IS NULL`,
    );
    await client.db.execute(
      sql`UPDATE reviews SET body = 'Edited since' WHERE id = (SELECT id FROM reviews ORDER BY id LIMIT 1)`,
    );

    await past.seedReviews(seedCaller, now);

    const [sold] = (
      await client.db.execute<{ n: number }>(
        sql`SELECT sum(seats_sold)::int AS n FROM sessions WHERE template_id IS NULL`,
      )
    ).rows;
    expect(sold?.n).toBe(reviewFixtures.reduce((n, f) => n + f.seats, 0));
    const edited = await client.db
      .select({ body: reviews.body })
      .from(reviews)
      .where(eq(reviews.body, 'Edited since'));
    expect(edited).toHaveLength(1);
  });

  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['a host owner', { userId: 'h', roles: ['host_owner'], hostIds: ['x'] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ] as const)(
    'refuses %s before reading or writing a row',
    async (_who, caller) => {
      await expect(past.seedReviews(caller, now)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    },
  );
});
