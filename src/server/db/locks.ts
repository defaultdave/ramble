import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from './client';
import { experiences, holds, sessions } from './schema';

/*
 * THE LOCK ORDER (design doc 4.2.3 rule 1, architecture rule B10). Every transaction that takes
 * more than one of these takes them in this order and never the other way round:
 *
 *   1. the device advisory lock   (reserve only)      lockDevice, then lockClientAddress
 *   2. the session row            FOR UPDATE          lockSessionRow
 *   3. the hold row               FOR UPDATE          lockHoldRow
 *   4. the order row                                  (a later unit)
 *   5. the gift row                                   (a later unit)
 *
 * A path that starts from a hold, an order, or a provider event reads the ids it needs without a
 * lock, then locks in this order and re-checks what it read. Locks are transaction-level only
 * (`pg_advisory_xact_lock`, `FOR UPDATE`), because app traffic goes through the pooler in
 * transaction mode (ADR 0002 amendment; the pooler keeps `FOR UPDATE`, see docs/adr/research/u-013-neon-concurrency-spike.md). The settings
 * row is read with a plain SELECT, so it is not a lock and sits outside the order. Later units add
 * their lockers here, below the one they follow.
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
 * Lock 1, after the device's. The limits count a device's holds and the holds from its address, so
 * two devices on one address are judged against each other in order too. Always taken second, so
 * two reserves cannot wait on each other's locks in opposite orders.
 */
export async function lockClientAddress(
  tx: Transaction,
  ipHash: string,
): Promise<void> {
  await lockFor(tx, `hold-address:${ipHash}`);
}

/**
 * Lock 2. The session row, with what the hold path needs to know about its experience: the owner
 * (for the capacity editor's check), the status a guest may book, and the tax treatment. Undefined
 * when there is no such session. The lock is on `sessions` only, never on the experience.
 */
export async function lockSessionRow(tx: Transaction, sessionId: string) {
  const [row] = await tx
    .select({
      session: sessions,
      hostId: experiences.hostId,
      experienceStatus: experiences.status,
      taxTreatment: experiences.taxTreatment,
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
