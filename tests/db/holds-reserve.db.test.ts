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
import { holdItems, sessions, settings } from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import {
  clearHolds,
  day,
  insertHold,
  insertSession,
  minute,
  seedBookable,
} from './holdFixtures';
import { forAdults, holdDbFixtures } from './holdsDbFixtures';

// Behaviours under test, one per decision, branch or risk:
// - reserveSpaces answers held with the hold, its items, and totals for a taxable, a not-taxable and an
//   unknown experience; seats count only space-using lines; ids in capitals work; expires_at follows holdMinutes
// - sold_out offers other scheduled dates of the same experience with room, and no others

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let holdData: typeof import('@/server/db/holds');
let guestA: Device;
let guestB: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  guestA = await testDevice('guest-a');
  guestB = await testDevice('guest-b');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  // The limits count a device's holds in every session, so a test starts with none.
  await clearHolds(client.db);
  cache.updateTag.mockClear();
  cache.revalidateTag.mockClear();
  await client.db
    .update(settings)
    .set({ bookingsPaused: false, holdMinutes: 10, taxRatePpm: 88_750 });
});

const { holdCount, totalHolds, storedHold, reserveHeld } = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

describe('reserveSpaces answers held', () => {
  it('stores the hold and its items, and returns the totals of a taxable experience', async () => {
    const bookable = await seedBookable(client.db);

    const result = await reserveHeld(bookable, 2);

    expect(result).toMatchObject({ status: 'held', totalMinor: 10_888 });
    expect(result.lines).toEqual([
      {
        priceOptionId: bookable.adult.id,
        kind: 'adult',
        quantity: 2,
        unitPriceMinor: 5000,
        usesSpace: true,
        lineTotalMinor: 10_000,
      },
    ]);
    const stored = await storedHold(result.holdId);
    expect(stored).toMatchObject({
      sessionId: bookable.session.id,
      purpose: 'booking',
      giftId: null,
      status: 'active',
      seats: 2,
      deviceKey: guestA.deviceKey,
      ipHash: guestA.ipHash,
      payingUntil: null,
      releasedReason: null,
      supersededBy: null,
    });
    expect(stored.createdAt).toEqual(stored.updatedAt);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      10 * minute,
    );
    expect(result.expiresAt).toBe(stored.expiresAt.toISOString());
    expect(
      await client.db
        .select()
        .from(holdItems)
        .where(eq(holdItems.holdId, result.holdId)),
    ).toEqual([
      {
        holdId: result.holdId,
        priceOptionId: bookable.adult.id,
        quantity: 2,
        unitPriceMinor: 5000,
        usesSpace: true,
      },
    ]);
  });

  it.each([
    ['not taxable', 'not_taxable' as const],
    ['of unknown tax treatment', 'unknown' as const],
  ])(
    'charges no tax on an experience that is %s',
    async (_name, taxTreatment) => {
      const bookable = await seedBookable(client.db, {
        experience: { taxTreatment },
      });

      expect(await reserveHeld(bookable, 2)).toMatchObject({
        totalMinor: 10_000,
      });
    },
  );

  it('stamps the hold with the database clock, not the JavaScript one', async () => {
    const bookable = await seedBookable(client.db);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2001-01-01T00:00:00.000Z'));
    let answer;
    try {
      answer = await holdData.reserveSpaces(guestA, forAdults(bookable, 1));
    } finally {
      vi.useRealTimers();
    }
    if (answer.status !== 'held') throw new Error('expected held');

    const stored = await storedHold(answer.holdId);
    const result = await client.db.execute(
      sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`,
    );
    const databaseNow = Number((result.rows[0] as { ms: string }).ms);
    expect(Math.abs(stored.createdAt.getTime() - databaseNow)).toBeLessThan(
      60_000,
    );
    expect(stored.updatedAt.getTime()).toBe(stored.createdAt.getTime());
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      10 * minute,
    );
  });

  it('prices a rate changed in settings', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.update(settings).set({ taxRatePpm: 0 });

    expect(await reserveHeld(bookable, 1)).toMatchObject({ totalMinor: 5000 });
  });

  it('counts only the space-using lines as seats, and snapshots every line', async () => {
    const bookable = await seedBookable(client.db);

    const result = await holdData.reserveSpaces(guestA, {
      sessionId: bookable.session.id,
      items: [
        { priceOptionId: bookable.adult.id, quantity: 2 },
        { priceOptionId: bookable.child.id, quantity: 3 },
      ],
      purpose: 'booking',
    });

    if (result.status !== 'held') throw new Error('not held');
    expect((await storedHold(result.holdId)).seats).toBe(2);
    const items = await client.db
      .select()
      .from(holdItems)
      .where(eq(holdItems.holdId, result.holdId));
    expect(items).toHaveLength(2);
    expect(
      items
        .filter((row) => row.usesSpace)
        .reduce((total, row) => total + row.quantity, 0),
    ).toBe(2);
    expect(result.totalMinor).toBe(Math.round((2 * 5000 + 3 * 2500) * 1.08875));
  });

  it('accepts ids written in capitals', async () => {
    const bookable = await seedBookable(client.db);

    const result = await holdData.reserveSpaces(guestA, {
      sessionId: bookable.session.id.toUpperCase(),
      items: [{ priceOptionId: bookable.adult.id.toUpperCase(), quantity: 1 }],
      purpose: 'booking',
    });

    expect(result.status).toBe('held');
  });

  it('follows the hold length in settings', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.update(settings).set({ holdMinutes: 25 });

    const result = await reserveHeld(bookable, 1);

    const stored = await storedHold(result.holdId);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      25 * minute,
    );
  });

  it('gives a device a hold on each of two sessions', async () => {
    const bookable = await seedBookable(client.db);
    const other = await insertSession(client.db, bookable.experience.id);

    await reserveHeld(bookable, 1);
    const second = await holdData.reserveSpaces(guestA, {
      ...forAdults(bookable, 1),
      sessionId: other.id,
    });

    expect(second.status).toBe('held');
    expect(await totalHolds()).toBe(2);
  });
});

describe('sold out', () => {
  it('refuses a party that does not fit, writing nothing, and takes the last spaces for one that does', async () => {
    const bookable = await seedBookable(client.db, { allocation: 3 });
    await reserveHeld(bookable, 2, guestA);

    const tooMany = await holdData.reserveSpaces(
      guestB,
      forAdults(bookable, 2),
    );
    const lastOne = await holdData.reserveSpaces(
      guestB,
      forAdults(bookable, 1),
    );
    const none = await holdData.reserveSpaces(
      await testDevice('guest-c'),
      forAdults(bookable, 1),
    );

    expect(tooMany).toEqual({ status: 'sold_out', alternatives: [] });
    expect(lastOne.status).toBe('held');
    expect(none.status).toBe('sold_out');
    expect(await holdCount(bookable.session.id)).toBe(2);
  });

  it('counts the seats already sold', async () => {
    const bookable = await seedBookable(client.db, { allocation: 5 });
    await client.db
      .update(sessions)
      .set({ seatsSold: 4 })
      .where(eq(sessions.id, bookable.session.id));

    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 2))).status,
    ).toBe('sold_out');
    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 1))).status,
    ).toBe('held');
  });

  it('offers other dates of the same experience that have room, soonest first, and no others', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1 });
    const experienceId = bookable.experience.id;
    const startsIn = (days: number) => ({
      startsAt: new Date(Date.now() + days * day),
      endsAt: new Date(Date.now() + days * day + 60 * minute),
    });
    const soon = await insertSession(client.db, experienceId, startsIn(2));
    const later = await insertSession(client.db, experienceId, startsIn(9));
    const heldElsewhere = await insertSession(client.db, experienceId, {
      ...startsIn(3),
      allocation: 4,
    });
    await insertHold(client.db, heldElsewhere.id, { seats: 3 });
    await insertSession(client.db, experienceId, {
      ...startsIn(4),
      status: 'cancelled',
      cancelReason: 'host',
    });
    await insertSession(client.db, experienceId, startsIn(30));
    await insertSession(client.db, experienceId, {
      ...startsIn(5),
      allocation: 0,
    });
    const otherExperience = await seedBookable(client.db);
    await reserveHeld(bookable, 1, guestA);

    const answer = await holdData.reserveSpaces(guestB, forAdults(bookable, 1));

    expect(answer).toMatchObject({ status: 'sold_out' });
    if (answer.status !== 'sold_out') throw new Error('expected sold out');
    expect(answer.alternatives.map((summary) => summary.sessionId)).toEqual([
      soon.id,
      heldElsewhere.id,
      later.id,
    ]);
    expect(answer.alternatives.map((summary) => summary.spacesLeft)).toEqual([
      10, 1, 10,
    ]);
    expect(answer.alternatives[0]).toEqual({
      sessionId: soon.id,
      startsAt: soon.startsAt.toISOString(),
      timeZone: 'America/New_York',
      spacesLeft: 10,
    });
    expect(
      answer.alternatives.map((summary) => summary.sessionId),
    ).not.toContain(otherExperience.session.id);
  });

  it('leaves out a date that cannot take the whole party, and offers at most three', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1 });
    const experienceId = bookable.experience.id;
    const startsIn = (days: number) => ({
      startsAt: new Date(Date.now() + days * day),
      endsAt: new Date(Date.now() + days * day + 60 * minute),
    });
    await insertSession(client.db, experienceId, {
      ...startsIn(2),
      allocation: 1,
    });
    for (const days of [3, 4, 5, 6]) {
      await insertSession(client.db, experienceId, {
        ...startsIn(days),
        allocation: 2,
      });
    }
    await reserveHeld(bookable, 1, guestA);

    const answer = await holdData.reserveSpaces(guestB, forAdults(bookable, 2));

    if (answer.status !== 'sold_out') throw new Error('expected sold out');
    expect(answer.alternatives).toHaveLength(3);
    expect(
      answer.alternatives.every((summary) => summary.spacesLeft >= 2),
    ).toBe(true);
  });
});
