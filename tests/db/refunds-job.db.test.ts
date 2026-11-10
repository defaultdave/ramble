import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { processRefundKind } from '@/lib/refunds';
import { PaymentsError } from '@/server/ports/payments';
import { dueClock } from '../support/dueClock';
import {
  ask,
  balancesOf,
  client,
  clearJobs,
  drain,
  gateway,
  jobsOfKind,
  ledgerOf,
  orderOf,
  refundJob,
  refundsOf,
  schema,
  seedPaidOrder,
  setupRefundsDatabase,
  type PaidOrder,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (all on the fake payment adapter):
// - end to end: a requested refund, drained, is sent to the provider with the order's and the refund's ids, its event is
//   stored once and drained, and the refund is succeeded, the cash posted, and the fake's balance down by the amount
// - end to end with a payment set to fail its refunds: the refund fails, every leg and the totals are put back, the fake's
//   balance is unchanged, and the order is flagged for ops
// - the job is safe to run twice: a second send (a crash after the provider call) gets the same provider refund, stores no
//   second event, and moves no second amount; a refund that is no longer pending is not sent
// - a provider error fails the try and leaves the refund pending with no event; a provider id that differs from the one kept throws
// - the job kind is registered with a strict payload

const settle = async () => {
  for (let round = 0; round < 4; round += 1) {
    const report = await drain.drainJobs(dueClock);
    if (report.succeeded + report.retried + report.dead === 0) return;
  }
};

async function requestedRefund(
  world: PaidOrder,
  over: Parameters<typeof ask>[1] = {},
) {
  const result = await ask(world, over);
  if (result.status !== 'requested') throw new Error('not requested');
  return result.refund;
}

const fakeBalance = async () =>
  (await gateway.getFakePayments().getBalance()).availableMinor;

const eventsOf = (refundId: string) =>
  client.db
    .select()
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.rambleRecordId, refundId));

describe('the refund job, end to end', () => {
  it('sends the refund, takes its event, and posts the cash', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ taxable: true, gatewayPayment: true });
    const balance = await fakeBalance();
    const refund = await requestedRefund(world, { ticketMinor: 8_500 });

    await settle();

    const [row] = await refundsOf(world);
    expect(row).toMatchObject({ status: 'succeeded' });
    expect(row?.providerRefundId).toMatch(/^re_[0-9a-f]{24}$/);
    const sent = await gateway.getFakePayments().retrieve({
      kind: 'refund',
      metadata: { orderId: world.orderId, recordId: refund.refundId },
    });
    expect(sent).toMatchObject({
      id: row?.providerRefundId,
      paymentId: world.paymentId,
      amountMinor: 9_255,
      status: 'succeeded',
    });
    expect(await fakeBalance()).toBe(balance - 9_255);
    const cash = (await ledgerOf(world)).filter(
      (entry) => entry.entryType === 'refund_cash_out',
    );
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({
      amountMinor: 9_255,
      providerObjectId: row?.providerRefundId,
    });
    expect((await balancesOf(world)).refunds_pending).toBe(0);
    expect(await eventsOf(refund.refundId)).toHaveLength(1);
    expect((await eventsOf(refund.refundId))[0]?.processedAt).not.toBeNull();
    expect(
      (await jobsOfKind(processRefundKind)).map((job) => job.status),
    ).toEqual(['succeeded']);
    expect(raise).not.toHaveBeenCalled();
  });

  it('fails the refund when the provider fails it, and puts everything back', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ gatewayPayment: true });
    const untouched = await balancesOf(world);
    const balance = await fakeBalance();
    await gateway.getFakePayments().setRefundOutcome(world.paymentId, {
      outcome: 'failed',
      failureCode: 'expired_or_canceled_card',
    });
    const refund = await requestedRefund(world);

    await settle();

    expect((await refundsOf(world))[0]).toMatchObject({
      status: 'failed',
      succeededAt: null,
    });
    expect(await orderOf(world)).toMatchObject({
      refundedTicketMinor: 0,
      refundedTaxMinor: 0,
      commissionReturnedMinor: 0,
      refundFailed: true,
    });
    expect(await balancesOf(world)).toEqual(untouched);
    expect(await fakeBalance()).toBe(balance);
    expect(
      (await ledgerOf(world)).filter(
        (entry) => entry.entryType === 'refund_cash_out',
      ),
    ).toHaveLength(0);
    expect(await eventsOf(refund.refundId)).toHaveLength(1);
  });
});

describe('running the refund job twice', () => {
  it('sends the same provider refund, stores one event, and moves the money once', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ gatewayPayment: true });
    const balance = await fakeBalance();
    const refund = await requestedRefund(world, { ticketMinor: 4_000 });

    const first = await refundJob.prepareRefund({ refundId: refund.refundId });
    const second = await refundJob.prepareRefund({ refundId: refund.refundId });

    expect(second).toEqual(first);
    expect(first).toMatchObject({ refundId: refund.refundId });
    expect(await eventsOf(refund.refundId)).toHaveLength(1);
    expect(await fakeBalance()).toBe(balance - 4_000);
    expect(
      await gateway
        .getFakePayments()
        .retrieve({ kind: 'payment', id: world.paymentId }),
    ).toMatchObject({ refundedMinor: 4_000 });
  });

  it('keeps the provider id once, and refuses a different one', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ gatewayPayment: true });
    const refund = await requestedRefund(world);
    const prepared = await refundJob.prepareRefund({
      refundId: refund.refundId,
    });
    const run = (providerRefundId: string) =>
      client.db.transaction((tx) =>
        refundJob.handleRefund({
          tx,
          payload: { refundId: refund.refundId },
          prepared: { refundId: refund.refundId, providerRefundId },
          jobId: randomUUID(),
          clock: { now: () => new Date() },
        }),
      );

    await run(prepared?.providerRefundId ?? '');
    await run(prepared?.providerRefundId ?? '');
    expect((await refundsOf(world))[0]?.providerRefundId).toBe(
      prepared?.providerRefundId,
    );
    await expect(run('re_another')).rejects.toThrow();
  });

  it('does nothing for a job whose refund is no longer pending, and does not call the provider', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ gatewayPayment: true });
    const refund = await requestedRefund(world);
    await settle();
    expect((await refundsOf(world))[0]?.status).toBe('succeeded');
    const send = vi.spyOn(gateway.getFakePayments(), 'refund');

    expect(
      await refundJob.prepareRefund({ refundId: refund.refundId }),
    ).toBeNull();
    await client.db.transaction((tx) =>
      refundJob.handleRefund({
        tx,
        payload: { refundId: refund.refundId },
        prepared: null,
        jobId: randomUUID(),
        clock: { now: () => new Date() },
      }),
    );

    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
});

describe('a refund the provider will not take', () => {
  it('fails the try, leaves the refund pending with no event, and succeeds on the next try', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ gatewayPayment: true });
    const refund = await requestedRefund(world);
    const send = vi
      .spyOn(gateway.getFakePayments(), 'refund')
      .mockRejectedValueOnce(new PaymentsError('provider_unavailable'));

    await expect(
      refundJob.prepareRefund({ refundId: refund.refundId }),
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
    });

    expect((await refundsOf(world))[0]?.status).toBe('pending');
    expect(await eventsOf(refund.refundId)).toHaveLength(0);
    expect(
      await refundJob.prepareRefund({ refundId: refund.refundId }),
    ).toMatchObject({
      refundId: refund.refundId,
    });
    send.mockRestore();
  });

  it('retries the job with a backoff when the provider is unavailable, and never fails the refund itself', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ gatewayPayment: true });
    await requestedRefund(world);
    const send = vi
      .spyOn(gateway.getFakePayments(), 'refund')
      .mockRejectedValue(new PaymentsError('provider_unavailable'));

    const report = await drain.drainJobs(dueClock);

    expect(report).toMatchObject({ retried: 1, dead: 0 });
    expect((await refundsOf(world))[0]?.status).toBe('pending');
    expect((await orderOf(world)).refundFailed).toBe(false);
    send.mockRestore();
  });

  it('throws for a refund that does not exist, and for a payment the attempt never recorded', async () => {
    await expect(
      refundJob.prepareRefund({ refundId: randomUUID() }),
    ).rejects.toThrow();
    const world = await seedPaidOrder({ gatewayPayment: true });
    const refund = await requestedRefund(world);
    await client.db
      .update(schema.paymentAttempts)
      .set({ providerPaymentId: null })
      .where(eq(schema.paymentAttempts.id, world.attemptId));

    await expect(
      refundJob.prepareRefund({ refundId: refund.refundId }),
    ).rejects.toThrow();
  });
});

describe('the refund job kind', () => {
  it('is registered and refuses a payload with anything but a refund id', async () => {
    const { enqueue } = await import('@/server/jobs/enqueue');
    const attempt = (payload: unknown) =>
      client.db.transaction((tx) =>
        enqueue(tx, { kind: processRefundKind, payload }),
      );

    await expect(attempt({ refundId: 'nope' })).rejects.toThrow();
    await expect(
      attempt({ refundId: randomUUID(), extra: 1 }),
    ).rejects.toThrow();
    await clearJobs();
    expect((await attempt({ refundId: randomUUID() }))?.id).toBeTruthy();
    await client.db.execute(sql`DELETE FROM jobs`);
  });
});
