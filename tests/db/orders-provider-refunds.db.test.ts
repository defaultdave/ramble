import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expectConstraint } from './harness';
import {
  created,
  earlier,
  insert,
  invalidText,
  later,
  newOrder,
  notNull,
  type Row,
  setupOrdersDatabase,
} from './orderFixtures';

// provider events: provider and event id unique, amount with currency, currency shape, body object within its size, tries, times
// provider event bodies: an object within the stored size limit
// refunds: parts, amount, key from id, reinstated gift, succeeded time, unique provider refund id

setupOrdersDatabase();

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

    await expectConstraint(
      insert('provider_events', event({ provider_event_id: providerEventId })),
      'provider_events_provider_event_id_unique',
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
    await expectConstraint(insert('provider_events', event(change)), name);
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

    await expectConstraint(body(payload), 'provider_events_payload_object');
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
    await expectConstraint(
      insert('refunds', refund(await newOrder(), change)),
      name,
    );
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

    await expectConstraint(
      insert(
        'refunds',
        refund(orderId, {
          status: 'gift_reinstated',
          payment_attempt_id: attemptId,
        }),
      ),
      'refunds_reinstated_gift_refunds_no_payment',
    );
  });

  it('refuses a provider refund id used twice', async () => {
    await insert(
      'refunds',
      refund(await newOrder(), { provider_refund_id: 're_dup' }),
    );

    await expectConstraint(
      insert(
        'refunds',
        refund(await newOrder(), { provider_refund_id: 're_dup' }),
      ),
      'refunds_provider_refund_id_unique',
    );
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

    await expectConstraint(insert('refunds', row), name);
  });
});
