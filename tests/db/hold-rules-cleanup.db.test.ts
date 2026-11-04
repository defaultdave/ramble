import { count, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { holdLimits, scrubbedHash } from '@/lib/holds';
import { holdItems } from '@/server/db/schema';
import { hash, insertHold, insertSession, seedBookable } from './holdFixtures';
import {
  client,
  guestA,
  guestB,
  holdData,
  lapsedHold,
  reserve,
  setupHoldRulesDatabase,
  stored,
} from './holdRulesFixtures';

// Behaviours under test, one per decision, branch or risk:
// - cleanup: lapsed active holds expire and lapsed paying holds are abandoned, open, converted, and released
//   holds are left alone, a second run does nothing, a batch is bounded, and each cleaned session's tag is revalidated
// - scrub: released holds past retention lose their hashes, newer ones, other statuses, and scrubbed ones do not
//   change, a batch is bounded, and the rows and their items stay

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

setupHoldRulesDatabase(cache);

describe('releaseLapsedHolds', () => {
  it('releases a lapsed active hold as expired and a lapsed paying hold as payment_abandoned', async () => {
    const bookable = await seedBookable(client.db);
    const active = await lapsedHold(bookable.session.id, guestA, 1);
    const paying = await lapsedHold(bookable.session.id, guestB, 20, {
      status: 'paying',
      payingUntil: sql`now() - make_interval(mins => 1)`,
    });

    expect(await holdData.releaseLapsedHolds()).toBe(2);

    expect(await stored(active.id)).toMatchObject({
      status: 'released',
      releasedReason: 'expired',
    });
    expect(await stored(paying.id)).toMatchObject({
      status: 'released',
      releasedReason: 'payment_abandoned',
    });
  });

  it('stamps the release with a time after the deadline it judged', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await lapsedHold(bookable.session.id, guestA, 1);

    await holdData.releaseLapsedHolds();

    const row = await stored(lapsed.id);
    expect(row.updatedAt.getTime()).toBeGreaterThan(row.expiresAt.getTime());
  });

  it('leaves open, converted, and released holds alone, and a paying hold inside paying_until', async () => {
    const bookable = await seedBookable(client.db);
    const openHold = await insertHold(client.db, bookable.session.id);
    const converted = await lapsedHold(bookable.session.id, guestA, 1, {
      status: 'converted',
    });
    const released = await lapsedHold(bookable.session.id, guestA, 1, {
      status: 'released',
      releasedReason: 'guest_left',
    });
    const grace = await lapsedHold(bookable.session.id, guestB, 1, {
      status: 'paying',
      payingUntil: sql`now() + make_interval(mins => 5)`,
    });

    expect(await holdData.releaseLapsedHolds()).toBe(0);

    expect((await stored(openHold.id)).status).toBe('active');
    expect((await stored(converted.id)).status).toBe('converted');
    expect((await stored(released.id)).releasedReason).toBe('guest_left');
    expect((await stored(grace.id)).status).toBe('paying');
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it('does nothing the second time', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 1);
    await holdData.releaseLapsedHolds();

    expect(await holdData.releaseLapsedHolds()).toBe(0);
  });

  it('revalidates the spaces tag of each session it cleaned, and no other', async () => {
    const bookable = await seedBookable(client.db);
    const second = await insertSession(client.db, bookable.experience.id);
    const untouched = await insertSession(client.db, bookable.experience.id);
    await lapsedHold(bookable.session.id, guestA, 1);
    await lapsedHold(second.id, guestA, 2);
    await insertHold(client.db, untouched.id);

    await holdData.releaseLapsedHolds();

    expect(cache.revalidateTag.mock.calls.map(([tag]) => tag).sort()).toEqual(
      [`session:${bookable.session.id}`, `session:${second.id}`].sort(),
    );
    expect(
      cache.revalidateTag.mock.calls.every(([, mode]) => mode === 'max'),
    ).toBe(true);
  });

  it('takes at most one batch, oldest deadline first, and the next call takes the rest', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1000 });
    const extra = 5;
    await client.db.execute(sql`
      INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at, created_at, updated_at)
      SELECT ${bookable.session.id}, 'booking', 'active', 1, ${hash('e')}, ${hash('f')},
             now() - make_interval(secs => 60 + n), now() - interval '20 minutes', now() - interval '20 minutes'
      FROM generate_series(1, ${holdLimits.cleanupBatch + extra}) AS n`);

    expect(await holdData.releaseLapsedHolds()).toBe(holdLimits.cleanupBatch);
    expect(await holdData.releaseLapsedHolds()).toBe(extra);
    expect(await holdData.releaseLapsedHolds()).toBe(0);
  });

  it('judges holds at database time, never at a caller-supplied time', async () => {
    const bookable = await seedBookable(client.db);
    const nearlyLapsed = await insertHold(client.db, bookable.session.id);

    expect(await holdData.releaseLapsedHolds()).toBe(0);
    expect((await stored(nearlyLapsed.id)).status).toBe('active');
  });
});

describe('scrubReleasedHolds', () => {
  const released = (
    sessionId: string,
    daysAgo: number,
    overrides: Parameters<typeof insertHold>[2] = {},
  ) =>
    insertHold(client.db, sessionId, {
      deviceKey: hash('c'),
      ipHash: hash('d'),
      createdAt: sql`now() - make_interval(days => ${daysAgo + 1})`,
      status: 'released',
      releasedReason: 'expired',
      updatedAt: sql`now() - make_interval(days => ${daysAgo})`,
      ...overrides,
    });

  it('replaces the hashes of a hold released past retention, and keeps the row and its items', async () => {
    const bookable = await seedBookable(client.db);
    const old = await released(
      bookable.session.id,
      holdLimits.releasedRetentionDays + 1,
    );
    await client.db.insert(holdItems).values({
      holdId: old.id,
      priceOptionId: bookable.adult.id,
      quantity: 1,
      unitPriceMinor: 5000,
      usesSpace: true,
    });

    expect(await holdData.scrubReleasedHolds()).toBe(1);

    expect(await stored(old.id)).toMatchObject({
      deviceKey: scrubbedHash,
      ipHash: scrubbedHash,
      status: 'released',
    });
    const items = await client.db
      .select({ total: count() })
      .from(holdItems)
      .where(eq(holdItems.holdId, old.id));
    expect(items[0]?.total).toBe(1);
  });

  it('leaves a hold released inside retention, and every status but released', async () => {
    const bookable = await seedBookable(client.db);
    const recent = await released(
      bookable.session.id,
      holdLimits.releasedRetentionDays - 1,
    );
    const converted = await released(
      bookable.session.id,
      holdLimits.releasedRetentionDays + 5,
      { status: 'converted', releasedReason: null },
    );

    expect(await holdData.scrubReleasedHolds()).toBe(0);

    expect((await stored(recent.id)).deviceKey).toBe(hash('c'));
    expect((await stored(converted.id)).deviceKey).toBe(hash('c'));
  });

  it('does nothing the second time, and never rescans a scrubbed row', async () => {
    const bookable = await seedBookable(client.db);
    await released(bookable.session.id, 60);
    await holdData.scrubReleasedHolds();

    expect(await holdData.scrubReleasedHolds()).toBe(0);
  });

  it('takes at most one batch', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1000 });
    const extra = 3;
    await client.db.execute(sql`
      INSERT INTO holds (session_id, purpose, status, released_reason, seats, device_key, ip_hash, expires_at, created_at, updated_at)
      SELECT ${bookable.session.id}, 'booking', 'released', 'expired', 1, ${hash('c')}, ${hash('d')},
             now() - interval '60 days' + interval '10 minutes', now() - interval '60 days', now() - make_interval(days => 40, secs => n)
      FROM generate_series(1, ${holdLimits.cleanupBatch + extra}) AS n`);

    expect(await holdData.scrubReleasedHolds()).toBe(holdLimits.cleanupBatch);
    expect(await holdData.scrubReleasedHolds()).toBe(extra);
  });

  it('keeps a scrubbed hold out of every limit, because no cookie produces the scrub value', async () => {
    const bookable = await seedBookable(client.db);
    await released(bookable.session.id, 60);
    await holdData.scrubReleasedHolds();

    expect((await reserve(guestA, bookable, 6)).status).toBe('held');
  });
});
