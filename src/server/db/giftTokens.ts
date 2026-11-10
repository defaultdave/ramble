import 'server-only';
import { eq } from 'drizzle-orm';
import { db, type Transaction } from './client';
import { gifts } from './schema';

// What src/server/tokens.ts reads and writes on `gifts`: the version and hash a gift token is
// checked against. It decides nothing; the derivation and every comparison live in tokens.ts.

export type GiftTokenRow = { id: string; version: number };

export async function readGiftByTokenHash(
  hash: string,
): Promise<GiftTokenRow | null> {
  const [row] = await db
    .select({ id: gifts.id, version: gifts.tokenVersion })
    .from(gifts)
    .where(eq(gifts.tokenHash, hash))
    .limit(1);
  return row ?? null;
}

/** Locks the gift row until the transaction ends and returns its version. Null when there is none. */
export async function lockGiftTokenVersion(
  tx: Transaction,
  giftId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ version: gifts.tokenVersion })
    .from(gifts)
    .where(eq(gifts.id, giftId))
    .for('update');
  return row?.version ?? null;
}

/** One UPDATE sets the version and the hash together, so no reader sees one without the other. */
export async function writeGiftTokenVersion(
  tx: Transaction,
  giftId: string,
  version: number,
  tokenHash: string,
): Promise<void> {
  await tx
    .update(gifts)
    .set({ tokenVersion: version, tokenHash })
    .where(eq(gifts.id, giftId));
}
