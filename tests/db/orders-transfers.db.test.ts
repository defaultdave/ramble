import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { expectConstraint } from './harness';
import {
  client,
  created,
  fresh,
  insert,
  invalidText,
  newOrder,
  orderRow,
  parents,
  type Row,
  setupOrdersDatabase,
} from './orderFixtures';

// transfers: one per order, amount set at release, reversal within the amount, key from order, unique provider transfer id
// text that only looks blank: Postgres [[:space:]] against JavaScript \s, on a lead guest name and a provider event id

setupOrdersDatabase();

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

    await expectConstraint(
      insert('transfers', transfer(orderId)),
      'transfers_order_id_unique',
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
    await expectConstraint(
      insert('transfers', transfer(await newOrder(), change)),
      name,
    );
  });

  it('refuses a provider transfer id used twice', async () => {
    await insert(
      'transfers',
      transfer(await newOrder(), { provider_transfer_id: 'tr_dup' }),
    );

    await expectConstraint(
      insert(
        'transfers',
        transfer(await newOrder(), { provider_transfer_id: 'tr_dup' }),
      ),
      'transfers_provider_transfer_id_unique',
    );
  });

  it('refuses an unknown status, order, and host', async () => {
    const orderId = await newOrder();
    await expect(
      insert('transfers', transfer(orderId, { status: 'sent' })),
    ).rejects.toMatchObject(invalidText);
    await expectConstraint(
      insert('transfers', transfer(randomUUID())),
      'transfers_order_id_orders_id_fk',
    );
    await expectConstraint(
      insert('transfers', transfer(orderId, { host_id: randomUUID() })),
      'transfers_host_id_hosts_id_fk',
    );
  });
});

describe('text that only looks blank', () => {
  // Postgres [[:space:]] takes these as text; JavaScript \s does not. blank-text.db.test.ts checks
  // the class over every code point, so each column here only has to show it uses that class.
  it.each([
    ['U+2028', ' '],
    ['a mix', '  ﻿\t'],
  ])('refuses a lead guest name of only %s', async (_name, value) => {
    await expectConstraint(
      insert('orders', orderRow({ lead_guest_name: value })),
      'orders_lead_guest_name_text',
    );
  });

  it.each([
    ['U+00A0', ' '],
  ])('refuses a provider event id of only %s', async (_name, value) => {
    await expectConstraint(
      insert('provider_events', {
        provider: 'stripe',
        provider_event_id: value,
        type: 'payment.succeeded',
        object_id: 'pi_1',
        occurred_at: created,
        received_at: created,
        payload: {},
      }),
      'provider_events_event_id_text',
    );
  });
});
