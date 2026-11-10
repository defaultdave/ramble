import { eq, sql } from 'drizzle-orm';
import {
  client,
  jobsOfKind,
  orderOf,
  refundsOf,
  schema,
  seedPaidOrder,
  type PaidOrder,
} from './refundFixtures';

export type CancelWorld = PaidOrder & {
  sessionId: string;
  holdId: string;
  /** The manage token for the order at version 1, as the confirmation email carries it. */
  token: string;
  /** Seats the booking took; the session's `seats_sold` starts at `seatsSoldBefore`. */
  seats: number;
  seatsSoldBefore: number;
};

type Seed = {
  taxable?: boolean;
  /** The card paid only this much, a gift the rest. */
  amountDueMinor?: number;
  attempt?: 'succeeded' | 'none';
  /** Also make the payment at the fake gateway, so the refund job has one to refund. */
  gatewayPayment?: boolean;
  /** The free-cancellation deadline, in minutes from the database's now (negative: already past). */
  freeCancelInMinutes?: number | null;
  /** When the session starts, in minutes from the database's now. */
  startsInMinutes?: number;
};

/**
 * A confirmed booking as the confirm step leaves it: the hold converted, the session counting its
 * seats among others', a manage hash for version 1, and the deadline snapshot.
 */
export async function seedCancellable(seed: Seed = {}): Promise<CancelWorld> {
  const { capabilityToken, hashToken } = await import('@/server/tokens');
  const paid = await seedPaidOrder({
    taxable: seed.taxable ?? false,
    ...(seed.amountDueMinor === undefined
      ? {}
      : { amountDueMinor: seed.amountDueMinor }),
    ...(seed.attempt === undefined ? {} : { attempt: seed.attempt }),
    ...(seed.gatewayPayment ? { gatewayPayment: true } : {}),
  });
  const order = await orderOf(paid);
  if (order.sessionId === null || order.holdId === null) {
    throw new Error('not a booking');
  }
  const { sessionId, holdId } = order;
  const [hold] = await client.db
    .update(schema.holds)
    .set({ status: 'converted' })
    .where(eq(schema.holds.id, holdId))
    .returning({ seats: schema.holds.seats });
  if (!hold) throw new Error('no hold');
  const seatsSoldBefore = hold.seats + 3;
  await client.db
    .update(schema.sessions)
    .set({
      seatsSold: seatsSoldBefore,
      ...(seed.startsInMinutes === undefined
        ? {}
        : {
            startsAt: sql`now() + make_interval(mins => ${seed.startsInMinutes})`,
            endsAt: sql`now() + make_interval(mins => ${seed.startsInMinutes + 120})`,
          }),
    })
    .where(eq(schema.sessions.id, sessionId));
  const token = capabilityToken('manage', order.id, order.manageTokenVersion);
  const deadline =
    seed.freeCancelInMinutes === undefined ? 60 : seed.freeCancelInMinutes;
  await client.db
    .update(schema.orders)
    .set({
      manageTokenHash: hashToken(token),
      freeCancelUntil:
        deadline === null
          ? null
          : sql`now() + make_interval(mins => ${deadline})`,
    })
    .where(eq(schema.orders.id, order.id));
  return {
    ...paid,
    sessionId,
    holdId,
    token,
    seats: hold.seats,
    seatsSoldBefore,
  };
}

export async function seatsSoldOf(world: Pick<CancelWorld, 'sessionId'>) {
  const [row] = await client.db
    .select({ seatsSold: schema.sessions.seatsSold })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, world.sessionId));
  if (!row) throw new Error('no session');
  return row.seatsSold;
}

export async function auditOf(world: Pick<CancelWorld, 'orderId'>) {
  return client.db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.subjectId, world.orderId));
}

/** Everything a cancellation writes, so a refusal can be shown to have written nothing. */
export async function cancelSnapshot(world: CancelWorld) {
  const order = await orderOf(world);
  const ledger = await client.db
    .select({ id: schema.ledgerEntries.id })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.orderId, world.orderId));
  return {
    status: order.status,
    cancelledAt: order.cancelledAt,
    cancelledBy: order.cancelledBy,
    refunded: [
      order.refundedTicketMinor,
      order.refundedTaxMinor,
      order.commissionReturnedMinor,
    ],
    refunds: (await refundsOf(world)).length,
    seatsSold: await seatsSoldOf(world),
    audit: (await auditOf(world)).length,
    ledger: ledger.length,
    jobs: {
      refund: (await jobsOfKind('process-refund')).length,
      guest: (await jobsOfKind('guest-cancellation')).length,
      host: (await jobsOfKind('host-cancellation-notice')).length,
    },
  };
}
