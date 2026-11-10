import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { insertGift } from './giftFixtures';
import { expectConstraint } from './harness';
import {
  client,
  created,
  earlier,
  ensureHold,
  insert,
  insertAsGiven,
  invalidText,
  later,
  newOrder,
  notNull,
  orderRow,
  parents,
  type Row,
  setupOrdersDatabase,
} from './orderFixtures';

// orders (money and status):
// - money: ranges, tax rate zero unless taxable, tax and commission rounding, total, gift, amount due, refund caps
// - status and time rules; times in range
// - foreign keys to guests, experiences, hosts, cancellation tiers, holds, sessions, and the terms and waiver documents; gifts

setupOrdersDatabase();

describe('orders', () => {
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
      await expectConstraint(insert('orders', orderRow(change)), name);
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
      await expectConstraint(insert('orders', orderRow(change)), name);
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
      await expectConstraint(
        insert('orders', orderRow({ [column]: randomUUID() })),
        name,
      );
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
        await expectConstraint(insertAsGiven('orders', row), name);
      },
    );

    it('accepts a waiver document and a gift that exist', async () => {
      await newOrder({ waiver_document_id: parents.termsDocumentId });
      const gift = await insertGift(client.db, parents);
      await expect(newOrder({ gift_id: gift.id })).resolves.toBeTypeOf(
        'string',
      );
    });

    it('refuses an order pointing at a missing gift', async () => {
      await expectConstraint(
        insert('orders', orderRow({ gift_id: randomUUID() })),
        'orders_gift_id_gifts_id_fk',
      );
    });

    it('restricts deleting a hold, a session, or a document an order points at', async () => {
      const holdId = randomUUID();
      await newOrder({ hold_id: holdId, idempotency_key: `book:${holdId}` });
      await expectConstraint(
        client.db.execute(sql`DELETE FROM holds WHERE id = ${holdId}`),
        'orders_hold_id_holds_id_fk',
      );
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
