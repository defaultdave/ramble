import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dueClock } from '../support/dueClock';
import { addDate, seedMovable, type MoveWorld } from './moveFixtures';
import {
  client,
  drain,
  jobsOfKind,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/ports/email', () => ({ sendEmail }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the job handler `guest-move-confirmation` and the drain):
// - end to end: a move, drained, emails the guest the booking-moved template with the new day, the manage link of the order's version,
//   and the job's own idempotency key; the host gets nothing from this unit
// - a booking moved twice sends two emails with two keys, and a retry of one job sends the same key again
// - a booking cancelled after the move is skipped: nothing is sent and the job still succeeds
// - a job that should not exist is refused and sends nothing: an order that does not exist, one that is not confirmed, one with no live manage link
// - the kind is registered with a strict payload: ids only, and the move id is a uuid
// the guest's session reminder follows the move (job `session-reminder`)
// - a waiting reminder moved to a later date is re-timed in place to 24 hours before the new start, and its payload names the move
// - a waiting reminder moved to an earlier date is re-timed to the earlier time, so it is not skipped
// - with no waiting reminder (already succeeded, or never queued) a move queues a fresh one under the move's own key, and the old row is left as it was
// - two moves leave exactly one waiting reminder, due for the last date
// - a refused move changes no reminder
// - the reminder's email key differs with a move id, so one sent for the old date does not swallow the new one; the payload takes a uuid move id only, lower-cased

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ messageId: 'm', status: 'sent' });
});

const settle = async () => {
  for (let round = 0; round < 6; round += 1) {
    const report = await drain.drainJobs(dueClock);
    if (report.succeeded + report.retried + report.dead === 0) return;
  }
};

const sent = () =>
  sendEmail.mock.calls.map(
    ([request]) =>
      request as {
        template: string;
        to: string;
        data: Record<string, unknown>;
        idempotencyKey: string;
      },
  );

const move = async (world: MoveWorld, targetSessionId: string) => {
  const { moveBooking } = await import('@/server/actions/orders');
  return moveBooking({ manageToken: world.token, targetSessionId });
};

async function runHandler(payload: unknown) {
  const { sendGuestMoveConfirmation } =
    await import('@/server/jobs/bookingEmails');
  return client.db.transaction((tx) =>
    sendGuestMoveConfirmation({
      tx,
      payload: payload as never,
      jobId: randomUUID(),
    }),
  );
}

describe('the email of a move, end to end', () => {
  it('emails the guest the booking-moved template for the new date, with the job key', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    await move(world, date);

    await settle();

    const [job] = await jobsOfKind('guest-move-confirmation');
    expect(sent()).toHaveLength(1);
    const [email] = sent();
    expect(email).toMatchObject({
      template: 'booking-moved',
      to: 'pat@example.com',
      idempotencyKey: job?.dedupe_key,
      data: {
        reference: expect.stringMatching(/^RMB-/) as string,
        manageUrl: expect.stringContaining(world.token) as string,
      },
    });
    const [session] = await client.db
      .select({ startsAt: schema.sessions.startsAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, date));
    expect(email?.data.calendar).toMatchObject({
      startsAt: session?.startsAt.toISOString(),
    });
    expect(await jobsOfKind('host-booking-notice')).toHaveLength(0);
  });

  it('sends one email per move, each with its own key, and the same key again for a retry', async () => {
    const world = await seedMovable();
    const second = await addDate(world);
    const third = await addDate(world, {
      startsInMinutes: (world.tierHours + 96) * 60,
    });
    await move(world, second);
    await move(world, third);

    await settle();

    const emails = sent();
    expect(emails).toHaveLength(2);
    expect(new Set(emails.map((email) => email.idempotencyKey)).size).toBe(2);
    // Each is the booking as it stands when the job runs, so both name the date it is on now.
    expect(emails[0]?.data.dayLabel).toBe(emails[1]?.data.dayLabel);
    const [first] = await jobsOfKind('guest-move-confirmation');
    sendEmail.mockClear();

    await runHandler(first?.payload);

    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.idempotencyKey).toBe(first?.dedupe_key);
  });

  it('skips a booking cancelled after the move, and the job succeeds', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    await move(world, date);
    await client.db
      .update(schema.orders)
      .set({
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: sql`clock_timestamp()`,
      })
      .where(eq(schema.orders.id, world.orderId));

    await settle();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(await jobsOfKind('guest-move-confirmation')).toMatchObject([
      { status: 'succeeded' },
    ]);
  });
});

describe('a job that should not exist', () => {
  it('is refused for an order that does not exist', async () => {
    await expect(
      runHandler({ orderId: randomUUID(), moveId: randomUUID() }),
    ).rejects.toThrow('no such booking');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is refused for an order that is not a confirmed booking', async () => {
    const world = await seedMovable();
    await client.db
      .update(schema.orders)
      .set({ status: 'refunded_after_lapse', confirmedAt: null })
      .where(eq(schema.orders.id, world.orderId));

    await expect(
      runHandler({ orderId: world.orderId, moveId: randomUUID() }),
    ).rejects.toThrow('not a confirmed booking');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is refused for an order whose manage link was voided, so no dead link is sent', async () => {
    const world = await seedMovable();
    await client.db
      .update(schema.orders)
      .set({ manageTokenVersion: 2 })
      .where(eq(schema.orders.id, world.orderId));

    await expect(
      runHandler({ orderId: world.orderId, moveId: randomUUID() }),
    ).rejects.toThrow('no live manage link');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('the registered kind', () => {
  it.each([
    ['a move id that is not a uuid', { orderId: randomUUID(), moveId: 'x' }],
    ['no move id', { orderId: randomUUID() }],
    ['an order id that is not one', { orderId: 'nope', moveId: randomUUID() }],
    [
      'an extra field',
      { orderId: randomUUID(), moveId: randomUUID(), email: 'a@b.c' },
    ],
  ])('refuses %s at enqueue', async (_name, payload) => {
    const { enqueue } = await import('@/server/jobs/enqueue');

    await expect(
      client.db.transaction((tx) =>
        enqueue(tx, { kind: 'guest-move-confirmation', payload }),
      ),
    ).rejects.toThrow();
  });
});

describe('the guest reminder follows a move', () => {
  const reminders = async () => {
    const rows = await client.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.kind, 'session-reminder'))
      .orderBy(schema.jobs.createdAt, schema.jobs.id);
    return rows.map((row) => ({
      status: row.status,
      dedupe_key: row.dedupeKey,
      run_after: row.runAfter,
      payload: row.payload as { orderId: string; moveId?: string },
    }));
  };
  const startOf = async (sessionId: string) => {
    const [row] = await client.db
      .select({ startsAt: schema.sessions.startsAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    if (!row) throw new Error('no session');
    return row.startsAt;
  };
  const queueReminder = async (world: MoveWorld) => {
    const { enqueueSessionReminder } =
      await import('@/server/db/sessionReminder');
    return client.db.transaction((tx) =>
      enqueueSessionReminder(tx, { orderId: world.orderId, now: new Date() }),
    );
  };
  const dayMs = 24 * 60 * 60 * 1000;
  const lastMoveId = async () => {
    const jobs = await jobsOfKind('guest-move-confirmation');
    return (jobs.at(-1)?.payload as { moveId: string }).moveId;
  };

  it('re-times a waiting reminder to 24 hours before a later date, and names the move', async () => {
    const world = await seedMovable();
    await queueReminder(world);
    const date = await addDate(world, { startsInMinutes: 60 * 24 * 40 });

    await move(world, date);

    const rows = await reminders();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.run_after).toEqual(
      new Date((await startOf(date)).getTime() - dayMs),
    );
    expect(rows[0]?.payload).toEqual({
      orderId: world.orderId,
      moveId: await lastMoveId(),
    });
    expect(rows[0]?.dedupe_key).toBe(`session-reminder:${world.orderId}`);
  });

  it('re-times a waiting reminder to an earlier date instead of skipping it', async () => {
    const world = await seedMovable({ startsInMinutes: 60 * 24 * 60 });
    await queueReminder(world);
    const [before] = await reminders();
    const date = await addDate(world);

    await move(world, date);

    const [after] = await reminders();
    expect(after?.run_after.getTime()).toBeLessThan(
      before?.run_after.getTime() ?? 0,
    );
    expect(after?.run_after).toEqual(
      new Date((await startOf(date)).getTime() - dayMs),
    );
  });

  it('queues a fresh reminder under the move key when the old one already succeeded, leaving the old row', async () => {
    const world = await seedMovable();
    await queueReminder(world);
    await client.db.execute(
      sql`UPDATE jobs SET status = 'succeeded', finished_at = now() WHERE kind = 'session-reminder'`,
    );
    const date = await addDate(world, { startsInMinutes: 60 * 24 * 40 });

    await move(world, date);

    const moveId = await lastMoveId();
    const rows = await reminders();
    expect(rows.map((row) => row.status)).toEqual(['succeeded', 'pending']);
    expect(rows[1]).toMatchObject({
      dedupe_key: `session-reminder-move:${moveId}`,
      payload: { orderId: world.orderId, moveId },
    });
    expect(rows[1]?.run_after).toEqual(
      new Date((await startOf(date)).getTime() - dayMs),
    );
    expect(rows[0]?.payload).toEqual({ orderId: world.orderId });
  });

  it('queues a reminder for a booking that never had one', async () => {
    const world = await seedMovable();
    const date = await addDate(world, { startsInMinutes: 60 * 24 * 40 });

    await move(world, date);

    expect(await reminders()).toHaveLength(1);
  });

  it.each([
    [
      'running',
      sql`status = 'running', locked_until = now() + interval '5 minutes'`,
    ],
    ['dead', sql`status = 'dead', finished_at = now()`],
  ])(
    'queues a fresh reminder under the move key when the old one is %s, leaving that row',
    async (status, set) => {
      const world = await seedMovable();
      await queueReminder(world);
      await client.db.execute(
        sql`UPDATE jobs SET ${set} WHERE kind = 'session-reminder'`,
      );
      const date = await addDate(world, { startsInMinutes: 60 * 24 * 40 });

      await move(world, date);

      const moveId = await lastMoveId();
      const rows = await reminders();
      expect(rows.map((row) => row.status)).toEqual([status, 'pending']);
      expect(rows[0]?.payload).toEqual({ orderId: world.orderId });
      expect(rows[1]).toMatchObject({
        dedupe_key: `session-reminder-move:${moveId}`,
        payload: { orderId: world.orderId, moveId },
      });
    },
  );

  it('judges the reminder again under the lock when a drain claims it first', async () => {
    const world = await seedMovable();
    await queueReminder(world);
    const { retimeSessionReminder } =
      await import('@/server/db/sessionReminder');
    const moveId = randomUUID();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A drain's claim: the row is running and locked by a transaction that has not committed yet.
    const drain = client.db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE jobs SET status = 'running', locked_until = now() + interval '5 minutes' WHERE kind = 'session-reminder'`,
      );
      locked();
      await held;
    });
    await lockTaken;

    const retime = client.db.transaction((tx) =>
      retimeSessionReminder(tx, {
        orderId: world.orderId,
        moveId,
        now: new Date(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await Promise.all([drain, retime]);

    expect((await reminders()).map((row) => row.status)).toEqual([
      'running',
      'pending',
    ]);
  });

  it('leaves exactly one waiting reminder after two moves, due for the last date', async () => {
    const world = await seedMovable();
    await queueReminder(world);
    const second = await addDate(world, { startsInMinutes: 60 * 24 * 40 });
    const third = await addDate(world, { startsInMinutes: 60 * 24 * 50 });

    await move(world, second);
    await move(world, third);

    const waiting = (await reminders()).filter(
      (row) => row.status === 'pending',
    );
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.run_after).toEqual(
      new Date((await startOf(third)).getTime() - dayMs),
    );
    expect(waiting[0]?.payload.moveId).toBe(await lastMoveId());
  });

  it('changes no reminder for a move that is refused', async () => {
    const world = await seedMovable();
    await queueReminder(world);
    const [before] = await reminders();

    const result = await move(world, world.sessionId);

    expect(result).toMatchObject({ status: 'same_date' });
    expect(await reminders()).toEqual([before]);
  });
});

describe('the reminder email key and payload', () => {
  const orderId = randomUUID();

  it('sends under the order key with no move id, and under another key per move id', async () => {
    const world = await seedMovable();
    const { sendSessionReminder } = await import('@/server/jobs/bookingEmails');
    const run = (payload: { orderId: string; moveId?: string }) =>
      client.db.transaction((tx) =>
        sendSessionReminder({
          tx,
          payload,
          jobId: randomUUID(),
          clock: { now: () => new Date() },
        }),
      );
    const moveId = randomUUID();

    await run({ orderId: world.orderId });
    await run({ orderId: world.orderId, moveId });

    expect(sent().map((email) => email.idempotencyKey)).toEqual([
      `session-reminder:${world.orderId}`,
      `session-reminder:${world.orderId}:${moveId}`,
    ]);
  });

  it.each([
    ['a move id that is not a uuid', { orderId, moveId: 'x' }],
    ['an extra field', { orderId, email: 'a@b.c' }],
  ])('refuses %s at enqueue', async (_name, payload) => {
    const { enqueue } = await import('@/server/jobs/enqueue');

    await expect(
      client.db.transaction((tx) =>
        enqueue(tx, { kind: 'session-reminder', payload }),
      ),
    ).rejects.toThrow();
  });

  it('lower-cases the move id', async () => {
    const { SessionReminderPayloadSchema } =
      await import('@/server/jobs/bookingEmails');
    const moveId = randomUUID();

    expect(
      SessionReminderPayloadSchema.parse({
        orderId,
        moveId: moveId.toUpperCase(),
      }).moveId,
    ).toBe(moveId);
  });
});
