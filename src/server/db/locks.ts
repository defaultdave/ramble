import 'server-only';
import { sql } from 'drizzle-orm';
import type { db } from './client';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializes writers that could collide on a unique value, until the transaction ends. A loser
 * reads the winner's committed row after the lock and returns a typed refusal instead of
 * tripping the unique index and throwing a raw database error. The key is hashed to a lock
 * number, and a hash collision only makes two unrelated writers take turns.
 */
export async function lockFor(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}
