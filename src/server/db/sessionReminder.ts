import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import {
  bookingEmailKey,
  reminderAfterMove,
  reminderMoveJobKey,
  reminderRunAt,
} from '@/lib/bookingEmails';
import { SessionReminderPayloadSchema } from '@/server/jobs/bookingEmails';
import { enqueue } from '@/server/jobs/enqueue';
import type { Transaction } from './client';
import { jobs, orders, sessions } from './schema';

// Not in ./bookingEmails: the booking email jobs import that file, and `enqueue` imports the job
// registry that imports them, so a file there that called `enqueue` would be a circular import.

async function readSessionStart(
  tx: Transaction,
  orderId: string,
): Promise<Date> {
  const [row] = await tx
    .select({ startsAt: sessions.startsAt })
    .from(orders)
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .where(eq(orders.id, orderId));
  if (!row) throw new Error('A reminder needs an order with a session');
  return row.startsAt;
}

/**
 * Queues the guest's reminder for an order the caller has just confirmed, in the caller's
 * transaction. The job is due 24 hours before the session, or at `now` when the booking is made
 * inside that window. The key is the order's, so a replayed confirm queues it once. Returns null
 * and queues nothing when the session has already started or the reminder was queued before.
 */
export async function enqueueSessionReminder(
  tx: Transaction,
  input: { orderId: string; now: Date },
): Promise<{ id: string } | null> {
  const startsAt = await readSessionStart(tx, input.orderId);
  const runAfter = reminderRunAt(startsAt, input.now);
  if (runAfter === null) return null;
  return enqueue(tx, {
    kind: 'session-reminder',
    payload: { orderId: input.orderId },
    dedupeKey: bookingEmailKey('session-reminder', input.orderId),
    runAfter,
  });
}

const waitingReminder = (orderId: string) =>
  and(
    eq(jobs.kind, 'session-reminder'),
    eq(jobs.status, 'pending'),
    sql`${jobs.payload}->>'orderId' = ${orderId}`,
  );

/**
 * Keeps the guest's reminder on the date the order is now on, in the caller's transaction (the
 * move's), after the order has been moved. A reminder still waiting has its run time and its move
 * id rewritten in place; with none waiting a fresh one is queued under the move's own key
 * (`reminderAfterMove` decides which). The waiting row is locked, so a drain that is claiming
 * jobs skips it and never sends the old time.
 */
export async function retimeSessionReminder(
  tx: Transaction,
  input: { orderId: string; moveId: string; now: Date },
): Promise<void> {
  const startsAt = await readSessionStart(tx, input.orderId);
  const waiting = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(waitingReminder(input.orderId))
    .for('update');
  const plan = reminderAfterMove({
    startsAt,
    now: input.now,
    hasPendingReminder: waiting.length > 0,
  });
  if (plan.kind === 'none') return;
  const payload = SessionReminderPayloadSchema.parse({
    orderId: input.orderId,
    moveId: input.moveId,
  });
  if (plan.kind === 'enqueue') {
    await enqueue(tx, {
      kind: 'session-reminder',
      payload,
      dedupeKey: reminderMoveJobKey(input.moveId),
      runAfter: plan.runAfter,
    });
    return;
  }
  await tx
    .update(jobs)
    .set({ runAfter: plan.runAfter, payload })
    .where(waitingReminder(input.orderId));
}
