import 'server-only';
import { and, asc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EntityIdSchema } from '@/lib/catalog';
import {
  LedgerWindowSchema,
  assertWithinReadCap,
  accountBalances,
  hostStatement,
  ledgerAccounts,
  ledgerEntryTypes,
  ledgerLimits,
  moneyHeld,
  orderLedgerSummaries,
  parseLedgerEvent,
  postOutcome,
  providerFeeEntries,
  type AccountBalances,
  type HostStatement,
  type LedgerEntryInput,
  type LedgerWindow,
  type OrderFlow,
  type OrderLedgerSummary,
} from '@/lib/ledger';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { dbRead, type Transaction } from './client';
import { ledgerEntries } from './schema';
import { requireStaff } from './staff';

export type PostResult =
  { status: 'posted'; count: number } | { status: 'already_posted' };

/**
 * Writes the rows of one event, all or none. It takes no locks: the caller has locked in the one
 * lock order (design doc 4.2.3 rule 1) and passes its transaction, so the rows commit with the
 * state change that caused them. A cash event is idempotent: when the provider's id was posted
 * before, nothing is written and the answer is `already_posted`; when only some rows were posted
 * before it throws and writes nothing, because a half-posted event is a bug. The insert runs in a
 * savepoint, so a caller that catches that error still has no partial rows. Money paths run as the
 * system, so this takes no caller; the path that calls it has already authorized the event.
 */
export async function postEntries(
  tx: Transaction,
  entries: readonly LedgerEntryInput[],
): Promise<PostResult> {
  const rows = parseLedgerEvent(entries);
  return tx.transaction(async (inner) => {
    const inserted = await inner
      .insert(ledgerEntries)
      .values(rows)
      .onConflictDoNothing({
        target: [ledgerEntries.entryType, ledgerEntries.providerObjectId],
        where: isNotNull(ledgerEntries.providerObjectId),
      })
      .returning({ id: ledgerEntries.id });
    return postOutcome(rows.length, inserted.length) === 'posted'
      ? ({ status: 'posted', count: inserted.length } as const)
      : ({ status: 'already_posted' } as const);
  });
}

/**
 * Posts the card fee the provider kept from a payment, under that payment's id, so a replay posts it
 * once. A fee the provider has not reported (or a fee of nothing) posts nothing and is no error.
 * Same rules as `postEntries`: the caller's transaction, no locks of its own. The confirm steps
 * for a booking, a gift purchase, and a redemption with a top-up share it.
 */
export async function postProviderFee(
  tx: Transaction,
  fee: Parameters<typeof providerFeeEntries>[0],
): Promise<PostResult | { status: 'no_fee' }> {
  const entries = providerFeeEntries(fee);
  return entries.length === 0 ? { status: 'no_fee' } : postEntries(tx, entries);
}

// Sums are Postgres bigints, which the driver returns as text.
const sum = z.coerce.number().pipe(z.int().min(0).max(Number.MAX_SAFE_INTEGER));

const PostingSumSchema = z.object({
  debitAccount: z.enum(ledgerAccounts),
  creditAccount: z.enum(ledgerAccounts),
  amountMinor: sum,
});

const OrderFlowSchema = PostingSumSchema.extend({
  orderId: EntityIdSchema,
  hostId: EntityIdSchema.nullable(),
  entryType: z.enum(ledgerEntryTypes),
  simulated: z.boolean(),
  firstAt: z.date(),
  lastAt: z.date(),
});

async function readBalances(): Promise<AccountBalances> {
  const rows = await dbRead
    .select({
      debitAccount: ledgerEntries.debitAccount,
      creditAccount: ledgerEntries.creditAccount,
      amountMinor: sql<string>`sum(${ledgerEntries.amountMinor})`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.debitAccount, ledgerEntries.creditAccount);
  return accountBalances(rows.map((row) => PostingSumSchema.parse(row)));
}

/**
 * The bookings' sums inside a window, grouped by order, entry type, and account pair, for one host
 * or for every host. A window with more groups than the cap is refused, never cut short, because a
 * total over part of the rows would be wrong.
 */
async function readOrderFlows(
  window: LedgerWindow,
  hostId: string | null,
): Promise<OrderFlow[]> {
  const firstAt = sql<Date>`min(${ledgerEntries.occurredAt})`.mapWith(
    ledgerEntries.occurredAt,
  );
  const lastAt = sql<Date>`max(${ledgerEntries.occurredAt})`.mapWith(
    ledgerEntries.occurredAt,
  );
  const rows = await dbRead
    .select({
      orderId: ledgerEntries.orderId,
      hostId: ledgerEntries.hostId,
      entryType: ledgerEntries.entryType,
      debitAccount: ledgerEntries.debitAccount,
      creditAccount: ledgerEntries.creditAccount,
      amountMinor: sql<string>`sum(${ledgerEntries.amountMinor})`,
      simulated: sql<boolean>`bool_or(${ledgerEntries.simulated})`,
      firstAt,
      lastAt,
    })
    .from(ledgerEntries)
    .where(
      and(
        isNotNull(ledgerEntries.orderId),
        gte(ledgerEntries.occurredAt, window.from),
        lt(ledgerEntries.occurredAt, window.to),
        hostId === null ? undefined : eq(ledgerEntries.hostId, hostId),
      ),
    )
    .groupBy(
      ledgerEntries.orderId,
      ledgerEntries.hostId,
      ledgerEntries.entryType,
      ledgerEntries.debitAccount,
      ledgerEntries.creditAccount,
    )
    .orderBy(
      asc(sql`min(${ledgerEntries.occurredAt})`),
      asc(ledgerEntries.orderId),
    )
    .limit(ledgerLimits.maxReadGroups + 1);
  assertWithinReadCap(rows.length);
  return rows.map((row) => OrderFlowSchema.parse(row));
}

// TODO(U-071): first caller, the host statements page.
/**
 * A host's statement (PRD-47) for a window, host owners only. A missing host, another host, and a
 * staff member without the host owner role all get the same refusal.
 */
export async function readHostStatement(
  caller: Caller,
  hostId: string,
  window: LedgerWindow,
): Promise<HostStatement> {
  requireRole(caller, Role.HostOwner, { hostId });
  const parsed = LedgerWindowSchema.parse(window);
  return hostStatement(
    await readOrderFlows(parsed, EntityIdSchema.parse(hostId)),
  );
}

// TODO(U-080): first caller, the finance export.
/** One row per booking in the window (PRD-56), staff only. Rows built on simulated money say so. */
export async function readFinanceExport(
  caller: Caller,
  window: LedgerWindow,
): Promise<OrderLedgerSummary[]> {
  requireStaff(caller);
  const parsed = LedgerWindowSchema.parse(window);
  return orderLedgerSummaries(await readOrderFlows(parsed, null));
}

// TODO(U-110): first caller, the money-held page.
/** Every account's balance and the money held (PRD-57), staff only. */
export async function readMoneyHeld(
  caller: Caller,
): Promise<{ balances: AccountBalances; moneyHeldMinor: number }> {
  requireStaff(caller);
  const balances = await readBalances();
  return { balances, moneyHeldMinor: moneyHeld(balances) };
}

// TODO(U-079b): first caller, the daily reconciliation check.
/** The `platform_cash` balance the daily check compares with the provider's, staff only. */
export async function readCashBalance(caller: Caller): Promise<number> {
  requireStaff(caller);
  return (await readBalances()).platform_cash;
}
