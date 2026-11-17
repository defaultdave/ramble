import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  fanOutHoldStatuses,
  fanOutLimit,
  fanOutOrderStatuses,
  requireWithinFanOut,
} from '@/lib/cancelSession';
import { requireAtMost } from '@/lib/holds';
import { impactOrders, sessionImpact, type Impact } from '@/lib/opsSessions';
import { attemptReadLimit } from '@/lib/refunds';
import {
  requireAnyRole,
  Role,
  type Caller,
  type Resource,
} from '@/server/auth/caller';
import type { db } from './client';
import { refundableOrderColumns } from './orderColumns';
import {
  experiences,
  holds,
  orders,
  paymentAttempts,
  sessions,
} from './schema';

// What cancelling sessions would do, read as it stands now. The ops session page and the host's
// cancel page show it before anyone confirms, and both read it here so the two cannot disagree. It
// reads guests' holds, orders and payment attempts, so it takes the caller and a scope: ops and admin
// pass with `{}`, a host owner only with the `hostId` of the host whose sessions are given (the
// caller of the host path has found each session on that host before it reads).

/** Ops and admin on any session; a host owner only when the scope names the host they own. */
function requireImpactReader(caller: Caller, scope: Resource) {
  requireAnyRole(caller, [Role.Ops, Role.Admin, Role.HostOwner], scope);
}

export type Executor = Pick<typeof db, 'select'>;

/**
 * The session ids the read may see. Ops and admin pass `{}` and see every id given; a host owner's
 * scope names the host, so an id of another host's session matches nothing, in the query itself.
 */
function scopedIds(scope: Resource, executor: Executor, sessionIds: string[]) {
  if (scope.hostId === undefined) return sessionIds;
  return executor
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(
      and(
        inArray(sessions.id, sessionIds),
        eq(experiences.hostId, scope.hostId),
      ),
    );
}

/** The holds a cancellation would release, for the sessions given. */
export async function readReleasableHolds(
  caller: Caller,
  scope: Resource,
  executor: Executor,
  sessionIds: string[],
) {
  requireImpactReader(caller, scope);
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
          inArray(holds.sessionId, scopedIds(scope, executor, sessionIds)),
          inArray(holds.status, fanOutHoldStatuses),
        ),
      )
      .limit(fanOutLimit + 1),
    'releasable holds',
  );
}

/** What cancelling the sessions given would do to their orders and holds, read as it stands now. */
export async function readImpact(
  caller: Caller,
  scope: Resource,
  executor: Executor,
  sessionIds: string[],
  at: Date,
): Promise<Impact> {
  requireImpactReader(caller, scope);
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
          inArray(orders.sessionId, scopedIds(scope, executor, sessionIds)),
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
    await readReleasableHolds(caller, scope, executor, sessionIds),
    at,
  );
}
