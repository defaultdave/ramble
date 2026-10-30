import 'server-only';
import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { db, type Transaction } from './client';
import { orders } from './schema';

// What src/server/tokens.ts reads and writes on `orders`: the version and hash a capability token
// is checked against. It decides nothing; the derivation and every comparison live in tokens.ts.

export type OrderTokenRow = { id: string; version: number };

export async function readOrderByManageHash(
  hash: string,
): Promise<OrderTokenRow | null> {
  const [row] = await db
    .select({ id: orders.id, version: orders.manageTokenVersion })
    .from(orders)
    .where(eq(orders.manageTokenHash, hash))
    .limit(1);
  return row ?? null;
}

export async function readOrderByReference(
  reference: string,
): Promise<OrderTokenRow | null> {
  const [row] = await db
    .select({ id: orders.id, version: orders.manageTokenVersion })
    .from(orders)
    .where(eq(orders.reference, reference))
    .limit(1);
  return row ?? null;
}

/** Locks the order row until the transaction ends and returns what a bump needs. Null when there is none. */
export async function lockOrderTokenState(
  tx: Transaction,
  orderId: string,
): Promise<{ version: number; hasManageHash: boolean } | null> {
  const [row] = await tx
    .select({
      version: orders.manageTokenVersion,
      hash: orders.manageTokenHash,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for('update');
  return row
    ? { version: row.version, hasManageHash: row.hash !== null }
    : null;
}

/** One UPDATE sets the version and the hash together, so no reader sees one without the other. */
export async function writeOrderTokenVersion(
  tx: Transaction,
  orderId: string,
  version: number,
  manageTokenHash: string | null,
): Promise<void> {
  await tx
    .update(orders)
    .set({ manageTokenVersion: version, manageTokenHash })
    .where(eq(orders.id, orderId));
}

/** The next page of orders that hold a manage hash, by id after `afterId`, at most `limit`. */
export async function readManageTokenPage(
  afterId: string | null,
  limit: number,
): Promise<OrderTokenRow[]> {
  return db
    .select({ id: orders.id, version: orders.manageTokenVersion })
    .from(orders)
    .where(
      and(
        isNotNull(orders.manageTokenHash),
        afterId === null ? undefined : gt(orders.id, afterId),
      ),
    )
    .orderBy(asc(orders.id))
    .limit(limit);
}

/**
 * Rewrites the stored hash of each order, only where its version is still the one the hash was
 * made for, so a bump that landed in between keeps its own hash. Returns how many it rewrote.
 */
export async function writeManageHashes(
  tx: Transaction,
  rows: readonly { id: string; version: number; hash: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${row.id}::uuid, ${row.version}::integer, ${row.hash}::text)`,
    ),
    sql`, `,
  );
  const result = await tx.execute(
    sql`UPDATE orders SET manage_token_hash = v.hash
      FROM (VALUES ${values}) AS v(id, version, hash)
      WHERE orders.id = v.id
        AND orders.manage_token_version = v.version
        AND orders.manage_token_hash IS NOT NULL`,
  );
  return result.rowCount ?? 0;
}
