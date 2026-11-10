import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { giftLimits } from '@/lib/giftInDate';
import { giftItems, gifts, orders } from '@/server/db/schema';
import { insertGift } from './giftFixtures';
import {
  createFreshDatabase,
  expectConstraint,
  type FreshDatabase,
} from './harness';
import { createOrderParents } from './orderParents';

// Behaviours under test, one per decision, branch or risk.
// - a gift and its items are accepted; the defaults are pending_payment, token version 1, and a creation time
// - the database refuses what the domain refuses: a value out of range, a blank or long name, a bad address, a blank or long message,
//   a malformed token hash or version, a send time past the horizon (the horizon itself is accepted), a validity that ends before it starts
// - sent_at is set exactly for delivered and redeemed gifts; the redeemed order and time are set exactly for redeemed ones; a reinstated gift clears them
// - the refund statuses are not in the enum
// - one gift per purchase order and one gift per token hash
// - a gift needs its experience, buyer, and purchase order; an order with a gift, and a gift with a redemption, cannot be deleted from under it
// - gift items: label, quantity, price, tax rate, and line total ranges; one row per price option

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  parents = await createOrderParents(client.db, 'gifts');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const dayMs = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * dayMs);
const stored = async (id: string) => {
  const [row] = await client.db.select().from(gifts).where(eq(gifts.id, id));
  if (!row) throw new Error('gift missing');
  return row;
};
const make = (over: Partial<typeof gifts.$inferInsert> = {}) =>
  insertGift(client.db, parents, over);

describe('accepting a gift', () => {
  it('stores the defaults the design doc names', async () => {
    const { id } = await make();

    const row = await stored(id);
    expect(row).toMatchObject({
      status: 'pending_payment',
      tokenVersion: 1,
      sentAt: null,
      redeemedAt: null,
      redeemedOrderId: null,
      message: null,
    });
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('points its purchase order back at it', async () => {
    const { id, orderId } = await make();

    const [order] = await client.db
      .select({ giftId: orders.giftId })
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order?.giftId).toBe(id);
  });

  it('accepts a send time exactly at the horizon', async () => {
    const created = new Date();
    const { id } = await make({
      createdAt: created,
      sendAt: new Date(created.getTime() + giftLimits.sendHorizonDays * dayMs),
      validUntil: inDays(800),
    });

    expect((await stored(id)).id).toBe(id);
  });

  it('accepts a message at its limit', async () => {
    const { id } = await make({ message: 'a'.repeat(giftLimits.message) });

    expect((await stored(id)).message).toHaveLength(giftLimits.message);
  });
});

describe('refusing a gift the domain refuses', () => {
  const nameOver = 'a'.repeat(giftLimits.recipientName + 1);
  const messageOver = 'a'.repeat(giftLimits.message + 1);

  it.each([
    ['a zero value', { valueMinor: 0 }, 'gifts_value_in_range'],
    [
      'a value above the cap',
      { valueMinor: 2_000_000_001 },
      'gifts_value_in_range',
    ],
    [
      'a blank recipient name',
      { recipientName: '   ' },
      'gifts_recipient_name_text',
    ],
    [
      'a recipient name over its limit',
      { recipientName: nameOver },
      'gifts_recipient_name_text',
    ],
    [
      'an upper-case address',
      { recipientEmail: 'Sam@Example.com' },
      'gifts_recipient_email_shape',
    ],
    [
      'an address with a display name',
      { recipientEmail: 'Sam <sam@example.com>' },
      'gifts_recipient_email_shape',
    ],
    ['a blank message', { message: '  ' }, 'gifts_message_text'],
    [
      'a message over its limit',
      { message: messageOver },
      'gifts_message_text',
    ],
    [
      'a token hash that is not 64 hex characters',
      { tokenHash: 'abc' },
      'gifts_token_hash_shape',
    ],
    [
      'an upper-case token hash',
      { tokenHash: 'A'.repeat(64) },
      'gifts_token_hash_shape',
    ],
    [
      'a token version of zero',
      { tokenVersion: 0 },
      'gifts_token_version_positive',
    ],
    [
      'a send time past the horizon',
      { sendAt: inDays(giftLimits.sendHorizonDays + 1) },
      'gifts_send_at_within_horizon',
    ],
    [
      'a validity that ends at the send time',
      (() => {
        const sendAt = inDays(2);
        return { sendAt, validUntil: sendAt };
      })(),
      'gifts_valid_until_after_send_at',
    ],
    [
      'delivered with no sent time',
      { status: 'delivered' as const },
      'gifts_sent_at_matches_status',
    ],
    [
      'scheduled with a sent time',
      { status: 'scheduled' as const, sentAt: new Date() },
      'gifts_sent_at_matches_status',
    ],
    [
      'redeemed with no redeemed order',
      {
        status: 'redeemed' as const,
        sentAt: new Date(),
        redeemedAt: new Date(),
      },
      'gifts_redeemed_matches_status',
    ],
    [
      'a redeemed time on a delivered gift',
      {
        status: 'delivered' as const,
        sentAt: new Date(),
        redeemedAt: new Date(),
      },
      'gifts_redeemed_matches_status',
    ],
  ] as const)('refuses %s', async (_name, over, constraint) => {
    await expectConstraint(make({ ...over }), constraint);
  });

  it('refuses a redeemed time before the sent time', async () => {
    const redeemedOrder = (await make()).orderId;

    await expectConstraint(
      make({
        status: 'redeemed',
        sentAt: new Date(),
        redeemedAt: new Date(Date.now() - dayMs),
        redeemedOrderId: redeemedOrder,
      }),
      'gifts_redeemed_at_in_range',
    );
  });

  it.each(['refund_pending', 'refunded', 'expired_refunded'])(
    'has no %s status',
    async (status) => {
      const { id } = await make();

      await expect(
        client.db.execute(
          sql`UPDATE gifts SET status = ${status}::gift_status WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '22P02' } });
    },
  );
});

describe('a gift through its states', () => {
  it('is redeemed with its order and time, then reinstated by clearing them', async () => {
    const { id } = await make({ status: 'delivered', sentAt: new Date() });
    const redemption = await make();

    await client.db
      .update(gifts)
      .set({
        status: 'redeemed',
        redeemedOrderId: redemption.orderId,
        redeemedAt: new Date(),
      })
      .where(eq(gifts.id, id));
    expect((await stored(id)).status).toBe('redeemed');

    await client.db
      .update(gifts)
      .set({ status: 'delivered', redeemedOrderId: null, redeemedAt: null })
      .where(eq(gifts.id, id));
    expect(await stored(id)).toMatchObject({
      status: 'delivered',
      redeemedOrderId: null,
    });
  });

  it('cannot be reinstated while it keeps its redeemed order', async () => {
    const { id } = await make({ status: 'delivered', sentAt: new Date() });
    const redemption = await make();
    await client.db
      .update(gifts)
      .set({
        status: 'redeemed',
        redeemedOrderId: redemption.orderId,
        redeemedAt: new Date(),
      })
      .where(eq(gifts.id, id));

    await expectConstraint(
      client.db
        .update(gifts)
        .set({ status: 'delivered' })
        .where(eq(gifts.id, id)),
      'gifts_redeemed_matches_status',
    );
  });
});

describe('uniqueness and foreign keys', () => {
  it('allows one gift per purchase order', async () => {
    const { orderId } = await make();

    await expectConstraint(
      client.db.insert(gifts).values({
        purchaseOrderId: orderId,
        experienceId: parents.experienceId,
        valueMinor: 1000,
        buyerGuestId: parents.guestId,
        recipientName: 'Sam',
        recipientEmail: 'sam@example.com',
        sendAt: inDays(1),
        validUntil: inDays(400),
        tokenHash: 'c'.repeat(64),
      }),
      'gifts_purchase_order_id_unique',
    );
  });

  it('allows one gift per token hash', async () => {
    const tokenHash = 'd'.repeat(64);
    await make({ tokenHash });

    await expectConstraint(make({ tokenHash }), 'gifts_token_hash_unique');
  });

  it.each([
    [
      'purchase order',
      { purchaseOrderId: randomUUID() },
      'gifts_purchase_order_id_orders_id_fk',
    ],
    [
      'experience',
      { experienceId: randomUUID() },
      'gifts_experience_id_experiences_id_fk',
    ],
    [
      'buyer',
      { buyerGuestId: randomUUID() },
      'gifts_buyer_guest_id_guests_id_fk',
    ],
  ] as const)(
    'refuses a gift pointing at a missing %s',
    async (_name, over, constraint) => {
      const { id } = await make();

      await expectConstraint(
        client.db.update(gifts).set(over).where(eq(gifts.id, id)),
        constraint,
      );
    },
  );

  it('restricts deleting the order a gift was bought with, and the gift an order names', async () => {
    const { id, orderId } = await make();

    await expectConstraint(
      client.db.delete(orders).where(eq(orders.id, orderId)),
      'gifts_purchase_order_id_orders_id_fk',
    );
    await expectConstraint(
      client.db.delete(gifts).where(eq(gifts.id, id)),
      'orders_gift_id_gifts_id_fk',
    );
  });
});

describe('gift items', () => {
  const item = (
    giftId: string,
    over: Partial<typeof giftItems.$inferInsert> = {},
  ) => ({
    giftId,
    priceOptionId: parents.priceOptionId,
    label: 'Adult',
    quantity: 2,
    unitPriceMinor: 2500,
    taxRatePpm: 88_750,
    usesSpace: true,
    lineTotalMinor: 5000,
    ...over,
  });

  it('accepts the party as priced at purchase, one row per price option', async () => {
    const { id } = await make();
    await client.db.insert(giftItems).values(item(id));

    await expectConstraint(
      client.db.insert(giftItems).values(item(id)),
      'gift_items_gift_id_price_option_id_pk',
    );
  });

  it.each([
    ['a blank label', { label: ' ' }, 'gift_items_label_text'],
    [
      'a zero quantity',
      { quantity: 0, lineTotalMinor: 0 },
      'gift_items_quantity_in_range',
    ],
    [
      'a quantity above the cap',
      { quantity: 101, lineTotalMinor: 252_500 },
      'gift_items_quantity_in_range',
    ],
    [
      'a negative unit price',
      { unitPriceMinor: -1, lineTotalMinor: -2 },
      'gift_items_unit_price_in_range',
    ],
    [
      'a tax rate above 100 percent',
      { taxRatePpm: 1_000_001 },
      'gift_items_tax_rate_in_range',
    ],
    [
      'a line total that is not quantity times price',
      { lineTotalMinor: 4999 },
      'gift_items_line_total_is_quantity_times_price',
    ],
  ] as const)('refuses %s', async (_name, over, constraint) => {
    const { id } = await make();

    await expectConstraint(
      client.db.insert(giftItems).values(item(id, over)),
      constraint,
    );
  });

  it('refuses an item for a missing gift or a missing price option', async () => {
    const { id } = await make();

    await expectConstraint(
      client.db.insert(giftItems).values(item(randomUUID())),
      'gift_items_gift_id_gifts_id_fk',
    );
    await expectConstraint(
      client.db
        .insert(giftItems)
        .values(item(id, { priceOptionId: randomUUID() })),
      'gift_items_price_option_id_price_options_id_fk',
    );
  });
});
