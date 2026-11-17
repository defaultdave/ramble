import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { noFilters } from '@/lib/filters';
import { toExperienceCard } from '@/lib/experienceCards';
import { reviewListLimit } from '@/lib/reviewList';
import { experiences, orders, reviews } from '@/server/db/schema';
import { browseReads } from './browseFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { createOrderParents } from './orderParents';
import { day, insertBooking } from './reviewFixtures';

// Behaviours under test, one per decision, branch or risk:
// - the rating read is the mean and the count of an experience's visible reviews, one row per experience that has any
// - a hidden review is in neither the mean nor the count, so hiding one moves the rating
// - an experience with no reviews has no row, and an empty list of ids reads nothing
// - the review list is the newest visible reviews, at most the limit, newest first, with the order's lead guest name and no email
// - the browse card read and the home card read carry the rating, below the threshold too: the threshold is the lib's, and the card shows it from five
// - a review written after the first read changes the next read at once: four reviews show no rating on the card, the fifth shows it

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let read: typeof import('@/server/db/reviewsRead');
let browse: typeof import('@/server/db/browse');
let home: typeof import('@/server/db/home');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  read = await import('@/server/db/reviewsRead');
  browse = await import('@/server/db/browse');
  home = await import('@/server/db/home');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const { list } = browseReads(() => browse);

type Parents = Awaited<ReturnType<typeof createOrderParents>>;
let sequence = 0;

/** A live experience of its own, with its price, ready for reviews. */
async function liveExperience(): Promise<Parents & { tag: string }> {
  const tag = `display-${String((sequence += 1))}-${randomUUID().slice(0, 8)}`;
  const parents = await createOrderParents(client.db, tag);
  await client.db
    .update(experiences)
    .set({ status: 'live' })
    .where(eq(experiences.id, parents.experienceId));
  return { ...parents, tag };
}

/** One review on a booking of its own; `daysAgo` sets when it was written. */
async function review(
  parents: Parents,
  {
    rating = 5,
    status = 'visible',
    daysAgo = 1,
    guestName = 'Pat Rivera',
    body = 'A lovely evening.',
  }: {
    rating?: number;
    status?: 'visible' | 'hidden';
    daysAgo?: number;
    guestName?: string;
    body?: string;
  } = {},
) {
  const order = await insertBooking(client.db, parents, {
    contactEmail: `private-${randomUUID()}@example.com`,
  });
  await client.db
    .update(orders)
    .set({ leadGuestName: guestName })
    .where(eq(orders.id, order.id));
  const createdAt = new Date(Date.now() - daysAgo * day);
  const [row] = await client.db
    .insert(reviews)
    .values({
      orderId: order.id,
      experienceId: parents.experienceId,
      rating,
      body,
      status,
      createdAt,
      updatedAt: createdAt,
    })
    .returning();
  if (!row) throw new Error('no review');
  return row;
}

describe('readRatings', () => {
  it('is the mean and the count of the visible reviews, one row per experience that has any', async () => {
    const a = await liveExperience();
    const b = await liveExperience();
    const none = await liveExperience();
    for (const rating of [5, 4, 4, 3]) await review(a, { rating });
    await review(b, { rating: 2 });

    const rows = await read.readRatings([
      a.experienceId,
      b.experienceId,
      none.experienceId,
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.experienceId === a.experienceId)).toEqual({
      experienceId: a.experienceId,
      average: 4,
      count: 4,
    });
    expect(rows.find((r) => r.experienceId === b.experienceId)).toEqual({
      experienceId: b.experienceId,
      average: 2,
      count: 1,
    });
  });

  it('keeps a hidden review out of the mean and the count', async () => {
    const a = await liveExperience();
    await review(a, { rating: 5 });
    await review(a, { rating: 1, status: 'hidden' });

    expect(await read.readRatings([a.experienceId])).toEqual([
      { experienceId: a.experienceId, average: 5, count: 1 },
    ]);
  });

  it('reads nothing for no ids, and for an experience with only hidden reviews', async () => {
    const a = await liveExperience();
    await review(a, { status: 'hidden' });

    expect(await read.readRatings([])).toEqual([]);
    expect(await read.readRatings([a.experienceId])).toEqual([]);
  });
});

describe('listReviewRows', () => {
  it('lists the newest visible reviews first, at most the limit', async () => {
    const a = await liveExperience();
    for (let daysAgo = 1; daysAgo <= reviewListLimit + 2; daysAgo += 1) {
      await review(a, { daysAgo, body: `Written ${String(daysAgo)} days ago` });
    }
    await review(a, { daysAgo: 0, status: 'hidden', body: 'Hidden, newest' });

    const rows = await read.listReviewRows(a.experienceId);

    expect(rows).toHaveLength(reviewListLimit);
    expect(rows.map((r) => r.body)).toEqual(
      Array.from(
        { length: reviewListLimit },
        (_, index) => `Written ${String(index + 1)} days ago`,
      ),
    );
  });

  it('carries the lead guest name and no email, and only this experience', async () => {
    const a = await liveExperience();
    const b = await liveExperience();
    await review(a, { guestName: 'Noor Haddad' });
    await review(b, { guestName: 'Someone Else' });

    const rows = await read.listReviewRows(a.experienceId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.guestName).toBe('Noor Haddad');
    expect(Object.keys(rows[0] ?? {}).toSorted()).toEqual([
      'body',
      'createdAt',
      'guestName',
      'id',
      'rating',
    ]);
    expect(JSON.stringify(rows)).not.toContain('@');
  });
});

describe('the card reads', () => {
  it('browse carries the rating from the first review, and the card shows it from the fifth', async () => {
    const a = await liveExperience();
    const filters = { ...noFilters, categories: [`category-${a.tag}`] };
    for (const rating of [5, 5, 4, 4]) await review(a, { rating });

    const before = (await list(filters)).items[0];
    expect(before?.rating).toEqual({ average: 4.5, count: 4 });
    const unrated = before ? toExperienceCard(before) : null;
    expect(unrated && 'rating' in unrated).toBe(false);

    await review(a, { rating: 3 });

    const after = (await list(filters)).items[0];
    expect(after?.rating).toEqual({ average: 4.2, count: 5 });
    const card = after ? toExperienceCard(after) : null;
    expect(card?.kind === 'bookable' ? card.rating : null).toEqual({
      average: 4.2,
      count: 5,
    });
  });

  it('browse leaves the rating off an experience with no reviews', async () => {
    const a = await liveExperience();
    const filters = { ...noFilters, categories: [`category-${a.tag}`] };

    const [item] = (await list(filters)).items;

    expect(item).toBeDefined();
    expect(item?.rating).toBeUndefined();
  });

  it('home carries the rating of the experiences it reads, and none for one with no reviews', async () => {
    const rated = await liveExperience();
    const plain = await liveExperience();
    for (const rating of [5, 4, 4, 4, 4]) await review(rated, { rating });

    const cards = await home.listHomeExperiences(
      [rated.experienceId, plain.experienceId],
      { covers: false },
    );

    expect(cards.find((c) => c.id === rated.experienceId)?.rating).toEqual({
      average: 4.2,
      count: 5,
    });
    expect(
      cards.find((c) => c.id === plain.experienceId)?.rating,
    ).toBeUndefined();
  });
});
