import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewLimits, reviewWindowMs } from '@/lib/reviews';
import { reviews } from '@/server/db/schema';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { createOrderParents } from './orderParents';
import { day, hour, insertBooking } from './reviewFixtures';

// Behaviours under test, one per decision, branch, or risk.
// the table
// - one review per order: a second row for the same order is refused by the database
// - a rating outside 1 to 5, a blank or over-long body, and a status outside visible and hidden are refused
// - a row is written visible, with its timestamps from the database clock, and its experience as the order's
// - a review cannot be written for an order that does not exist
// the write rule (insertReview, under the order's lock)
// - a confirmed booking whose session ended gets its review, copied from the order's experience
// - a second review of the order is already_reviewed and leaves the first untouched
// - two submits racing for one order write one review and answer created once and already_reviewed once
// - a cancelled booking, an unpaid one, and one whose session is still ahead write nothing and are not found
// - a session that ended before the window is expired, and one inside it is not
// - an order that does not exist is not found
// - a booking cancelled while a submit holds the lock is judged after it: the order is locked for update

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let write: typeof import('@/server/db/reviews');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  process.env.DATABASE_URL = fresh.url;
  client = await import('@/server/db/client');
  write = await import('@/server/db/reviews');
  parents = await createOrderParents(client.db, 'reviews');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
});

const submit = (orderId: string, rating = 5, body = 'A lovely evening.') =>
  client.db.transaction((tx) =>
    write.insertReview(tx, { orderId, rating, body }),
  );

const reviewsOf = (orderId: string) =>
  client.db.select().from(reviews).where(eq(reviews.orderId, orderId));

describe('the reviews table', () => {
  it('writes a review visible, with the order experience and database timestamps', async () => {
    const order = await insertBooking(client.db, parents);
    expect(await submit(order.id, 4, 'Lovely.')).toBe('created');
    const [row] = await reviewsOf(order.id);
    expect(row).toMatchObject({
      orderId: order.id,
      experienceId: parents.experienceId,
      rating: 4,
      body: 'Lovely.',
      status: 'visible',
    });
    expect(row?.createdAt.getTime()).toBeLessThanOrEqual(
      row?.updatedAt.getTime() ?? 0,
    );
  });

  it('refuses a second row for one order', async () => {
    const order = await insertBooking(client.db, parents);
    const row = {
      orderId: order.id,
      experienceId: parents.experienceId,
      rating: 5,
      body: 'First',
    };
    await client.db.insert(reviews).values(row);
    await expect(
      client.db.insert(reviews).values({ ...row, body: 'Second' }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it.each([
    ['a rating of 0', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['a blank body', { body: ' \n\t ' }],
    ['an empty body', { body: '' }],
    [
      'a body one character over the limit',
      { body: 'x'.repeat(reviewLimits.bodyMaxChars + 1) },
    ],
  ])('refuses %s', async (_label, override) => {
    const order = await insertBooking(client.db, parents);
    await expect(
      client.db.insert(reviews).values({
        orderId: order.id,
        experienceId: parents.experienceId,
        rating: 5,
        body: 'Fine',
        ...override,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('takes a body of exactly the limit and the hidden status, and refuses any other status', async () => {
    const order = await insertBooking(client.db, parents);
    await client.db.insert(reviews).values({
      orderId: order.id,
      experienceId: parents.experienceId,
      rating: 3,
      body: 'x'.repeat(reviewLimits.bodyMaxChars),
      status: 'hidden',
    });
    const other = await insertBooking(client.db, parents);
    await expect(
      client.db.execute(
        sql`INSERT INTO reviews (order_id, experience_id, rating, body, status)
          VALUES (${other.id}, ${parents.experienceId}, 3, 'x', 'pending')`,
      ),
    ).rejects.toMatchObject({ cause: { code: '22P02' } });
  });

  it('refuses a review for an order that does not exist', async () => {
    await expect(
      client.db.insert(reviews).values({
        orderId: '00000000-0000-4000-8000-000000000000',
        experienceId: parents.experienceId,
        rating: 5,
        body: 'Ghost',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});

describe('insertReview', () => {
  it('answers a second review of the order already_reviewed and leaves the first alone', async () => {
    const order = await insertBooking(client.db, parents);
    expect(await submit(order.id, 5, 'First')).toBe('created');
    expect(await submit(order.id, 1, 'Second')).toBe('already_reviewed');
    const rows = await reviewsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 5, body: 'First' });
  });

  it('writes one review when two submits race for one order', async () => {
    const order = await insertBooking(client.db, parents);
    const answers = await Promise.all([submit(order.id), submit(order.id, 2)]);
    expect([...answers].sort()).toEqual(['already_reviewed', 'created']);
    expect(await reviewsOf(order.id)).toHaveLength(1);
  });

  it.each([
    ['a cancelled booking', { status: 'cancelled' as const }],
    ['an unpaid booking', { status: 'pending_payment' as const }],
    ['a session still running or ahead', { endedAgoMs: -2 * hour }],
  ])('writes nothing for %s and says not found', async (_label, options) => {
    const order = await insertBooking(client.db, parents, options);
    expect(await submit(order.id)).toBe('not_found');
    expect(await reviewsOf(order.id)).toHaveLength(0);
  });

  it('says expired for a session that ended before the window, and writes nothing', async () => {
    const order = await insertBooking(client.db, parents, {
      endedAgoMs: reviewWindowMs + day,
    });
    expect(await submit(order.id)).toBe('expired');
    expect(await reviewsOf(order.id)).toHaveLength(0);
  });

  it('takes a session that ended just inside the window', async () => {
    const order = await insertBooking(client.db, parents, {
      endedAgoMs: reviewWindowMs - day,
    });
    expect(await submit(order.id)).toBe('created');
  });

  it('says not found for an order that does not exist', async () => {
    expect(await submit('00000000-0000-4000-8000-000000000000')).toBe(
      'not_found',
    );
  });

  it('waits for the order lock, so a cancel committing first is judged before the review is written', async () => {
    const order = await insertBooking(client.db, parents);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const canceller = client.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`,
      );
      locked();
      await held;
      await tx.execute(
        sql`UPDATE orders SET status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = 'guest' WHERE id = ${order.id}`,
      );
    });
    await lockTaken;
    const racing = submit(order.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await canceller;
    expect(await racing).toBe('not_found');
    expect(await reviewsOf(order.id)).toHaveLength(0);
  });
});
