import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { orderCurrency } from '@/lib/orders';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { createOrderParents } from './orderParents';

// Behaviours under test, one per decision, branch or risk. Each bad row is refused by the
// database with the constraint named; each rule matches one in src/lib (orders, payments,
// refunds, transfers).
// orders:
// - a booking, a gift purchase, a confirmed and a cancelled order are accepted; defaults are set
// - the reference format, and the reference, key, and manage hash are unique (null hashes repeat)
// - a booking has a hold, session, lead guest, and the key book:<hold>; a gift purchase has none of those, a uuid key, no gift applied
// - at most one live order per hold: a void order frees the hold (the index is reached with the key rules lifted, in a rolled-back transaction)
// - text, email, children ages, and guardian rules
// - money: ranges, tax rate zero unless taxable, tax and commission rounding, total, gift, amount due, refund caps
// - status and time rules; times in range
// - foreign keys to guests, experiences, hosts, cancellation tiers, holds, sessions, and the terms and waiver documents; none yet on gift ids
// order items: key, quantity, price, line total, label, foreign keys
// payment attempts: order and number unique, one live attempt per order, key from order and number, tries, failure code, times
// provider events: provider and event id unique, amount with currency, currency shape, body object within its size, tries, times
// refunds: parts, amount, key from id, reinstated gift, succeeded time, unique provider refund id
// transfers: one per order, amount set at release, reversal within the amount, key from order, unique provider transfer id

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');

const parents = {
  hostId: '',
  experienceId: '',
  tierId: '',
  guestId: '',
  priceOptionId: '',
  sessionId: '',
  termsDocumentId: '',
};

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  Object.assign(parents, await createOrderParents(client.db, 'orders'));
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Row = Record<string, unknown>;

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
async function ensureHold(holdId: string) {
  await client.db.execute(
    sql`INSERT INTO holds (id, session_id, purpose, status, seats, device_key, ip_hash, expires_at)
      VALUES (${holdId}, ${parents.sessionId}, 'booking', 'active', 1, ${'a'.repeat(64)}, ${'b'.repeat(64)}, now() + interval '10 minutes')
      ON CONFLICT (id) DO NOTHING`,
  );
}

/** Writes the row as given, with no parent made for it. */
function insertAsGiven(table: string, row: Row) {
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

async function insert(table: string, row: Row) {
  if (table === 'orders' && typeof row.hold_id === 'string') {
    await ensureHold(row.hold_id);
  }
  return insertAsGiven(table, row);
}

const constraint = (name: string) => ({ cause: { constraint: name } });
const invalidText = { cause: { code: '22P02' } };
const notNull = { cause: { code: '23502' } };

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

const created = '2026-11-01T12:00:00Z';
const later = '2026-11-01T12:05:00Z';
const earlier = '2026-11-01T11:00:00Z';

function orderRow(over: Row = {}): Row {
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

function giftPurchaseRow(over: Row = {}): Row {
  return orderRow({
    kind: 'gift_purchase',
    idempotency_key: randomUUID(),
    hold_id: null,
    session_id: null,
    lead_guest_name: null,
    ...over,
  });
}

async function newOrder(over: Row = {}) {
  const row = orderRow(over);
  await insert('orders', row);
  return row.id as string;
}

async function count(table: string, id: unknown) {
  const { rows } = await client.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ${id}`,
  );
  return rows[0]?.n;
}

describe('orders', () => {
  it.each([
    ['a booking', () => orderRow()],
    ['a gift purchase', () => giftPurchaseRow()],
    [
      'a confirmed booking',
      () => orderRow({ status: 'confirmed', confirmed_at: later }),
    ],
    [
      'a cancelled booking',
      () =>
        orderRow({
          status: 'cancelled',
          confirmed_at: later,
          cancelled_at: later,
          cancelled_by: 'guest',
        }),
    ],
    [
      'a refunded-after-lapse booking',
      () => orderRow({ status: 'refunded_after_lapse' }),
    ],
    [
      'a not-taxable booking',
      () =>
        orderRow({
          tax_treatment: 'not_taxable',
          tax_rate_ppm: 0,
          tax_minor: 0,
          total_minor: 17000,
          amount_due_minor: 17000,
        }),
    ],
    [
      'a zero-price booking',
      () =>
        orderRow({
          ticket_subtotal_minor: 0,
          tax_minor: 0,
          total_minor: 0,
          amount_due_minor: 0,
          commission_minor: 0,
        }),
    ],
    [
      'a booking paid partly by a gift',
      () =>
        orderRow({
          gift_id: randomUUID(),
          gift_applied_minor: 5000,
          amount_due_minor: 13509,
        }),
    ],
    [
      'a booking with children and a guardian',
      () =>
        orderRow({
          children_ages: [0, 17],
          guardian_name: 'Pat',
          guardian_contact: 'pat@example.com',
        }),
    ],
    [
      'a booking with a manage hash and attribution',
      () =>
        orderRow({
          manage_token_hash: 'ab'.repeat(32),
          attribution_source: 'newsletter',
          attribution_campaign: 'fall',
          attribution_issue: '12',
          contact_phone: '+1 555 0100',
        }),
    ],
  ])('accepts %s', async (_name, build) => {
    const row = build();
    await insert('orders', row);

    expect(await count('orders', row.id)).toBe(1);
  });

  it('sets the defaults the design doc names', async () => {
    const id = await newOrder();

    const { rows } = await client.db.execute<Row>(
      sql`SELECT manage_token_version, synthetic, currency, refund_failed, gift_applied_minor, refunded_ticket_minor, refunded_tax_minor, commission_returned_minor FROM orders WHERE id = ${id}`,
    );
    expect(rows[0]).toEqual({
      manage_token_version: 1,
      synthetic: false,
      currency: orderCurrency,
      refund_failed: false,
      gift_applied_minor: 0,
      refunded_ticket_minor: 0,
      refunded_tax_minor: 0,
      commission_returned_minor: 0,
    });
  });

  it('stamps the created time from the database clock after any lock', async () => {
    const row = orderRow();
    delete row.created_at;
    await insert('orders', row);

    const { rows } = await client.db.execute<{ same: boolean }>(
      sql`SELECT created_at <= clock_timestamp() AS same FROM orders WHERE id = ${row.id}`,
    );
    expect(rows[0]?.same).toBe(true);
  });

  it.each([
    ['lower case', 'rmb-ABCDEF'],
    ['a letter Crockford leaves out', 'RMB-ILOU00'],
    ['five characters', 'RMB-ABCDE'],
    ['seven characters', 'RMB-ABCDEFG'],
    ['a trailing newline', 'RMB-ABCDEF\n'],
    ['no prefix', 'ABCDEF'],
  ])('refuses a reference with %s', async (_name, value) => {
    await expect(
      insert('orders', orderRow({ reference: value })),
    ).rejects.toMatchObject(constraint('orders_reference_shape'));
  });

  it('refuses a second order with one reference', async () => {
    const ref = reference();
    await newOrder({ reference: ref });

    await expect(
      insert('orders', orderRow({ reference: ref })),
    ).rejects.toMatchObject(constraint('orders_reference_unique'));
  });

  it('refuses a second order with one idempotency key', async () => {
    const holdId = randomUUID();
    const base = { hold_id: holdId, idempotency_key: `book:${holdId}` };
    await newOrder(base);

    await expect(insert('orders', orderRow(base))).rejects.toMatchObject(
      constraint('orders_idempotency_key_unique'),
    );
  });

  it('refuses a second order with one manage hash and allows many without one', async () => {
    const hash = 'cd'.repeat(32);
    await newOrder({ manage_token_hash: hash });
    await newOrder();
    await newOrder();

    await expect(
      insert('orders', orderRow({ manage_token_hash: hash })),
    ).rejects.toMatchObject(constraint('orders_manage_token_hash_unique'));
  });

  describe('one live order per hold', () => {
    // A booking's key must be book:<hold>, so a second order on a hold meets the key index before
    // this one. With the key rules lifted inside a transaction that is rolled back, this index is
    // what is left, and it is the one that frees a hold whose order went void.
    it('refuses a second live order and frees the hold when the first is void', async () => {
      const holdId = randomUUID();
      await ensureHold(holdId);
      const connection = await client.db.$client.connect();
      const insertOrder = (key: string, status: string) => {
        const row = orderRow({
          hold_id: holdId,
          idempotency_key: key,
          status,
        });
        const columns = Object.keys(row);
        return connection.query(
          `INSERT INTO orders (${columns.join(', ')}) VALUES (${columns.map((_column, i) => `$${String(i + 1)}`).join(', ')})`,
          columns.map((column) => row[column]),
        );
      };
      try {
        await connection.query('BEGIN');
        await connection.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_kind_shape',
        );
        await connection.query('DROP INDEX orders_idempotency_key_unique');
        await insertOrder('first', 'void');
        await insertOrder('second', 'pending_payment');

        await expect(
          insertOrder('third', 'pending_payment'),
        ).rejects.toMatchObject({ constraint: 'orders_one_live_per_hold' });
      } finally {
        await connection.query('ROLLBACK');
        connection.release();
      }
    });

    it('is a partial index on hold_id that leaves void orders out', async () => {
      const { rows } = await client.db.execute<{ indexdef: string }>(
        sql`SELECT indexdef FROM pg_indexes WHERE schemaname = ${fresh.schema} AND indexname = 'orders_one_live_per_hold'`,
      );
      expect(rows[0]?.indexdef).toMatch(
        /UNIQUE INDEX.*\(hold_id\).*WHERE.*status <> 'void'/,
      );
    });
  });

  describe('kind', () => {
    const holdId = randomUUID();
    it.each([
      ['a booking with no hold', () => orderRow({ hold_id: null })],
      ['a booking with no session', () => orderRow({ session_id: null })],
      [
        'a booking with no lead guest',
        () => orderRow({ lead_guest_name: null }),
      ],
      [
        'a booking key that is not from its hold',
        () => orderRow({ idempotency_key: randomUUID() }),
      ],
      [
        'a booking key from another hold',
        () =>
          orderRow({
            hold_id: holdId,
            idempotency_key: `book:${randomUUID()}`,
          }),
      ],
      [
        'a gift purchase with a hold',
        () => giftPurchaseRow({ hold_id: holdId }),
      ],
      [
        'a gift purchase with a session',
        () => giftPurchaseRow({ session_id: randomUUID() }),
      ],
      [
        'a gift purchase with a booking key',
        () => giftPurchaseRow({ idempotency_key: `book:${holdId}` }),
      ],
      [
        'a gift purchase with an upper-case uuid key',
        () =>
          giftPurchaseRow({
            idempotency_key: '0A0A0A0A-0000-4000-8000-00000000000A',
          }),
      ],
      [
        'a gift purchase applying a gift',
        () =>
          giftPurchaseRow({
            gift_id: randomUUID(),
            gift_applied_minor: 100,
            amount_due_minor: 18409,
          }),
      ],
    ])('refuses %s', async (_name, build) => {
      await expect(insert('orders', build())).rejects.toMatchObject(
        constraint('orders_kind_shape'),
      );
    });
  });

  describe('contact and text', () => {
    it.each([
      ['an upper-case email', 'Pat@example.com'],
      ['no domain', 'pat@'],
      ['a display name', 'Pat <pat@example.com>'],
      ['255 characters', `${'a'.repeat(243)}@example.com`],
    ])('refuses an email that is %s', async (_name, value) => {
      await expect(
        insert('orders', orderRow({ contact_email: value })),
      ).rejects.toMatchObject(constraint('orders_contact_email_shape'));
    });

    it.each([
      ['blank', ' '],
      ['41 characters', 'p'.repeat(41)],
    ])('refuses a phone that is %s', async (_name, value) => {
      await expect(
        insert('orders', orderRow({ contact_phone: value })),
      ).rejects.toMatchObject(constraint('orders_contact_phone_text'));
    });

    it.each([
      ['blank', ' '],
      ['121 characters', 'n'.repeat(121)],
    ])('refuses a lead guest name that is %s', async (_name, value) => {
      await expect(
        insert('orders', orderRow({ lead_guest_name: value })),
      ).rejects.toMatchObject(constraint('orders_lead_guest_name_text'));
    });

    it.each([
      ['attribution_source'],
      ['attribution_campaign'],
      ['attribution_issue'],
    ])('refuses a blank and an over-long %s', async (column) => {
      await expect(
        insert('orders', orderRow({ [column]: '  ' })),
      ).rejects.toMatchObject(constraint('orders_attribution_text'));
      await expect(
        insert('orders', orderRow({ [column]: 'a'.repeat(101) })),
      ).rejects.toMatchObject(constraint('orders_attribution_text'));
    });

    it.each([
      ['guardian_name', 'g'.repeat(121)],
      ['guardian_contact', 'g'.repeat(255)],
    ])('refuses an over-long %s', async (column, value) => {
      await expect(
        insert(
          'orders',
          orderRow({
            guardian_name: 'Pat',
            guardian_contact: 'pat@example.com',
            [column]: value,
          }),
        ),
      ).rejects.toMatchObject(constraint('orders_guardian_text'));
    });
  });

  describe('children and guardian', () => {
    const guardian = {
      guardian_name: 'Pat',
      guardian_contact: 'x@example.com',
    };

    it.each([
      ['an empty list', []],
      ['an age of 18', [18]],
      ['a negative age', [-1]],
      ['a missing age', [null]],
      ['more children than the cap', Array.from({ length: 101 }, () => 5)],
    ])('refuses children ages with %s', async (_name, ages) => {
      await expect(
        insert('orders', orderRow({ children_ages: ages, ...guardian })),
      ).rejects.toMatchObject(constraint('orders_children_ages_valid'));
    });

    it('refuses children with no guardian', async () => {
      await expect(
        insert('orders', orderRow({ children_ages: [4] })),
      ).rejects.toMatchObject(constraint('orders_guardian_complete'));
    });

    it.each([
      ['a name with no contact', { guardian_name: 'Pat' }],
      ['a contact with no name', { guardian_contact: 'x@example.com' }],
    ])('refuses a guardian %s', async (_name, change) => {
      await expect(insert('orders', orderRow(change))).rejects.toMatchObject(
        constraint('orders_guardian_complete'),
      );
    });
  });

  describe('money', () => {
    const refuses: [string, Row, string][] = [
      ['a currency other than USD', { currency: 'EUR' }, 'orders_currency_usd'],
      // The rest of each row is made consistent, so only the rule named refuses it.
      [
        'a subtotal above the cap',
        {
          ticket_subtotal_minor: 1_000_000_001,
          tax_treatment: 'not_taxable',
          tax_rate_ppm: 0,
          tax_minor: 0,
          total_minor: 1_000_000_001,
          amount_due_minor: 1_000_000_001,
          commission_minor: 150_000_000,
        },
        'orders_ticket_subtotal_in_range',
      ],
      // A negative total also leaves the gift applied (0) above it, and that check runs first.
      [
        'a negative subtotal',
        {
          ticket_subtotal_minor: -1,
          tax_treatment: 'not_taxable',
          tax_rate_ppm: 0,
          tax_minor: 0,
          total_minor: -1,
          amount_due_minor: -1,
          commission_minor: 0,
        },
        'orders_gift_applied_within_total',
      ],
      [
        'a tax rate above 100 percent',
        {
          tax_rate_ppm: 1_000_001,
          tax_minor: 17_000,
          total_minor: 34_000,
          amount_due_minor: 34_000,
        },
        'orders_tax_rate_in_range',
      ],
      [
        'a negative tax rate',
        {
          tax_rate_ppm: -1,
          tax_minor: 0,
          total_minor: 17_000,
          amount_due_minor: 17_000,
        },
        'orders_tax_rate_in_range',
      ],
      [
        'a tax rate on a not-taxable order',
        { tax_treatment: 'not_taxable' },
        'orders_tax_rate_zero_unless_taxable',
      ],
      [
        'a tax rate on an unknown-treatment order',
        { tax_treatment: 'unknown' },
        'orders_tax_rate_zero_unless_taxable',
      ],
      [
        'a tax that is not the rounded rate',
        { tax_minor: 1508, total_minor: 18508, amount_due_minor: 18508 },
        'orders_tax_is_rounded_rate',
      ],
      [
        'a total that is not subtotal plus tax',
        { total_minor: 18510, amount_due_minor: 18510 },
        'orders_total_is_subtotal_plus_tax',
      ],
      [
        'a negative gift applied',
        {
          gift_id: randomUUID(),
          gift_applied_minor: -1,
          amount_due_minor: 18510,
        },
        'orders_gift_applied_within_total',
      ],
      [
        'a gift applied above the total',
        {
          gift_id: randomUUID(),
          gift_applied_minor: 18510,
          amount_due_minor: -1,
        },
        'orders_gift_applied_within_total',
      ],
      [
        'a gift applied with no gift',
        { gift_applied_minor: 1000, amount_due_minor: 17509 },
        'orders_gift_applied_names_gift',
      ],
      [
        'an amount due that is not the total less the gift',
        {
          gift_id: randomUUID(),
          gift_applied_minor: 1000,
          amount_due_minor: 18509,
        },
        'orders_amount_due_is_total_less_gift',
      ],
      [
        'a commission rate above 100 percent',
        { commission_rate_bps: 10_001, commission_minor: 17_002 },
        'orders_commission_rate_in_range',
      ],
      [
        'a commission that is not the rounded rate',
        { commission_minor: 2549 },
        'orders_commission_is_rounded_rate',
      ],
      [
        'tickets refunded above the subtotal',
        { refunded_ticket_minor: 17001 },
        'orders_refunded_ticket_within_subtotal',
      ],
      [
        'tax refunded above the tax',
        { refunded_tax_minor: 1510 },
        'orders_refunded_tax_within_tax',
      ],
      [
        'commission returned above the commission',
        { commission_returned_minor: 2551 },
        'orders_commission_returned_within_commission',
      ],
      [
        'a negative refund running total',
        { refunded_ticket_minor: -1 },
        'orders_refunded_ticket_within_subtotal',
      ],
    ];

    it.each(refuses)('refuses %s', async (_name, change, name) => {
      await expect(insert('orders', orderRow(change))).rejects.toMatchObject(
        constraint(name),
      );
    });

    it.each([
      [1, 500_000, 1],
      [1, 499_999, 0],
      [17000, 88750, 1509],
    ])(
      'rounds the tax on %i at %i ppm half up to %i',
      async (subtotal, rate, tax) => {
        await insert(
          'orders',
          orderRow({
            ticket_subtotal_minor: subtotal,
            tax_rate_ppm: rate,
            tax_minor: tax,
            total_minor: subtotal + tax,
            amount_due_minor: subtotal + tax,
            commission_minor: Math.floor((subtotal * 1500 + 5000) / 10_000),
          }),
        );
      },
    );
  });

  describe('status and times', () => {
    const refuses: [string, Row, string][] = [
      [
        'a confirmed order with no confirmed time',
        { status: 'confirmed' },
        'orders_confirmed_at_matches_status',
      ],
      [
        'a confirmed time on a pending order',
        { confirmed_at: later },
        'orders_confirmed_at_matches_status',
      ],
      [
        'a confirmed time on a void order',
        { status: 'void', confirmed_at: later },
        'orders_confirmed_at_matches_status',
      ],
      [
        'a cancelled order with no cancel time',
        { status: 'cancelled', confirmed_at: later, cancelled_by: 'guest' },
        'orders_cancelled_matches_status',
      ],
      [
        'a cancelled order with no canceller',
        { status: 'cancelled', confirmed_at: later, cancelled_at: later },
        'orders_cancelled_matches_status',
      ],
      [
        'a canceller on a confirmed order',
        { status: 'confirmed', confirmed_at: later, cancelled_by: 'host' },
        'orders_cancelled_matches_status',
      ],
      [
        'a confirmed time before the created time',
        { status: 'confirmed', confirmed_at: earlier },
        'orders_confirmed_at_in_range',
      ],
      [
        'a confirmed time of infinity',
        { status: 'confirmed', confirmed_at: 'infinity' },
        'orders_confirmed_at_in_range',
      ],
      [
        'a cancelled time before the confirmed time',
        {
          status: 'cancelled',
          confirmed_at: later,
          cancelled_at: created,
          cancelled_by: 'guest',
        },
        'orders_cancelled_at_in_range',
      ],
      [
        'a created time of infinity',
        { created_at: 'infinity' },
        'orders_created_at_in_range',
      ],
      [
        'a free-cancel time past year 9999',
        { free_cancel_until: '10000-01-01 00:00:00+00' },
        'orders_free_cancel_until_in_range',
      ],
      [
        'a manage hash in upper case',
        { manage_token_hash: 'AB'.repeat(32) },
        'orders_manage_token_hash_shape',
      ],
      [
        'a manage hash of 63 characters',
        { manage_token_hash: 'a'.repeat(63) },
        'orders_manage_token_hash_shape',
      ],
      [
        'a token version of 0',
        { manage_token_version: 0 },
        'orders_manage_token_version_positive',
      ],
    ];

    it.each(refuses)('refuses %s', async (_name, change, name) => {
      await expect(insert('orders', orderRow(change))).rejects.toMatchObject(
        constraint(name),
      );
    });

    it.each([
      ['status', 'paid'],
      ['kind', 'refund'],
      ['cancelled_by', 'nobody'],
      ['tax_treatment', 'sometimes'],
    ])('refuses an unknown %s', async (column, value) => {
      await expect(
        insert('orders', orderRow({ [column]: value })),
      ).rejects.toMatchObject(invalidText);
    });
  });

  describe('references to other tables', () => {
    it.each([
      ['guest', 'guest_id', 'orders_guest_id_guests_id_fk'],
      ['experience', 'experience_id', 'orders_experience_id_experiences_id_fk'],
      ['host', 'host_id', 'orders_host_id_hosts_id_fk'],
      [
        'cancellation tier',
        'cancellation_tier_id',
        'orders_cancellation_tier_id_cancellation_tiers_id_fk',
      ],
    ])('refuses an unknown %s', async (_name, column, name) => {
      await expect(
        insert('orders', orderRow({ [column]: randomUUID() })),
      ).rejects.toMatchObject(constraint(name));
    });

    it.each([
      'guest_id',
      'experience_id',
      'host_id',
      'cancellation_tier_id',
      'terms_document_id',
    ])('refuses a null %s', async (column) => {
      await expect(
        insert('orders', orderRow({ [column]: null })),
      ).rejects.toMatchObject(notNull);
    });

    it.each([
      ['hold', 'hold_id', 'orders_hold_id_holds_id_fk'],
      ['session', 'session_id', 'orders_session_id_sessions_id_fk'],
      [
        'waiver document',
        'waiver_document_id',
        'orders_waiver_document_id_legal_documents_id_fk',
      ],
      [
        'terms document',
        'terms_document_id',
        'orders_terms_document_id_legal_documents_id_fk',
      ],
    ])(
      'refuses an order pointing at a missing %s',
      async (_name, column, name) => {
        const holdId = randomUUID();
        if (column !== 'hold_id') await ensureHold(holdId);
        const row = orderRow({
          hold_id: holdId,
          idempotency_key: `book:${holdId}`,
          ...(column === 'hold_id' ? {} : { [column]: randomUUID() }),
        });
        await expect(insertAsGiven('orders', row)).rejects.toMatchObject(
          constraint(name),
        );
      },
    );

    it('accepts a waiver document that exists, and keeps no foreign key yet on the gift id', async () => {
      await newOrder({ waiver_document_id: parents.termsDocumentId });
      await expect(newOrder({ gift_id: randomUUID() })).resolves.toBeTypeOf(
        'string',
      );
    });

    it('restricts deleting a hold, a session, or a document an order points at', async () => {
      const holdId = randomUUID();
      await newOrder({ hold_id: holdId, idempotency_key: `book:${holdId}` });
      await expect(
        client.db.execute(sql`DELETE FROM holds WHERE id = ${holdId}`),
      ).rejects.toMatchObject(constraint('orders_hold_id_holds_id_fk'));
      await expect(
        client.db.execute(
          sql`DELETE FROM sessions WHERE id = ${parents.sessionId}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
      await expect(
        client.db.execute(
          sql`DELETE FROM legal_documents WHERE id = ${parents.termsDocumentId}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });
});

describe('order items', () => {
  const item = (orderId: string, over: Row = {}): Row => ({
    order_id: orderId,
    price_option_id: parents.priceOptionId,
    label: 'Adult',
    quantity: 2,
    unit_price_minor: 8500,
    uses_space: true,
    line_total_minor: 17000,
    ...over,
  });

  it('accepts a priced line and refuses the same option twice on one order', async () => {
    const orderId = await newOrder();
    await insert('order_items', item(orderId));

    await expect(insert('order_items', item(orderId))).rejects.toMatchObject(
      constraint('order_items_order_id_price_option_id_pk'),
    );
  });

  it.each([
    [
      'a quantity of 0',
      { quantity: 0, line_total_minor: 0 },
      'order_items_quantity_in_range',
    ],
    [
      'a quantity above the cap',
      { quantity: 101, line_total_minor: 858_500 },
      'order_items_quantity_in_range',
    ],
    [
      'a negative price',
      { unit_price_minor: -1, line_total_minor: -2 },
      'order_items_unit_price_in_range',
    ],
    [
      'a price above the cap',
      { unit_price_minor: 10_000_001, line_total_minor: 20_000_002 },
      'order_items_unit_price_in_range',
    ],
    [
      'a line total that is not quantity times price',
      { line_total_minor: 17001 },
      'order_items_line_total_is_quantity_times_price',
    ],
    ['a blank label', { label: ' ' }, 'order_items_label_text'],
    [
      'a label over 80 characters',
      { label: 'a'.repeat(81) },
      'order_items_label_text',
    ],
  ])('refuses %s', async (_name, change, name) => {
    const orderId = await newOrder();

    await expect(
      insert('order_items', item(orderId, change)),
    ).rejects.toMatchObject(constraint(name));
  });

  it.each([
    ['order', 'order_id', 'order_items_order_id_orders_id_fk'],
    [
      'price option',
      'price_option_id',
      'order_items_price_option_id_price_options_id_fk',
    ],
  ])('refuses an unknown %s', async (_name, column, name) => {
    const orderId = await newOrder();

    await expect(
      insert('order_items', item(orderId, { [column]: randomUUID() })),
    ).rejects.toMatchObject(constraint(name));
  });
});

describe('payment attempts', () => {
  const attempt = (orderId: string, over: Row = {}): Row => {
    const attemptNo = (over.attempt_no as number | undefined) ?? 1;
    return {
      order_id: orderId,
      attempt_no: attemptNo,
      provider: 'fake',
      provider_key: `pay:${orderId}:${String(attemptNo)}`,
      amount_minor: 18509,
      created_at: created,
      updated_at: created,
      ...over,
    };
  };

  it('accepts an attempt with its defaults', async () => {
    const orderId = await newOrder();
    await insert('payment_attempts', attempt(orderId));

    const { rows } = await client.db.execute<Row>(
      sql`SELECT status, failed_tries, currency FROM payment_attempts WHERE order_id = ${orderId}`,
    );
    expect(rows[0]).toEqual({
      status: 'created',
      failed_tries: 0,
      currency: 'USD',
    });
  });

  it('refuses a second attempt number on an order', async () => {
    const orderId = await newOrder();
    await insert('payment_attempts', attempt(orderId, { status: 'canceled' }));

    await expect(
      insert('payment_attempts', attempt(orderId, { status: 'canceled' })),
    ).rejects.toMatchObject(
      constraint('payment_attempts_order_attempt_no_unique'),
    );
  });

  it.each(['created', 'requires_action', 'processing', 'failed_try'])(
    'refuses a second live attempt while the first is %s',
    async (status) => {
      const orderId = await newOrder();
      await insert(
        'payment_attempts',
        attempt(orderId, { status, failed_tries: 1 }),
      );

      await expect(
        insert('payment_attempts', attempt(orderId, { attempt_no: 2 })),
      ).rejects.toMatchObject(
        constraint('payment_attempts_one_live_per_order'),
      );
    },
  );

  it.each(['canceled', 'succeeded'])(
    'allows a new live attempt once the first is %s',
    async (status) => {
      const orderId = await newOrder();
      await insert('payment_attempts', attempt(orderId, { status }));

      await insert('payment_attempts', attempt(orderId, { attempt_no: 2 }));
    },
  );

  it('lets two orders each have a live attempt', async () => {
    await insert('payment_attempts', attempt(await newOrder()));
    await insert('payment_attempts', attempt(await newOrder()));
  });

  it('refuses a provider payment id used twice', async () => {
    await insert(
      'payment_attempts',
      attempt(await newOrder(), { provider_payment_id: 'pi_dup' }),
    );

    await expect(
      insert(
        'payment_attempts',
        attempt(await newOrder(), { provider_payment_id: 'pi_dup' }),
      ),
    ).rejects.toMatchObject(
      constraint('payment_attempts_provider_payment_id_unique'),
    );
  });

  it('allows many attempts with no provider payment id yet', async () => {
    await insert('payment_attempts', attempt(await newOrder()));
    await insert('payment_attempts', attempt(await newOrder()));
  });

  it('has a unique index on the provider key', async () => {
    const { rows } = await client.db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = ${fresh.schema} AND indexname = 'payment_attempts_provider_key_unique'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX.*\(provider_key\)/);
  });

  it.each([
    [
      'a key that is not from the order and number',
      { provider_key: 'pay:x:1' },
      'payment_attempts_provider_key_from_order',
    ],
    [
      'an attempt number of 0',
      { attempt_no: 0 },
      'payment_attempts_attempt_no_in_range',
    ],
    [
      'an attempt number past the limit',
      { attempt_no: 51 },
      'payment_attempts_attempt_no_in_range',
    ],
    [
      'a blank provider payment id',
      { provider_payment_id: ' ' },
      'payment_attempts_provider_payment_id_text',
    ],
    [
      'a provider payment id over 255 characters',
      { provider_payment_id: 'p'.repeat(256) },
      'payment_attempts_provider_payment_id_text',
    ],
    [
      'a negative amount',
      { amount_minor: -1 },
      'payment_attempts_amount_in_range',
    ],
    [
      'a currency other than USD',
      { currency: 'EUR' },
      'payment_attempts_currency_usd',
    ],
    [
      'more failed tries than the limit',
      { failed_tries: 6 },
      'payment_attempts_failed_tries_in_range',
    ],
    [
      'a failed try with none counted',
      { status: 'failed_try' },
      'payment_attempts_failed_try_counted',
    ],
    [
      'a failure code with no failed try',
      { failure_code: 'card_declined' },
      'payment_attempts_failure_code_shape',
    ],
    [
      'a failure code in upper case',
      { failed_tries: 1, failure_code: 'CARD' },
      'payment_attempts_failure_code_shape',
    ],
    [
      'a failure code over 64 characters',
      { failed_tries: 1, failure_code: 'a'.repeat(65) },
      'payment_attempts_failure_code_shape',
    ],
    [
      'an updated time before the created time',
      { updated_at: earlier },
      'payment_attempts_updated_at_in_range',
    ],
    [
      'a created time of infinity',
      { created_at: 'infinity', updated_at: 'infinity' },
      'payment_attempts_created_at_in_range',
    ],
  ])('refuses %s', async (_name, change, name) => {
    const orderId = await newOrder();
    const row = attempt(orderId, change);

    await expect(insert('payment_attempts', row)).rejects.toMatchObject(
      constraint(name),
    );
  });

  it.each([
    ['provider', 'paypal'],
    ['status', 'paid'],
    ['method', 'cheque'],
  ])('refuses an unknown %s', async (column, value) => {
    await expect(
      insert(
        'payment_attempts',
        attempt(await newOrder(), { [column]: value }),
      ),
    ).rejects.toMatchObject(invalidText);
  });

  it('refuses an attempt for an unknown order', async () => {
    const orderId = randomUUID();

    await expect(
      insert('payment_attempts', attempt(orderId)),
    ).rejects.toMatchObject(
      constraint('payment_attempts_order_id_orders_id_fk'),
    );
  });
});

describe('provider events', () => {
  const event = (over: Row = {}): Row => ({
    provider: 'stripe',
    provider_event_id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    object_id: 'pi_1',
    amount_minor: 18509,
    currency: 'USD',
    occurred_at: created,
    received_at: created,
    payload: { id: 'evt', type: 'payment_intent.succeeded' },
    ...over,
  });

  it('accepts an event and names no foreign key for the ids from metadata', async () => {
    await insert(
      'provider_events',
      event({ ramble_order_id: randomUUID(), ramble_record_id: randomUUID() }),
    );
  });

  it('accepts an event with no amount, currency, or ids', async () => {
    await insert(
      'provider_events',
      event({ amount_minor: null, currency: null }),
    );
  });

  it('refuses a repeat of one provider event and allows the same id from another provider', async () => {
    const providerEventId = `evt_${randomUUID()}`;
    await insert(
      'provider_events',
      event({ provider_event_id: providerEventId }),
    );

    await expect(
      insert('provider_events', event({ provider_event_id: providerEventId })),
    ).rejects.toMatchObject(
      constraint('provider_events_provider_event_id_unique'),
    );
    await insert(
      'provider_events',
      event({ provider: 'fake', provider_event_id: providerEventId }),
    );
  });

  it.each([
    [
      'a blank event id',
      { provider_event_id: ' ' },
      'provider_events_event_id_text',
    ],
    [
      'an event id over 255 characters',
      { provider_event_id: 'e'.repeat(256) },
      'provider_events_event_id_text',
    ],
    ['a blank object id', { object_id: '' }, 'provider_events_object_id_text'],
    [
      'a negative amount',
      { amount_minor: -1 },
      'provider_events_amount_in_range',
    ],
    [
      'an amount with no currency',
      { currency: null },
      'provider_events_amount_and_currency_together',
    ],
    [
      'a currency with no amount',
      { amount_minor: null },
      'provider_events_amount_and_currency_together',
    ],
    [
      'a currency in lower case',
      { currency: 'usd' },
      'provider_events_currency_shape',
    ],
    [
      'more handling tries than the cap',
      { attempts: 26 },
      'provider_events_attempts_in_range',
    ],
    [
      'a negative count of tries',
      { attempts: -1 },
      'provider_events_attempts_in_range',
    ],
    [
      'a blank last error',
      { last_error: ' ' },
      'provider_events_last_error_text',
    ],
    [
      'a last error over 500 characters',
      { last_error: 'e'.repeat(501) },
      'provider_events_last_error_text',
    ],
    [
      'a body that is an array',
      { payload: [] },
      'provider_events_payload_object',
    ],
    [
      'a body that is a string',
      { payload: 'text' },
      'provider_events_payload_object',
    ],
    [
      'a body over the stored size',
      { payload: { text: 'x'.repeat(33_000) } },
      'provider_events_payload_object',
    ],
    [
      'a processed time before the received time',
      { processed_at: earlier },
      'provider_events_processed_at_in_range',
    ],
    [
      'a received time of infinity',
      { received_at: 'infinity' },
      'provider_events_received_at_in_range',
    ],
    [
      'an occurred time of infinity',
      { occurred_at: 'infinity' },
      'provider_events_occurred_at_in_range',
    ],
  ])('refuses %s', async (_name, change, name) => {
    await expect(
      insert('provider_events', event(change)),
    ).rejects.toMatchObject(constraint(name));
  });

  it.each([
    ['type', 'payment.refunded'],
    ['provider', 'paypal'],
  ])('refuses an unknown %s', async (column, value) => {
    await expect(
      insert('provider_events', event({ [column]: value })),
    ).rejects.toMatchObject(invalidText);
  });

  it('refuses a missing body', async () => {
    const row = event();
    delete row.payload;

    await expect(insert('provider_events', row)).rejects.toMatchObject(notNull);
  });
});

describe('refunds', () => {
  const refund = (orderId: string, over: Row = {}): Row => {
    const id = randomUUID();
    return {
      id,
      order_id: orderId,
      ticket_minor: 17000,
      tax_minor: 1509,
      commission_returned_minor: 2550,
      amount_minor: 18509,
      reason: 'guest_cancel',
      provider_key: `refund:${id}`,
      status: 'pending',
      created_at: created,
      ...over,
    };
  };

  it.each([
    ['a pending refund', {}],
    [
      'a succeeded refund',
      { status: 'succeeded', succeeded_at: later, provider_refund_id: 're_ok' },
    ],
    ['a reinstated gift', { status: 'gift_reinstated' }],
    [
      'a tax-only refund',
      {
        ticket_minor: 0,
        commission_returned_minor: 0,
        tax_minor: 100,
        amount_minor: 100,
      },
    ],
  ])('accepts %s', async (_name, change) => {
    await insert('refunds', refund(await newOrder(), change));
  });

  it.each([
    [
      'an amount that is not ticket plus tax',
      { amount_minor: 18510 },
      'refunds_amount_is_ticket_plus_tax',
    ],
    [
      'an amount of 0',
      {
        ticket_minor: 0,
        tax_minor: 0,
        commission_returned_minor: 0,
        amount_minor: 0,
      },
      'refunds_amount_is_ticket_plus_tax',
    ],
    [
      'a negative ticket part',
      { ticket_minor: -1, amount_minor: 1508 },
      'refunds_parts_in_range',
    ],
    [
      'a commission returned above the ticket part',
      { commission_returned_minor: 17001 },
      'refunds_parts_in_range',
    ],
    [
      'a key that is not from the refund id',
      { provider_key: `refund:${randomUUID()}` },
      'refunds_provider_key_from_id',
    ],
    [
      'a blank provider refund id',
      { provider_refund_id: ' ' },
      'refunds_provider_refund_id_text',
    ],
    [
      'a reinstated gift with a provider refund id',
      { status: 'gift_reinstated', provider_refund_id: 're_x' },
      'refunds_reinstated_gift_refunds_no_payment',
    ],
    [
      'a succeeded refund with no succeeded time',
      { status: 'succeeded' },
      'refunds_succeeded_at_matches_status',
    ],
    [
      'a succeeded time on a pending refund',
      { succeeded_at: later },
      'refunds_succeeded_at_matches_status',
    ],
    [
      'a succeeded time before the created time',
      { status: 'succeeded', succeeded_at: earlier },
      'refunds_succeeded_at_in_range',
    ],
    [
      'a created time of infinity',
      { created_at: 'infinity' },
      'refunds_created_at_in_range',
    ],
  ])('refuses %s', async (_name, change, name) => {
    await expect(
      insert('refunds', refund(await newOrder(), change)),
    ).rejects.toMatchObject(constraint(name));
  });

  it('refuses a reinstated gift that names a payment attempt', async () => {
    const orderId = await newOrder();
    const attemptId = randomUUID();
    await insert('payment_attempts', {
      id: attemptId,
      order_id: orderId,
      attempt_no: 1,
      provider: 'fake',
      provider_key: `pay:${orderId}:1`,
      amount_minor: 18509,
    });

    await expect(
      insert(
        'refunds',
        refund(orderId, {
          status: 'gift_reinstated',
          payment_attempt_id: attemptId,
        }),
      ),
    ).rejects.toMatchObject(
      constraint('refunds_reinstated_gift_refunds_no_payment'),
    );
  });

  it('refuses a provider refund id used twice', async () => {
    await insert(
      'refunds',
      refund(await newOrder(), { provider_refund_id: 're_dup' }),
    );

    await expect(
      insert(
        'refunds',
        refund(await newOrder(), { provider_refund_id: 're_dup' }),
      ),
    ).rejects.toMatchObject(constraint('refunds_provider_refund_id_unique'));
  });

  it('refuses an unknown reason and status', async () => {
    await expect(
      insert('refunds', refund(await newOrder(), { reason: 'changed_mind' })),
    ).rejects.toMatchObject(invalidText);
    await expect(
      insert('refunds', refund(await newOrder(), { status: 'done' })),
    ).rejects.toMatchObject(invalidText);
  });

  it.each([
    ['order', 'order_id', 'refunds_order_id_orders_id_fk'],
    [
      'payment attempt',
      'payment_attempt_id',
      'refunds_payment_attempt_id_payment_attempts_id_fk',
    ],
  ])('refuses an unknown %s', async (_name, column, name) => {
    const row = refund(await newOrder(), { [column]: randomUUID() });

    await expect(insert('refunds', row)).rejects.toMatchObject(
      constraint(name),
    );
  });
});

describe('transfers', () => {
  const transfer = (orderId: string, over: Row = {}): Row => ({
    order_id: orderId,
    host_id: parents.hostId,
    release_after: '2026-11-10T12:00:00Z',
    provider_key: `transfer:${orderId}`,
    ...over,
  });

  it('accepts a scheduled transfer with its defaults', async () => {
    const orderId = await newOrder();
    await insert('transfers', transfer(orderId));

    const { rows } = await client.db.execute<Row>(
      sql`SELECT status, reversed_minor, amount_minor FROM transfers WHERE order_id = ${orderId}`,
    );
    expect(rows[0]).toEqual({
      status: 'scheduled',
      reversed_minor: 0,
      amount_minor: null,
    });
  });

  it.each([
    ['a releasing transfer', { status: 'releasing', amount_minor: 15000 }],
    [
      'a paid transfer partly reversed',
      { status: 'paid', amount_minor: 15000, reversed_minor: 5000 },
    ],
    ['a skipped transfer with no amount', { status: 'skipped' }],
    [
      'a skipped transfer with a zero amount',
      { status: 'skipped', amount_minor: 0 },
    ],
    ['a simulated transfer', { status: 'simulated', amount_minor: 15000 }],
  ])('accepts %s', async (_name, change) => {
    const orderId = await newOrder();
    await insert('transfers', transfer(orderId, change));
  });

  it('refuses a second transfer for one booking', async () => {
    const orderId = await newOrder();
    await insert('transfers', transfer(orderId));

    await expect(insert('transfers', transfer(orderId))).rejects.toMatchObject(
      constraint('transfers_order_id_unique'),
    );
  });

  it('has a unique index on the provider key', async () => {
    const { rows } = await client.db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = ${fresh.schema} AND indexname = 'transfers_provider_key_unique'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX.*\(provider_key\)/);
  });

  it.each([
    [
      'a scheduled transfer with an amount',
      { amount_minor: 15000 },
      'transfers_amount_set_at_release',
    ],
    [
      'a releasing transfer with no amount',
      { status: 'releasing' },
      'transfers_amount_set_at_release',
    ],
    [
      'a paid transfer of zero',
      { status: 'paid', amount_minor: 0 },
      'transfers_amount_set_at_release',
    ],
    [
      'a negative amount',
      { status: 'skipped', amount_minor: -1 },
      'transfers_amount_in_range',
    ],
    [
      'a reversal above the amount',
      { status: 'paid', amount_minor: 100, reversed_minor: 101 },
      'transfers_reversed_within_amount',
    ],
    [
      'a reversal on a transfer with no amount',
      { reversed_minor: 1 },
      'transfers_reversed_within_amount',
    ],
    [
      'a key that is not from the order',
      { provider_key: `transfer:${randomUUID()}` },
      'transfers_provider_key_from_order',
    ],
    [
      'a blank provider transfer id',
      { provider_transfer_id: ' ' },
      'transfers_provider_transfer_id_text',
    ],
    [
      'a release time of infinity',
      { release_after: 'infinity' },
      'transfers_release_after_in_range',
    ],
  ])('refuses %s', async (_name, change, name) => {
    await expect(
      insert('transfers', transfer(await newOrder(), change)),
    ).rejects.toMatchObject(constraint(name));
  });

  it('refuses a provider transfer id used twice', async () => {
    await insert(
      'transfers',
      transfer(await newOrder(), { provider_transfer_id: 'tr_dup' }),
    );

    await expect(
      insert(
        'transfers',
        transfer(await newOrder(), { provider_transfer_id: 'tr_dup' }),
      ),
    ).rejects.toMatchObject(
      constraint('transfers_provider_transfer_id_unique'),
    );
  });

  it('refuses an unknown status, order, and host', async () => {
    const orderId = await newOrder();
    await expect(
      insert('transfers', transfer(orderId, { status: 'sent' })),
    ).rejects.toMatchObject(invalidText);
    await expect(
      insert('transfers', transfer(randomUUID())),
    ).rejects.toMatchObject(constraint('transfers_order_id_orders_id_fk'));
    await expect(
      insert('transfers', transfer(orderId, { host_id: randomUUID() })),
    ).rejects.toMatchObject(constraint('transfers_host_id_hosts_id_fk'));
  });
});

describe('text that only looks blank', () => {
  // Postgres [[:space:]] takes these as text; JavaScript \s does not.
  it.each([
    ['U+00A0', ' '],
    ['U+FEFF', '﻿'],
    ['U+2028', ' '],
    ['a mix', '  ﻿\t'],
  ])('refuses a lead guest name of only %s', async (_name, value) => {
    await expect(
      insert('orders', orderRow({ lead_guest_name: value })),
    ).rejects.toMatchObject(constraint('orders_lead_guest_name_text'));
  });

  it.each([
    ['U+00A0', ' '],
    ['U+FEFF', '﻿'],
  ])('refuses a provider event id of only %s', async (_name, value) => {
    await expect(
      insert('provider_events', {
        provider: 'stripe',
        provider_event_id: value,
        type: 'payment.succeeded',
        object_id: 'pi_1',
        occurred_at: created,
        received_at: created,
        payload: {},
      }),
    ).rejects.toMatchObject(constraint('provider_events_event_id_text'));
  });
});

describe('provider event bodies', () => {
  const body = (payload: unknown) =>
    insert('provider_events', {
      provider: 'stripe',
      provider_event_id: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      object_id: 'pi_1',
      occurred_at: created,
      received_at: created,
      payload,
    });

  it('stores the largest body the contract accepts, mostly separators, within the stored limit', async () => {
    await body({ a: new Array<number>(8187).fill(1) });
  });

  it('refuses a small body of exponent numbers that jsonb would print in full', async () => {
    // The contract refuses these first (src/lib/payments.test.ts); this is the backstop under it.
    const payload = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`k${String(i)}`, 1e-300]),
    );

    await expect(body(payload)).rejects.toMatchObject(
      constraint('provider_events_payload_object'),
    );
  });
});
