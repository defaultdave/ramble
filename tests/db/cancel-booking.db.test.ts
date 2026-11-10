import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tagsForChanges } from '@/lib/cacheTags';
import { refundsReconcile } from '@/lib/refunds';
import { backendPid, waitUntilBlocked } from './harness';
import {
  auditOf,
  cancelSnapshot,
  seatsSoldOf,
  seedCancellable,
  type CancelWorld,
} from './cancelFixtures';
import {
  balancesOf,
  client,
  clearJobs,
  jobsOfKind,
  ledgerOf,
  orderOf,
  refundsOf,
  setupRefundsDatabase,
  side,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the fake payment adapter; the action `cancelBooking`):
// - a cancellation inside the window cancels the order as the guest, requests one refund of the rest of the order
//   (ticket and tax, taxable too) under the guest_cancel reason, returns the seats once, writes one audit row with
//   the amounts and ids, queues the provider refund and both emails once, invalidates the session's spaces tag, and
//   leaves the refunds reconciling with the order
// - after the window the cancel refunds nothing: no refund row, no refund job, the seats still return, the audit row says 0
// - a refund shown that is one minor unit off, or that the window has since closed on, changes the terms and writes nothing
// - a booking paid in part by a gift refunds 0 and reinstates no gift; asking for the card amount changes the terms
// - the second cancel is already_cancelled and writes nothing more
// - a session that has started, a refund the order cannot be given (no succeeded payment), a link voided by a bump,
//   an unknown token, and a malformed one each cancel nothing and write nothing
// - the tier is judged by the database's clock: an app clock far ahead or far behind changes nothing
// - the cancel spends the manage count, and a token over it is refused with nothing written
// - under the locks: a cancel that waits for another cancellation judges the order it left (fails if the locked re-check is
//   removed); a token voided while it waits opens nothing; two cancels at once make one

const cancel = async (
  world: CancelWorld,
  expectedRefundMinor: number,
  token = world.token,
) => {
  const { cancelBooking } = await import('@/server/actions/orders');
  return cancelBooking({ manageToken: token, expectedRefundMinor });
};

async function fresh(seed: Parameters<typeof seedCancellable>[0] = {}) {
  await clearJobs();
  revalidateTag.mockClear();
  return seedCancellable(seed);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('cancelling inside the window', () => {
  it('cancels the booking, refunds the rest of it, and returns the seats', async () => {
    const world = await fresh();

    const result = await cancel(world, 13_000);

    expect(result).toEqual({
      status: 'cancelled',
      refundMinor: 13_000,
      giftReinstated: false,
      refundEta: 'Your bank usually shows it within 5 to 10 business days.',
    });
    const order = await orderOf(world);
    expect(order).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'guest',
      refundedTicketMinor: 13_000,
      refundedTaxMinor: 0,
      commissionReturnedMinor: world.commissionMinor,
    });
    expect(order.cancelledAt).toBeInstanceOf(Date);
    const [refund, ...others] = await refundsOf(world);
    expect(others).toHaveLength(0);
    expect(refund).toMatchObject({
      reason: 'guest_cancel',
      status: 'pending',
      ticketMinor: 13_000,
      taxMinor: 0,
      amountMinor: 13_000,
      initiatedBy: null,
    });
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore - world.seats);
    expect(revalidateTag).toHaveBeenCalledWith(
      tagsForChanges([{ kind: 'spaces', sessionId: world.sessionId }])[0],
      'max',
    );
  });

  it('writes one audit row with ids and amounts only', async () => {
    const world = await fresh();
    await cancel(world, 13_000);

    const [refund] = await refundsOf(world);
    const rows = await auditOf(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: 'guest',
      actorId: null,
      action: 'order.cancelled',
      subjectKind: 'order',
      subjectId: world.orderId,
      details: {
        cancelled_by: 'guest',
        session_id: world.sessionId,
        refund_minor: 13_000,
        refund_id: refund?.id,
        seats_returned: world.seats,
        gift_reinstated: false,
      },
    });
  });

  it('queues the provider refund and both emails once, with ids and amounts only', async () => {
    const world = await fresh();
    await cancel(world, 13_000);

    const [refund] = await refundsOf(world);
    expect(await jobsOfKind('process-refund')).toMatchObject([
      { payload: { refundId: refund?.id } },
    ]);
    expect(await jobsOfKind('guest-cancellation')).toMatchObject([
      {
        payload: {
          orderId: world.orderId,
          cancelledBy: 'guest',
          refundMinor: 13_000,
        },
        dedupe_key: `guest-cancellation:${world.orderId}`,
      },
    ]);
    expect(await jobsOfKind('host-cancellation-notice')).toMatchObject([
      {
        payload: { orderId: world.orderId, cancelledBy: 'guest' },
        dedupe_key: `host-cancellation-notice:${world.orderId}`,
      },
    ]);
  });

  it('takes the liability back and leaves the refunds reconciling, for a taxable order', async () => {
    const world = await fresh({ taxable: true });
    const before = await balancesOf(world);

    expect(await cancel(world, 18_509)).toMatchObject({
      status: 'cancelled',
      refundMinor: 18_509,
    });

    const order = await orderOf(world);
    const refunds = await refundsOf(world);
    expect(refunds).toMatchObject([
      { ticketMinor: 17_000, taxMinor: 1_509, amountMinor: 18_509 },
    ]);
    expect(refundsReconcile(order, refunds)).toBe(true);
    expect(order.commissionReturnedMinor).toBe(world.commissionMinor);
    expect(await balancesOf(world)).not.toEqual(before);
    expect((await ledgerOf(world)).length).toBeGreaterThan(0);
  });

  it('refunds a window that closes a minute from now, and not one that closed a minute ago', async () => {
    const open = await fresh({ freeCancelInMinutes: 1 });
    expect(await cancel(open, 13_000)).toMatchObject({
      status: 'cancelled',
      refundMinor: 13_000,
    });
    const closed = await fresh({ freeCancelInMinutes: -1 });
    expect(await cancel(closed, 0)).toMatchObject({
      status: 'cancelled',
      refundMinor: 0,
    });
  });
});

describe('cancelling after the window, or paid with a gift', () => {
  it('refunds nothing after the window: no refund row, no refund job, the seats return', async () => {
    const world = await fresh({ freeCancelInMinutes: -1 });

    expect(await cancel(world, 0)).toEqual({
      status: 'cancelled',
      refundMinor: 0,
      giftReinstated: false,
      refundEta: null,
    });

    expect(await refundsOf(world)).toHaveLength(0);
    expect(await jobsOfKind('process-refund')).toHaveLength(0);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore - world.seats);
    expect((await orderOf(world)).refundedTicketMinor).toBe(0);
    expect((await auditOf(world))[0]?.details).toMatchObject({
      refund_minor: 0,
      refund_id: null,
    });
    expect(await jobsOfKind('guest-cancellation')).toMatchObject([
      { payload: { refundMinor: 0 } },
    ]);
  });

  it('refunds nothing for an order with no deadline snapshot', async () => {
    const world = await fresh({ freeCancelInMinutes: null });

    expect(await cancel(world, 0)).toMatchObject({
      status: 'cancelled',
      refundMinor: 0,
    });
    expect(await refundsOf(world)).toHaveLength(0);
  });

  it('refunds 0 for a gift-paid booking and reinstates no gift', async () => {
    const world = await fresh({ amountDueMinor: 9_000 });

    expect(await cancel(world, 0)).toEqual({
      status: 'cancelled',
      refundMinor: 0,
      giftReinstated: false,
      refundEta: null,
    });

    expect(await refundsOf(world)).toHaveLength(0);
    expect(await jobsOfKind('process-refund')).toHaveLength(0);
    expect((await orderOf(world)).status).toBe('cancelled');
    expect((await auditOf(world))[0]?.details).toMatchObject({
      refund_minor: 0,
      gift_reinstated: false,
    });
  });

  it('does not cancel a gift-paid booking for the card amount: the terms changed', async () => {
    const world = await fresh({ amountDueMinor: 9_000 });
    const before = await cancelSnapshot(world);

    expect(await cancel(world, 9_000)).toEqual({
      status: 'terms_changed',
      refundMinor: 0,
    });
    expect(await cancelSnapshot(world)).toEqual(before);
  });
});

describe('what is refused writes nothing', () => {
  it.each([12_999, 13_001, 0])(
    'a refund shown of %i against a refund now of 13000 changes the terms',
    async (shown) => {
      const world = await fresh();
      const before = await cancelSnapshot(world);

      expect(await cancel(world, shown)).toEqual({
        status: 'terms_changed',
        refundMinor: 13_000,
      });
      expect(await cancelSnapshot(world)).toEqual(before);
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );

  it('a refund shown before the window closed changes the terms to 0', async () => {
    const world = await fresh({ freeCancelInMinutes: -1 });
    const before = await cancelSnapshot(world);

    expect(await cancel(world, 13_000)).toEqual({
      status: 'terms_changed',
      refundMinor: 0,
    });
    expect(await cancelSnapshot(world)).toEqual(before);
  });

  it('a session that has started cannot be cancelled', async () => {
    const world = await fresh({ startsInMinutes: -5 });
    const before = await cancelSnapshot(world);

    const result = await cancel(world, 13_000);

    expect(result).toMatchObject({ status: 'not_refundable' });
    expect(await cancelSnapshot(world)).toEqual(before);
  });

  it('answers a booking with no payment to refund as refund_unavailable, and cancels nothing', async () => {
    const world = await fresh({ attempt: 'none' });
    const before = await cancelSnapshot(world);

    expect(await cancel(world, 13_000)).toEqual({
      status: 'refund_unavailable',
      reason: 'no_payment',
    });
    expect(await cancelSnapshot(world)).toEqual(before);
    expect((await orderOf(world)).status).toBe('confirmed');
  });

  it('rolls the whole cancellation back when the order refunds do not reconcile', async () => {
    const world = await fresh();
    await client.db.execute(
      sql`UPDATE orders SET refunded_ticket_minor = 1000 WHERE id = ${world.orderId}`,
    );
    const before = await cancelSnapshot(world);

    await expect(cancel(world, 12_000)).rejects.toThrow('do not reconcile');
    expect(await cancelSnapshot(world)).toEqual(before);
  });

  it('answers a cancelled booking as already cancelled and writes nothing more', async () => {
    const world = await fresh();
    await cancel(world, 13_000);
    const after = await cancelSnapshot(world);

    expect(await cancel(world, 13_000)).toEqual({
      status: 'already_cancelled',
    });
    expect(await cancel(world, 0)).toEqual({ status: 'already_cancelled' });
    expect(await cancelSnapshot(world)).toEqual(after);
    expect(after).toMatchObject({
      refunds: 1,
      audit: 1,
      jobs: { refund: 1, guest: 1, host: 1 },
      seatsSold: world.seatsSoldBefore - world.seats,
    });
  });

  it('opens nothing for a token that is unknown or malformed', async () => {
    const world = await fresh();
    const before = await cancelSnapshot(world);

    expect(await cancel(world, 13_000, 'B'.repeat(43))).toEqual({
      status: 'not_found',
    });
    expect(await cancel(world, 13_000, 'short')).toEqual({
      status: 'not_found',
    });
    expect(await cancelSnapshot(world)).toEqual(before);
  });

  it('opens nothing for a link voided by a bump, and the rebuilt link cancels', async () => {
    const world = await fresh();
    const tokens = await import('@/server/tokens');
    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'manage', world.orderId),
    );
    const before = await cancelSnapshot(world);

    expect(await cancel(world, 13_000)).toEqual({ status: 'not_found' });
    expect(await cancelSnapshot(world)).toEqual(before);

    const rebuilt = tokens.capabilityToken('manage', world.orderId, 2);
    expect(await cancel(world, 13_000, rebuilt)).toMatchObject({
      status: 'cancelled',
    });
  });
});

describe('the tier is judged by the database clock', () => {
  it('refunds in full when the app clock says the window closed long ago', async () => {
    const world = await fresh({ freeCancelInMinutes: 60 });
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() + 10 * 24 * 60 * 60_000,
    });

    expect(await cancel(world, 13_000)).toMatchObject({
      status: 'cancelled',
      refundMinor: 13_000,
    });
  });

  it('changes the terms when the app clock says the window is still open', async () => {
    const world = await fresh({ freeCancelInMinutes: -1 });
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() - 10 * 24 * 60 * 60_000,
    });

    expect(await cancel(world, 13_000)).toEqual({
      status: 'terms_changed',
      refundMinor: 0,
    });
    expect((await orderOf(world)).status).toBe('confirmed');
  });
});

describe('the manage rate limit', () => {
  it('spends one try of the manage count for each cancel', async () => {
    const world = await fresh();
    const { consumeRateLimit } = await import('@/server/ports/rate-limit');

    await cancel(world, 1);

    expect(await consumeRateLimit('manage', world.token)).toEqual({
      allowed: true,
      remaining: 28,
    });
  });

  it('refuses a token over the count and cancels nothing', async () => {
    const world = await fresh();
    const { consumeRateLimit } = await import('@/server/ports/rate-limit');
    for (let tries = 0; tries < 30; tries += 1) {
      await consumeRateLimit('manage', world.token);
    }
    const before = await cancelSnapshot(world);

    const result = await cancel(world, 13_000);

    expect(result).toMatchObject({ status: 'rate_limited' });
    expect(await cancelSnapshot(world)).toEqual(before);
  });
});

describe('under the locks', () => {
  it('judges the order another cancellation left: a cancel that waits sees it cancelled', async () => {
    const world = await fresh();
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
      world.orderId,
    ]);

    const waiting = cancel(world, 13_000);
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await holder.query(
      `UPDATE orders SET status = 'cancelled', cancelled_by = 'ramble', cancelled_at = clock_timestamp() WHERE id = $1`,
      [world.orderId],
    );
    await holder.query('COMMIT');
    holder.release();

    expect(await waiting).toEqual({ status: 'already_cancelled' });
    expect(await refundsOf(world)).toHaveLength(0);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
    expect(await auditOf(world)).toHaveLength(0);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(0);
  });

  it('opens nothing for a token voided while the cancel waits', async () => {
    const world = await fresh();
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
      world.orderId,
    ]);

    const waiting = cancel(world, 13_000);
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await holder.query(
      `UPDATE orders SET manage_token_version = 2 WHERE id = $1`,
      [world.orderId],
    );
    await holder.query('COMMIT');
    holder.release();

    expect(await waiting).toEqual({ status: 'not_found' });
    expect((await orderOf(world)).status).toBe('confirmed');
    expect(await refundsOf(world)).toHaveLength(0);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
  });

  it('judges the session another writer left: a cancel that waits for the session lock sees a session that started', async () => {
    const world = await fresh();
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
      world.sessionId,
    ]);

    const waiting = cancel(world, 13_000);
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await holder.query(
      `UPDATE sessions SET starts_at = now() - interval '5 minutes', ends_at = now() + interval '90 minutes' WHERE id = $1`,
      [world.sessionId],
    );
    await holder.query('COMMIT');
    holder.release();

    expect(await waiting).toMatchObject({ status: 'not_refundable' });
    expect((await orderOf(world)).status).toBe('confirmed');
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
  });

  it('makes one cancellation of two at once, in 4 rounds', async () => {
    for (let round = 0; round < 4; round += 1) {
      const world = await fresh();

      const answers = await Promise.all([
        cancel(world, 13_000),
        cancel(world, 13_000),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([
        'already_cancelled',
        'cancelled',
      ]);
      expect(await refundsOf(world)).toHaveLength(1);
      expect(await auditOf(world)).toHaveLength(1);
      expect(await seatsSoldOf(world)).toBe(
        world.seatsSoldBefore - world.seats,
      );
      expect(await jobsOfKind('process-refund')).toHaveLength(1);
    }
  });
});
