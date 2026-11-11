import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { CancelSessionInput } from '@/lib/cancelSession';
import type { Caller } from '@/server/auth/caller';
import type { PaymentsPort } from '@/server/ports/payments';
import {
  attemptOf,
  holdOf,
  hostOwner,
  newSession,
  ops,
  orderRow,
  seedActiveHoldOn,
  seedConfirmedOn,
  seedUnpaidOn,
  sessionOf,
  snapshot,
} from './cancelSessionFixtures';
import {
  client,
  clearJobs,
  gateway,
  getParents,
  jobsOfKind,
  refundsOf,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (`cancelSession`, the fake payment adapter):
// - a confirmed booking is cancelled by the reason, refunded in full once (reason by party, pending, one refund job), its
//   seats returned, one guest email queued with the reason and the refund, and the audit rows written; its hold stays converted
// - the session is cancelled with the reason, its version up by one; a second session's booking, hold, and seats are untouched
// - a held order (an active hold, no order) is released as session_cancelled; a hold of another session is not
// - an unpaid order with a live attempt is voided, its hold released, its payment cancelled at the provider and its attempt
//   marked cancelled; it gets no refund and no email; a payment_failed order is voided the same way
// - a payment the provider will not let go of (it reports it succeeded) is left: the attempt stays live and is counted
// - an order that already ended (a guest cancelled earlier, void, refunded after a lapse) is left alone and not refunded twice
// - a repeat call answers already_cancelled and writes nothing; a repeat after a half-done run walks the orders again under the stored reason
// - a completed session is refused and writes nothing; an unknown session is not_found for staff and forbidden for a host
// - only ops, admin, or the session's host owner may cancel; another host's owner is refused and nothing is written
// - the entry parses its input: a bad id or reason throws before anything is read or written

async function run(
  caller: Caller,
  sessionId: string,
  reason: CancelSessionInput['reason'] = 'host',
  payments?: PaymentsPort,
) {
  const { cancelSession } = await import('@/server/db/cancelSession');
  return cancelSession(caller, { sessionId, reason }, payments);
}

beforeEach(clearJobs);

describe('a confirmed booking on the session', () => {
  it('is cancelled by the host, refunded in full once, and told', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 3);
    const seatsBefore = (await sessionOf(session.id)).seatsSold;

    const result = await run(ops, session.id, 'host');

    expect(result).toEqual({
      status: 'cancelled',
      ordersRefunded: 1,
      ordersVoided: 0,
      holdsReleased: 0,
      attemptsLeft: 0,
    });
    const order = await orderRow(booking.orderId);
    expect(order).toMatchObject({ status: 'cancelled', cancelledBy: 'host' });
    expect(order.cancelledAt).not.toBeNull();
    expect(order).toMatchObject({
      refundedTicketMinor: order.ticketSubtotalMinor,
      refundedTaxMinor: order.taxMinor,
    });
    const refunds = await refundsOf(booking);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: 'host_cancel',
      status: 'pending',
      amountMinor: order.totalMinor,
    });
    expect(await jobsOfKind('process-refund')).toHaveLength(1);
    const emails = await jobsOfKind('guest-cancellation');
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      dedupe_key: `guest-cancellation:${booking.orderId}`,
      payload: {
        orderId: booking.orderId,
        cancelledBy: 'host',
        refundMinor: order.totalMinor,
      },
    });
    expect((await holdOf(booking.holdId)).status).toBe('converted');
    const after = await sessionOf(session.id);
    expect(after).toMatchObject({ status: 'cancelled', cancelReason: 'host' });
    expect(after.seatsSold).toBe(seatsBefore - 3);
  });

  it.each(['host', 'weather', 'ramble'] as const)(
    'carries the %s reason on the order and its refund',
    async (reason) => {
      const session = await newSession();
      const booking = await seedConfirmedOn(session.id);

      await run(ops, session.id, reason);

      expect(await orderRow(booking.orderId)).toMatchObject({
        cancelledBy: reason,
      });
      expect((await refundsOf(booking))[0]?.reason).toBe(
        { host: 'host_cancel', weather: 'weather', ramble: 'ramble_cancel' }[
          reason
        ],
      );
      expect((await sessionOf(session.id)).cancelReason).toBe(reason);
    },
  );

  it('leaves a second session, its booking, and its hold exactly as they were', async () => {
    const session = await newSession();
    const other = await newSession();
    await seedConfirmedOn(session.id);
    const kept = await seedConfirmedOn(other.id, 2);
    const heldElsewhere = await seedActiveHoldOn(other.id);
    const before = await snapshot(other.id, [kept.orderId]);

    await run(ops, session.id);

    expect(await orderRow(kept.orderId)).toMatchObject({ status: 'confirmed' });
    expect((await holdOf(heldElsewhere.id)).status).toBe('active');
    expect(await refundsOf(kept)).toHaveLength(0);
    expect(await sessionOf(other.id)).toMatchObject({
      status: 'scheduled',
      cancelReason: null,
      seatsSold: 2,
      version: before.session[2],
    });
  });

  it('writes an audit row for the session and one for each booking', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);

    await run(ops, session.id, 'weather');

    const rows = await client.db.select().from(schema.auditLog);
    expect(
      rows
        .filter((row) => [session.id, booking.orderId].includes(row.subjectId))
        .map((row) => [row.action, row.actorKind, row.subjectKind])
        .sort(),
    ).toEqual([
      ['order.cancelled', 'system', 'order'],
      ['session.cancelled', 'system', 'session'],
    ]);
    expect(
      rows.find((row) => row.subjectId === session.id)?.details,
    ).toMatchObject({
      reason: 'weather',
      orders_refunded: 1,
      orders_voided: 0,
      holds_released: 0,
    });
  });
});

describe('the holds and unpaid orders of the session', () => {
  it('releases a held order as session_cancelled and not a hold of another session', async () => {
    const session = await newSession();
    const other = await newSession();
    const held = await seedActiveHoldOn(session.id);
    const elsewhere = await seedActiveHoldOn(other.id);

    const result = await run(ops, session.id);

    expect(result).toMatchObject({ holdsReleased: 1, ordersRefunded: 0 });
    expect(await holdOf(held.id)).toMatchObject({
      status: 'released',
      releasedReason: 'session_cancelled',
    });
    expect((await holdOf(elsewhere.id)).status).toBe('active');
  });

  it.each(['pending_payment', 'payment_failed'] as const)(
    'voids a %s order, releases its hold and cancels its payment at the provider',
    async (orderStatus) => {
      const session = await newSession();
      const unpaid = await seedUnpaidOn(session.id, { orderStatus });
      const confirmed = await seedConfirmedOn(session.id);

      const result = await run(ops, session.id);

      expect(result).toEqual({
        status: 'cancelled',
        ordersRefunded: 1,
        ordersVoided: 1,
        holdsReleased: 1,
        attemptsLeft: 0,
      });
      expect((await orderRow(unpaid.orderId)).status).toBe('void');
      expect(await holdOf(unpaid.holdId)).toMatchObject({
        status: 'released',
        releasedReason: 'session_cancelled',
      });
      expect((await attemptOf(unpaid.attemptId)).status).toBe('canceled');
      expect(
        (
          await gateway
            .getFakePayments()
            .retrieve({ kind: 'payment', id: unpaid.paymentId })
        )?.status,
      ).toBe('canceled');
      expect(await refundsOf(unpaid)).toHaveLength(0);
      const emails = await jobsOfKind('guest-cancellation');
      expect(emails.map((email) => email.dedupe_key)).toEqual([
        `guest-cancellation:${confirmed.orderId}`,
      ]);
    },
  );

  it('leaves a payment the provider reports as succeeded, and says so', async () => {
    const session = await newSession();
    const unpaid = await seedUnpaidOn(session.id);
    const cancelPayment = vi.fn();
    const stubbed = {
      ...gateway.getFakePayments(),
      retrieve: vi.fn().mockResolvedValue({
        id: unpaid.paymentId,
        status: 'succeeded',
        metadata: {},
      }),
      cancelPayment,
    } as unknown as PaymentsPort;

    const result = await run(ops, session.id, 'host', stubbed);

    expect(result).toMatchObject({ ordersVoided: 1, attemptsLeft: 1 });
    expect(cancelPayment).not.toHaveBeenCalled();
    expect((await orderRow(unpaid.orderId)).status).toBe('void');
    expect((await attemptOf(unpaid.attemptId)).status).toBe('requires_action');
  });

  it('does not touch the live attempt of another session', async () => {
    const session = await newSession();
    const other = await newSession();
    await seedActiveHoldOn(session.id);
    const elsewhere = await seedUnpaidOn(other.id);

    await run(ops, session.id);

    expect((await attemptOf(elsewhere.attemptId)).status).toBe(
      'requires_action',
    );
    expect((await orderRow(elsewhere.orderId)).status).toBe('pending_payment');
  });
});

describe('an order that already ended', () => {
  it.each(['cancelled', 'void', 'refunded_after_lapse'] as const)(
    'is left alone when it is %s',
    async (status) => {
      const session = await newSession();
      const booking = await seedConfirmedOn(session.id);
      const { eq } = await import('drizzle-orm');
      await client.db
        .update(schema.orders)
        .set(
          status === 'cancelled'
            ? {
                status,
                cancelledBy: 'guest',
                cancelledAt: new Date(Date.now() + 1000),
              }
            : { status, confirmedAt: null },
        )
        .where(eq(schema.orders.id, booking.orderId));
      const before = await snapshot(session.id, [booking.orderId]);

      const result = await run(ops, session.id);

      expect(result).toMatchObject({ ordersRefunded: 0, ordersVoided: 0 });
      expect(await refundsOf(booking)).toHaveLength(0);
      expect((await orderRow(booking.orderId)).status).toBe(status);
      expect((await snapshot(session.id, [booking.orderId])).jobs).toEqual(
        before.jobs,
      );
    },
  );
});

describe('a repeat', () => {
  it('answers already_cancelled and writes nothing', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);
    await seedUnpaidOn(session.id);
    await seedActiveHoldOn(session.id);
    await run(ops, session.id, 'weather');
    const before = await snapshot(session.id, [booking.orderId]);

    const again = await run(ops, session.id, 'host');

    expect(again).toEqual({
      status: 'already_cancelled',
      ordersRefunded: 0,
      ordersVoided: 0,
      holdsReleased: 0,
      attemptsLeft: 0,
    });
    expect(await snapshot(session.id, [booking.orderId])).toEqual(before);
    expect((await sessionOf(session.id)).cancelReason).toBe('weather');
  });

  it('finishes what a half-done run left, under the reason the session carries', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);
    const { eq } = await import('drizzle-orm');
    await client.db
      .update(schema.sessions)
      .set({ status: 'cancelled', cancelReason: 'weather' })
      .where(eq(schema.sessions.id, session.id));

    const result = await run(ops, session.id, 'host');

    expect(result).toMatchObject({
      status: 'already_cancelled',
      ordersRefunded: 1,
    });
    expect(await orderRow(booking.orderId)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'weather',
    });
    expect((await refundsOf(booking))[0]?.reason).toBe('weather');
    expect((await sessionOf(session.id)).version).toBe(1);
  });

  it('cancels a payment the first run could not reach', async () => {
    const session = await newSession();
    const unpaid = await seedUnpaidOn(session.id);
    const refuses = {
      ...gateway.getFakePayments(),
      retrieve: vi.fn().mockRejectedValue(new Error('provider down')),
    } as unknown as PaymentsPort;
    await expect(run(ops, session.id, 'host', refuses)).rejects.toThrow(
      'provider down',
    );
    expect((await sessionOf(session.id)).status).toBe('cancelled');
    expect((await attemptOf(unpaid.attemptId)).status).toBe('requires_action');

    const result = await run(ops, session.id);

    expect(result).toMatchObject({
      status: 'already_cancelled',
      attemptsLeft: 0,
    });
    expect((await attemptOf(unpaid.attemptId)).status).toBe('canceled');
  });
});

describe('the sessions and callers it refuses', () => {
  it('refuses a completed session and writes nothing', async () => {
    const session = await newSession({ status: 'completed' });
    await seedActiveHoldOn(session.id);
    const before = await snapshot(session.id, []);

    expect(await run(ops, session.id)).toEqual({ status: 'completed' });

    expect(await snapshot(session.id, [])).toEqual(before);
    expect((await sessionOf(session.id)).status).toBe('completed');
  });

  it('answers not_found for staff and forbidden for a host on a session that is not there', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    expect(await run(ops, missing)).toEqual({ status: 'not_found' });
    await expect(
      run(hostOwner(getParents().hostId), missing),
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  it('lets the owner of the session host cancel it, and admin too', async () => {
    const first = await newSession();
    const second = await newSession();

    expect(await run(hostOwner(getParents().hostId), first.id)).toMatchObject({
      status: 'cancelled',
    });
    expect(
      await run({ userId: null, roles: ['admin'], hostIds: [] }, second.id),
    ).toMatchObject({ status: 'cancelled' });
  });

  it.each<[string, Caller]>([
    ['another host', hostOwner('11111111-1111-4111-8111-111111111111')],
    ['a guest', { userId: null, roles: ['guest'], hostIds: [] }],
    ['no one', { userId: null, roles: [], hostIds: [] }],
  ])('refuses %s and writes nothing', async (_who, caller) => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);
    const before = await snapshot(session.id, [booking.orderId]);

    await expect(run(caller, session.id)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });

    expect(await snapshot(session.id, [booking.orderId])).toEqual(before);
  });

  it.each([
    ['an id that is not one', { sessionId: 'nope', reason: 'host' }],
    ['a reason that is not one', { sessionId: 'x', reason: 'guest' }],
    ['an extra field', { sessionId: 'x', reason: 'host', seats: 1 }],
  ])(
    'parses the input: %s throws before anything is read',
    async (_name, input) => {
      const { cancelSession } = await import('@/server/db/cancelSession');

      await expect(cancelSession(ops, input as never)).rejects.toBeInstanceOf(
        ZodError,
      );
    },
  );
});
