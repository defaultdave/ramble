import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  seatsSoldOf,
  seedCancellable,
  type CancelWorld,
} from './cancelFixtures';
import {
  client,
  clearJobs,
  handleEvent,
  jobsOfKind,
  orderOf,
  refundEvent,
  refundsOf,
  schema,
  setupRefundsDatabase,
  storeEvent,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
const sendEmail = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/ports/email', () => ({ sendEmail }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/server/db/audit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/db/audit')>();
  return {
    ...original,
    recordAudit: (entry: Parameters<typeof original.recordAudit>[0]) =>
      audit.failWith
        ? Promise.reject(audit.failWith)
        : original.recordAudit(entry),
    writeAudit: (
      tx: Parameters<typeof original.writeAudit>[0],
      entry: Parameters<typeof original.writeAudit>[1],
    ) =>
      audit.failWith
        ? Promise.reject(audit.failWith)
        : original.writeAudit(tx, entry),
  };
});
setupRefundsDatabase(raise);

// Behaviours under test, against the real database (the fake payment adapter; the actions of the ops bookings area):
// cancel
// - an ops cancel is the guest's cancel (the order, seats, tier refund, and emails are the same) with the actor ops: the order records Ramble as the canceller, and `order.cancelled` and `booking.ops_cancel_requested` both name the ops user
// - the guest's own cancel, the default actor, still records the guest and writes no ops row
// - the cancellation and both audit rows are one transaction: an audit row that cannot be written leaves the order, spaces, and refunds as they were; a cancel that changes the terms, or finds no booking, writes no audit row at all
// refund
// - a cancelled booking is refunded once, in full, under the ops reason and the ops user, with one audit row naming the refund; asking again changes nothing
// - a confirmed booking, and one whose refund failed, are refused with nothing written
// retry
// - a booking whose refund failed gets one new refund of the rest, the flag cleared, and one audit row in one transaction; a second try finds nothing to retry; a retry after the retry failed too asks again
// - a retry the refund path refuses leaves the flag set and writes nothing; one whose audit row cannot be written leaves the flag set and no new refund
// void links
// - the token version goes up with the audit row in one transaction: the old link opens nothing and the new one opens the booking; an audit row that cannot be written leaves the version alone; a missing booking is null with no audit row
// resend
// - the confirmation goes to the address on the booking with a link that opens it and a key made from the resend id the audit row carries
// - a cancelled booking and a missing one send nothing and write no audit row; a resend whose audit row cannot be written sends nothing
// history
// - the booking page lists what ops did to it

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops: Caller = testCaller({ userId: opsUser, roles: [Role.Ops] });

let data: typeof import('@/server/db/opsBookings');
let retry: typeof import('@/server/db/orderRefundRetry');
let resend: typeof import('@/server/opsBookingResend');
let tokens: typeof import('@/server/tokens');
let guestCancel: typeof import('@/server/db/orderCancel');

beforeAll(async () => {
  data = await import('@/server/db/opsBookings');
  retry = await import('@/server/db/orderRefundRetry');
  resend = await import('@/server/opsBookingResend');
  tokens = await import('@/server/tokens');
  guestCancel = await import('@/server/db/orderCancel');
});

beforeEach(async () => {
  audit.failWith = null;
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ messageId: 'm', status: 'sent' });
  await clearJobs();
});

async function auditRows(orderId: string, action?: string) {
  return client.db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.subjectId, orderId),
        action === undefined ? undefined : eq(schema.auditLog.action, action),
      ),
    );
}

/** A cancelled booking with its refund in flight, cancelled by ops. */
async function cancelled(seed: Parameters<typeof seedCancellable>[0] = {}) {
  const world = await seedCancellable({ gatewayPayment: true, ...seed });
  const result = await data.cancelBookingAsOps(ops, {
    orderId: world.orderId,
    expectedRefundMinor: seed.freeCancelInMinutes === -60 ? 0 : 13_000,
  });
  expect(result.status).toBe('cancelled');
  return world;
}

async function failTheRefund(world: CancelWorld) {
  const [refund] = (await refundsOf(world)).filter(
    (row) => row.status === 'pending',
  );
  if (!refund) throw new Error('no pending refund');
  await handleEvent(
    await storeEvent(refundEvent(world, refund, 'refund.failed')),
  );
}

describe('cancelling', () => {
  it("is the guest's cancel with the actor ops, in one transaction with both audit rows", async () => {
    const world = await seedCancellable({ gatewayPayment: true });

    const result = await data.cancelBookingAsOps(ops, {
      orderId: world.orderId,
      expectedRefundMinor: 13_000,
    });

    expect(result).toMatchObject({ status: 'cancelled', refundMinor: 13_000 });
    expect(await orderOf(world)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'ramble',
    });
    expect(await refundsOf(world)).toHaveLength(1);
    expect((await jobsOfKind('guest-cancellation')).length).toBe(1);
    expect(await auditRows(world.orderId, 'order.cancelled')).toMatchObject([
      {
        actorKind: 'user',
        actorId: opsUser,
        details: { cancelled_by: 'ramble' },
      },
    ]);
    expect(
      await auditRows(world.orderId, 'booking.ops_cancel_requested'),
    ).toMatchObject([
      { actorKind: 'user', actorId: opsUser, subjectKind: 'order' },
    ]);
  });

  it('records the guest, and writes no ops row, for the guest cancel', async () => {
    const world = await seedCancellable({ gatewayPayment: true });
    const token = await tokens.resolveManageToken(world.token);
    if (token === null) throw new Error('no token');

    const result = await guestCancel.cancelBookingOrder({
      token,
      expectedRefundMinor: 13_000,
    });

    expect(result.status).toBe('cancelled');
    expect((await orderOf(world)).cancelledBy).toBe('guest');
    expect(await auditRows(world.orderId, 'order.cancelled')).toMatchObject([
      { actorKind: 'guest', actorId: null, details: { cancelled_by: 'guest' } },
    ]);
    expect(
      await auditRows(world.orderId, 'booking.ops_cancel_requested'),
    ).toHaveLength(0);
  });

  it('cancels nothing when an audit row cannot be written', async () => {
    const world = await seedCancellable({ gatewayPayment: true });
    const spaces = await seatsSoldOf(world);
    audit.failWith = new Error('audit down');

    await expect(
      data.cancelBookingAsOps(ops, {
        orderId: world.orderId,
        expectedRefundMinor: 13_000,
      }),
    ).rejects.toThrow('audit down');

    expect((await orderOf(world)).status).toBe('confirmed');
    expect(await refundsOf(world)).toHaveLength(0);
    expect(await seatsSoldOf(world)).toBe(spaces);
    expect(await auditRows(world.orderId)).toHaveLength(0);
  });

  it('changes the terms for a refund that is not the one shown, and writes no audit row', async () => {
    const world = await seedCancellable({ gatewayPayment: true });
    const result = await data.cancelBookingAsOps(ops, {
      orderId: world.orderId,
      expectedRefundMinor: 0,
    });
    expect(result).toEqual({ status: 'terms_changed', refundMinor: 13_000 });
    expect((await orderOf(world)).status).toBe('confirmed');
    expect(await refundsOf(world)).toHaveLength(0);
    expect(await auditRows(world.orderId)).toHaveLength(0);
  });

  it('does not find a missing booking and writes no audit row', async () => {
    const id = randomUUID();
    expect(
      await data.cancelBookingAsOps(ops, {
        orderId: id,
        expectedRefundMinor: 0,
      }),
    ).toEqual({ status: 'not_found' });
    expect(await auditRows(id)).toHaveLength(0);
  });
});

describe('refunding', () => {
  it('refunds a cancelled booking in full, once, under the ops reason and user', async () => {
    const world = await cancelled({ freeCancelInMinutes: -60 });
    expect(await refundsOf(world)).toHaveLength(0);

    expect(await data.refundBookingAsOps(ops, world.orderId)).toBe('requested');
    expect(await data.refundBookingAsOps(ops, world.orderId)).toBe(
      'already_requested',
    );

    const [refund, ...others] = await refundsOf(world);
    expect(others).toHaveLength(0);
    expect(refund).toMatchObject({
      reason: 'ops_adjustment',
      initiatedBy: opsUser,
      status: 'pending',
      amountMinor: 13_000,
    });
    const rows = await auditRows(world.orderId, 'booking.ops_refund_requested');
    expect(rows).toMatchObject([{ details: { refund_id: refund?.id } }]);
    expect((await jobsOfKind('process-refund')).length).toBe(1);
  });

  it('refuses a confirmed booking, and one whose refund failed, and writes nothing', async () => {
    const confirmed = await seedCancellable({ gatewayPayment: true });
    expect(await data.refundBookingAsOps(ops, confirmed.orderId)).toBe(
      'refused',
    );
    expect(await refundsOf(confirmed)).toHaveLength(0);

    const failed = await cancelled();
    await failTheRefund(failed);
    expect(await data.refundBookingAsOps(ops, failed.orderId)).toBe('refused');
    expect(
      await auditRows(failed.orderId, 'booking.ops_refund_requested'),
    ).toHaveLength(0);
  });

  it('does not find a missing booking', async () => {
    expect(await data.refundBookingAsOps(ops, randomUUID())).toBe('not_found');
  });
});

describe('retrying a failed refund', () => {
  it('asks once more for the rest, clears the flag, and records the retry, together', async () => {
    const world = await cancelled();
    await failTheRefund(world);
    expect((await orderOf(world)).refundFailed).toBe(true);

    expect(await retry.retryFailedRefund(ops, world.orderId)).toBe('requested');

    expect((await orderOf(world)).refundFailed).toBe(false);
    const refunds = await refundsOf(world);
    expect(refunds.map((refund) => refund.status).toSorted()).toEqual([
      'failed',
      'pending',
    ]);
    expect(refunds.find((refund) => refund.status === 'pending')).toMatchObject(
      {
        reason: 'guest_cancel',
        initiatedBy: opsUser,
        amountMinor: 13_000,
      },
    );
    expect(
      await auditRows(world.orderId, 'booking.ops_refund_retried'),
    ).toHaveLength(1);
    expect(await retry.retryFailedRefund(ops, world.orderId)).toBe('refused');
    expect(await refundsOf(world)).toHaveLength(2);
  });

  it('retries again after the retry fails too, under a key named for the newest failure', async () => {
    const world = await cancelled();
    await failTheRefund(world);
    await retry.retryFailedRefund(ops, world.orderId);
    await failTheRefund(world);
    expect((await orderOf(world)).refundFailed).toBe(true);

    expect(await retry.retryFailedRefund(ops, world.orderId)).toBe('requested');
    expect(await refundsOf(world)).toHaveLength(3);
  });

  it('leaves the flag set and writes nothing when the refund path refuses the request', async () => {
    const world = await cancelled();
    await failTheRefund(world);
    await client.db
      .update(schema.paymentAttempts)
      .set({ status: 'canceled' })
      .where(eq(schema.paymentAttempts.orderId, world.orderId));

    expect(await retry.retryFailedRefund(ops, world.orderId)).toBe('refused');

    expect((await orderOf(world)).refundFailed).toBe(true);
    expect(await refundsOf(world)).toHaveLength(1);
    expect(
      await auditRows(world.orderId, 'booking.ops_refund_retried'),
    ).toHaveLength(0);
  });

  it('leaves the flag set and no new refund when the audit row cannot be written', async () => {
    const world = await cancelled();
    await failTheRefund(world);
    audit.failWith = new Error('audit down');

    await expect(retry.retryFailedRefund(ops, world.orderId)).rejects.toThrow(
      'audit down',
    );

    expect((await orderOf(world)).refundFailed).toBe(true);
    expect(await refundsOf(world)).toHaveLength(1);
  });

  it('refuses a booking whose refund did not fail, and does not find a missing one', async () => {
    const world = await cancelled();
    expect(await retry.retryFailedRefund(ops, world.orderId)).toBe('refused');
    expect(await retry.retryFailedRefund(ops, randomUUID())).toBe('not_found');
    expect(await refundsOf(world)).toHaveLength(1);
  });
});

describe('voiding earlier links', () => {
  it('raises the version with its audit row, so the old link opens nothing and the new one opens the booking', async () => {
    const world = await seedCancellable();
    expect(await tokens.resolveManageToken(world.token)).not.toBeNull();

    expect(await data.voidBookingLinks(ops, world.orderId)).toEqual({
      version: 2,
    });

    expect(await tokens.resolveManageToken(world.token)).toBeNull();
    const fresh = tokens.capabilityToken('manage', world.orderId, 2);
    expect(await tokens.resolveManageToken(fresh)).toMatchObject({
      id: world.orderId,
    });
    expect(
      await auditRows(world.orderId, 'booking.ops_links_voided'),
    ).toMatchObject([{ actorId: opsUser, details: { token_version: 2 } }]);
  });

  it('leaves the version alone when the audit row cannot be written', async () => {
    const world = await seedCancellable();
    audit.failWith = new Error('audit down');
    await expect(data.voidBookingLinks(ops, world.orderId)).rejects.toThrow(
      'audit down',
    );
    expect((await orderOf(world)).manageTokenVersion).toBe(1);
    expect(await tokens.resolveManageToken(world.token)).not.toBeNull();
  });

  it('is null for a missing booking and writes no audit row', async () => {
    const id = randomUUID();
    expect(await data.voidBookingLinks(ops, id)).toBeNull();
    expect(await auditRows(id)).toHaveLength(0);
  });
});

describe('resending the confirmation', () => {
  it('sends to the address on the booking with a link that opens it, keyed by the audited resend id', async () => {
    const world = await seedCancellable();

    expect(await resend.resendBookingConfirmation(ops, world.orderId)).toBe(
      'sent',
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [request] = sendEmail.mock.calls[0] as [
      {
        template: string;
        to: string;
        idempotencyKey: string;
        data: { manageUrl: string; calendar: unknown };
      },
    ];
    expect(request).toMatchObject({
      template: 'guest-confirmation',
      to: (await orderOf(world)).contactEmail,
    });
    expect(request.data.manageUrl).toContain(world.token);
    expect(request.data.calendar).toBeDefined();
    const [row] = await auditRows(
      world.orderId,
      'booking.ops_confirmation_resent',
    );
    const details = row?.details as { resend_id: string };
    expect(request.idempotencyKey).toBe(
      `guest-confirmation-resend:${details.resend_id}`,
    );
  });

  it('carries a rebuilt link after the earlier ones are voided', async () => {
    const world = await seedCancellable();
    await data.voidBookingLinks(ops, world.orderId);
    await resend.resendBookingConfirmation(ops, world.orderId);
    const [request] = sendEmail.mock.calls[0] as [
      { data: { manageUrl: string } },
    ];
    expect(request.data.manageUrl).toContain(
      tokens.capabilityToken('manage', world.orderId, 2),
    );
    expect(request.data.manageUrl).not.toContain(world.token);
  });

  it('sends nothing for a cancelled booking or a missing one, and writes no audit row', async () => {
    const world = await cancelled();
    expect(await resend.resendBookingConfirmation(ops, world.orderId)).toBe(
      'not_resendable',
    );
    const id = randomUUID();
    expect(await resend.resendBookingConfirmation(ops, id)).toBe('not_found');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(
      await auditRows(world.orderId, 'booking.ops_confirmation_resent'),
    ).toHaveLength(0);
    expect(await auditRows(id)).toHaveLength(0);
  });

  it('sends nothing when the audit row cannot be written', async () => {
    const world = await seedCancellable();
    audit.failWith = new Error('audit down');
    await expect(
      resend.resendBookingConfirmation(ops, world.orderId),
    ).rejects.toThrow('audit down');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('the booking page', () => {
  it('lists what ops did to the booking', async () => {
    const world = await cancelled();
    await data.voidBookingLinks(ops, world.orderId);

    const detail = await data.readOpsBooking(ops, world.orderId);

    expect(detail?.events.map((event) => event.label)).toEqual(
      expect.arrayContaining([
        'Cancelled by ramble',
        'Cancelled by ops',
        'Earlier links voided by ops',
      ]),
    );
    expect(detail).toMatchObject({ canRefund: false, canResend: false });
  });
});
