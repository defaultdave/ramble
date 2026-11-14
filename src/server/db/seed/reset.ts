import 'server-only';
import { getTableName, gt, sql } from 'drizzle-orm';
import { resetRefusal } from '@/lib/seed/resetTarget';
import { db } from '@/server/db/client';
import {
  emailSuppressions,
  giftItems,
  gifts,
  holdItems,
  holds,
  jobs,
  ledgerEntries,
  messages,
  orderItems,
  orders,
  paymentAttempts,
  providerEvents,
  refunds,
  sessions,
  transfers,
} from '@/server/db/schema';
import { env } from '@/server/env';
import { seedCaller } from './caller';
import { runSeed, type SeedReport } from './run';

// What a tester creates by using the site, and nothing the seed owns. Catalogue, hosts, people,
// accounts, sessions, consents, legal acceptances, support and private requests, rate limits, the
// audit log and the fake gateway's own memory stay: the seed rerun restores seed data, and the
// rest is history that does not point at anything wiped. A table that is wiped is wiped whole, so
// a table that a wiped table points to is in the list too (`TRUNCATE` refuses otherwise).
export const wipedTables = [
  ledgerEntries,
  transfers,
  refunds,
  providerEvents,
  paymentAttempts,
  giftItems,
  gifts,
  orderItems,
  orders,
  holdItems,
  holds,
  emailSuppressions,
  messages,
  jobs,
] as const;

// The ledger refuses an emptying even by its owner. A reset is the one reason to lift that, for this
// one trigger and this one transaction: the statement rolls back with it, so a failed reset leaves
// the guard as it was.
const ledgerKeepTableTrigger = 'ledger_entries_keep_table';

export class ResetRefusedError extends Error {}

export type ResetOptions = {
  /** The clock for the seed rerun's session generation. */
  now: Date;
  log?: (line: string) => void;
};

/**
 * Empties what testers created (`wipedTables`), sets every session back to no seats sold, then
 * reruns the seed, which puts the seats its coverage matrix needs back. The refusal is here and
 * not only in the callers, so the console and the command line both inherit it: nothing is read
 * or written before it.
 */
export async function resetDemoData(
  options: ResetOptions,
): Promise<SeedReport> {
  const refusal = resetRefusal({
    vercelEnv: env.VERCEL_ENV,
    seedTarget: env.SEED_TARGET,
  });
  if (refusal !== null) throw new ResetRefusedError(refusal);

  const log = options.log ?? (() => undefined);
  const names = sql.join(
    wipedTables.map((table) => sql.identifier(getTableName(table))),
    sql`, `,
  );
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE ${sql.identifier(getTableName(ledgerEntries))} DISABLE TRIGGER ${sql.identifier(ledgerKeepTableTrigger)}`,
    );
    await tx.execute(sql`TRUNCATE ${names}`);
    await tx.execute(
      sql`ALTER TABLE ${sql.identifier(getTableName(ledgerEntries))} ENABLE TRIGGER ${sql.identifier(ledgerKeepTableTrigger)}`,
    );
    await tx
      .update(sessions)
      .set({ seatsSold: 0 })
      .where(gt(sessions.seatsSold, 0));
  });
  log(`Wiped ${String(wipedTables.length)} tables`);

  return runSeed({ caller: seedCaller, now: options.now, log });
}
