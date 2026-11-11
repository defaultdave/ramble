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
