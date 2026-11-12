import { eq, sql } from 'drizzle-orm';
import { bookingPaid } from '@/lib/ledger';
import type { Caller } from '@/server/auth/caller';
import { seedBooking } from './confirmOrderFixtures';
import { insertHold, insertSession } from './holdFixtures';
import {
  client,
  gateway,
  getParents,
  jobsOfKind,
  refundsOf,
  schema,
} from './refundFixtures';

export const ops: Caller = { userId: null, roles: ['ops'], hostIds: [] };

export const hostOwner = (hostId: string): Caller => ({
  userId: null,
  roles: ['host_owner'],
  hostIds: [hostId],
});

/** A scheduled session of the file's experience, in a week. */
export function newSession(
  over: Parameters<typeof insertSession>[2] = {},
): Promise<{ id: string }> {
  const startsAt = over.startsAt instanceof Date ? over.startsAt : undefined;
  return insertSession(client.db, getParents().experienceId, {
    allocation: 20,
    ...(startsAt
      ? { endsAt: new Date(startsAt.getTime() + 2 * 60 * 60_000) }
      : {}),
    ...over,
  });
}

const on = (sessionId: string) => {
  const { experienceId, hostId } = getParents();
  return { experienceId, hostId, sessionId };
};

export type SeededOrder = {
  orderId: string;
  holdId: string;
  attemptId: string;
  paymentId: string;
  seats: number;
};

/** A booking as the confirm step leaves it: paid at the fake provider, confirmed, the hold converted, its seats counted. */
export async function seedConfirmedOn(
  sessionId: string,
  seats = 2,
): Promise<SeededOrder> {
  const world = await seedBooking(client.db, getParents(), {
    on: on(sessionId),
    holdSeats: seats,
  });
  const [order] = await client.db
    .update(schema.orders)
    .set({ status: 'confirmed', confirmedAt: sql`clock_timestamp()` })
    .where(eq(schema.orders.id, world.orderId))
    .returning();
  if (!order) throw new Error('no order');
  const fake = gateway.getFakePayments();
  const created = await fake.createPayment({
    idempotencyKey: `pay:${order.id}:1`,
    amountMinor: order.amountDueMinor,
    currency: 'USD',
    metadata: { orderId: order.id, recordId: world.attemptId },
  });
  await fake.confirm(created.id, { outcome: 'succeeded' });
  await client.db
    .update(schema.paymentAttempts)
    .set({ status: 'succeeded', providerPaymentId: created.id })
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  await client.db
    .update(schema.holds)
    .set({ status: 'converted' })
    .where(eq(schema.holds.id, world.holdId));
  await client.db
    .update(schema.sessions)
    .set({ seatsSold: sql`${schema.sessions.seatsSold} + ${seats}` })
    .where(eq(schema.sessions.id, sessionId));
  const ledgerData = await import('@/server/db/ledger');
  await client.db.transaction((tx) =>
    ledgerData.postEntries(
      tx,
      bookingPaid({
        occurredAt: new Date(),
        simulated: true,
        orderId: order.id,
        hostId: order.hostId,
        paymentAttemptId: world.attemptId,
        providerObjectId: created.id,
        split: {
          ticketMinor: order.ticketSubtotalMinor,
          commissionMinor: order.commissionMinor,
          taxMinor: order.taxMinor,
        },
      }),
    ),
  );
  return {
    orderId: order.id,
    holdId: world.holdId,
    attemptId: world.attemptId,
    paymentId: created.id,
    seats,
  };
}

/** A guest mid-payment: a `paying` hold, a `pending_payment` order, and a live attempt whose payment waits at the fake provider. */
export async function seedUnpaidOn(
  sessionId: string,
  over: { orderStatus?: 'pending_payment' | 'payment_failed' } = {},
): Promise<SeededOrder> {
  const world = await seedBooking(client.db, getParents(), {
    on: on(sessionId),
    orderStatus: over.orderStatus ?? 'pending_payment',
  });
  const fake = gateway.getFakePayments();
  const created = await fake.createPayment({
    idempotencyKey: `pay:${world.orderId}:1`,
    amountMinor: world.amountDueMinor,
    currency: 'USD',
    metadata: { orderId: world.orderId, recordId: world.attemptId },
  });
  await client.db
    .update(schema.paymentAttempts)
    .set({ status: 'requires_action', providerPaymentId: created.id })
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  return {
    orderId: world.orderId,
    holdId: world.holdId,
    attemptId: world.attemptId,
    paymentId: created.id,
    seats: 2,
  };
}

/** A browsing guest's hold with no order yet. */
export async function seedActiveHoldOn(sessionId: string, seats = 1) {
  return insertHold(client.db, sessionId, { seats });
}

export async function sessionOf(sessionId: string) {
  const [row] = await client.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  if (!row) throw new Error('no session');
  return row;
}

export async function holdOf(holdId: string) {
  const [row] = await client.db
    .select()
    .from(schema.holds)
    .where(eq(schema.holds.id, holdId));
  if (!row) throw new Error('no hold');
  return row;
}

export async function orderRow(orderId: string) {
  const [row] = await client.db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (!row) throw new Error('no order');
  return row;
}

export async function attemptOf(attemptId: string) {
  const [row] = await client.db
    .select()
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.id, attemptId));
  if (!row) throw new Error('no attempt');
  return row;
}

/** Everything a session cancellation writes, so a refusal or a repeat can be shown to have written nothing. */
export async function snapshot(sessionId: string, orderIds: string[]) {
  const session = await sessionOf(sessionId);
  const audit = await client.db.select().from(schema.auditLog);
  const ledger = await client.db.select().from(schema.ledgerEntries);
  const refunds = await Promise.all(
    orderIds.map((orderId) => refundsOf({ orderId })),
  );
  return {
    session: [
      session.status,
      session.cancelReason,
      session.version,
      session.seatsSold,
    ],
    audit: audit.length,
    ledger: ledger.length,
    refunds: refunds.flat().length,
    jobs: {
      refund: (await jobsOfKind('process-refund')).length,
      guest: (await jobsOfKind('guest-cancellation')).length,
      late: (await jobsOfKind('guest-paid-after-lapse')).length,
    },
  };
}
