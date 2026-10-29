import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from './client';
import {
  experiences,
  holds,
  orders,
  paymentAttempts,
  sessions,
} from './schema';

/*
 * THE LOCK ORDER (design doc 4.2.3 rule 1, architecture rule B10). Every transaction that takes
 * more than one of these takes them in this order and never the other way round:
 *
 *   1. the device advisory lock   (reserve only)      lockDevice
 *   2. the session row            FOR UPDATE          lockSessionRow
 *   3. the hold row               FOR UPDATE          lockHoldRow
 *   4. the order row              FOR UPDATE          lockOrderRow
 *   5. the gift row                                   (a later unit)
 *   -  the attempt row            FOR UPDATE          lockAttemptRow, taken alone, by the payment's
 *                                                     second transaction only
 *
 * A path that starts from a hold, an order, or a provider event reads the ids it needs without a
 * lock, then locks in this order and re-checks what it read. Locks are transaction-level only
 * (`pg_advisory_xact_lock`, `FOR UPDATE`), because app traffic goes through the pooler in
 * transaction mode (ADR 0002 amendment; the pooler keeps `FOR UPDATE`, see docs/adr/research/u-013-neon-concurrency-spike.md). The settings
 * row is read with a plain SELECT, so it is not a lock and sits outside the order. A guest row,
 * taken by the checkout's guest upsert and consent write, comes after the order row, and no path
 * locks a guest and then a session, hold, or order. Later units add their lockers here, below the
 * one they follow.
 */

/**
 * Serializes writers that could collide on a unique value, until the transaction ends. A loser
 * reads the winner's committed row after the lock and returns a typed refusal instead of
 * tripping the unique index and throwing a raw database error. The key is hashed to a lock
 * number, and a hash collision only makes two unrelated writers take turns.
 */
export async function lockFor(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/** Lock 1. One reserve per device at a time, so a device's holds are judged against each other in order. */
export async function lockDevice(
  tx: Transaction,
  deviceKey: string,
): Promise<void> {
  await lockFor(tx, `hold-device:${deviceKey}`);
}

/**
 * Lock 2. The session row, with what the hold and payment paths need to know about its experience:
 * the owner (for the capacity editor's check), the status a guest may book, the tax treatment,
 * the age and waiver rules, and the cancellation tier. Undefined when there is no such session.
 * The lock is on `sessions` only, never on the experience.
 */
export async function lockSessionRow(tx: Transaction, sessionId: string) {
  const [row] = await tx
    .select({
      session: sessions,
      hostId: experiences.hostId,
      experienceStatus: experiences.status,
      taxTreatment: experiences.taxTreatment,
      ageRule: experiences.ageRule,
      minAge: experiences.minAge,
      maxAge: experiences.maxAge,
      waiverRequired: experiences.waiverRequired,
      waiverDocumentId: experiences.waiverDocumentId,
      cancellationTierId: experiences.cancellationTierId,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(eq(sessions.id, sessionId))
    .for('update', { of: sessions });
  return row;
}

/** Lock 3. The hold row, after its session's. Undefined when there is no such hold. */
export async function lockHoldRow(tx: Transaction, holdId: string) {
  const [row] = await tx
    .select()
    .from(holds)
    .where(eq(holds.id, holdId))
    .for('update');
  return row;
}

/**
 * Lock 4. The order a booking's key names, after its hold's: two tabs on one hold reach the same
 * row. Undefined when the hold has no order yet; the session lock, taken first, is what makes two
 * first calls take turns to create it.
 */
export async function lockOrderRow(tx: Transaction, idempotencyKey: string) {
  const [row] = await tx
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, idempotencyKey))
    .for('update');
  return row;
}

/**
 * The payment attempt, with the device key of its order's hold, for the payment's second
 * transaction. Taken alone: that transaction holds no other lock of the order, so it sits outside
 * the order above and cannot wait on, or be waited on in a cycle by, the paths that follow it.
 * Undefined when there is no such attempt.
 */
export async function lockAttemptRow(tx: Transaction, attemptId: string) {
  const [row] = await tx
    .select({ attempt: paymentAttempts, deviceKey: holds.deviceKey })
    .from(paymentAttempts)
    .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
    .innerJoin(holds, eq(holds.id, orders.holdId))
    .where(eq(paymentAttempts.id, attemptId))
    .for('update', { of: paymentAttempts });
  return row;
}
