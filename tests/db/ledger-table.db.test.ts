import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { insertGift } from './giftFixtures';
import {
  cashRow,
  client,
  code,
  fresh,
  insert,
  newBooking,
  nextProviderId,
  openLedgerDatabase,
  parents,
  plainRow,
  type Row,
} from './ledgerFixtures';

// Behaviours under test, one per decision, branch or risk.
// The table and its CHECKs (each bad row is refused by the database, with the constraint named):
// - a cash row and a non-cash row are accepted; the defaults are USD and a recording time from clock_timestamp()
// - the debit and credit accounts differ; the amount is 1 to the cap; the currency is USD
// - the accounts are ones the entry type moves money between (a row inserted around Zod with a wrong pair is refused; the two legs of a multi-leg type are accepted)
// - an order, gift, or host is named, except on Ramble's own payout
// - a provider id is present exactly on rows that touch platform_cash, and is not blank or over 255 characters
// - a memo is not blank and at most 500 characters; times are in range
// - simulated has no default; the id is generated; an unknown entry type or account is refused
// - foreign keys to order, host, attempt, refund, and transfer; gift; none on dispute or created_by; an order with entries cannot be deleted
// - the cash index: the same entry type and provider id twice is refused, the same id under another type is not, rows with no provider id repeat

openLedgerDatabase();

const constraint = (name: string) => ({ cause: { constraint: name } });
const notNull = code('23502');
const invalidText = code('22P02');
const foreignKey = code('23503');

describe('ledger_entries', () => {
  it('accepts a cash row and a non-cash row, and fills the defaults', async () => {
    await insert(cashRow());
    await insert(plainRow());
    const { rows } = await client.db.execute<Row>(
      sql`SELECT currency, recorded_at > now() - interval '1 minute' AS recent, id FROM ledger_entries ORDER BY id LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({ currency: 'USD', recent: true });
    expect(Number(rows[0]?.id)).toBeGreaterThan(0);
  });

  it.each([
    [
      'the same debit and credit account',
      () => plainRow({ credit_account: 'host_payable' }),
      'ledger_entries_accounts_differ',
    ],
    [
      'accounts the entry type never moves money between',
      () =>
        cashRow({
          entry_type: 'charge_commission',
          debit_account: 'ramble_payouts',
          credit_account: 'platform_cash',
        }),
      'ledger_entries_entry_type_accounts',
    ],
    [
      'a leg of the right accounts under the wrong entry type',
      () =>
        plainRow({
          entry_type: 'refund_reversal',
          debit_account: 'host_payable',
          credit_account: 'refunds_pending',
        }),
      'ledger_entries_entry_type_accounts',
    ],
    [
      'an amount of zero',
      () => cashRow({ amount_minor: 0 }),
      'ledger_entries_amount_in_range',
    ],
    [
      'an amount below zero',
      () => cashRow({ amount_minor: -1 }),
      'ledger_entries_amount_in_range',
    ],
    [
      'an amount over the cap',
      () => cashRow({ amount_minor: 2_000_000_001 }),
      'ledger_entries_amount_in_range',
    ],
    [
      'a currency other than USD',
      () => cashRow({ currency: 'EUR' }),
      'ledger_entries_currency_usd',
    ],
    [
      'no order, gift, or host',
      () => cashRow({ host_id: null }),
      'ledger_entries_names_a_subject',
    ],
    [
      'a cash row with no provider id',
      () => cashRow({ provider_object_id: null }),
      'ledger_entries_provider_id_on_cash',
    ],
    [
      'a cash row on the credit side with no provider id',
      () =>
        cashRow({
          entry_type: 'transfer_to_host',
          debit_account: 'host_payable',
          credit_account: 'platform_cash',
          provider_object_id: null,
        }),
      'ledger_entries_provider_id_on_cash',
    ],
    [
      'a non-cash row with a provider id',
      () => plainRow({ provider_object_id: 'pi_x' }),
      'ledger_entries_provider_id_on_cash',
    ],
    [
      'a blank provider id',
      () => cashRow({ provider_object_id: '  ' }),
      'ledger_entries_provider_id_text',
    ],
    [
      'a provider id over 255 characters',
      () => cashRow({ provider_object_id: 'p'.repeat(256) }),
      'ledger_entries_provider_id_text',
    ],
    ['a blank memo', () => cashRow({ memo: ' ' }), 'ledger_entries_memo_text'],
    [
      'a memo over 500 characters',
      () => cashRow({ memo: 'm'.repeat(501) }),
      'ledger_entries_memo_text',
    ],
    [
      'an occurrence before year 1000',
      () => cashRow({ occurred_at: '0999-12-31T00:00:00Z' }),
      'ledger_entries_occurred_at_in_range',
    ],
    [
      'a recording time in year 10000',
      () => cashRow({ recorded_at: '10000-01-01 00:00:00+00' }),
      'ledger_entries_recorded_at_in_range',
    ],
  ])('refuses %s', async (_name, row, name) => {
    await expect(insert(row())).rejects.toMatchObject(constraint(name));
  });

  it.each([
    ['refund_reversal', 'refunds_pending', 'host_payable'],
    ['refund_reversal', 'refunds_pending', 'ramble_commission'],
    ['gift_reinstated', 'host_payable', 'gift_liability'],
    ['gift_reinstated', 'ramble_commission', 'gift_liability'],
  ])('accepts the %s leg %s to %s', async (entryType, debit, credit) => {
    await insert(
      plainRow({
        entry_type: entryType,
        debit_account: debit,
        credit_account: credit,
      }),
    );
  });

  it('accepts the bounds: an amount of 1 and of the cap, 255 and 500 characters', async () => {
    await insert(cashRow({ amount_minor: 1 }));
    await insert(cashRow({ amount_minor: 2_000_000_000 }));
    await insert(
      cashRow({
        provider_object_id: 'p'.repeat(255),
        memo: 'm'.repeat(500),
      }),
    );
  });

  it("lets Ramble's own payout name no order, gift, or host, and no other type", async () => {
    const payout = {
      entry_type: 'ramble_payout',
      debit_account: 'ramble_payouts',
      credit_account: 'platform_cash',
      host_id: null,
    };
    await insert(cashRow(payout));
    await expect(
      insert(
        cashRow({
          ...payout,
          entry_type: 'processing_fee',
          debit_account: 'processing_fees',
        }),
      ),
    ).rejects.toMatchObject(constraint('ledger_entries_names_a_subject'));
  });

  it('accepts a gift or an order alone as the subject, and refuses a gift that does not exist', async () => {
    await insert(
      cashRow({
        host_id: null,
        gift_id: (await insertGift(client.db, parents)).id,
      }),
    );
    await expect(
      insert(cashRow({ host_id: null, gift_id: randomUUID() })),
    ).rejects.toMatchObject(constraint('ledger_entries_gift_id_gifts_id_fk'));
    await insert(
      cashRow({ host_id: null, order_id: await parents.newOrder() }),
    );
  });

  it('has no default for simulated and generates the id itself', async () => {
    const withoutSimulated = Object.fromEntries(
      Object.entries(cashRow()).filter(([column]) => column !== 'simulated'),
    );
    await expect(insert(withoutSimulated)).rejects.toMatchObject(notNull);
    await expect(insert(cashRow({ id: 5 }))).rejects.toMatchObject(
      code('428C9'),
    );
  });

  it.each([
    ['an unknown entry type', { entry_type: 'bonus' }],
    ['an unknown debit account', { debit_account: 'petty_cash' }],
    ['an unknown credit account', { credit_account: 'petty_cash' }],
  ])('refuses %s', async (_name, over) => {
    await expect(insert(cashRow(over))).rejects.toMatchObject(invalidText);
  });

  it.each([
    ['order_id', { order_id: randomUUID() }],
    ['host_id', { host_id: randomUUID() }],
    ['payment_attempt_id', { payment_attempt_id: randomUUID() }],
    ['refund_id', { refund_id: randomUUID() }],
    ['transfer_id', { transfer_id: randomUUID() }],
  ])('refuses a %s that points at nothing', async (_name, over) => {
    await expect(insert(cashRow(over))).rejects.toMatchObject(foreignKey);
  });

  it('takes a dispute and a staff user with no row behind them yet', async () => {
    await insert(
      cashRow({ dispute_id: randomUUID(), created_by: randomUUID() }),
    );
  });

  it('keeps an order that has entries from being deleted', async () => {
    const { orderId } = await newBooking();
    await insert(cashRow({ order_id: orderId }));
    await expect(
      client.db.execute(sql`DELETE FROM orders WHERE id = ${orderId}`),
    ).rejects.toMatchObject(foreignKey);
  });

  it('keeps cash from posting twice: one entry type and provider id, once', async () => {
    const providerId = nextProviderId();
    await insert(cashRow({ provider_object_id: providerId }));
    await expect(
      insert(cashRow({ provider_object_id: providerId })),
    ).rejects.toMatchObject(constraint('ledger_entries_cash_event_unique'));
    // The same provider id under another type is another posting of the same payment.
    await insert(
      cashRow({
        entry_type: 'charge_commission',
        credit_account: 'ramble_commission',
        provider_object_id: providerId,
      }),
    );
  });

  it('lets rows with no provider id repeat, and the index only covers rows with one', async () => {
    await insert(plainRow());
    await insert(plainRow());
    const { rows } = await client.db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = ${fresh.schema} AND indexname = 'ledger_entries_cash_event_unique'`,
    );
    expect(rows[0]?.indexdef).toMatch(
      /UNIQUE.*\(entry_type, provider_object_id\)/,
    );
    expect(rows[0]?.indexdef).toMatch(/WHERE.*provider_object_id IS NOT NULL/);
  });
});
