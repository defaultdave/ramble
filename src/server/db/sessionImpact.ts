import 'server-only';
import { and, asc, inArray } from 'drizzle-orm';
import {
  fanOutHoldStatuses,
  fanOutLimit,
  fanOutOrderStatuses,
  requireWithinFanOut,
} from '@/lib/cancelSession';
import { requireAtMost } from '@/lib/holds';
import { impactOrders, sessionImpact, type Impact } from '@/lib/opsSessions';
import { attemptReadLimit } from '@/lib/refunds';
import type { db } from './client';
import { refundableOrderColumns } from './orderColumns';
import { holds, orders, paymentAttempts } from './schema';

// What cancelling sessions would do, read as it stands now. The ops session page and the host's
// cancel page show it before anyone confirms, and both read it here so the two cannot disagree. It
// checks no caller: each function that calls it has already checked its own subject.

export type Executor = Pick<typeof db, 'select'>;

/** The holds a cancellation would release, for the sessions given. */
export async function readReleasableHolds(
  executor: Executor,
  sessionIds: string[],
) {
  if (sessionIds.length === 0) return [];
  return requireWithinFanOut(
    await executor
      .select({
        sessionId: holds.sessionId,
        status: holds.status,
        seats: holds.seats,
        expiresAt: holds.expiresAt,
        payingUntil: holds.payingUntil,
      })
      .from(holds)
      .where(
        and(
          inArray(holds.sessionId, sessionIds),
          inArray(holds.status, fanOutHoldStatuses),
        ),
      )
      .limit(fanOutLimit + 1),
    'releasable holds',
  );
}

/** What cancelling the sessions given would do to their orders and holds, read as it stands now. */
export async function readImpact(
  executor: Executor,
  sessionIds: string[],
  at: Date,
): Promise<Impact> {
  if (sessionIds.length === 0) return sessionImpact([], [], at);
  const orderRows = requireWithinFanOut(
    await executor
      .select({
        id: orders.id,
        reference: orders.reference,
        ...refundableOrderColumns,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.sessionId, sessionIds),
          inArray(orders.status, fanOutOrderStatuses),
        ),
      )
      .orderBy(asc(orders.reference))
      .limit(fanOutLimit + 1),
    'orders',
  );
  const attempts =
    orderRows.length === 0
      ? []
      : requireAtMost(
          await executor
            .select({
              orderId: paymentAttempts.orderId,
              status: paymentAttempts.status,
              providerPaymentId: paymentAttempts.providerPaymentId,
            })
            .from(paymentAttempts)
            .where(
              inArray(
                paymentAttempts.orderId,
                orderRows.map((order) => order.id),
              ),
            )
            .limit(fanOutLimit * attemptReadLimit + 1),
          fanOutLimit * attemptReadLimit,
          'payment attempts',
        );
  return sessionImpact(
    impactOrders(orderRows, attempts),
    await readReleasableHolds(executor, sessionIds),
    at,
  );
}
