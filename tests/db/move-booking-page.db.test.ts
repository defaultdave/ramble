import { describe, expect, it, vi } from 'vitest';
import { moveChoiceLimit } from '@/lib/moveBooking';
import {
  addDate,
  isolateExperience,
  otherExperience,
  seedMovable,
} from './moveFixtures';
import {
  clearJobs,
  setupRefundsDatabase,
  client,
  schema,
} from './refundFixtures';
import { eq, sql } from 'drizzle-orm';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the manage page's read, with the picker open):
// - the picker lists the other dates of the booking's experience that take the party and are outside the window, soonest first,
//   and leaves out the booking's own date, another experience's date, a cancelled date, a date that has started, a full date,
//   and a date inside the window
// - it reads at most `moveChoiceLimit` dates, soonest first, so a later date past the limit is not offered
// - a page read without the picker reads no dates, and a booking outside the terms has no offer even when the picker is asked for

const read = async (token: string, picker: boolean) => {
  const { readManagePage } = await import('@/server/manageBooking');
  const outcome = await readManagePage(token, { picker });
  if (outcome.kind !== 'ok' || outcome.view.kind !== 'active') {
    throw new Error('not an active page');
  }
  return outcome.view;
};

describe('the picker on the manage page', () => {
  it('lists the dates the move would accept, soonest first, and no others', async () => {
    await clearJobs();
    const world = await isolateExperience(await seedMovable());
    const later = await addDate(world, {
      startsInMinutes: (world.tierHours + 96) * 60,
    });
    const sooner = await addDate(world, {
      startsInMinutes: (world.tierHours + 24) * 60,
      seatsSold: 10 - world.seats,
    });
    await addDate(world, { seatsSold: 10 - world.seats + 1 });
    await addDate(world, { status: 'cancelled' });
    await addDate(world, { startsInMinutes: -30 });
    await addDate(world, { startsInMinutes: world.tierHours * 60 - 1 });
    await addDate(world, { experienceId: await otherExperience() });

    const view = await read(world.token, true);

    expect(
      view.move?.picker?.choices.map((choice) => choice.sessionId),
    ).toEqual([sooner, later]);
    expect(view.move?.picker?.choices[0]?.spacesLabel).toBe('2 left');
  });

  it('reads no more dates than the limit, soonest first', async () => {
    await clearJobs();
    const world = await isolateExperience(await seedMovable());
    const ids: string[] = [];
    for (let index = 0; index < moveChoiceLimit + 1; index += 1) {
      ids.push(
        await addDate(world, {
          startsInMinutes: (world.tierHours + 24 + index) * 60,
        }),
      );
    }

    const view = await read(world.token, true);

    expect(
      view.move?.picker?.choices.map((choice) => choice.sessionId),
    ).toEqual(ids.slice(0, moveChoiceLimit));
  });

  it('reads no dates when the picker is closed, and the offer is still there', async () => {
    await clearJobs();
    const world = await isolateExperience(await seedMovable());
    await addDate(world);

    const view = await read(world.token, false);

    expect(view.move).toMatchObject({ picker: null });
  });

  it('shows no offer on a booking outside the terms, even with the picker asked for', async () => {
    await clearJobs();
    const world = await isolateExperience(
      await seedMovable({ freeCancelInMinutes: -1 }),
    );
    await addDate(world);

    expect((await read(world.token, true)).move).toBeNull();
  });

  it('leaves out a date that has come inside the window since it was made', async () => {
    await clearJobs();
    const world = await isolateExperience(await seedMovable());
    const date = await addDate(world);
    await client.db
      .update(schema.sessions)
      .set({
        startsAt: sql`now() + make_interval(mins => 5)`,
        endsAt: sql`now() + make_interval(mins => 125)`,
      })
      .where(eq(schema.sessions.id, date));

    const view = await read(world.token, true);

    expect(view.move?.picker?.choices).toEqual([]);
  });
});
