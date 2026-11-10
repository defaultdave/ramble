import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { refundsReconcile } from '@/lib/refunds';
import { backendPid, waitUntilBlocked } from './harness';
import {
  ask,
  balancesOf,
  client,
  eventRow,
  handleEvent,
  ledgerOf,
  orderOf,
  refundEvent,
  refundsOf,
  schema,
  seedPaidOrder,
  setupRefundsDatabase,
  side,
  storeEvent,
  type PaidOrder,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk:
// - refund.succeeded: the refund is succeeded with the provider's id and time, the cash leaves platform_cash once under the
//   provider's refund id, refunds_pending empties, the order's totals stay; a second event for it changes nothing
// - refund.failed: the refund is failed, the three reversal rows put every leg back so the balances are what they were before the
//   request, the order's totals give the parts back (only the failed refund's, when another stands), refund_failed is set,
//   and the order can be refunded again under a new key
// - an event that names no refund of Ramble's, another order's refund, no order, another amount, another provider id, or
//   that contradicts a finished refund writes nothing and is retried with backoff, alerting on the 5th try
// - the refund row is read under its lock: an event that waits for another change to the refund judges what that left
//   (fails if the lock is removed); so are the order's totals: a failure that waits for another change to them gives back only
//   its own parts (fails if the order lock is removed)

async function requested(
  world: PaidOrder,
  over: Parameters<typeof ask>[1] = {},
) {
  const result = await ask(world, over);
  if (result.status !== 'requested') throw new Error('not requested');
  return result.refund;
}

const standing = async (world: PaidOrder) => {
  const order = await orderOf(world);
  return {
    order,
    refunds: await refundsOf(world),
    ledger: await ledgerOf(world),
  };
};

describe('refund.succeeded', () => {
  it('succeeds the refund and posts the cash once, under the provider refund id', async () => {
    const world = await seedPaidOrder({ taxable: true });
    const refund = await requested(world, { ticketMinor: 8_500 });
    const before = await balancesOf(world);
    const event = refundEvent(
      world,
      { id: refund.refundId, amountMinor: refund.amountMinor },
      'refund.succeeded',
    );

    const id = await storeEvent(event);
    await handleEvent(id);

    const [row] = await refundsOf(world);
    expect(row).toMatchObject({
      status: 'succeeded',
      providerRefundId: event.objectId,
    });
    expect(row?.succeededAt?.getTime()).toBeGreaterThanOrEqual(
      row?.createdAt.getTime() ?? Infinity,
    );
    const cash = (await ledgerOf(world)).filter(
      (entry) => entry.entryType === 'refund_cash_out',
    );
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({
      amountMinor: 9_255,
      providerObjectId: event.objectId,
      refundId: refund.refundId,
      orderId: world.orderId,
      hostId: world.hostId,
      paymentAttemptId: world.attemptId,
      simulated: true,
    });
    const after = await balancesOf(world);
    expect(after.refunds_pending).toBe(0);
    expect(after.platform_cash).toBe(before.platform_cash - 9_255);
    expect(after.host_payable).toBe(before.host_payable);
    expect(await orderOf(world)).toMatchObject({
      refundedTicketMinor: 8_500,
      refundFailed: false,
    });
    expect((await eventRow(id)).processedAt).not.toBeNull();
  });

  it('answers a processed event again without writing, and a second event for the refund changes nothing', async () => {
    const world = await seedPaidOrder();
    const refund = await requested(world);
    const facts = { id: refund.refundId, amountMinor: refund.amountMinor };
    const first = await storeEvent(
      refundEvent(world, facts, 'refund.succeeded'),
    );
    await handleEvent(first);
    const before = await standing(world);

    await handleEvent(first);
    const second = await storeEvent(
      refundEvent(world, facts, 'refund.succeeded', {
        objectId: (await refundsOf(world))[0]?.providerRefundId ?? '',
      }),
    );
    await handleEvent(second);

    expect(await standing(world)).toEqual(before);
    expect((await eventRow(second)).processedAt).not.toBeNull();
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('refund.failed', () => {
  it('fails the refund and puts every leg and the order totals back', async () => {
    const world = await seedPaidOrder({ taxable: true });
    const untouched = await balancesOf(world);
    const refund = await requested(world, { ticketMinor: 8_500 });
    const event = refundEvent(
      world,
      { id: refund.refundId, amountMinor: refund.amountMinor },
      'refund.failed',
    );

    const id = await storeEvent(event);
    await handleEvent(id);

    const [row] = await refundsOf(world);
    expect(row).toMatchObject({
      status: 'failed',
      providerRefundId: event.objectId,
      succeededAt: null,
    });
    expect(await orderOf(world)).toMatchObject({
      refundedTicketMinor: 0,
      refundedTaxMinor: 0,
      commissionReturnedMinor: 0,
      refundFailed: true,
    });
    const reversals = (await ledgerOf(world)).filter(
      (entry) => entry.entryType === 'refund_reversal',
    );
    expect(
      reversals.map((entry) => entry.amountMinor).sort((a, b) => a - b),
    ).toEqual([755, 1_275, 7_225]);
    expect(
      reversals.every(
        (entry) => entry.refundId === refund.refundId && entry.simulated,
      ),
    ).toBe(true);
    expect(await balancesOf(world)).toEqual(untouched);
    expect((await eventRow(id)).processedAt).not.toBeNull();
  });

  it('gives back only the failed refund when another stands, and the order can be refunded again', async () => {
    const world = await seedPaidOrder({ taxable: true });
    const kept = await requested(world, { key: 'kept', ticketMinor: 5_000 });
    const lost = await requested(world, { key: 'lost', ticketMinor: 6_000 });
    await handleEvent(
      await storeEvent(
        refundEvent(
          world,
          { id: lost.refundId, amountMinor: lost.amountMinor },
          'refund.failed',
        ),
      ),
    );

    const order = await orderOf(world);
    expect(order).toMatchObject({
      refundedTicketMinor: 5_000,
      refundedTaxMinor: kept.taxMinor,
      commissionReturnedMinor: kept.commissionReturnedMinor,
    });
    expect(refundsReconcile(order, await refundsOf(world))).toBe(true);

    const again = await ask(world, { key: 'retry', ticketMinor: 'remaining' });
    expect(again).toMatchObject({
      status: 'requested',
      refund: { ticketMinor: 12_000 },
    });
  });
});

describe('an event that cannot be applied', () => {
  it.each([
    ['another amount', null, { amountMinor: 1 }],
    ['no amount', null, { amountMinor: null, currency: null }],
    ['another provider refund id than the one kept', 're_kept', {}],
  ] as const)(
    'leaves a success with %s retrying, and writes nothing',
    async (_name, kept, over) => {
      const world = await seedPaidOrder();
      const refund = await requested(world);
      if (kept) {
        await client.db
          .update(schema.refunds)
          .set({ providerRefundId: kept })
          .where(eq(schema.refunds.id, refund.refundId));
      }
      const before = await standing(world);
      const id = await storeEvent(
        refundEvent(
          world,
          { id: refund.refundId, amountMinor: refund.amountMinor },
          'refund.succeeded',
          over,
        ),
      );

      await handleEvent(id);

      expect(await standing(world)).toEqual(before);
      expect(await eventRow(id)).toMatchObject({
        processedAt: null,
        attempts: 1,
      });
    },
  );

  it.each([
    [
      'a refund Ramble does not have',
      (world: PaidOrder) =>
        refundEvent(
          world,
          { id: randomUUID(), amountMinor: 1_000 },
          'refund.succeeded',
        ),
    ],
    [
      'no ids at all',
      (world: PaidOrder) =>
        refundEvent(
          world,
          { id: randomUUID(), amountMinor: 1_000 },
          'refund.succeeded',
          { metadata: null },
        ),
    ],
  ])(
    'leaves an event for %s retrying, and writes nothing',
    async (_name, make) => {
      const world = await seedPaidOrder();
      await requested(world);
      const before = await standing(world);
      const id = await storeEvent(make(world));

      await handleEvent(id);

      expect(await standing(world)).toEqual(before);
      expect(await eventRow(id)).toMatchObject({
        processedAt: null,
        attempts: 1,
      });
    },
  );

  it('does not apply an event to the refund of another order', async () => {
    const world = await seedPaidOrder();
    const other = await seedPaidOrder();
    const refund = await requested(world);
    const otherBefore = await standing(other);
    const id = await storeEvent(
      refundEvent(
        other,
        { id: refund.refundId, amountMinor: refund.amountMinor },
        'refund.succeeded',
      ),
    );

    await handleEvent(id);

    expect((await refundsOf(world))[0]?.status).toBe('pending');
    expect(await standing(other)).toEqual(otherBefore);
    expect(await eventRow(id)).toMatchObject({
      processedAt: null,
      attempts: 1,
    });
  });

  it.each([
    ['a failure after a success', 'refund.succeeded', 'refund.failed'],
    ['a success after a failure', 'refund.failed', 'refund.succeeded'],
  ] as const)(
    'leaves %s retrying, and the refund as it was',
    async (_name, first, second) => {
      const world = await seedPaidOrder();
      const refund = await requested(world);
      const facts = { id: refund.refundId, amountMinor: refund.amountMinor };
      await handleEvent(await storeEvent(refundEvent(world, facts, first)));
      const before = await standing(world);
      const id = await storeEvent(refundEvent(world, facts, second));

      await handleEvent(id);

      expect(await standing(world)).toEqual(before);
      expect(await eventRow(id)).toMatchObject({
        processedAt: null,
        attempts: 1,
      });
    },
  );

  it('alerts when the 5th try is spent', async () => {
    const world = await seedPaidOrder();
    await requested(world);
    const id = await storeEvent(
      refundEvent(
        world,
        { id: randomUUID(), amountMinor: 1_000 },
        'refund.succeeded',
      ),
    );

    for (let tries = 0; tries < 4; tries += 1) await handleEvent(id);
    expect(raise).not.toHaveBeenCalled();
    await handleEvent(id);

    expect(raise).toHaveBeenCalledWith(
      'payment-event-unmatched',
      'error',
      expect.any(String),
      expect.objectContaining({ eventId: id, tries: 5 }),
    );
  });
});

describe('an event that waits for a lock', () => {
  it('judges the refund another writer left: a failure that waits for a success does not undo it', async () => {
    const world = await seedPaidOrder();
    const refund = await requested(world);
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM refunds WHERE id = $1 FOR UPDATE', [
      refund.refundId,
    ]);
    const id = await storeEvent(
      refundEvent(
        world,
        { id: refund.refundId, amountMinor: refund.amountMinor },
        'refund.failed',
      ),
    );

    const handled = handleEvent(id);
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await holder.query(
      `UPDATE refunds SET status = 'succeeded', succeeded_at = clock_timestamp(), provider_refund_id = 're_won' WHERE id = $1`,
      [refund.refundId],
    );
    await holder.query('COMMIT');
    holder.release();
    await handled;

    expect((await refundsOf(world))[0]).toMatchObject({
      status: 'succeeded',
      providerRefundId: 're_won',
    });
    expect(
      (await ledgerOf(world)).filter(
        (entry) => entry.entryType === 'refund_reversal',
      ),
    ).toHaveLength(0);
    expect(await orderOf(world)).toMatchObject({
      refundFailed: false,
      refundedTicketMinor: 13_000,
    });
    expect(await eventRow(id)).toMatchObject({
      processedAt: null,
      attempts: 1,
    });
  });

  it('judges the order totals another writer left: a failure that waits gives back only its own parts', async () => {
    const world = await seedPaidOrder();
    const refund = await requested(world, { ticketMinor: 5_000 });
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
      world.orderId,
    ]);
    const id = await storeEvent(
      refundEvent(
        world,
        { id: refund.refundId, amountMinor: refund.amountMinor },
        'refund.failed',
      ),
    );

    const handled = handleEvent(id);
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await holder.query(
      'UPDATE orders SET refunded_ticket_minor = refunded_ticket_minor + 500 WHERE id = $1',
      [world.orderId],
    );
    await holder.query('COMMIT');
    holder.release();
    await handled;

    expect(await orderOf(world)).toMatchObject({
      refundedTicketMinor: 500,
      refundFailed: true,
    });
  });

  it('handles two events for one refund at once as one success', async () => {
    const world = await seedPaidOrder();
    const refund = await requested(world);
    const facts = { id: refund.refundId, amountMinor: refund.amountMinor };
    const ids = await Promise.all([
      storeEvent(refundEvent(world, facts, 'refund.succeeded')),
      storeEvent(refundEvent(world, facts, 'refund.succeeded')),
    ]);

    await Promise.all(ids.map((id) => handleEvent(id)));

    expect(
      (await ledgerOf(world)).filter(
        (entry) => entry.entryType === 'refund_cash_out',
      ),
    ).toHaveLength(1);
    const stored = await client.db
      .select()
      .from(schema.providerEvents)
      .where(eq(schema.providerEvents.rambleRecordId, refund.refundId));
    expect(
      stored.filter((row) => row.processedAt !== null).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
