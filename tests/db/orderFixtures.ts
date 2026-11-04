import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, vi } from 'vitest';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { createOrderParents } from './orderParents';

// Shared setup for the orders-*.db.test.ts files. Each file calls setupOrdersDatabase() at its top
// level for its own schema, then uses client, fresh, and parents under the names it had before the split.

let loaded: typeof import('@/server/db/client');

export const client = {
  get db() {
    return loaded.db;
  },
};

export const fresh = {} as FreshDatabase;

export const parents = {
  hostId: '',
  experienceId: '',
  tierId: '',
  guestId: '',
  priceOptionId: '',
  sessionId: '',
  termsDocumentId: '',
};

export function setupOrdersDatabase() {
  beforeAll(async () => {
    Object.assign(
      fresh,
      await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? ''),
    );
    vi.stubEnv('DATABASE_URL', fresh.url);
    loaded = await import('@/server/db/client');
    Object.assign(parents, await createOrderParents(loaded.db, 'orders'));
  });

  afterAll(async () => {
    await loaded.db.$client.end();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });
}

export type Row = Record<string, unknown>;

function valueOf(column: string, value: unknown) {
  if (column === 'payload') return sql`${JSON.stringify(value)}::jsonb`;
  if (value === null) return sql.raw('NULL');
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === null ? 'NULL' : String(item)));
    return sql`${`{${items.join(',')}}`}::integer[]`;
  }
  return sql`${value}`;
}

/** A hold row for an order to point at, written straight to the table; one that exists already is left alone. */
export async function ensureHold(holdId: string) {
  await client.db.execute(
    sql`INSERT INTO holds (id, session_id, purpose, status, seats, device_key, ip_hash, expires_at)
      VALUES (${holdId}, ${parents.sessionId}, 'booking', 'active', 1, ${'a'.repeat(64)}, ${'b'.repeat(64)}, now() + interval '10 minutes')
      ON CONFLICT (id) DO NOTHING`,
  );
}

/** Writes the row as given, with no parent made for it. */
export function insertAsGiven(table: string, row: Row) {
  const columns = Object.keys(row);
  return client.db.execute(
    sql`INSERT INTO ${sql.identifier(table)} (${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )}) VALUES (${sql.join(
      columns.map((column) => valueOf(column, row[column])),
      sql`, `,
    )})`,
  );
}

export async function insert(table: string, row: Row) {
  if (table === 'orders' && typeof row.hold_id === 'string') {
    await ensureHold(row.hold_id);
  }
  return insertAsGiven(table, row);
}

export const invalidText = { cause: { code: '22P02' } };
export const notNull = { cause: { code: '23502' } };

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

export const created = '2026-11-01T12:00:00Z';
export const later = '2026-11-01T12:05:00Z';
export const earlier = '2026-11-01T11:00:00Z';

export function orderRow(over: Row = {}): Row {
  const holdId = randomUUID();
  return {
    id: randomUUID(),
    reference: reference(),
    kind: 'booking',
    status: 'pending_payment',
    idempotency_key: `book:${holdId}`,
    hold_id: holdId,
    session_id: parents.sessionId,
    experience_id: parents.experienceId,
    host_id: parents.hostId,
    guest_id: parents.guestId,
    contact_email: 'pat@example.com',
    lead_guest_name: 'Pat Smith',
    terms_document_id: parents.termsDocumentId,
    ticket_subtotal_minor: 17000,
    tax_treatment: 'taxable',
    tax_rate_ppm: 88750,
    tax_minor: 1509,
    total_minor: 18509,
    amount_due_minor: 18509,
    commission_rate_bps: 1500,
    commission_minor: 2550,
    cancellation_tier_id: parents.tierId,
    created_at: created,
    ...over,
  };
}

export function giftPurchaseRow(over: Row = {}): Row {
  return orderRow({
    kind: 'gift_purchase',
    idempotency_key: randomUUID(),
    hold_id: null,
    session_id: null,
    lead_guest_name: null,
    ...over,
  });
}

export async function newOrder(over: Row = {}) {
  const row = orderRow(over);
  await insert('orders', row);
  return row.id as string;
}

export async function count(table: string, id: unknown) {
  const { rows } = await client.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ${id}`,
  );
  return rows[0]?.n;
}
