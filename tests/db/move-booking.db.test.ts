import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { tagsForChanges } from '@/lib/cacheTags';
import { experienceStatuses } from '@/lib/catalog';
import type { MoveBookingResult } from '@/lib/moveBooking';
import { sessionStatuses } from '@/lib/sessions';
import { auditOf, seatsSoldOf } from './cancelFixtures';
import { insertHold } from './holdFixtures';
import {
  addDate,
  holdOf,
  moveSnapshot,
  otherExperience,
  seedMovable,
  sessionOf,
  type MoveWorld,
} from './moveFixtures';
import {
  client,
  jobsOfKind,
  orderOf,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the action `moveBooking`, the fake payment adapter):
// - a move puts the order, its hold, and its seats on the new date and takes them off the old: only those two sessions' counts
//   change, another booking's order, hold, and session are untouched, and no amount, refund, or status on the order changes
// - the new deadline is the booking's tier before the new start, taken from the database clock; the date a minute inside it is refused,
//   the date a minute outside it is taken
// - one audit row of ids and a count, one email job with the move's own key, and the spaces tags of both dates invalidated
// - a booking can move again from the new date, and back; each move queues its own email
// - the date's room counts the seats sold and the open holds, but not a lapsed hold: exactly the party fits, one seat fewer does not
// - each refusal writes nothing at all: the booking's own date, another experience's date, a date that is cancelled or completed
//   or has started, one of an experience that is not live, no such date, a full date, a date inside the window, a booking
//   outside the terms (window closed, started, cancelled, paid with a gift), a link voided by a bump, an unknown or malformed link
// - the entry of the data layer parses its input before anything is read, and takes an upper-case id for the same date
// - the terms are judged by the database clock, not the app's
// - the move spends the manage count, and a token over it is refused with nothing written

const move = async (
  world: MoveWorld,
  targetSessionId: string,
  manageToken = world.token,
) => {
  const { moveBooking } = await import('@/server/actions/orders');
  return moveBooking({ manageToken, targetSessionId });
};

async function fresh(seed: Parameters<typeof seedMovable>[0] = {}) {
  revalidateTag.mockClear();
  return seedMovable(seed);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('moving a booking', () => {
  it('puts the booking, its hold, and its seats on the new date and leaves everything else alone', async () => {
    const world = await fresh();
    const date = await addDate(world, { seatsSold: 4 });
    const bystander = await fresh();
    const bystanderBefore = await moveSnapshot(bystander, []);
    const before = await orderOf(world);

    expect(await move(world, date)).toEqual({ status: 'moved' });

    const after = await orderOf(world);
    expect({ ...after, sessionId: null, freeCancelUntil: null }).toEqual({
      ...before,
      sessionId: null,
      freeCancelUntil: null,
    });
    expect(after.sessionId).toBe(date);
    expect((await holdOf(world.holdId)).sessionId).toBe(date);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore - world.seats);
    expect((await sessionOf(date)).seatsSold).toBe(4 + world.seats);
    expect(await moveSnapshot(bystander, [])).toEqual(bystanderBefore);
    expect((await holdOf(world.holdId)).status).toBe('converted');
  });

  it('makes the new deadline the booking tier before the new start', async () => {
    const world = await fresh();
    const date = await addDate(world);

    await move(world, date);

    const [row] = await client.db
      .select({
        matches: sql<boolean>`${schema.orders.freeCancelUntil} = date_trunc('milliseconds', ${schema.sessions.startsAt}) - make_interval(hours => ${world.tierHours})`,
      })
      .from(schema.orders)
      .innerJoin(
        schema.sessions,
        eq(schema.sessions.id, schema.orders.sessionId),
      )
      .where(eq(schema.orders.id, world.orderId));
    expect(row?.matches).toBe(true);
  });

  it('writes one audit row of ids and a count, queues one email, and invalidates both dates', async () => {
    const world = await fresh();
    const date = await addDate(world);

    await move(world, date);

    const rows = await auditOf(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: 'guest',
      actorId: null,
      action: 'order.moved',
      subjectKind: 'order',
      subjectId: world.orderId,
      details: {
        from_session_id: world.sessionId,
        to_session_id: date,
        seats_moved: world.seats,
      },
    });
    const jobs = await jobsOfKind('guest-move-confirmation');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      orderId: world.orderId,
      moveId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
    });
    expect(jobs[0]?.dedupe_key).toBe(
      `guest-move-confirmation:${(jobs[0]?.payload as { moveId: string }).moveId}`,
    );
    const tags = tagsForChanges([
      { kind: 'spaces', sessionId: world.sessionId },
      { kind: 'spaces', sessionId: date },
    ]);
    for (const tag of tags) {
      expect(revalidateTag).toHaveBeenCalledWith(tag, 'max');
    }
  });

  it('moves again from the new date, and back, each with its own email', async () => {
    const world = await fresh();
    const second = await addDate(world);
    const third = await addDate(world, {
      startsInMinutes: (world.tierHours + 96) * 60,
    });

    expect(await move(world, second)).toEqual({ status: 'moved' });
    expect(await move(world, third)).toEqual({ status: 'moved' });
    expect(await move(world, world.sessionId)).toEqual({ status: 'moved' });

    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
    expect((await sessionOf(second)).seatsSold).toBe(0);
    expect((await sessionOf(third)).seatsSold).toBe(0);
    const keys = (await jobsOfKind('guest-move-confirmation')).map(
      (job) => job.dedupe_key,
    );
    expect(new Set(keys).size).toBe(3);
    expect(await auditOf(world)).toHaveLength(3);
  });
});

describe('the new date is judged for its window and its room', () => {
  it.each([
    ['a minute outside the booking tier', 1, 'moved'],
    ['a minute inside the booking tier', -1, 'too_soon'],
  ])('a date %s answers %s', async (_name, offsetMinutes, status) => {
    const world = await fresh();
    const date = await addDate(world, {
      startsInMinutes: world.tierHours * 60 + offsetMinutes,
    });

    expect(await move(world, date)).toEqual({ status });
    expect((await orderOf(world)).sessionId).toBe(
      status === 'moved' ? date : world.sessionId,
    );
  });

  it.each([
    ['exactly the party fits', 0, 'moved'],
    ['one seat fewer than the party', 1, 'sold_out'],
  ])('with room for %s', async (_name, shortBy, status) => {
    const world = await fresh();
    const date = await addDate(world, {
      allocation: 10,
      seatsSold: 10 - world.seats + shortBy,
    });

    expect(await move(world, date)).toEqual({ status });
  });

  it('counts the open holds of the date, and not a lapsed one', async () => {
    const world = await fresh();
    const date = await addDate(world, { allocation: 10, seatsSold: 6 });
    await insertHold(client.db, date, {
      status: 'paying',
      seats: world.seats + 1,
      payingUntil: sql`now() + make_interval(mins => 10)`,
      deviceKey: 'c'.repeat(64),
      ipHash: 'd'.repeat(64),
    });

    expect(await move(world, date)).toEqual({ status: 'sold_out' });

    await client.db
      .update(schema.holds)
      .set({
        status: 'active',
        payingUntil: null,
        createdAt: sql`now() - make_interval(mins => 30)`,
        expiresAt: sql`now() - make_interval(mins => 1)`,
      })
      .where(eq(schema.holds.sessionId, date));
    expect(await move(world, date)).toEqual({ status: 'moved' });
  });
});

describe('what is refused writes nothing', () => {
  type Case = {
    name: string;
    status: MoveBookingResult['status'];
    seed?: Parameters<typeof seedMovable>[0];
    date: (world: MoveWorld) => Promise<string>;
    experience?: (typeof experienceStatuses)[number];
    /** There is no row of the date to snapshot. */
    noSnapshot?: boolean;
  };
  const cases: Case[] = [
    {
      name: 'the booking own date',
      status: 'same_date',
      date: (world) => Promise.resolve(world.sessionId),
    },
    {
      name: 'a date of another experience',
      status: 'date_unavailable',
      date: async (world) =>
        addDate(world, { experienceId: await otherExperience() }),
    },
    {
      name: 'a date that does not exist',
      status: 'date_unavailable',
      noSnapshot: true,
      date: () => Promise.resolve('00000000-0000-4000-8000-000000000000'),
    },
    {
      name: 'a date that has started',
      status: 'date_unavailable',
      date: (world) => addDate(world, { startsInMinutes: -5 }),
    },
    {
      name: 'a booking whose window has closed',
      status: 'not_movable',
      seed: { freeCancelInMinutes: -1 },
      date: (world) => addDate(world),
    },
    {
      name: 'a booking with no deadline',
      status: 'not_movable',
      seed: { freeCancelInMinutes: null },
      date: (world) => addDate(world),
    },
    {
      name: 'a booking whose session has started',
      status: 'not_movable',
      seed: { startsInMinutes: -5 },
      date: (world) => addDate(world),
    },
    {
      name: 'a booking paid with a gift',
      status: 'not_movable',
      seed: { amountDueMinor: 9_000 },
      date: (world) => addDate(world),
    },
    ...sessionStatuses
      .filter((status) => status !== 'scheduled')
      .map((status): Case => ({
        name: `a date that is ${status}`,
        status: 'date_unavailable',
        date: (world) => addDate(world, { status, seatsSold: 10 }),
      })),
    ...experienceStatuses
      .filter((status) => status !== 'live')
      .map((status): Case => ({
        name: `an experience that is ${status}`,
        status: 'date_unavailable',
        experience: status,
        date: (world) => addDate(world),
      })),
  ];

  it.each(cases)('$name answers $status', async (testCase) => {
    const world = await fresh(testCase.seed);
    const date = await testCase.date(world);
    if (testCase.experience !== undefined) {
      await client.db
        .update(schema.experiences)
        .set({
          status: testCase.experience,
          linkOutUrl: 'https://example.com/guide',
        })
        .where(eq(schema.experiences.id, world.experienceId));
    }
    const dates = testCase.noSnapshot ? [] : [date];
    const before = await moveSnapshot(world, dates);
    revalidateTag.mockClear();

    expect(await move(world, date)).toEqual({ status: testCase.status });

    expect(await moveSnapshot(world, dates)).toEqual(before);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('a cancelled booking answers not movable', async () => {
    const world = await fresh();
    const date = await addDate(world);
    await client.db
      .update(schema.orders)
      .set({
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: sql`clock_timestamp()`,
      })
      .where(eq(schema.orders.id, world.orderId));
    const before = await moveSnapshot(world, [date]);

    expect(await move(world, date)).toEqual({ status: 'not_movable' });
    expect(await moveSnapshot(world, [date])).toEqual(before);
  });

  it('answers not found for a link voided by a bump, and the rebuilt link moves', async () => {
    const world = await fresh();
    const date = await addDate(world);
    const tokens = await import('@/server/tokens');
    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'manage', world.orderId),
    );
    const before = await moveSnapshot(world, [date]);

    expect(await move(world, date)).toEqual({ status: 'not_found' });
    expect(await moveSnapshot(world, [date])).toEqual(before);

    const rebuilt = tokens.capabilityToken('manage', world.orderId, 2);
    expect(await move(world, date, rebuilt)).toEqual({ status: 'moved' });
  });

  it.each([
    ['an unknown token', 'B'.repeat(43)],
    ['a token of the wrong shape', 'short'],
  ])('answers not found for %s', async (_name, token) => {
    const world = await fresh();
    const date = await addDate(world);
    const before = await moveSnapshot(world, [date]);

    expect(await move(world, date, token)).toEqual({ status: 'not_found' });
    expect(await moveSnapshot(world, [date])).toEqual(before);
  });

  it('answers not found for a date id that is not one, without reading', async () => {
    const world = await fresh();
    const before = await moveSnapshot(world, []);

    expect(await move(world, 'nope')).toEqual({ status: 'not_found' });
    expect(await moveSnapshot(world, [])).toEqual(before);
  });
});

describe('the entry of the data layer', () => {
  const direct = async (
    over: { token?: Record<string, unknown>; targetSessionId?: string } = {},
  ) => {
    const { moveBookingOrder } = await import('@/server/db/orderMove');
    return moveBookingOrder({
      token: {
        id: '00000000-0000-4000-8000-000000000000',
        version: 1,
        kind: 'manage',
        ...over.token,
      } as never,
      targetSessionId:
        over.targetSessionId ?? '00000000-0000-4000-8000-000000000001',
    });
  };

  it.each([
    ['an order id that is not one', { token: { id: 'nope' } }],
    ['version 0', { token: { version: 0 } }],
    ['a date id that is not one', { targetSessionId: 'nope' }],
  ])('refuses %s before it reads anything', async (_name, over) => {
    await expect(direct(over)).rejects.toBeInstanceOf(ZodError);
  });

  it('takes an upper-case order id and date id for the same ones', async () => {
    const world = await fresh();
    const date = await addDate(world);

    expect(
      await direct({
        token: { id: world.orderId.toUpperCase() },
        targetSessionId: date.toUpperCase(),
      }),
    ).toEqual({ status: 'moved' });
  });

  it.each(['order', 'gift'])('moves nothing for a %s token', async (kind) => {
    const world = await fresh();
    const date = await addDate(world);
    const before = await moveSnapshot(world, [date]);

    expect(
      await direct({
        token: { id: world.orderId, kind },
        targetSessionId: date,
      }),
    ).toEqual({ status: 'not_found' });
    expect(await moveSnapshot(world, [date])).toEqual(before);
  });

  it('answers not found for a token version that is not the order, and an order that is gone', async () => {
    const world = await fresh();
    const date = await addDate(world);

    expect(
      await direct({
        token: { id: world.orderId, version: 2 },
        targetSessionId: date,
      }),
    ).toEqual({ status: 'not_found' });
    expect(await direct({ targetSessionId: date })).toEqual({
      status: 'not_found',
    });
  });

  it('refuses a facts read of an id that is not one', async () => {
    const { readMoveSubject } = await import('@/server/db/ordersMoveFacts');

    await expect(
      client.db.transaction((tx) => readMoveSubject(tx, 'nope')),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('the terms are judged by the database clock', () => {
  it('moves when the app clock says the window closed long ago', async () => {
    const world = await fresh({ freeCancelInMinutes: 60 });
    const date = await addDate(world);
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() + 10 * 24 * 60 * 60_000,
    });

    expect(await move(world, date)).toEqual({ status: 'moved' });
  });

  it('refuses when the app clock says the window is still open', async () => {
    const world = await fresh({ freeCancelInMinutes: -1 });
    const date = await addDate(world);
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() - 10 * 24 * 60 * 60_000,
    });

    expect(await move(world, date)).toEqual({ status: 'not_movable' });
  });

  it('judges the new date against the database clock too', async () => {
    const world = await fresh();
    const date = await addDate(world, {
      startsInMinutes: world.tierHours * 60 - 1,
    });
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() - 10 * 24 * 60 * 60_000,
    });

    expect(await move(world, date)).toEqual({ status: 'too_soon' });
  });
});

describe('the manage rate limit', () => {
  it('spends one try of the manage count for each move', async () => {
    const world = await fresh();
    const date = await addDate(world);
    const { consumeRateLimit } = await import('@/server/ports/rate-limit');

    await move(world, date);

    expect(await consumeRateLimit('manage', world.token)).toEqual({
      allowed: true,
      remaining: 28,
    });
  });

  it('refuses a token over the count and moves nothing', async () => {
    const world = await fresh();
    const date = await addDate(world);
    const { consumeRateLimit } = await import('@/server/ports/rate-limit');
    for (let tries = 0; tries < 30; tries += 1) {
      await consumeRateLimit('manage', world.token);
    }
    const before = await moveSnapshot(world, [date]);

    expect(await move(world, date)).toMatchObject({ status: 'rate_limited' });
    expect(await moveSnapshot(world, [date])).toEqual(before);
  });
});
