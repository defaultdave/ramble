import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import {
  LapseRefSchema,
  afterAttemptWrite,
  cancelErrorAction,
  liveAttemptStatuses,
  payingLapse,
  providerSettled,
  type LapseTarget,
} from '@/lib/holdLapse';
import { requireHoldTransition } from '@/lib/holds';
import { bookingIdempotencyKey } from '@/lib/orders';
import {
  requireAttemptTransition,
  requireOrderTransition,
} from '@/lib/providerEvents';
import { logger } from '@/server/monitoring/logger';
import { PaymentsError, type PaymentsPort } from '@/server/ports/payments';
import { db, type Transaction } from './client';
import { lockHoldRow, lockOrderRow, lockSessionRow } from './locks';
import { readLatestAttempt } from './ordersAttempts';
import { holds, orders, paymentAttempts } from './schema';
import { readDatabaseTime } from './time';

type Look =
  | { done: true; released: boolean }
  | {
      done: false;
      attemptId: string;
      idempotencyKey: string;
      target: LapseTarget;
    };

/**
 * One look at a lapsed `paying` hold under the locks of design doc 4.2.3 (session, hold, order),
 * at database time read after them; the latest attempt is read with no lock. `payingLapse`
 * decides; a release is written here in the one transaction: the attempt cancelled, the order
 * voided, the hold released as `payment_abandoned`. A cancel the provider has not made yet is
 * handed back and nothing is written.
 */
async function lookAtHold(
  tx: Transaction,
  ref: { holdId: string; sessionId: string },
  settledAttemptId: string | null,
): Promise<Look> {
  await lockSessionRow(tx, ref.sessionId);
  const hold = await lockHoldRow(tx, ref.holdId);
  if (!hold) return { done: true, released: false };
  const order =
    (await lockOrderRow(tx, bookingIdempotencyKey(hold.id))) ?? null;
  const attempt = order ? await readLatestAttempt(tx, order.id) : null;
  const at = await readDatabaseTime(tx);

  const lapse = payingLapse({ hold, order, attempt }, at, settledAttemptId);
  if (lapse.kind === 'skip') return { done: true, released: false };
  if (lapse.kind === 'cancel_first') {
    return {
      done: false,
      attemptId: lapse.attemptId,
      idempotencyKey: lapse.idempotencyKey,
      target: lapse.target,
    };
  }

  if (lapse.cancelAttempt) {
    requireAttemptTransition(lapse.cancelAttempt.from, 'canceled');
    // The attempt row is not locked (design doc 4.2.3: only the payment's second transaction takes
    // it), so the write only lands while the attempt is still live, and nothing else is written
    // before it.
    const moved = await tx
      .update(paymentAttempts)
      .set({ status: 'canceled', updatedAt: at })
      .where(
        and(
          eq(paymentAttempts.id, lapse.cancelAttempt.id),
          inArray(paymentAttempts.status, liveAttemptStatuses),
        ),
      )
      .returning({ id: paymentAttempts.id });
    if (afterAttemptWrite(moved.length) === 'skip') {
      return { done: true, released: false };
    }
  }
  if (lapse.voidOrderId !== null && order) {
    requireOrderTransition(order.status, 'void');
    await tx
      .update(orders)
      .set({ status: 'void' })
      .where(eq(orders.id, lapse.voidOrderId));
  }
  requireHoldTransition(hold.status, 'released');
  await tx
    .update(holds)
    .set({
      status: 'released',
      releasedReason: 'payment_abandoned',
      updatedAt: at,
    })
    .where(eq(holds.id, hold.id));
  return { done: true, released: true };
}

/** The payment's status once a cancel was tried: the cancel's answer, or the payment as it stands when the provider refused. */
async function paymentStatusAfterCancel(
  payments: PaymentsPort,
  holdId: string,
  look: Extract<Look, { done: false }>,
) {
  const found =
    look.target.kind === 'payment'
      ? { id: look.target.paymentId }
      : await payments.retrieve({
          kind: 'payment',
          metadata: {
            orderId: look.target.orderId,
            recordId: look.attemptId,
          },
        });
  if (found === null) return null;
  try {
    return (
      await payments.cancelPayment({
        idempotencyKey: look.idempotencyKey,
        paymentId: found.id,
      })
    ).status;
  } catch (error) {
    const code = error instanceof PaymentsError ? error.code : null;
    if (cancelErrorAction(code) === 'rethrow') throw error;
    logger.warn('Payment cancel refused, payment read instead', {
      code,
      holdId,
      attemptId: look.attemptId,
    });
    const current = await payments.retrieve({ kind: 'payment', id: found.id });
    return current?.status ?? null;
  }
}

/**
 * Ends a lapsed `paying` hold for the holds sweep, and returns whether this call released it. The
 * hold is looked at under the locks and decided by `payingLapse`. When a live attempt has to be
 * cancelled, the provider is asked between two short transactions, never inside one (design doc
 * 4.2.3, rule 6), and the hold is judged again under the locks afterwards: a hold paid, extended, or
 * released in between is left as it now stands. A payment the provider will not cancel (it is
 * processing, or it succeeded) leaves the hold for the next run, and a success lands through
 * `confirmOrder`.
 */
export async function abandonPayingHold(
  payments: PaymentsPort,
  input: z.input<typeof LapseRefSchema>,
): Promise<boolean> {
  const ref = LapseRefSchema.parse(input);
  const first = await db.transaction((tx) => lookAtHold(tx, ref, null));
  if (first.done) return first.released;

  const status = await paymentStatusAfterCancel(payments, ref.holdId, first);
  if (!providerSettled(first.target, status)) return false;
  const second = await db.transaction((tx) =>
    lookAtHold(tx, ref, first.attemptId),
  );
  return second.done && second.released;
}
