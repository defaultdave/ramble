import 'server-only';
import { eq } from 'drizzle-orm';
import { bookingEmailKey, reminderRunAt } from '@/lib/bookingEmails';
import { enqueue } from '@/server/jobs/enqueue';
import type { Transaction } from './client';
import { orders, sessions } from './schema';

// Not in ./bookingEmails: the booking email jobs import that file, and `enqueue` imports the job
// registry that imports them, so a file there that called `enqueue` would be a circular import.

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
  const [row] = await tx
    .select({ startsAt: sessions.startsAt })
    .from(orders)
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .where(eq(orders.id, input.orderId));
  if (!row) throw new Error('A reminder needs an order with a session');
  const runAfter = reminderRunAt(row.startsAt, input.now);
  if (runAfter === null) return null;
  return enqueue(tx, {
    kind: 'session-reminder',
    payload: { orderId: input.orderId },
    dedupeKey: bookingEmailKey('session-reminder', input.orderId),
    runAfter,
  });
}
