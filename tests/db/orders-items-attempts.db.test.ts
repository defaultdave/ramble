import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { expectConstraint } from './harness';
import {
  client,
  created,
  earlier,
  fresh,
  insert,
  invalidText,
  newOrder,
  parents,
  type Row,
  setupOrdersDatabase,
} from './orderFixtures';

// order items: key, quantity, price, line total, label, foreign keys
// payment attempts: order and number unique, one live attempt per order, key from order and number, tries, failure code, times

setupOrdersDatabase();

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

    await expectConstraint(
      insert('order_items', item(orderId)),
      'order_items_order_id_price_option_id_pk',
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

    await expectConstraint(insert('order_items', item(orderId, change)), name);
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

    await expectConstraint(
      insert('order_items', item(orderId, { [column]: randomUUID() })),
      name,
    );
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

    await expectConstraint(
      insert('payment_attempts', attempt(orderId, { status: 'canceled' })),
      'payment_attempts_order_attempt_no_unique',
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

      await expectConstraint(
        insert('payment_attempts', attempt(orderId, { attempt_no: 2 })),
        'payment_attempts_one_live_per_order',
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

    await expectConstraint(
      insert(
        'payment_attempts',
        attempt(await newOrder(), { provider_payment_id: 'pi_dup' }),
      ),
      'payment_attempts_provider_payment_id_unique',
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

    await expectConstraint(insert('payment_attempts', row), name);
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

    await expectConstraint(
      insert('payment_attempts', attempt(orderId)),
      'payment_attempts_order_id_orders_id_fk',
    );
  });
});
