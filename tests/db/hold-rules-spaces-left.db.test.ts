import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { experiences, sessions } from '@/server/db/schema';
import { insertHold, seedBookable } from './holdFixtures';
import {
  client,
  guestA,
  guestB,
  holdData,
  lapsedHold,
  reserve,
  reserveHeld,
  setupHoldRulesDatabase,
} from './holdRulesFixtures';

// Behaviours under test, one per decision, branch or risk:
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

setupHoldRulesDatabase(cache);

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
