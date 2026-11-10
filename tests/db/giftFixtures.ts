import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { giftValidUntil } from '@/lib/giftInDate';
import type { db as Db } from '@/server/db/client';
import { gifts, orders } from '@/server/db/schema';

type Database = typeof Db;

/** The rows a gift and its purchase order point at; `createOrderParents` makes them. */
export type GiftParents = {
  experienceId: string;
  hostId: string;
  guestId: string;
  termsDocumentId: string;
  tierId: string;
};

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reference = () =>
  `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;

const dayMs = 86_400_000;

/**
 * A gift with its confirmed purchase order: the order first, then the gift, then the order's
 * `gift_id`, the order the two foreign keys allow. The token hash is a random stand-in unless a
 * test passes the real one; the gift is `pending_payment` unless `over` says otherwise.
 */
export async function insertGift(
  db: Database,
  parents: GiftParents,
  over: Partial<typeof gifts.$inferInsert> = {},
) {
  const [order] = await db
    .insert(orders)
    .values({
      reference: reference(),
      kind: 'gift_purchase',
      status: 'confirmed',
      idempotencyKey: randomUUID(),
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail: 'pat@example.com',
      termsDocumentId: parents.termsDocumentId,
      ticketSubtotalMinor: 5000,
      taxTreatment: 'not_taxable',
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 5000,
      amountDueMinor: 5000,
      commissionRateBps: 1500,
      commissionMinor: 750,
      cancellationTierId: parents.tierId,
      confirmedAt: sql`clock_timestamp()`,
    })
    .returning({ id: orders.id });
  if (!order) throw new Error('no gift purchase order');
  const sendAt = new Date(Date.now() + dayMs);
  const [gift] = await db
    .insert(gifts)
    .values({
      purchaseOrderId: order.id,
      experienceId: parents.experienceId,
      valueMinor: 5000,
      buyerGuestId: parents.guestId,
      recipientName: 'Sam',
      recipientEmail: 'sam@example.com',
      sendAt,
      validUntil: giftValidUntil(sendAt, 12),
      tokenHash: randomBytes(32).toString('hex'),
      ...over,
    })
    .returning({ id: gifts.id });
  if (!gift) throw new Error('no gift');
  await db
    .update(orders)
    .set({ giftId: gift.id })
    .where(eq(orders.id, order.id));
  return { id: gift.id, orderId: order.id };
}
