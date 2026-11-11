import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dueClock } from '../support/dueClock';
import {
  newSession,
  ops,
  seedConfirmedOn,
  seedUnpaidOn,
} from './cancelSessionFixtures';
import { insertSession } from './holdFixtures';
import { createOrderParents } from './orderParents';
import {
  client,
  clearJobs,
  drain,
  getParents,
  jobsOfKind,
  refundsOf,
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

// Behaviours under test, one per decision, branch, or risk (`cancelSession`, the guest cancellation job, the fake payment adapter):
// - end to end: a host's cancellation, drained at once, sends each guest one email that says the host cancelled, the full
//   refund, and a link to the experience's other dates; the refund job runs and the refund email is not sent for it
// - the link appears for another scheduled session that starts after now (a minute out) and for none of: the cancelled
//   session itself, another session of the experience that is cancelled, one that started a minute ago, or another experience's
// - a guest who cancelled their own booking gets no link, whatever else the experience has
// - the email job is due the moment the cancellation commits, so the drain sends it with no wait
// - an unpaid order gets no email

const minuteMs = 60_000;

beforeEach(async () => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ messageId: 'm', status: 'sent' });
  await clearJobs();
  // Sessions of earlier tests are still the experience's other dates unless they are out of the way.
  await client.db
    .update(schema.sessions)
    .set({ status: 'cancelled', cancelReason: 'ramble' });
  await client.db.update(schema.hosts).set({ notificationEmail: null });
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

const cancel = async (sessionId: string) => {
  const { cancelSession } = await import('@/server/db/cancelSession');
  return cancelSession(ops, { sessionId, reason: 'host' });
};

const experiencePage = () =>
  `http://localhost:3000/experiences/experience-refunds-${getParents().experienceId}`;

describe('the email each guest gets', () => {
  it('says the host cancelled, the full refund, and where the other dates are', async () => {
    const session = await newSession();
    await newSession({ startsAt: new Date(Date.now() + 9 * 86_400_000) });
    const booking = await seedConfirmedOn(session.id);
    await cancel(session.id);

    await settle();

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      template: 'booking-cancellation',
      to: 'pat@example.com',
      idempotencyKey: `guest-cancellation:${booking.orderId}`,
      data: {
        audience: 'guest',
        reasonLine: 'The host cancelled this session.',
        refundLine:
          'Your refund of $130.00 goes back to your original payment method.',
        otherDatesUrl: experiencePage(),
      },
    });
    expect(await jobsOfKind('process-refund')).toMatchObject([
      { status: 'succeeded' },
    ]);
    expect((await refundsOf(booking))[0]?.status).toBe('succeeded');
    expect(await jobsOfKind('guest-refund')).toHaveLength(0);
    expect(raise).not.toHaveBeenCalled();
  });

  it('has its job due when the cancellation commits', async () => {
    const session = await newSession();
    await seedConfirmedOn(session.id);
    await cancel(session.id);

    const { rows } = await client.db.execute<{ due: boolean }>(
      sql`SELECT run_after <= now() AS due FROM jobs WHERE kind = 'guest-cancellation'`,
    );

    expect(rows).toEqual([{ due: true }]);
  });

  it('is not sent for an unpaid order', async () => {
    const session = await newSession();
    await seedUnpaidOn(session.id);
    await cancel(session.id);

    await settle();

    expect(sent()).toHaveLength(0);
  });
});

describe('the link to other dates', () => {
  type Seed = (sessionId: string) => Promise<unknown>;

  const inMinutes = (minutes: number) =>
    new Date(Date.now() + minutes * minuteMs);

  it.each<[string, Seed, boolean]>([
    [
      'another scheduled session a minute from now',
      () => newSession({ startsAt: inMinutes(1) }),
      true,
    ],
    ['no other session', () => Promise.resolve(), false],
    [
      'another session that is cancelled',
      () => newSession({ status: 'cancelled', cancelReason: 'ramble' }),
      false,
    ],
    [
      'another session that started a minute ago',
      () => newSession({ startsAt: inMinutes(-1) }),
      false,
    ],
    [
      'a session of another experience',
      async () => {
        const other = await createOrderParents(client.db, 'elsewhere');
        return insertSession(client.db, other.experienceId, {});
      },
      false,
    ],
  ])('for %s', async (_name, seedOther, linked) => {
    const session = await newSession({ startsAt: inMinutes(-60) });
    await seedOther(session.id);
    await seedConfirmedOn(session.id);
    await cancel(session.id);

    await settle();

    expect(sent()[0]?.data.otherDatesUrl).toBe(
      linked ? experiencePage() : null,
    );
  });

  it('is left out for a guest who cancelled their own booking', async () => {
    const session = await newSession();
    await newSession({ startsAt: new Date(Date.now() + 9 * 86_400_000) });
    const booking = await seedConfirmedOn(session.id);
    await client.db
      .update(schema.orders)
      .set({
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: sql`clock_timestamp()`,
      })
      .where(eq(schema.orders.id, booking.orderId));
    const { enqueue } = await import('@/server/jobs/enqueue');
    await client.db.transaction((tx) =>
      enqueue(tx, {
        kind: 'guest-cancellation',
        payload: {
          orderId: booking.orderId,
          cancelledBy: 'guest',
          refundMinor: 0,
        },
      }),
    );

    await settle();

    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.data).toMatchObject({
      reasonLine: 'You cancelled this booking.',
      otherDatesUrl: null,
    });
  });
});
