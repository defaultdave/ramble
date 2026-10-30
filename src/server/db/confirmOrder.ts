import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { bookingEmailKey } from '@/lib/bookingEmails';
import {
  NotBuiltError,
  confirmDecision,
  isPaymentMismatch,
  isSeatsSoldRefusal,
  isSimulatedPayment,
  type ConfirmDecisionInput,
  type NotBuiltBranch,
  type RefundPathReason,
} from '@/lib/confirmOrder';
import { requireHoldTransition } from '@/lib/holds';
import { bookingPaid } from '@/lib/ledger';
import { requireOrderTransition } from '@/lib/providerEvents';
import { transferProviderKey, transferReleaseAfter } from '@/lib/transfers';
import { revalidateTagsForChanges } from '@/server/cache/invalidate';
import { enqueue } from '@/server/jobs/enqueue';
import { alerts } from '@/server/monitoring/alerts';
import { capabilityToken, hashToken } from '@/server/tokens';
import type { Transaction } from './client';
import { readOpenHeldSeats } from './holds';
import { postEntries, postProviderFee } from './ledger';
import { takeRefundPath } from './refundPath';
import { holds, orders, paymentAttempts, sessions, transfers } from './schema';

/** What the provider event job tells the confirm step about the success it is acting on. */
type ConfirmOrderInput = {
  orderId: string;
  attemptId: string;
  providerEventId: string;
  providerPaymentId: string;
  amountMinor: number | null;
  currency: string | null;
  feeMinor: number | null;
  now: Date;
};

type ConfirmOrderResult =
  /** Confirmed by this call. `reference` is the order's `RMB-` reference. */
  | { status: 'confirmed'; reference: string }
  /** The order was confirmed before; nothing was written. */
  | { status: 'already_confirmed'; reference: string }
  /** The payment cannot be confirmed and the refund path is not built yet: the event stays unprocessed. */
  | { status: 'unavailable' };

/**
 * The seam between a provider's success event and `confirmOrder` (design doc 4.2.3). It runs inside
 * the event job's transaction, under the session, hold, and order locks.
 */
export type ConfirmOrder = (
  tx: Transaction,
  input: ConfirmOrderInput,
) => Promise<ConfirmOrderResult>;

// Money paths run as the system, like `postEntries`: the provider's signature on the event is what
// authorized this, so the function takes no `Caller` (architecture rule B6, by design).

type OrderRow = Awaited<ReturnType<typeof readOrder>>;

async function readOrder(tx: Transaction, orderId: string) {
  const [row] = await tx
    .select({
      id: orders.id,
      reference: orders.reference,
      kind: orders.kind,
      status: orders.status,
      currency: orders.currency,
      amountDueMinor: orders.amountDueMinor,
      giftAppliedMinor: orders.giftAppliedMinor,
      ticketSubtotalMinor: orders.ticketSubtotalMinor,
      taxMinor: orders.taxMinor,
      commissionMinor: orders.commissionMinor,
      hostId: orders.hostId,
      holdId: orders.holdId,
      sessionId: orders.sessionId,
      manageTokenVersion: orders.manageTokenVersion,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!row) throw new Error('The order to confirm does not exist');
  return row;
}

type BookingRows = {
  sessionId: string;
  holdId: string;
  sessionEndsAt: Date;
  facts: NonNullable<ConfirmDecisionInput['booking']>;
};

/**
 * The session and hold of a booking, and the seats the session's open holds take, read with plain
 * SELECTs: the caller's session and hold locks are what keep them from changing.
 */
async function readBooking(
  tx: Transaction,
  order: OrderRow,
  at: Date,
): Promise<BookingRows | null> {
  if (order.kind !== 'booking') return null;
  const { sessionId, holdId } = order;
  if (sessionId === null || holdId === null) {
    throw new Error('A booking order has no session or hold');
  }
  const [session] = await tx
    .select({
      status: sessions.status,
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
      endsAt: sessions.endsAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  const [hold] = await tx
    .select({
      status: holds.status,
      seats: holds.seats,
      expiresAt: holds.expiresAt,
      payingUntil: holds.payingUntil,
    })
    .from(holds)
    .where(eq(holds.id, holdId));
  if (!session || !hold) {
    throw new Error('A booking order has no session or hold');
  }
  return {
    sessionId,
    holdId,
    sessionEndsAt: session.endsAt,
    facts: {
      session,
      hold,
      openHeldSeats: await readOpenHeldSeats(tx, sessionId, at),
    },
  };
}

/** Confirmations that belong to later units. A payment that reaches one is a bug until they land. */
const notBuilt = {
  // TODO(U-062a): confirm a gift purchase: gift scheduled, `gift_liability_in`, the delivery job.
  gift_purchase: () => {
    throw new NotBuiltError('gift_purchase');
  },
  // TODO(U-064a): confirm an order with nothing due, from `redeemGift`.
  zero_due: () => {
    throw new NotBuiltError('zero_due');
  },
  // TODO(U-065a): confirm an exchange, settling the difference with the buyer.
  exchange: () => {
    throw new NotBuiltError('exchange');
  },
} as const satisfies Record<NotBuiltBranch, () => never>;

/**
 * The confirm writes of a booking, all in the transaction they are given (a savepoint, so a refusal
 * leaves none of them behind). The seat count goes first: it is the write the database's CHECK can refuse.
 * TODO(U-086): the `booking_confirmed` event, in this transaction.
 */
async function writeBookingConfirmed(
  tx: Transaction,
  order: OrderRow,
  booking: BookingRows,
  input: ConfirmOrderInput,
): Promise<void> {
  const at = input.now;
  const [attempt] = await tx
    .select({ provider: paymentAttempts.provider })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, input.attemptId));
  if (!attempt) {
    throw new Error('The payment attempt to confirm does not exist');
  }

  await tx
    .update(sessions)
    .set({
      seatsSold: sql`${sessions.seatsSold} + ${booking.facts.hold.seats}`,
    })
    .where(eq(sessions.id, booking.sessionId));

  requireHoldTransition(booking.facts.hold.status, 'converted');
  await tx
    .update(holds)
    .set({
      status: 'converted',
      releasedReason: null,
      supersededBy: null,
      updatedAt: at,
    })
    .where(eq(holds.id, booking.holdId));

  requireOrderTransition(order.status, 'confirmed');
  await tx
    .update(orders)
    .set({
      status: 'confirmed',
      confirmedAt: at,
      manageTokenHash: hashToken(
        capabilityToken('manage', order.id, order.manageTokenVersion),
      ),
    })
    .where(eq(orders.id, order.id));

  const simulated = isSimulatedPayment(attempt.provider);
  await postEntries(
    tx,
    bookingPaid({
      occurredAt: at,
      simulated,
      orderId: order.id,
      hostId: order.hostId,
      paymentAttemptId: input.attemptId,
      providerObjectId: input.providerPaymentId,
      split: {
        ticketMinor: order.ticketSubtotalMinor,
        commissionMinor: order.commissionMinor,
        taxMinor: order.taxMinor,
      },
    }),
  );
  await postProviderFee(tx, {
    providerPaymentId: input.providerPaymentId,
    feeMinor: input.feeMinor,
    orderId: order.id,
    hostId: order.hostId,
    paymentAttemptId: input.attemptId,
    simulated,
    at,
  });

  await tx.insert(transfers).values({
    orderId: order.id,
    hostId: order.hostId,
    releaseAfter: transferReleaseAfter(booking.sessionEndsAt),
    providerKey: transferProviderKey(order.id),
    status: 'scheduled',
  });

  for (const kind of ['guest-confirmation', 'host-booking-notice'] as const) {
    await enqueue(tx, {
      kind,
      payload: { orderId: order.id },
      dedupeKey: bookingEmailKey(kind, order.id),
    });
  }
}

function refundPath(
  tx: Transaction,
  input: ConfirmOrderInput,
  reason: RefundPathReason,
): Promise<ConfirmOrderResult> {
  if (isPaymentMismatch(reason)) {
    alerts.raise('payment-amount-mismatch', 'error', `order:${input.orderId}`, {
      orderId: input.orderId,
      attemptId: input.attemptId,
      reason,
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
  }
  return takeRefundPath(tx, {
    orderId: input.orderId,
    attemptId: input.attemptId,
    providerPaymentId: input.providerPaymentId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    reason,
    at: input.now,
  });
}

/**
 * Turns a succeeded payment into a booking (design doc 4.2.3, `confirmOrder`). It runs in the
 * caller's transaction, after the caller's locks, and takes none of its own: the event job holds
 * the order's events lock, then the session, hold, and order locks, and `input.now` is the database
 * time it read after them (rule 2), never the provider's `occurred_at`. Any later caller (`redeemGift`,
 * an exchange top-up) takes the order's events lock first, so a success event and a
 * redemption of one order never run together (audit BC-17), and then the same locks in the same order.
 *
 * The confirm writes run in a savepoint. When the database refuses the seat count (the session's
 * CHECK, which holds a capacity lowered below what is held), the savepoint rolls back and the
 * payment takes the refund path in the confirm's place. The refund path is not built yet, so a
 * payment that cannot be confirmed answers `unavailable` and the event retries.
 */
export const confirmOrder: ConfirmOrder = async (tx, input) => {
  const order = await readOrder(tx, input.orderId);
  const booking = await readBooking(tx, order, input.now);
  const decision = confirmDecision({
    order,
    payment: { amountMinor: input.amountMinor, currency: input.currency },
    booking: booking?.facts ?? null,
    at: input.now,
  });

  switch (decision.kind) {
    case 'already_confirmed':
      return { status: 'already_confirmed', reference: order.reference };
    case 'not_built':
      return notBuilt[decision.branch]();
    case 'refund_path':
      return refundPath(tx, input, decision.reason);
    case 'confirm': {
      if (booking === null) throw new Error('A booking order has no booking');
      try {
        await tx.transaction((savepoint) =>
          writeBookingConfirmed(savepoint, order, booking, input),
        );
      } catch (error) {
        if (!isSeatsSoldRefusal(error)) throw error;
        return refundPath(tx, input, 'sold_out_after_lapse');
      }
      revalidateTagsForChanges([
        { kind: 'spaces', sessionId: booking.sessionId },
      ]);
      return { status: 'confirmed', reference: order.reference };
    }
  }
};
