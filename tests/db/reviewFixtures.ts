import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { db as Db } from '@/server/db/client';
import { orderItems, orders, sessions } from '@/server/db/schema';
import { insertHold } from './holdFixtures';
import type { createOrderParents } from './orderParents';

type Database = typeof Db;
type Parents = Awaited<ReturnType<typeof createOrderParents>>;

export const hour = 3_600_000;
export const day = 24 * hour;

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

export type BookingOptions = {
  /** How long ago the session ended, in milliseconds; negative for one still ahead. */
  endedAgoMs?: number;
  status?: 'confirmed' | 'cancelled' | 'pending_payment';
  contactEmail?: string;
  version?: number;
};

/**
 * A booking of a one-hour session that ended `endedAgoMs` ago, written straight to the tables, with
 * its hold and one order line. Times come from the clock the test process sees; the database judges
 * them on its own, which differs by well under the margins the tests leave.
 */
export async function insertBooking(
  db: Database,
  parents: Parents,
  {
    endedAgoMs = 5 * hour,
    status = 'confirmed',
    contactEmail = 'pat@example.com',
    version = 1,
  }: BookingOptions = {},
) {
  const endsAt = new Date(Date.now() - endedAgoMs);
  const [session] = await db
    .insert(sessions)
    .values({
      experienceId: parents.experienceId,
      startsAt: new Date(endsAt.getTime() - hour),
      endsAt,
      timeZone: 'America/New_York',
      allocation: 20,
      source: 'ramble',
    })
    .returning();
  if (!session) throw new Error('no session');
  const { id: holdId } = await insertHold(db, session.id);
  const id = randomUUID();
  const [order] = await db
    .insert(orders)
    .values({
      id,
      reference: reference(),
      kind: 'booking',
      status,
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId: session.id,
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail,
      leadGuestName: 'Pat Rivera',
      termsDocumentId: parents.termsDocumentId,
      ticketSubtotalMinor: 8500,
      taxTreatment: 'not_taxable',
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 8500,
      amountDueMinor: 8500,
      commissionRateBps: 1500,
      commissionMinor: 1275,
      cancellationTierId: parents.tierId,
      manageTokenVersion: version,
      confirmedAt: status === 'pending_payment' ? null : sql`clock_timestamp()`,
      cancelledAt: status === 'cancelled' ? sql`clock_timestamp()` : null,
      cancelledBy: status === 'cancelled' ? 'guest' : null,
    })
    .returning();
  if (!order) throw new Error('no order');
  await db.insert(orderItems).values({
    orderId: id,
    priceOptionId: parents.priceOptionId,
    label: 'Adult',
    quantity: 1,
    unitPriceMinor: 8500,
    usesSpace: true,
    lineTotalMinor: 8500,
  });
  return order;
}
