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
import { openHeldSeats, type HoldTimes } from '@/lib/holds';
import { maxAllocation } from '@/lib/sessions';
import { holds, settings } from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import {
  clearHolds,
  hash,
  insertHold,
  minute,
  seedBookable,
} from './holdFixtures';
import { forAdults, holdDbFixtures } from './holdsDbFixtures';

// Behaviours under test, one per decision, branch or risk:
// - spaces left counts seats sold, active holds before their deadline, and paying holds before paying_until,
//   and counts no lapsed, converted or released hold
// - the SQL pre-filter and isOpenHold agree at each boundary, to the millisecond, and the fetch is bounded

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

const {} = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

describe('which holds count', () => {
  const past = (ms: number) => new Date(Date.now() - ms);
  const ahead = (ms: number) => new Date(Date.now() + ms);

  it('counts an active hold before its deadline and not one past it', async () => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    await insertHold(client.db, bookable.session.id, {
      seats: 2,
      createdAt: past(20 * minute),
      updatedAt: past(20 * minute),
      expiresAt: past(10 * minute),
    });

    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 2))).status,
    ).toBe('held');
    expect(
      (await holdData.reserveSpaces(guestB, forAdults(bookable, 1))).status,
    ).toBe('sold_out');
  });

  it('counts a paying hold past expires_at but before paying_until, and not past paying_until', async () => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    const stillPaying = await insertHold(client.db, bookable.session.id, {
      seats: 2,
      status: 'paying',
      createdAt: past(12 * minute),
      updatedAt: past(12 * minute),
      expiresAt: past(2 * minute),
      payingUntil: ahead(3 * minute),
    });

    const refused = await holdData.reserveSpaces(
      guestA,
      forAdults(bookable, 1),
    );
    await client.db
      .update(holds)
      .set({ payingUntil: past(1000) })
      .where(eq(holds.id, stillPaying.id));
    const accepted = await holdData.reserveSpaces(
      guestA,
      forAdults(bookable, 2),
    );

    expect(refused.status).toBe('sold_out');
    expect(accepted.status).toBe('held');
  });

  it.each([
    ['converted', { status: 'converted' as const }],
    [
      'released',
      { status: 'released' as const, releasedReason: 'guest_left' as const },
    ],
  ])('does not count a %s hold', async (_name, override) => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    await insertHold(client.db, bookable.session.id, { seats: 2, ...override });

    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 2))).status,
    ).toBe('held');
  });
});

describe('the SQL pre-filter and isOpenHold', () => {
  const at = new Date('2026-11-01T12:00:00.000Z');
  const createdAt = new Date('2026-11-01T11:55:00.000Z');

  async function seedAgreement() {
    const bookable = await seedBookable(client.db, { allocation: 500 });
    const sessionId = bookable.session.id;
    const common = { createdAt, updatedAt: createdAt };
    const activeAt = (expires: string) =>
      insertHold(client.db, sessionId, {
        ...common,
        expiresAt: sql`${expires}::timestamptz`,
      });
    const payingAt = (until: string) =>
      insertHold(client.db, sessionId, {
        ...common,
        status: 'paying',
        expiresAt: new Date('2026-11-01T11:56:00.000Z'),
        payingUntil: sql`${until}::timestamptz`,
        seats: 2,
      });
    await activeAt('2026-11-01 11:59:59.999+00');
    await activeAt('2026-11-01 12:00:00.000+00');
    await activeAt('2026-11-01 12:00:00.000500+00');
    await activeAt('2026-11-01 12:00:00.001+00');
    await activeAt('2026-11-01 12:00:00.001999+00');
    await payingAt('2026-11-01 11:59:59.999+00');
    await payingAt('2026-11-01 12:00:00.000+00');
    await payingAt('2026-11-01 12:00:00.000999+00');
    await payingAt('2026-11-01 12:00:00.001+00');
    return sessionId;
  }

  it('count the same seats at each boundary, down to the millisecond', async () => {
    const sessionId = await seedAgreement();
    const rows: (HoldTimes & { seats: number })[] = await client.db
      .select({
        status: holds.status,
        expiresAt: holds.expiresAt,
        payingUntil: holds.payingUntil,
        seats: holds.seats,
      })
      .from(holds)
      .where(eq(holds.sessionId, sessionId));

    const fromSql = await client.db.transaction((tx) =>
      holdData.readOpenHeldSeats(tx, sessionId, at),
    );

    expect(fromSql).toBe(openHeldSeats(rows, at));
    // Open: the two active holds ending at .001 and .001999 (1 seat each) and the paying hold ending
    // at .001 (2 seats). A deadline within the millisecond of `at` (.000, .000500, .000999) is reached.
    expect(fromSql).toBe(1 + 1 + 2);
  });

  // `readOpenHeldSeats` re-judges the rows with `isOpenHold`, so a loose pre-filter shows only in
  // the bounded fetch: the largest capacity of open holds plus one that must not be fetched.
  it.each([
    ['an active hold ending exactly at the time', 'active', '0 microseconds'],
    [
      'an active hold ending within the millisecond',
      'active',
      '500 microseconds',
    ],
    ['a paying hold ending exactly at the time', 'paying', '0 microseconds'],
    [
      'a paying hold ending within the millisecond',
      'paying',
      '999 microseconds',
    ],
  ] as const)('does not fetch %s', async (_name, status, offset) => {
    const bookable = await seedBookable(client.db);
    await client.db.execute(sql`
        INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at, created_at, updated_at)
        SELECT ${bookable.session.id}, 'booking', 'active', 1, ${hash('c')}, ${hash('d')},
               ${at}::timestamptz + interval '5 minutes', ${createdAt}, ${createdAt}
        FROM generate_series(1, ${maxAllocation})
      `);
    const edge = sql`${at.toISOString()}::timestamptz + ${offset}::interval`;
    await insertHold(
      client.db,
      bookable.session.id,
      status === 'active'
        ? { createdAt, updatedAt: createdAt, expiresAt: edge }
        : {
            createdAt,
            updatedAt: createdAt,
            status: 'paying',
            expiresAt: new Date('2026-11-01T11:56:00.000Z'),
            payingUntil: edge,
          },
    );

    await expect(
      client.db.transaction((tx) =>
        holdData.readOpenHeldSeats(tx, bookable.session.id, at),
      ),
    ).resolves.toBe(maxAllocation);
  });

  it('refuses more open holds than the largest capacity', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.execute(sql`
      INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at, created_at, updated_at)
      SELECT ${bookable.session.id}, 'booking', 'active', 1, ${hash('c')}, ${hash('d')},
             ${at}::timestamptz + interval '5 minutes', ${createdAt}, ${createdAt}
      FROM generate_series(1, ${maxAllocation + 1})
    `);

    await expect(
      client.db.transaction((tx) =>
        holdData.readOpenHeldSeats(tx, bookable.session.id, at),
      ),
    ).rejects.toThrow(RangeError);
  });
});
