import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dueClock } from '../support/dueClock';
import { seedCancellable } from './cancelFixtures';
import {
  ask,
  client,
  clearJobs,
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

// Behaviours under test, one per decision, branch, or risk (the fake payment adapter; the job handlers and the drain):
// - end to end: a guest's cancellation, drained, emails the guest a cancellation with the refund line, emails the host a
//   cancellation notice with no refund line, and, once the provider confirms the refund, emails the guest the refund
//   with its amount; each message has its own idempotency key
// - a cancellation with no refund tells the guest no refund is due, and queues no refund email
// - a refund for another reason (a goodwill refund) sends no refund email
// - a job that should not exist is refused, and sends nothing: a cancellation email for an order that is still confirmed
//   or missing, a host with no notification address, a refund email for a refund that has not succeeded or does not exist
// - the three kinds are registered with strict payloads

const hostEmail = 'bookings@harborlight.example';

beforeEach(async () => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ messageId: 'm', status: 'sent' });
  await client.db.update(schema.hosts).set({ notificationEmail: hostEmail });
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

async function cancelAndSettle(
  over: Parameters<typeof seedCancellable>[0],
  expected: number,
) {
  await clearJobs();
  const world = await seedCancellable({ gatewayPayment: true, ...over });
  const { cancelBooking } = await import('@/server/actions/orders');
  const result = await cancelBooking({
    manageToken: world.token,
    expectedRefundMinor: expected,
  });
  expect(result.status).toBe('cancelled');
  await settle();
  return world;
}

describe('the emails of a cancellation, end to end', () => {
  it('emails the guest, the host, and the guest again when the refund goes through', async () => {
    const world = await cancelAndSettle({}, 13_000);

    const emails = sent();
    expect(emails.map((email) => email.template).sort()).toEqual([
      'booking-cancellation',
      'booking-cancellation',
      'booking-refund',
    ]);
    const guest = emails.find(
      (email) =>
        email.template === 'booking-cancellation' &&
        email.to === 'pat@example.com',
    );
    expect(guest).toMatchObject({
      idempotencyKey: `guest-cancellation:${world.orderId}`,
      data: {
        audience: 'guest',
        reasonLine: 'You cancelled this booking.',
        refundLine:
          'Your refund of $130.00 goes back to your original payment method.',
        otherDatesUrl: null,
      },
    });
    const host = emails.find((email) => email.to === hostEmail);
    expect(host).toMatchObject({
      template: 'booking-cancellation',
      idempotencyKey: `host-cancellation-notice:${world.orderId}`,
      data: {
        audience: 'host',
        reasonLine: 'The guest cancelled this booking.',
        refundLine: null,
      },
    });
    const refund = emails.find((email) => email.template === 'booking-refund');
    expect(refund).toMatchObject({
      to: 'pat@example.com',
      data: { amount: '$130.00' },
    });
    expect(refund?.idempotencyKey).toMatch(/^guest-refund:[0-9a-f-]{36}$/);
    expect(await jobsOfKind('guest-refund')).toMatchObject([
      { status: 'succeeded' },
    ]);
    expect(raise).not.toHaveBeenCalled();
  });

  it('tells the guest no refund is due, and queues no refund email, when nothing is refunded', async () => {
    await cancelAndSettle({ freeCancelInMinutes: -1 }, 0);

    expect(
      sent().find((email) => email.to === 'pat@example.com'),
    ).toMatchObject({
      data: { refundLine: 'No refund is due under the cancellation terms.' },
    });
    expect(
      sent().filter((email) => email.template === 'booking-refund'),
    ).toHaveLength(0);
    expect(await jobsOfKind('guest-refund')).toHaveLength(0);
  });

  it('queues no refund email, and sends none, for a refund that is not a guest cancellation', async () => {
    await clearJobs();
    const world = await seedCancellable({ gatewayPayment: true });
    await ask(world, {
      reason: 'goodwill',
      key: 'goodwill',
      ticketMinor: 1_000,
    });

    await settle();

    expect(await jobsOfKind('guest-refund')).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  it('emails the refund amount, ticket and tax, for a taxed order', async () => {
    await cancelAndSettle({ taxable: true }, 18_509);

    const refund = sent().find((email) => email.template === 'booking-refund');
    expect(refund?.data).toMatchObject({ amount: '$185.09' });
  });

  it('queues and sends one refund email for each refund, each under its own key', async () => {
    await clearJobs();
    const world = await seedCancellable({ gatewayPayment: true });
    await ask(world, { key: 'first', ticketMinor: 5_000 });
    await ask(world, { key: 'second', ticketMinor: 8_000 });

    await settle();

    const jobs = await jobsOfKind('guest-refund');
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.dedupe_key)).size).toBe(2);
    const refunds = sent().filter(
      (email) => email.template === 'booking-refund',
    );
    expect(refunds.map((email) => email.data.amount).sort()).toEqual(
      ['$50.00', '$80.00'].sort(),
    );
    expect(new Set(refunds.map((email) => email.idempotencyKey)).size).toBe(2);
  });
});

describe('a job that should not exist', () => {
  const run = async (
    kind: 'guest-cancellation' | 'host-cancellation-notice' | 'guest-refund',
    payload: unknown,
  ) => {
    const handlers = await import('@/server/jobs/cancellationEmails');
    const handler = {
      'guest-cancellation': handlers.sendGuestCancellation,
      'host-cancellation-notice': handlers.sendHostCancellationNotice,
      'guest-refund': handlers.sendGuestRefund,
    }[kind];
    return client.db.transaction((tx) =>
      handler({ tx, payload: payload as never, jobId: randomUUID() }),
    );
  };

  it.each([
    ['guest-cancellation', { refundMinor: 0 }],
    ['host-cancellation-notice', {}],
  ] as const)(
    'is refused for %s of an order that is still confirmed',
    async (kind, extra) => {
      const world = await seedCancellable();

      await expect(
        run(kind, { orderId: world.orderId, cancelledBy: 'guest', ...extra }),
      ).rejects.toThrow('not a cancelled booking');
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

  it('is refused for an order that does not exist', async () => {
    await expect(
      run('guest-cancellation', {
        orderId: randomUUID(),
        cancelledBy: 'guest',
        refundMinor: 0,
      }),
    ).rejects.toThrow('no such booking');
  });

  it('is refused for a host with no notification address', async () => {
    const world = await seedCancellable();
    await client.db
      .update(schema.orders)
      .set({
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: sql`clock_timestamp()`,
      })
      .where(eq(schema.orders.id, world.orderId));
    await client.db
      .update(schema.hosts)
      .set({ notificationEmail: null })
      .where(eq(schema.hosts.id, world.hostId));

    await expect(
      run('host-cancellation-notice', {
        orderId: world.orderId,
        cancelledBy: 'guest',
      }),
    ).rejects.toThrow('no notification address');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is refused for a refund that has not succeeded, or does not exist', async () => {
    const world = await seedCancellable({ gatewayPayment: true });
    const requested = await ask(world);
    if (requested.status !== 'requested') throw new Error('not requested');

    await expect(
      run('guest-refund', { refundId: requested.refund.refundId }),
    ).rejects.toThrow('has not succeeded');
    await expect(
      run('guest-refund', { refundId: randomUUID() }),
    ).rejects.toThrow('no such refund');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('the job kinds', () => {
  it.each([
    [
      'guest-cancellation',
      { orderId: randomUUID(), cancelledBy: 'guest', refundMinor: 5, extra: 1 },
    ],
    [
      'guest-cancellation',
      { orderId: randomUUID(), cancelledBy: 'someone', refundMinor: 5 },
    ],
    [
      'guest-cancellation',
      { orderId: randomUUID(), cancelledBy: 'guest', refundMinor: -1 },
    ],
    [
      'host-cancellation-notice',
      { orderId: 'not-a-uuid', cancelledBy: 'guest' },
    ],
    ['guest-refund', { refundId: randomUUID(), orderId: randomUUID() }],
  ])('refuses a bad %s payload at enqueue', async (kind, payload) => {
    const { enqueue } = await import('@/server/jobs/enqueue');

    await expect(
      client.db.transaction((tx) => enqueue(tx, { kind, payload })),
    ).rejects.toThrow();
  });
});
