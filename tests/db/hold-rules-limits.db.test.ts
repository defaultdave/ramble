import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { holdLimits } from '@/lib/holds';
import {
  clearHolds,
  insertHold,
  insertSession,
  minute,
  seedBookable,
} from './holdFixtures';
import {
  client,
  guestA,
  guestB,
  guestOnA,
  holdData,
  lapsedHold,
  reserve,
  reserveHeld,
  setupHoldRulesDatabase,
  totalHolds,
  type Bookable,
} from './holdRulesFixtures';

// Behaviours under test, one per decision, branch or risk:
// - the device limit: six seats across the device's open holds in every session, refused as device_limit
//   with no end time and nothing written; superseded and lapsed holds do not count; a second device on the
//   same address shares the limit and gets the same answer
// - the block: three lapses inside 15 minutes block with `until` from the deadlines, whether the cleanup job
//   has run or not; two lapses, older lapses, superseded holds, and bookings do not; the address is counted too

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
