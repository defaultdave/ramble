import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  reviewEligibility,
  reviewInviteBatchSize,
  reviewInviteKey,
  reviewInviteKind,
  reviewInviteResendKey,
  reviewInviteRunAt,
} from '@/lib/reviews';
import { requireAnyRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import { readInvitableOrders, readReviewOrder } from '@/server/db/reviews';
import { readDatabaseTime } from '@/server/db/time';
import { enqueue } from './enqueue';

/**
 * Queues an invite for every booking whose session ended long enough ago and has none yet, at
 * most one batch per sweep. One dedupe key per order, so an order is invited once however often
 * the sweep runs; a backlog (a pulse outage) drains over the next sweeps. Judged on the pulse's
 * clock, so a test console that moves the clock on invites for the sessions it has moved past.
 * Returns how many were new.
 */
export async function scheduleReviewInvites(now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await readInvitableOrders(tx, now, reviewInviteBatchSize);
    let queued = 0;
    for (const order of due) {
      const job = await enqueue(tx, {
        kind: reviewInviteKind,
        payload: { orderId: order.orderId },
        dedupeKey: reviewInviteKey(order.orderId),
        runAfter: reviewInviteRunAt(order.endsAt, now),
      });
      if (job) queued += 1;
    }
    return queued;
  });
}

/**
 * Queues one invite for an order right now, for the test console. The order must be invitable at
 * the database's time, the same rule the sweep and the form use. Each call is a new send with its
 * own email key, so a tester can send the same order's invite again.
 */
export async function queueReviewInviteNow(
  caller: Caller,
  orderId: string,
): Promise<'queued' | 'not_eligible'> {
  requireAnyRole(caller, [Role.Ops, Role.Admin], {});
  return db.transaction(async (tx) => {
    const order = await readReviewOrder(tx, orderId);
    if (!order) return 'not_eligible';
    const now = await readDatabaseTime(tx);
    if (!reviewEligibility(order.facts, now).ok) return 'not_eligible';
    const sendId = randomUUID();
    await enqueue(tx, {
      kind: reviewInviteKind,
      payload: { orderId: order.orderId, sendId },
      dedupeKey: reviewInviteResendKey(sendId),
      runAfter: now,
    });
    return 'queued';
  });
}
