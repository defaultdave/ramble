import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, vi } from 'vitest';
import { type LedgerEntryInput } from '@/lib/ledger';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { createLedgerParents, type LedgerParents } from './ledgerParents';

export let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
export let client: typeof import('@/server/db/client');
export let ledger: typeof import('@/server/db/ledger');
export let parents: LedgerParents;

/** Opens a fresh database for the file that calls it and loads the modules that read DATABASE_URL. */
export function openLedgerDatabase() {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    vi.stubEnv('DATABASE_URL', fresh.url);
    stopHttp = await serveNeonHttp(fresh.url);
    client = await import('@/server/db/client');
    ledger = await import('@/server/db/ledger');
    parents = await createLedgerParents(client.db, 'ledger');
  });

  afterAll(async () => {
    await stopHttp();
    await client.db.$client.end();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });
}

export type Row = Record<string, unknown>;

export const code = (value: string) => ({ cause: { code: value } });

function valueOf(value: unknown) {
  return value === null ? sql.raw('NULL') : sql`${value}`;
}

export function insert(row: Row) {
  const columns = Object.keys(row);
  return client.db.execute(
    sql`INSERT INTO ledger_entries (${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )}) VALUES (${sql.join(
      columns.map((column) => valueOf(row[column])),
      sql`, `,
    )})`,
  );
}

export const occurred = '2026-11-02T15:00:00Z';
let counter = 0;
export const nextProviderId = () => `pi_${String(++counter)}`;

/** A cash row at the column level: the host share of a payment. */
export function cashRow(over: Row = {}): Row {
  return {
    occurred_at: occurred,
    entry_type: 'charge_host_share',
    debit_account: 'platform_cash',
    credit_account: 'host_payable',
    amount_minor: 11050,
    host_id: parents.hostId,
    provider_object_id: nextProviderId(),
    simulated: true,
    ...over,
  };
}

/** A non-cash row at the column level: a refund request leg. */
export function plainRow(over: Row = {}): Row {
  return cashRow({
    entry_type: 'refund_host_share',
    debit_account: 'host_payable',
    credit_account: 'refunds_pending',
    provider_object_id: null,
    ...over,
  });
}

export async function countRows(where = sql`TRUE`) {
  const { rows } = await client.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ledger_entries WHERE ${where}`,
  );
  return rows[0]?.n;
}

export type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
export const post = (rows: LedgerEntryInput[]) =>
  client.db.transaction((tx) => ledger.postEntries(tx, rows));
export const postIn = (tx: Tx, rows: LedgerEntryInput[]) =>
  ledger.postEntries(tx, rows);

export async function newBooking() {
  const orderId = await parents.newOrder();
  const paymentAttemptId = await parents.newAttempt(orderId);
  return { orderId, paymentAttemptId, hostId: parents.hostId };
}

export const common = { occurredAt: new Date(occurred), simulated: true };
export const worked = {
  ticketMinor: 13000,
  commissionMinor: 1950,
  taxMinor: 0,
};
