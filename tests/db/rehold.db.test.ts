import { and, eq, gt } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { unbookableSession } from '@/lib/holds';
import type { Device } from '@/server/device';
import { holdFor } from './checkoutFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { clearHolds, seedBookable } from './holdFixtures';
import { testDevice } from '../deviceFixture';

// The re-hold action (S6) against a real database. Behaviours under test:
// - a lapsed hold of the calling device is held again with the same party, and is released as expired
// - the same lapsed id held again a second time is refused, so it re-holds at most once and the
//   device ends with exactly one open hold
// - a live `active` hold and a `paying` hold are refused, writing nothing
// - another device's hold, a missing one, and a malformed input all get the same refusal
// - the device's `reserve` try is spent, and a spent limit answers `blocked` before any hold is read
// - a limit store that fails makes the action throw, and no hold is made

const limiter = vi.hoisted(() => ({
  consume: null as null | ((...args: unknown[]) => Promise<unknown>),
}));
vi.mock('@/server/ports/rate-limit', async (original) => {
  const real = await original<typeof import('@/server/ports/rate-limit')>();
  return {
    ...real,
    consumeRateLimit: vi.fn(
      (...args: Parameters<typeof real.consumeRateLimit>) =>
        limiter.consume
          ? (limiter.consume(...args) as ReturnType<
              typeof real.consumeRateLimit
            >)
          : real.consumeRateLimit(...args),
    ),
  };
});

// `reserveSpaces` invalidates the session's cache tag, which needs a Next.js request.
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let schema: typeof import('@/server/db/schema');
let rehold: typeof import('@/server/actions/rehold');
let rateLimit: typeof import('@/server/ports/rate-limit');
let guestA: Device;

const anHourAgo = () => new Date(Date.now() - 3_600_000);

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  schema = await import('@/server/db/schema');
  rehold = await import('@/server/actions/rehold');
  rateLimit = await import('@/server/ports/rate-limit');
  guestA = await testDevice('rehold-a');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  // The device's open-hold limits count every test's holds, so each test starts with none.
  await clearHolds(client.db);
  limiter.consume = null;
  vi.mocked(rateLimit.consumeRateLimit).mockClear();
  await testDevice('rehold-a');
});

async function openHolds(sessionId: string, device: Device) {
  const rows = await client.db
    .select({ id: schema.holds.id })
    .from(schema.holds)
    .where(
      and(
        eq(schema.holds.sessionId, sessionId),
        eq(schema.holds.deviceKey, device.deviceKey),
        eq(schema.holds.status, 'active'),
        gt(schema.holds.expiresAt, new Date()),
      ),
    );
  return rows.length;
}

describe('reholdSpaces', () => {
  it('holds the same party again for a lapsed hold and releases it as expired', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      adults: 2,
      createdAt: anHourAgo(),
    });

    const result = await rehold.reholdSpaces({ holdId: lapsed.id });

    expect(result.status).toBe('held');
    if (result.status === 'held') {
      expect(result.holdId).not.toBe(lapsed.id);
      expect(result.lines.map((line) => line.quantity)).toEqual([2]);
    }
    const [old] = await client.db
      .select()
      .from(schema.holds)
      .where(eq(schema.holds.id, lapsed.id));
    expect(old).toMatchObject({
      status: 'released',
      releasedReason: 'expired',
    });
    expect(rateLimit.consumeRateLimit).toHaveBeenCalledWith(
      'reserve',
      guestA.deviceKey,
    );
  });

  it('re-holds one lapsed id at most once, leaving one open hold', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      createdAt: anHourAgo(),
    });

    const first = await rehold.reholdSpaces({ holdId: lapsed.id });
    const second = await rehold.reholdSpaces({ holdId: lapsed.id });

    expect(first.status).toBe('held');
    expect(second).toEqual(unbookableSession);
    expect(await openHolds(bookable.session.id, guestA)).toBe(1);
  });

  it('leaves one open hold when the device also had a live one on the session', async () => {
    const bookable = await seedBookable(client.db);
    const live = await holdFor(client.db, bookable, guestA);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      createdAt: anHourAgo(),
    });

    const result = await rehold.reholdSpaces({ holdId: lapsed.id });

    expect(result.status).toBe('held');
    // U-014b's supersede ends the live hold; the lapsed one is already released, so exactly the new hold is open.
    expect(await openHolds(bookable.session.id, guestA)).toBe(1);
    const [old] = await client.db
      .select({ status: schema.holds.status })
      .from(schema.holds)
      .where(eq(schema.holds.id, live.id));
    expect(old?.status).toBe('released');
  });

  it('holds once under two calls at the same time', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      createdAt: anHourAgo(),
    });

    const results = await Promise.all([
      rehold.reholdSpaces({ holdId: lapsed.id }),
      rehold.reholdSpaces({ holdId: lapsed.id }),
    ]);

    expect(results.filter((result) => result.status === 'held')).toHaveLength(
      1,
    );
    expect(await openHolds(bookable.session.id, guestA)).toBe(1);
  });

  it.each([
    ['a live active hold', {}],
    [
      'a paying hold',
      {
        status: 'paying' as const,
        payingUntil: new Date(Date.now() + 1_200_000),
      },
    ],
  ])('refuses %s and writes nothing', async (_name, options) => {
    const bookable = await seedBookable(client.db);
    const live = await holdFor(client.db, bookable, guestA, options);

    expect(await rehold.reholdSpaces({ holdId: live.id })).toEqual(
      unbookableSession,
    );
    const rows = await client.db
      .select({ id: schema.holds.id })
      .from(schema.holds)
      .where(eq(schema.holds.sessionId, bookable.session.id));
    expect(rows).toHaveLength(1);
  });

  it('refuses another device the same way as a missing hold', async () => {
    const hold = await holdFor(
      client.db,
      await seedBookable(client.db),
      guestA,
      { createdAt: anHourAgo() },
    );
    await testDevice('rehold-b');

    expect(await rehold.reholdSpaces({ holdId: hold.id })).toEqual(
      unbookableSession,
    );
    expect(
      await rehold.reholdSpaces({
        holdId: '00000000-0000-4000-8000-0000000000aa',
      }),
    ).toEqual(unbookableSession);
  });

  it.each([{}, { holdId: 'x'.repeat(2000) }, null])(
    'refuses the input %j without touching the limiter',
    async (input) => {
      expect(await rehold.reholdSpaces(input)).toEqual(unbookableSession);
      expect(rateLimit.consumeRateLimit).not.toHaveBeenCalled();
    },
  );

  it('answers try_later when the reserve tries are spent, and holds nothing', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      createdAt: anHourAgo(),
    });
    limiter.consume = () =>
      Promise.resolve({ allowed: false, retryAfterSeconds: 60 });

    const result = await rehold.reholdSpaces({ holdId: lapsed.id });

    expect(result).toEqual({ status: 'try_later' });
    expect(await openHolds(bookable.session.id, guestA)).toBe(0);
    const [still] = await client.db
      .select()
      .from(schema.holds)
      .where(eq(schema.holds.id, lapsed.id));
    expect(still?.status).toBe('active');
  });

  it('answers with the refusal, not try_later, once the lapsed hold is released and the reserve refuses', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      createdAt: anHourAgo(),
    });
    await client.db
      .update(schema.settings)
      .set({ bookingsPaused: true })
      .where(eq(schema.settings.id, true));

    try {
      const result = await rehold.reholdSpaces({ holdId: lapsed.id });
      expect(result).toEqual({
        status: 'unavailable',
        reason: 'bookings_paused',
      });
    } finally {
      await client.db
        .update(schema.settings)
        .set({ bookingsPaused: false })
        .where(eq(schema.settings.id, true));
    }
    const [old] = await client.db
      .select({ status: schema.holds.status })
      .from(schema.holds)
      .where(eq(schema.holds.id, lapsed.id));
    expect(old?.status).toBe('released');
  });

  it('fails closed when the limit store fails', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await holdFor(client.db, bookable, guestA, {
      createdAt: anHourAgo(),
    });
    limiter.consume = () => Promise.reject(new Error('store down'));

    await expect(rehold.reholdSpaces({ holdId: lapsed.id })).rejects.toThrow(
      'store down',
    );
    const [still] = await client.db
      .select()
      .from(schema.holds)
      .where(eq(schema.holds.id, lapsed.id));
    expect(still?.status).toBe('active');
  });
});
