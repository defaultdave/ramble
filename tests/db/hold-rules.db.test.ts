import { count, eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { holdLimits, scrubbedHash } from '@/lib/holds';
import { experiences, holdItems, holds, sessions } from '@/server/db/schema';
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
  insertSession,
  minute,
  seedBookable,
} from './holdFixtures';

// Behaviours under test, one per decision, branch or risk:
// - supersede: a new hold by the same device on the same session releases the earlier open one as
//   superseded, pointing at the new hold, in the same transaction, and the earlier hold's seats come back
//   to the new one; another device's hold, a paying hold, and a lapsed hold are left alone; a refusal after
//   the plan (sold out, over the limit, blocked) leaves the earlier hold standing
// - the device limit: six seats across the device's open holds in every session, refused as device_limit
//   with no end time and nothing written; superseded and lapsed holds do not count; a second device on the
//   same address shares the limit and gets the same answer
// - the block: three lapses inside 15 minutes block with `until` from the deadlines, whether the cleanup job
//   has run or not; two lapses, older lapses, superseded holds, and bookings do not; the address is counted too
// - cleanup: lapsed active holds expire and lapsed paying holds are abandoned, open, converted, and released
//   holds are left alone, a second run does nothing, a batch is bounded, and each cleaned session's tag is revalidated
// - scrub: released holds past retention lose their hashes, newer ones, other statuses, and scrubbed ones do not
//   change, a batch is bounded, and the rows and their items stay
// - the spaces-left read counts sold seats and open holds, answers null for a missing or hidden session, returns
//   negative as is, and reads a lapsed hold as free
// - a hold placed or released invalidates the session's spaces tag, and a refusal invalidates nothing

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
let guestOnA: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  guestA = await testDevice('rules-a');
  guestB = await testDevice('rules-b');
  guestOnA = await testDevice('rules-on-a', '198.51.100.7');
  guestA = await testDevice('rules-a', '198.51.100.7');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await clearHolds(client.db);
  cache.updateTag.mockClear();
  cache.revalidateTag.mockClear();
  await client.db.execute(
    sql`UPDATE settings SET bookings_paused = false, hold_minutes = 10`,
  );
});

type Bookable = Awaited<ReturnType<typeof seedBookable>>;

const forAdults = (
  sessionId: string,
  bookable: Bookable,
  quantity: number,
) => ({
  sessionId,
  items: [{ priceOptionId: bookable.adult.id, quantity }],
  purpose: 'booking' as const,
});

async function reserve(
  device: Device,
  bookable: Bookable,
  quantity: number,
  sessionId = bookable.session.id,
) {
  return holdData.reserveSpaces(
    device,
    forAdults(sessionId, bookable, quantity),
  );
}

async function reserveHeld(
  device: Device,
  bookable: Bookable,
  quantity: number,
  sessionId = bookable.session.id,
) {
  const result = await reserve(device, bookable, quantity, sessionId);
  if (result.status !== 'held') throw new Error(`not held: ${result.status}`);
  return result;
}

async function stored(id: string) {
  const [row] = await client.db.select().from(holds).where(eq(holds.id, id));
  if (!row) throw new Error('no such hold');
  return row;
}

async function totalHolds() {
  const [row] = await client.db.select({ total: count() }).from(holds);
  return row?.total ?? 0;
}

/** A hold of `device` whose deadline passed `minutesAgo` minutes ago, never converted. */
function lapsedHold(
  sessionId: string,
  device: Device,
  minutesAgo: number,
  overrides: Parameters<typeof insertHold>[2] = {},
) {
  return insertHold(client.db, sessionId, {
    deviceKey: device.deviceKey,
    ipHash: device.ipHash,
    createdAt: sql`now() - make_interval(mins => ${minutesAgo + 10})`,
    ...overrides,
  });
}

describe('superseding the same device on the same session', () => {
  it('releases the earlier hold as superseded, pointing at the new one, and keeps its items', async () => {
    const bookable = await seedBookable(client.db);
    const first = await reserveHeld(guestA, bookable, 2);

    const second = await reserveHeld(guestA, bookable, 3);

    const earlier = await stored(first.holdId);
    expect(earlier).toMatchObject({
      status: 'released',
      releasedReason: 'superseded',
      supersededBy: second.holdId,
    });
    expect((await stored(second.holdId)).status).toBe('active');
    const items = await client.db
      .select({ total: count() })
      .from(holdItems)
      .where(eq(holdItems.holdId, first.holdId));
    expect(items[0]?.total).toBe(1);
  });

  it('stamps the supersede with the time of the new hold', async () => {
    const bookable = await seedBookable(client.db);
    const first = await reserveHeld(guestA, bookable, 1);

    const second = await reserveHeld(guestA, bookable, 1);

    expect((await stored(first.holdId)).updatedAt).toEqual(
      (await stored(second.holdId)).createdAt,
    );
  });

  it('gives the earlier hold seats back to the new one, so a party that only fits that way is held', async () => {
    const bookable = await seedBookable(client.db, { allocation: 4 });
    await reserveHeld(guestA, bookable, 3);

    const bigger = await reserve(guestA, bookable, 4);

    expect(bigger.status).toBe('held');
  });

  it('leaves another device on the session alone', async () => {
    const bookable = await seedBookable(client.db);
    const others = await reserveHeld(guestB, bookable, 2);

    await reserveHeld(guestA, bookable, 2);
    await reserveHeld(guestA, bookable, 2);

    expect((await stored(others.holdId)).status).toBe('active');
  });

  it('supersedes only on the same session', async () => {
    const bookable = await seedBookable(client.db);
    const other = await insertSession(client.db, bookable.experience.id);
    const first = await reserveHeld(guestA, bookable, 1);

    await reserveHeld(guestA, bookable, 1, other.id);

    expect((await stored(first.holdId)).status).toBe('active');
  });

  it('leaves a paying hold alone, and counts its seats', async () => {
    const bookable = await seedBookable(client.db, { allocation: 4 });
    const paying = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      ipHash: guestA.ipHash,
      seats: 3,
      status: 'paying',
      payingUntil: sql`now() + make_interval(mins => 15)`,
    });

    const tooMany = await reserve(guestA, bookable, 2);
    const fits = await reserve(guestA, bookable, 1);

    expect(tooMany).toEqual({ status: 'sold_out', alternatives: [] });
    expect(fits.status).toBe('held');
    expect((await stored(paying.id)).status).toBe('paying');
  });

  it('leaves a lapsed active hold for the cleanup job', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await lapsedHold(bookable.session.id, guestA, 1);

    await reserveHeld(guestA, bookable, 1);

    expect(await stored(lapsed.id)).toMatchObject({ status: 'active' });
  });

  it.each([
    [
      'sold out',
      async (bookable: Bookable) => {
        await insertHold(client.db, bookable.session.id, {
          deviceKey: hash('c'),
          ipHash: hash('d'),
          seats: 2,
        });
        return reserve(guestA, bookable, 3);
      },
      'sold_out',
    ],
    [
      'over the device limit',
      async (bookable: Bookable) => {
        const other = await insertSession(client.db, bookable.experience.id);
        await reserveHeld(guestA, bookable, 4, other.id);
        return reserve(guestA, bookable, 3);
      },
      'blocked',
    ],
  ])(
    'leaves the earlier hold standing when the new one is refused as %s',
    async (_name, refuse, expected) => {
      const bookable = await seedBookable(client.db, { allocation: 4 });
      const first = await reserveHeld(guestA, bookable, 2);

      const answer = await refuse(bookable);

      expect(answer.status).toBe(expected);
      expect(await stored(first.holdId)).toMatchObject({
        status: 'active',
        releasedReason: null,
        supersededBy: null,
      });
    },
  );

  it('keeps one open hold when the same device reserves again and again', async () => {
    const bookable = await seedBookable(client.db);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await reserveHeld(guestA, bookable, 1);
    }

    const rows = await client.db
      .select({ status: holds.status, reason: holds.releasedReason })
      .from(holds);
    expect(rows.filter(({ status }) => status === 'active')).toHaveLength(1);
    expect(rows.filter(({ reason }) => reason === 'superseded')).toHaveLength(
      3,
    );
  });
});

describe('the device limit of six spaces', () => {
  it('holds six across two sessions and refuses the seventh space as device_limit', async () => {
    const bookable = await seedBookable(client.db);
    const second = await insertSession(client.db, bookable.experience.id);
    const third = await insertSession(client.db, bookable.experience.id);
    await reserveHeld(guestA, bookable, 4);
    await reserveHeld(guestA, bookable, 2, second.id);
    const before = await totalHolds();

    const refused = await reserve(guestA, bookable, 1, third.id);

    expect(refused).toEqual({ status: 'blocked', reason: 'device_limit' });
    expect(await totalHolds()).toBe(before);
    expect(cache.updateTag).toHaveBeenCalledTimes(2);
  });

  it('counts the new hold with the others: five held, a party of two is refused and one is held', async () => {
    const bookable = await seedBookable(client.db);
    const other = await insertSession(client.db, bookable.experience.id);
    await reserveHeld(guestA, bookable, 5);

    expect((await reserve(guestA, bookable, 2, other.id)).status).toBe(
      'blocked',
    );
    expect((await reserve(guestA, bookable, 1, other.id)).status).toBe('held');
  });

  it('lets a device that holds six on a session reserve six there again, because the first is superseded', async () => {
    const bookable = await seedBookable(client.db);
    await reserveHeld(guestA, bookable, 6);

    expect((await reserve(guestA, bookable, 6)).status).toBe('held');
  });

  it('counts a child ticket as no seat', async () => {
    const bookable = await seedBookable(client.db);
    await reserveHeld(guestA, bookable, 6);

    const withChild = await holdData.reserveSpaces(guestA, {
      sessionId: (await insertSession(client.db, bookable.experience.id)).id,
      items: [{ priceOptionId: bookable.child.id, quantity: 1 }],
      purpose: 'booking',
    });

    expect(withChild).toMatchObject({ status: 'invalid' });
  });

  it('does not count a lapsed hold, a released one, or a converted one', async () => {
    const bookable = await seedBookable(client.db);
    const sessionTwo = await insertSession(client.db, bookable.experience.id);
    await lapsedHold(sessionTwo.id, guestA, 1, { seats: 6 });
    await lapsedHold(sessionTwo.id, guestA, 30, {
      seats: 6,
      status: 'released',
      releasedReason: 'guest_left',
    });
    await lapsedHold(sessionTwo.id, guestA, 30, {
      seats: 6,
      status: 'converted',
    });

    expect((await reserve(guestA, bookable, 6)).status).toBe('held');
  });

  it('counts a paying hold until paying_until', async () => {
    const bookable = await seedBookable(client.db);
    const sessionTwo = await insertSession(client.db, bookable.experience.id);
    await insertHold(client.db, sessionTwo.id, {
      deviceKey: guestA.deviceKey,
      ipHash: guestA.ipHash,
      seats: 5,
      status: 'paying',
      payingUntil: sql`now() + make_interval(mins => 15)`,
    });

    expect((await reserve(guestA, bookable, 2)).status).toBe('blocked');
  });

  it('shares the limit with a second device on the same address, and answers it the same way', async () => {
    const bookable = await seedBookable(client.db);
    const other = await insertSession(client.db, bookable.experience.id);
    await reserveHeld(guestA, bookable, 4);

    const overTheLimit = await reserve(guestOnA, bookable, 3, other.id);
    const ownOvershoot = await reserve(guestA, bookable, 3, other.id);

    expect(overTheLimit).toEqual({ status: 'blocked', reason: 'device_limit' });
    expect(ownOvershoot).toEqual(overTheLimit);
    expect((await reserve(guestOnA, bookable, 2, other.id)).status).toBe(
      'held',
    );
  });

  it('does not share it with a device on another address', async () => {
    const bookable = await seedBookable(client.db);
    const other = await insertSession(client.db, bookable.experience.id);
    await reserveHeld(guestA, bookable, 6);

    expect((await reserve(guestB, bookable, 6, other.id)).status).toBe('held');
  });
});

describe('the block after three lapses in 15 minutes', () => {
  async function threeLapses(bookable: Bookable, device = guestA) {
    const rows = [];
    for (const minutesAgo of [2, 5, 9]) {
      rows.push(await lapsedHold(bookable.session.id, device, minutesAgo));
    }
    return rows;
  }

  it('blocks with an end time 15 minutes after the third most recent deadline, and writes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const rows = await threeLapses(bookable);
    const oldest = Math.min(
      ...rows.map(({ expiresAt }) => expiresAt.getTime()),
    );
    const before = await totalHolds();

    const answer = await reserve(guestA, bookable, 1);

    expect(answer).toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
      until: new Date(oldest + 15 * minute).toISOString(),
    });
    expect(await totalHolds()).toBe(before);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('counts lapses the cleanup job has already released the same as ones it has not', async () => {
    const bookable = await seedBookable(client.db);
    const before = await reserve(guestA, bookable, 1);
    expect(before.status).toBe('held');
    await clearHolds(client.db);
    await threeLapses(bookable);
    const unswept = await reserve(guestA, bookable, 1);
    await holdData.releaseLapsedHolds();
    const swept = await reserve(guestA, bookable, 1);

    expect(unswept).toMatchObject({ status: 'blocked' });
    expect(swept).toEqual(unswept);
  });

  it('lets a device with two lapses through', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 2);
    await lapsedHold(bookable.session.id, guestA, 5);

    expect((await reserve(guestA, bookable, 1)).status).toBe('held');
  });

  it('does not count a lapse older than 15 minutes', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 2);
    await lapsedHold(bookable.session.id, guestA, 5);
    await lapsedHold(bookable.session.id, guestA, 16);

    expect((await reserve(guestA, bookable, 1)).status).toBe('held');
  });

  it('counts a lapse in another session', async () => {
    const bookable = await seedBookable(client.db);
    const sessionTwo = await insertSession(client.db, bookable.experience.id);
    await lapsedHold(sessionTwo.id, guestA, 2);
    await lapsedHold(sessionTwo.id, guestA, 5);
    await lapsedHold(bookable.session.id, guestA, 9);

    expect((await reserve(guestA, bookable, 1)).status).toBe('blocked');
  });

  it('counts a paying hold that ran past paying_until, from paying_until', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 2);
    await lapsedHold(bookable.session.id, guestA, 5);
    await lapsedHold(bookable.session.id, guestA, 20, {
      status: 'paying',
      payingUntil: sql`now() - make_interval(mins => 8)`,
    });

    expect((await reserve(guestA, bookable, 1)).status).toBe('blocked');
  });

  it('does not count superseded holds: the same device can change its mind many times', async () => {
    const bookable = await seedBookable(client.db);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await reserveHeld(guestA, bookable, 1);
    }
    await client.db.execute(
      sql`UPDATE holds SET expires_at = created_at + interval '1 minute', updated_at = created_at`,
    );

    expect((await reserve(guestA, bookable, 1)).status).toBe('held');
  });

  it('does not count a booking', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 2);
    await lapsedHold(bookable.session.id, guestA, 5);
    await lapsedHold(bookable.session.id, guestA, 9, { status: 'converted' });

    expect((await reserve(guestA, bookable, 1)).status).toBe('held');
  });

  it('does not count a guest leaving before the deadline', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 2);
    await lapsedHold(bookable.session.id, guestA, 5);
    await lapsedHold(bookable.session.id, guestA, 9, {
      status: 'released',
      releasedReason: 'guest_left',
      updatedAt: sql`now() - make_interval(mins => 15)`,
    });

    expect((await reserve(guestA, bookable, 1)).status).toBe('held');
  });

  it('does not let a guest clear a lapse by releasing the lapsed hold', async () => {
    const bookable = await seedBookable(client.db);
    const rows = await threeLapses(bookable);
    for (const row of rows) {
      await holdData.releaseHold(guestA, { holdId: row.id });
    }

    expect((await reserve(guestA, bookable, 1)).status).toBe('blocked');
  });

  it('blocks a second device on the same address, and not one elsewhere', async () => {
    const bookable = await seedBookable(client.db);
    await threeLapses(bookable);

    expect((await reserve(guestOnA, bookable, 1)).status).toBe('blocked');
    expect((await reserve(guestB, bookable, 1)).status).toBe('held');
  });

  it('ends at `until`: a hold placed after the third lapse leaves the window goes through', async () => {
    const bookable = await seedBookable(client.db);
    await lapsedHold(bookable.session.id, guestA, 1);
    await lapsedHold(bookable.session.id, guestA, 2);
    await lapsedHold(bookable.session.id, guestA, 14);
    expect((await reserve(guestA, bookable, 1)).status).toBe('blocked');

    await client.db.execute(
      sql`UPDATE holds SET created_at = created_at - interval '3 minutes', updated_at = updated_at - interval '3 minutes', expires_at = expires_at - interval '3 minutes' WHERE expires_at < now() - interval '13 minutes'`,
    );

    expect((await reserve(guestA, bookable, 1)).status).toBe('held');
  });

  it('refuses to decide on more lapsed rows than the bound allows', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.execute(sql`
      INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at, created_at, updated_at)
      SELECT ${bookable.session.id}, 'booking', 'active', 1, ${guestA.deviceKey}, ${guestA.ipHash},
             now() - interval '2 minutes', now() - interval '12 minutes', now() - interval '12 minutes'
      FROM generate_series(1, ${holdLimits.blockScan + 1})`);

    await expect(reserve(guestA, bookable, 1)).rejects.toThrow(
      'More recent lapsed holds than the rules allow',
    );
  });
});

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

describe('readSessionSpacesLeft', () => {
  it('is the allocation less seats sold and open holds, and a lapsed hold counts for nothing', async () => {
    const bookable = await seedBookable(client.db, { allocation: 10 });
    await client.db.execute(
      sql`UPDATE sessions SET seats_sold = 2 WHERE id = ${bookable.session.id}`,
    );
    await insertHold(client.db, bookable.session.id, { seats: 3 });
    await lapsedHold(bookable.session.id, guestA, 1, { seats: 4 });

    expect(await holdData.readSessionSpacesLeft(bookable.session.id)).toBe(5);
  });

  it('counts a paying hold until paying_until', async () => {
    const bookable = await seedBookable(client.db, { allocation: 10 });
    await insertHold(client.db, bookable.session.id, {
      seats: 2,
      status: 'paying',
      payingUntil: sql`now() + make_interval(mins => 15)`,
    });
    await lapsedHold(bookable.session.id, guestA, 10, {
      seats: 3,
      status: 'paying',
      payingUntil: sql`now() - make_interval(mins => 1)`,
    });

    expect(await holdData.readSessionSpacesLeft(bookable.session.id)).toBe(8);
  });

  it('returns a negative number as it is when the capacity was lowered under the holds', async () => {
    const bookable = await seedBookable(client.db, { allocation: 5 });
    await insertHold(client.db, bookable.session.id, { seats: 4 });
    await client.db.execute(
      sql`UPDATE sessions SET allocation = 2 WHERE id = ${bookable.session.id}`,
    );

    expect(await holdData.readSessionSpacesLeft(bookable.session.id)).toBe(-2);
  });

  it('answers null for a missing session and for one of an experience guests cannot see', async () => {
    const hidden = await seedBookable(client.db, {
      experience: { status: 'draft' },
    });

    expect(
      await holdData.readSessionSpacesLeft(
        '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      ),
    ).toBeNull();
    expect(await holdData.readSessionSpacesLeft(hidden.session.id)).toBeNull();
  });

  it('shows a guide-only experience, which guests can see', async () => {
    const guide = await seedBookable(client.db, {
      allocation: 7,
      experience: {
        status: 'guide_only',
        linkOutUrl: 'https://example.com/guide',
      },
    });

    expect(await holdData.readSessionSpacesLeft(guide.session.id)).toBe(7);
  });

  it('agrees with the reserve: the last space is the last one the display shows', async () => {
    const bookable = await seedBookable(client.db, { allocation: 3 });
    await reserveHeld(guestA, bookable, 3);

    expect(await holdData.readSessionSpacesLeft(bookable.session.id)).toBe(0);
    expect((await reserve(guestB, bookable, 1)).status).toBe('sold_out');
  });

  it('reads the experience status from the row, so a taken-down experience disappears', async () => {
    const bookable = await seedBookable(client.db, { allocation: 4 });
    await client.db
      .update(experiences)
      .set({ status: 'paused' })
      .where(eq(experiences.id, bookable.experience.id));

    expect(
      await holdData.readSessionSpacesLeft(bookable.session.id),
    ).toBeNull();
    await client.db
      .update(sessions)
      .set({ allocation: 4 })
      .where(eq(sessions.id, bookable.session.id));
  });
});

describe('invalidating the spaces tag', () => {
  it('invalidates the session tag when a hold is placed, once, and for a supersede too', async () => {
    const bookable = await seedBookable(client.db);

    await reserveHeld(guestA, bookable, 1);
    await reserveHeld(guestA, bookable, 2);

    expect(cache.updateTag.mock.calls).toEqual([
      [`session:${bookable.session.id}`],
      [`session:${bookable.session.id}`],
    ]);
  });

  it('invalidates nothing for a refusal', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1 });
    await reserveHeld(guestB, bookable, 1);
    cache.updateTag.mockClear();

    await reserve(guestA, bookable, 1);
    await holdData.releaseHold(guestA, {
      holdId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });

    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('invalidates the session tag when a hold is released, and not for a second release', async () => {
    const bookable = await seedBookable(client.db);
    const placed = await reserveHeld(guestA, bookable, 1);
    cache.updateTag.mockClear();

    await holdData.releaseHold(guestA, { holdId: placed.holdId });
    await holdData.releaseHold(guestA, { holdId: placed.holdId });

    expect(cache.updateTag.mock.calls).toEqual([
      [`session:${bookable.session.id}`],
    ]);
  });
});
