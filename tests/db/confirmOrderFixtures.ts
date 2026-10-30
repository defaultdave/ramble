import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { db as Db } from '@/server/db/client';
import {
  orderItems,
  orders,
  paymentAttempts,
  sessions,
} from '@/server/db/schema';
import { insertHold, insertSession } from './holdFixtures';
import type { createOrderParents } from './orderParents';

type Database = typeof Db;
type Parents = Awaited<ReturnType<typeof createOrderParents>>;

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reference = () =>
  `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;

export type BookingSeed = {
  allocation?: number;
  seatsSold?: number;
  sessionStatus?: 'scheduled' | 'cancelled';
  holdSeats?: number;
  /** `open` is paying with time left, `lapsed` an active hold past its expiry, `released` one the upkeep tidied. */
  hold?: 'open' | 'lapsed' | 'released';
  orderStatus?: 'pending_payment' | 'payment_failed' | 'void';
  orderKind?: 'booking' | 'zero_due' | 'gift_purchase';
  /** Two guests at $65, not taxable (the design doc's worked example), or $170 taxable. */
  taxable?: boolean;
  /** An experience, host, and session made elsewhere (a bookable the reserve path can use). */
  on?: { experienceId: string; hostId: string; sessionId: string };
};

export type BookingWorld = {
  orderId: string;
  attemptId: string;
  holdId: string;
  sessionId: string;
  paymentId: string;
  amountDueMinor: number;
};

const amounts = {
  worked: {
    subtotal: 13000,
    tax: 0,
    total: 13000,
    commission: 1950,
    ppm: 0,
    treatment: 'not_taxable',
  },
  taxable: {
    subtotal: 17000,
    tax: 1509,
    total: 18509,
    commission: 2550,
    ppm: 88750,
    treatment: 'taxable',
  },
} as const;

/** A booking order, its hold, session, and one processing payment attempt, in the states the seed names. */
export async function seedBooking(
  db: Database,
  parents: Parents,
  seed: BookingSeed = {},
): Promise<BookingWorld> {
  const money = amounts[seed.taxable ? 'taxable' : 'worked'];
  const session = seed.on
    ? { id: seed.on.sessionId }
    : await insertSession(db, parents.experienceId, {
        allocation: seed.allocation ?? 10,
        seatsSold: seed.seatsSold ?? 0,
        ...(seed.sessionStatus === 'cancelled'
          ? { status: 'cancelled', cancelReason: 'host' }
          : {}),
      });
  if (seed.on && seed.sessionStatus === 'cancelled') {
    await db
      .update(sessions)
      .set({ status: 'cancelled', cancelReason: 'host' })
      .where(sql`${sessions.id} = ${session.id}`);
  }
  const state = seed.hold ?? 'open';
  const hold = await insertHold(db, session.id, {
    seats: seed.holdSeats ?? 2,
    ...(state === 'open'
      ? {
          status: 'paying',
          payingUntil: sql`now() + make_interval(mins => 12)`,
        }
      : {
          createdAt: sql`now() - make_interval(mins => 30)`,
          ...(state === 'released'
            ? { status: 'released', releasedReason: 'expired' }
            : {}),
        }),
  });
  const kind = seed.orderKind ?? 'booking';
  const [order] = await db
    .insert(orders)
    .values({
      reference: reference(),
      kind: kind === 'gift_purchase' ? 'gift_purchase' : 'booking',
      status: seed.orderStatus ?? 'pending_payment',
      idempotencyKey:
        kind === 'gift_purchase' ? randomUUID() : `book:${hold.id}`,
      holdId: kind === 'gift_purchase' ? null : hold.id,
      sessionId: kind === 'gift_purchase' ? null : session.id,
      experienceId: seed.on?.experienceId ?? parents.experienceId,
      hostId: seed.on?.hostId ?? parents.hostId,
      guestId: parents.guestId,
      contactEmail: 'pat@example.com',
      leadGuestName: kind === 'gift_purchase' ? null : 'Pat Smith',
      termsDocumentId: parents.termsDocumentId,
      ticketSubtotalMinor: money.subtotal,
      taxTreatment: money.treatment,
      taxRatePpm: money.ppm,
      taxMinor: money.tax,
      totalMinor: money.total,
      ...(kind === 'zero_due'
        ? {
            giftId: randomUUID(),
            giftAppliedMinor: money.total,
            amountDueMinor: 0,
          }
        : { amountDueMinor: money.total }),
      commissionRateBps: 1500,
      commissionMinor: money.commission,
      cancellationTierId: parents.tierId,
    })
    .returning({ id: orders.id });
  if (!order) throw new Error('no order');
  if (kind !== 'gift_purchase') {
    await db.insert(orderItems).values({
      orderId: order.id,
      priceOptionId: parents.priceOptionId,
      label: 'Adult',
      quantity: 2,
      unitPriceMinor: money.subtotal / 2,
      usesSpace: true,
      lineTotalMinor: money.subtotal,
    });
  }
  const paymentId = `pay_${randomUUID()}`;
  const [attempt] = await db
    .insert(paymentAttempts)
    .values({
      orderId: order.id,
      attemptNo: 1,
      provider: 'fake',
      providerKey: `pay:${order.id}:1`,
      providerPaymentId: paymentId,
      amountMinor: money.total,
      status: 'processing',
    })
    .returning({ id: paymentAttempts.id });
  if (!attempt) throw new Error('no attempt');
  return {
    orderId: order.id,
    attemptId: attempt.id,
    holdId: hold.id,
    sessionId: session.id,
    paymentId,
    amountDueMinor: money.total,
  };
}

/** Another guest's hold on the session, open for the next twelve minutes. */
export async function insertOtherOpenHold(
  db: Database,
  sessionId: string,
  seats: number,
) {
  return insertHold(db, sessionId, {
    seats,
    status: 'paying',
    payingUntil: sql`now() + make_interval(mins => 12)`,
    deviceKey: 'c'.repeat(64),
    ipHash: 'd'.repeat(64),
  });
}
