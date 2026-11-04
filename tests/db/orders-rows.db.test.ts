import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { orderCurrency } from '@/lib/orders';
import { expectConstraint } from './harness';
import {
  client,
  count,
  ensureHold,
  giftPurchaseRow,
  insert,
  later,
  newOrder,
  orderRow,
  reference,
  type Row,
  setupOrdersDatabase,
} from './orderFixtures';

// orders (rows):
// - a booking, a gift purchase, a confirmed and a cancelled order are accepted; defaults are set
// - the reference format, and the reference, key, and manage hash are unique (null hashes repeat)
// - a booking has a hold, session, lead guest, and the key book:<hold>; a gift purchase has none of those, a uuid key, no gift applied
// - at most one live order per hold: a void order frees the hold (the index is reached with the key rules lifted, in a rolled-back transaction)
// - text, email, children ages, and guardian rules

setupOrdersDatabase();

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
    await expectConstraint(
      insert('orders', orderRow({ reference: value })),
      'orders_reference_shape',
    );
  });

  it('refuses a second order with one reference', async () => {
    const ref = reference();
    await newOrder({ reference: ref });

    await expectConstraint(
      insert('orders', orderRow({ reference: ref })),
      'orders_reference_unique',
    );
  });

  it('refuses a second order with one idempotency key', async () => {
    const holdId = randomUUID();
    const base = { hold_id: holdId, idempotency_key: `book:${holdId}` };
    await newOrder(base);

    await expectConstraint(
      insert('orders', orderRow(base)),
      'orders_idempotency_key_unique',
    );
  });

  it('refuses a second order with one manage hash and allows many without one', async () => {
    const hash = 'cd'.repeat(32);
    await newOrder({ manage_token_hash: hash });
    await newOrder();
    await newOrder();

    await expectConstraint(
      insert('orders', orderRow({ manage_token_hash: hash })),
      'orders_manage_token_hash_unique',
    );
  });

  describe('one live order per hold', () => {
    // A booking's key must be book:<hold>, so a second order on a hold meets the key index before
    // this one. With the key rules lifted inside a transaction that is rolled back, this index is
    // what is left, and it is the one that frees a hold whose order went void.
    const withKeyRulesLifted = async (
      run: (
        insertOrder: (
          key: string,
          overrides: Record<string, unknown>,
        ) => Promise<unknown>,
      ) => Promise<void>,
    ) => {
      const holdId = randomUUID();
      await ensureHold(holdId);
      const connection = await client.db.$client.connect();
      const insertOrder = (key: string, overrides: Record<string, unknown>) => {
        const row = orderRow({
          hold_id: holdId,
          idempotency_key: key,
          ...overrides,
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
        await run(insertOrder);
      } finally {
        await connection.query('ROLLBACK');
        connection.release();
      }
    };

    it('refuses a second live order and frees the hold when the first is void', async () => {
      await withKeyRulesLifted(async (insertOrder) => {
        await insertOrder('first', { status: 'void' });
        await insertOrder('second', { status: 'pending_payment' });

        await expect(
          insertOrder('third', { status: 'pending_payment' }),
        ).rejects.toMatchObject({ constraint: 'orders_one_live_per_hold' });
      });
    });

    it('refuses a second live order on a hold whose first order is confirmed', async () => {
      await withKeyRulesLifted(async (insertOrder) => {
        await insertOrder('first', {
          status: 'confirmed',
          confirmed_at: later,
        });

        await expect(
          insertOrder('second', { status: 'pending_payment' }),
        ).rejects.toMatchObject({ constraint: 'orders_one_live_per_hold' });
      });
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
      await expectConstraint(insert('orders', build()), 'orders_kind_shape');
    });
  });

  describe('contact and text', () => {
    it.each([
      ['an upper-case email', 'Pat@example.com'],
      ['no domain', 'pat@'],
      ['a display name', 'Pat <pat@example.com>'],
      ['255 characters', `${'a'.repeat(243)}@example.com`],
    ])('refuses an email that is %s', async (_name, value) => {
      await expectConstraint(
        insert('orders', orderRow({ contact_email: value })),
        'orders_contact_email_shape',
      );
    });

    it.each([
      ['blank', ' '],
      ['41 characters', 'p'.repeat(41)],
    ])('refuses a phone that is %s', async (_name, value) => {
      await expectConstraint(
        insert('orders', orderRow({ contact_phone: value })),
        'orders_contact_phone_text',
      );
    });

    it.each([
      ['blank', ' '],
      ['121 characters', 'n'.repeat(121)],
    ])('refuses a lead guest name that is %s', async (_name, value) => {
      await expectConstraint(
        insert('orders', orderRow({ lead_guest_name: value })),
        'orders_lead_guest_name_text',
      );
    });

    it.each([
      ['attribution_source'],
      ['attribution_campaign'],
      ['attribution_issue'],
    ])('refuses a blank and an over-long %s', async (column) => {
      await expectConstraint(
        insert('orders', orderRow({ [column]: '  ' })),
        'orders_attribution_text',
      );
      await expectConstraint(
        insert('orders', orderRow({ [column]: 'a'.repeat(101) })),
        'orders_attribution_text',
      );
    });

    it.each([
      ['guardian_name', 'g'.repeat(121)],
      ['guardian_contact', 'g'.repeat(255)],
    ])('refuses an over-long %s', async (column, value) => {
      await expectConstraint(
        insert(
          'orders',
          orderRow({
            guardian_name: 'Pat',
            guardian_contact: 'pat@example.com',
            [column]: value,
          }),
        ),
        'orders_guardian_text',
      );
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
      await expectConstraint(
        insert('orders', orderRow({ children_ages: ages, ...guardian })),
        'orders_children_ages_valid',
      );
    });

    it('refuses children with no guardian', async () => {
      await expectConstraint(
        insert('orders', orderRow({ children_ages: [4] })),
        'orders_guardian_complete',
      );
    });

    it.each([
      ['a name with no contact', { guardian_name: 'Pat' }],
      ['a contact with no name', { guardian_contact: 'x@example.com' }],
    ])('refuses a guardian %s', async (_name, change) => {
      await expectConstraint(
        insert('orders', orderRow(change)),
        'orders_guardian_complete',
      );
    });
  });
});
