import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { refundsReconcile } from '@/lib/refunds';
import { backendPid, waitUntilBlocked } from './harness';
import {
  ask,
  balancesOf,
  client,
  clearJobs,
  jobsOfKind,
  ledgerOf,
  orderOf,
  refundsOf,
  seedPaidOrder,
  setupRefundsDatabase,
  side,
  type PaidOrder,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk:
// - a request writes, in the caller's transaction, the pending refund with its split, the order's running totals, the
//   three liability rows (no cash row, rule 5), and one job; the refund's id is a UUID made from (order, reason, key)
// - a repeat of the same order, reason, and key answers already_requested and writes nothing, even when the order has
//   since changed; the same key asking for another ticket part is refused (request_changed)
// - another key or another reason is another refund: a partial, a second partial, then `remaining` end with exactly the
//   tax and commission charged, and the refunds reconcile with the order's totals and never pass total_minor
// - every refusal writes nothing: no order, an order that took no cash, no succeeded payment, more than remains,
//   nothing left, more than the card paid; input the schema refuses throws; a caller that throws afterwards loses it all
// - judged under the order's lock: a request that waits for another change to the order judges the row it left (fails if
//   the lock is removed), two requests for one key make one refund, and two for the rest of an order make one

async function snapshot(world: PaidOrder) {
  const order = await orderOf(world);
  return {
    refunds: await refundsOf(world),
    ledger: (await ledgerOf(world)).length,
    jobs: (await jobsOfKind('process-refund')).length,
    totals: [
      order.refundedTicketMinor,
      order.refundedTaxMinor,
      order.commissionReturnedMinor,
    ],
  };
}

describe('requesting a refund', () => {
  it('writes the pending refund, the order totals, the liability rows, and the job', async () => {
    await clearJobs();
    const world = await seedPaidOrder({ taxable: true });
    const before = await balancesOf(world);

    const result = await ask(world, { ticketMinor: 8_500 });

    expect(result).toMatchObject({
      status: 'requested',
      refund: {
        ticketMinor: 8_500,
        taxMinor: 755,
        commissionReturnedMinor: 1_275,
        amountMinor: 9_255,
      },
    });
    if (result.status !== 'requested') throw new Error('not requested');
    const { refundId } = result.refund;
    expect(refundId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const [refund] = await refundsOf(world);
    expect(refund).toMatchObject({
      id: refundId,
      status: 'pending',
      reason: 'guest_cancel',
      providerKey: `refund:${refundId}`,
      paymentAttemptId: world.attemptId,
      providerRefundId: null,
      succeededAt: null,
      initiatedBy: null,
      amountMinor: 9_255,
    });
    expect(await orderOf(world)).toMatchObject({
      refundedTicketMinor: 8_500,
      refundedTaxMinor: 755,
      commissionReturnedMinor: 1_275,
      refundFailed: false,
    });
    const rows = (await ledgerOf(world)).filter(
      (row) => row.refundId === refundId,
    );
    expect(
      rows.map((row) => `${row.entryType}:${String(row.amountMinor)}`).sort(),
    ).toEqual([
      'commission_returned:1275',
      'refund_host_share:7225',
      'refund_tax:755',
    ]);
    expect(
      rows.every((row) => row.simulated && row.providerObjectId === null),
    ).toBe(true);
    const after = await balancesOf(world);
    expect(after.refunds_pending).toBe(9_255);
    expect(after.platform_cash).toBe(before.platform_cash);
    expect(after.host_payable).toBe(before.host_payable - 7_225 - 755);
    expect(after.ramble_commission).toBe(before.ramble_commission - 1_275);
    expect(await jobsOfKind('process-refund')).toEqual([
      {
        payload: { refundId },
        dedupe_key: `process-refund:${refundId}`,
        status: 'pending',
      },
    ]);
  });

  it('records who asked, when a staff member did', async () => {
    const world = await seedPaidOrder();
    const staff = randomUUID();
    await ask(world, {
      ticketMinor: 1_000,
      reason: 'goodwill',
      initiatedBy: staff,
    });
    expect((await refundsOf(world))[0]).toMatchObject({
      initiatedBy: staff,
      reason: 'goodwill',
    });
  });

  it('answers a repeat with the same refund and writes nothing, even after the order changed', async () => {
    const world = await seedPaidOrder({ taxable: true });
    const first = await ask(world, { ticketMinor: 8_500 });
    await ask(world, { key: 'second', ticketMinor: 500 });
    const before = await snapshot(world);

    const again = await ask(world, { ticketMinor: 8_500 });
    const remaining = await ask(world, { ticketMinor: 'remaining' });

    expect(again).toEqual({
      status: 'already_requested',
      refund: first.status === 'requested' ? first.refund : null,
    });
    expect(remaining.status).toBe('already_requested');
    expect(await snapshot(world)).toEqual(before);
  });

  it('refuses the same key asking for another ticket part', async () => {
    const world = await seedPaidOrder();
    await ask(world, { ticketMinor: 1_000 });
    const before = await snapshot(world);

    expect(await ask(world, { ticketMinor: 1_001 })).toEqual({
      status: 'refused',
      reason: 'request_changed',
      remainingTicketMinor: null,
    });
    expect(await snapshot(world)).toEqual(before);
  });

  it('treats another key, and another reason, as another refund', async () => {
    const world = await seedPaidOrder();
    const first = await ask(world, { ticketMinor: 1_000 });
    const byKey = await ask(world, { key: 'other', ticketMinor: 1_000 });
    const byReason = await ask(world, {
      reason: 'goodwill',
      ticketMinor: 1_000,
    });

    const ids = [first, byKey, byReason].map((result) =>
      result.status === 'requested' ? result.refund.refundId : null,
    );
    expect(new Set(ids).size).toBe(3);
    expect(await refundsOf(world)).toHaveLength(3);
  });

  it.each([
    ['not taxable', false, 13_000, 0, 1_950],
    ['taxable', true, 17_000, 1_509, 2_550],
  ])(
    'refunds a %s order in three parts to exactly what was charged, and the refunds reconcile',
    async (_name, taxable, ticket, tax, commission) => {
      const world = await seedPaidOrder({ taxable });
      await ask(world, { key: 'a', ticketMinor: 1 });
      await ask(world, { key: 'b', ticketMinor: Math.floor(ticket / 2) });
      const last = await ask(world, { key: 'c', ticketMinor: 'remaining' });

      expect(last.status).toBe('requested');
      const order = await orderOf(world);
      const rows = await refundsOf(world);
      expect(order).toMatchObject({
        refundedTicketMinor: ticket,
        refundedTaxMinor: tax,
        commissionReturnedMinor: commission,
      });
      expect(refundsReconcile(order, rows)).toBe(true);
      expect(rows.reduce((total, row) => total + row.amountMinor, 0)).toBe(
        order.totalMinor,
      );
      const after = await balancesOf(world);
      expect(after.ramble_commission).toBe(0);
      expect(after.host_payable).toBe(0);
      expect(after.refunds_pending).toBe(order.totalMinor);
    },
  );

  it('takes no more tax than the order has when earlier roundings used it: ticket 6, tax 3, in parts of 1', async () => {
    const world = await seedPaidOrder({
      money: { subtotal: 6, tax: 3, commission: 1 },
    });
    const taxes: number[] = [];
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const result = await ask(world, { key, ticketMinor: 1 });
      if (result.status !== 'requested') throw new Error('not requested');
      taxes.push(result.refund.taxMinor);
    }

    expect(taxes).toEqual([1, 1, 1, 0, 0, 0]);
    const order = await orderOf(world);
    expect(order).toMatchObject({
      refundedTicketMinor: 6,
      refundedTaxMinor: 3,
    });
    expect(refundsReconcile(order, await refundsOf(world))).toBe(true);
  });

  it.each([
    [
      'an order that does not exist',
      () => ({ orderId: randomUUID() }),
      {},
      'order_not_found',
      null,
    ],
    [
      'an order still awaiting payment',
      () => ({}),
      { status: 'pending_payment' as const },
      'order_not_refundable',
      13_000,
    ],
    [
      'an order with no succeeded payment',
      () => ({}),
      { attempt: 'none' as const },
      'no_payment',
      null,
    ],
    [
      'more than remains',
      () => ({ ticketMinor: 13_001 }),
      {},
      'exceeds_remaining',
      13_000,
    ],
    [
      'more than the card paid',
      () => ({}),
      { amountDueMinor: 8_000 },
      'exceeds_card_payment',
      13_000,
    ],
  ] as const)(
    'refuses %s and writes nothing',
    async (_name, over, seed, reason, remaining) => {
      const world = await seedPaidOrder(seed);
      const before = await snapshot(world);

      const result = await ask(world, over());

      expect(result).toEqual({
        status: 'refused',
        reason,
        remainingTicketMinor: remaining,
      });
      expect(await snapshot(world)).toEqual(before);
    },
  );

  it('refuses an order with nothing left', async () => {
    const world = await seedPaidOrder();
    await ask(world, { key: 'all' });
    const before = await snapshot(world);

    expect(await ask(world, { key: 'again' })).toEqual({
      status: 'refused',
      reason: 'nothing_left',
      remainingTicketMinor: 0,
    });
    expect(await snapshot(world)).toEqual(before);
  });

  it.each([
    ['a gift reason', { reason: 'gift_unredeemed' }],
    ['the duplicate payment reason', { reason: 'duplicate_payment' }],
    ['a key with a space', { key: 'a b' }],
    ['a zero ticket part', { ticketMinor: 0 }],
  ])('throws on %s and writes nothing', async (_name, over) => {
    const world = await seedPaidOrder();
    const before = await snapshot(world);

    await expect(ask(world, over as never)).rejects.toThrow();
    expect(await snapshot(world)).toEqual(before);
  });

  it('writes nothing when the caller fails after asking', async () => {
    const world = await seedPaidOrder();
    const before = await snapshot(world);
    const { requestRefund } = await import('@/server/db/refunds');

    await expect(
      client.db.transaction(async (tx) => {
        await requestRefund(tx, {
          orderId: world.orderId,
          reason: 'guest_cancel',
          key: 'cancel',
          ticketMinor: 'remaining',
        });
        throw new Error('the caller failed');
      }),
    ).rejects.toThrow('the caller failed');
    expect(await snapshot(world)).toEqual(before);
  });
});

describe('requesting a refund under the order lock', () => {
  it('judges the order another writer left: a request that waits sees the refund made meanwhile', async () => {
    const world = await seedPaidOrder();
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
      world.orderId,
    ]);

    const waiting = ask(world, { key: 'waiting' });
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await holder.query(
      `UPDATE orders SET refunded_ticket_minor = ticket_subtotal_minor, refunded_tax_minor = tax_minor,
         commission_returned_minor = commission_minor WHERE id = $1`,
      [world.orderId],
    );
    await holder.query('COMMIT');
    holder.release();

    expect(await waiting).toEqual({
      status: 'refused',
      reason: 'nothing_left',
      remainingTicketMinor: 0,
    });
    expect(await refundsOf(world)).toHaveLength(0);
  });

  it('makes one refund of two requests for one key, in 4 rounds', async () => {
    for (let round = 0; round < 4; round += 1) {
      const world = await seedPaidOrder();
      const answers = await Promise.all([ask(world), ask(world)]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([
        'already_requested',
        'requested',
      ]);
      expect(await refundsOf(world)).toHaveLength(1);
    }
  });

  it('makes one refund of two requests for the rest of an order, in 4 rounds', async () => {
    for (let round = 0; round < 4; round += 1) {
      const world = await seedPaidOrder({ taxable: true });
      const answers = await Promise.all([
        ask(world, { key: 'one' }),
        ask(world, { key: 'two' }),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([
        'refused',
        'requested',
      ]);
      const order = await orderOf(world);
      expect(order.refundedTicketMinor).toBe(order.ticketSubtotalMinor);
      expect(refundsReconcile(order, await refundsOf(world))).toBe(true);
    }
  });
});
