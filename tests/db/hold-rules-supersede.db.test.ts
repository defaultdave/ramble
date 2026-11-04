import { count, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { holdItems, holds } from '@/server/db/schema';
import { hash, insertHold, insertSession, seedBookable } from './holdFixtures';
import {
  client,
  guestA,
  guestB,
  lapsedHold,
  reserve,
  reserveHeld,
  setupHoldRulesDatabase,
  stored,
  type Bookable,
} from './holdRulesFixtures';

// Behaviours under test, one per decision, branch or risk:
// - supersede: a new hold by the same device on the same session releases the earlier open one as
//   superseded, pointing at the new hold, in the same transaction, and the earlier hold's seats come back
//   to the new one; another device's hold, a paying hold, and a lapsed hold are left alone; a refusal after
//   the plan (sold out, over the limit, blocked) leaves the earlier hold standing

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
