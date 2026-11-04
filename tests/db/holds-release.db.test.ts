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
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { holdItems, sessions, settings } from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import { clearHolds, insertHold, minute, seedBookable } from './holdFixtures';
import { forAdults, holdDbFixtures, type Bookable } from './holdsDbFixtures';

// Behaviours under test, one per decision, branch or risk:
// - releaseHold: own active hold released as guest_left; another device's hold, a missing one, a malformed id
//   and a converted one all answer not_found; paying is refused; a second release answers released; a lapsed
//   active hold is released
// - a capacity edit is refused below seats sold plus open holds, allowed at exactly that, and lapsed holds
//   do not block it

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
let sessionData: typeof import('@/server/db/sessions');
let guestA: Device;
let guestB: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  sessionData = await import('@/server/db/sessions');
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

const { storedHold, reserveHeld } = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

describe('releaseHold', () => {
  it("releases the device's active hold as guest_left, and keeps its items", async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 2);

    const answer = await holdData.releaseHold(guestA, { holdId });

    expect(answer).toEqual({ status: 'released' });
    const stored = await storedHold(holdId);
    expect(stored).toMatchObject({
      status: 'released',
      releasedReason: 'guest_left',
    });
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(
      stored.createdAt.getTime(),
    );
    expect(
      await client.db
        .select()
        .from(holdItems)
        .where(eq(holdItems.holdId, holdId)),
    ).toHaveLength(1);
  });

  it('stamps the release with the database clock, not the JavaScript one', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2001-01-01T00:00:00.000Z'));
    try {
      expect(await holdData.releaseHold(guestA, { holdId })).toEqual({
        status: 'released',
      });
    } finally {
      vi.useRealTimers();
    }

    const stored = await storedHold(holdId);
    const result = await client.db.execute(
      sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`,
    );
    const databaseNow = Number((result.rows[0] as { ms: string }).ms);
    expect(Math.abs(stored.updatedAt.getTime() - databaseNow)).toBeLessThan(
      60_000,
    );
  });

  it('frees the spaces at once', async () => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    const { holdId } = await reserveHeld(bookable, 2);

    await holdData.releaseHold(guestA, { holdId });

    expect(
      (await holdData.reserveSpaces(guestB, forAdults(bookable, 2))).status,
    ).toBe('held');
  });

  it('accepts the id in capitals', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1);

    expect(
      await holdData.releaseHold(guestA, { holdId: holdId.toUpperCase() }),
    ).toEqual({ status: 'released' });
  });

  it('answers a second release as released and changes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1);
    await holdData.releaseHold(guestA, { holdId });
    const first = await storedHold(holdId);

    const again = await holdData.releaseHold(guestA, { holdId });

    expect(again).toEqual({ status: 'released' });
    expect(await storedHold(holdId)).toEqual(first);
  });

  it('releases an active hold that has already lapsed', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      createdAt: new Date(Date.now() - 30 * minute),
      updatedAt: new Date(Date.now() - 30 * minute),
      expiresAt: new Date(Date.now() - 20 * minute),
    });

    expect(await holdData.releaseHold(guestA, { holdId: lapsed.id })).toEqual({
      status: 'released',
    });
    expect(await storedHold(lapsed.id)).toMatchObject({
      status: 'released',
      releasedReason: 'guest_left',
    });
  });

  it('refuses a paying hold and changes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const paying = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      status: 'paying',
      payingUntil: new Date(Date.now() + 10 * minute),
      expiresAt: new Date(Date.now() + 10 * minute),
    });
    const before = await storedHold(paying.id);

    expect(await holdData.releaseHold(guestA, { holdId: paying.id })).toEqual({
      status: 'payment_in_progress',
    });
    expect(await storedHold(paying.id)).toEqual(before);
  });

  it('answers another device, a missing hold, a malformed id and a converted hold alike, and changes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1, guestA);
    const converted = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      status: 'converted',
    });
    const paying = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      status: 'paying',
      payingUntil: new Date(Date.now() + 10 * minute),
      expiresAt: new Date(Date.now() + 10 * minute),
    });
    const before = [
      await storedHold(holdId),
      await storedHold(converted.id),
      await storedHold(paying.id),
    ];

    const answers = await Promise.all([
      holdData.releaseHold(guestB, { holdId }),
      holdData.releaseHold(guestB, { holdId: paying.id }),
      holdData.releaseHold(guestA, {
        holdId: '2f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f',
      }),
      holdData.releaseHold(guestA, { holdId: 'nope' }),
      holdData.releaseHold(guestA, { holdId: converted.id }),
    ]);

    expect(answers).toEqual(
      Array.from({ length: 5 }, () => ({ status: 'not_found' })),
    );
    expect([
      await storedHold(holdId),
      await storedHold(converted.id),
      await storedHold(paying.id),
    ]).toEqual(before);
  });
});

describe('capacity edits count open holds', () => {
  const ops = testCaller({ roles: [Role.Ops] });
  const edit = (bookable: Bookable, allocation: number, version = 1) =>
    sessionData.updateSessionAllocation(ops, {
      sessionId: bookable.session.id,
      allocation,
      expectedVersion: version,
    });

  it('refuses a capacity below the seats sold plus the open holds, naming both', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await client.db
      .update(sessions)
      .set({ seatsSold: 3 })
      .where(eq(sessions.id, bookable.session.id));
    await reserveHeld(bookable, 4);

    expect(await edit(bookable, 6)).toEqual({
      ok: false,
      reason: 'below_sold_and_held',
      seatsSold: 3,
      heldSeats: 4,
    });
    expect(await edit(bookable, 7)).toMatchObject({
      ok: true,
      session: { allocation: 7 },
    });
  });

  it('invalidates the session spaces tag on a saved edit and on no refusal', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await reserveHeld(bookable, 4);
    cache.updateTag.mockClear();

    await edit(bookable, 3);
    expect(cache.updateTag).not.toHaveBeenCalled();

    await edit(bookable, 9);
    expect(cache.updateTag.mock.calls).toEqual([
      [`session:${bookable.session.id}`],
    ]);
  });

  it('counts a paying hold that is still inside paying_until', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await insertHold(client.db, bookable.session.id, {
      seats: 5,
      status: 'paying',
      createdAt: new Date(Date.now() - 12 * minute),
      updatedAt: new Date(Date.now() - 12 * minute),
      expiresAt: new Date(Date.now() - 2 * minute),
      payingUntil: new Date(Date.now() + 3 * minute),
    });

    expect(await edit(bookable, 4)).toMatchObject({
      ok: false,
      reason: 'below_sold_and_held',
      heldSeats: 5,
    });
  });

  it('allows a lower capacity when only lapsed or finished holds stand in the way', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await insertHold(client.db, bookable.session.id, {
      seats: 5,
      createdAt: new Date(Date.now() - 30 * minute),
      updatedAt: new Date(Date.now() - 30 * minute),
      expiresAt: new Date(Date.now() - 20 * minute),
    });
    await insertHold(client.db, bookable.session.id, {
      seats: 3,
      status: 'converted',
    });
    await insertHold(client.db, bookable.session.id, {
      seats: 3,
      status: 'released',
      releasedReason: 'guest_left',
    });

    expect(await edit(bookable, 1)).toMatchObject({
      ok: true,
      session: { allocation: 1 },
    });
  });

  it('is reached again after a release frees the spaces', async () => {
    const bookable = await seedBookable(client.db, { allocation: 4 });
    const { holdId } = await reserveHeld(bookable, 4);
    expect(await edit(bookable, 2)).toMatchObject({ ok: false });

    await holdData.releaseHold(guestA, { holdId });

    expect(await edit(bookable, 2)).toMatchObject({ ok: true });
  });
});
