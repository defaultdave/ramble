import 'server-only';
import { asc, eq } from 'drizzle-orm';
import type { BookingEmailSource } from '@/lib/bookingEmails';
import { maxMoneyLines } from '@/lib/email/bookingTemplates';
import type { Transaction } from './client';
import { experiences, hosts, orderItems, orders, sessions } from './schema';

// What the booking email jobs read: one order with its session, experience, and host. The reads
// decide nothing; src/lib/bookingEmails.ts decides what the email says.

export type BookingEmailOrder = {
  source: BookingEmailSource;
  contactEmail: string;
  hostNotificationEmail: string | null;
  manageTokenVersion: number;
  manageTokenHash: string | null;
};

/** Null when there is no such order. The job runs in a transaction, so both reads see one snapshot. */
export async function readBookingEmailOrder(
  tx: Transaction,
  orderId: string,
): Promise<BookingEmailOrder | null> {
  const [row] = await tx
    .select({
      orderId: orders.id,
      reference: orders.reference,
      kind: orders.kind,
      status: orders.status,
      leadGuestName: orders.leadGuestName,
      contactEmail: orders.contactEmail,
      taxTreatment: orders.taxTreatment,
      taxMinor: orders.taxMinor,
      totalMinor: orders.totalMinor,
      giftAppliedMinor: orders.giftAppliedMinor,
      amountDueMinor: orders.amountDueMinor,
      freeCancelUntil: orders.freeCancelUntil,
      confirmedAt: orders.confirmedAt,
      manageTokenVersion: orders.manageTokenVersion,
      manageTokenHash: orders.manageTokenHash,
      experienceName: experiences.name,
      meetingPoint: experiences.meetingPoint,
      durationMinutes: experiences.durationMinutes,
      hostName: hosts.name,
      hostNotificationEmail: hosts.notificationEmail,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      timeZone: sessions.timeZone,
    })
    .from(orders)
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .innerJoin(hosts, eq(hosts.id, orders.hostId))
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .where(eq(orders.id, orderId));
  if (!row) return null;

  // One more than the email can show, so an order with too many lines is refused and not trimmed.
  const items = await tx
    .select({
      label: orderItems.label,
      quantity: orderItems.quantity,
      lineTotalMinor: orderItems.lineTotalMinor,
      usesSpace: orderItems.usesSpace,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.label), asc(orderItems.priceOptionId))
    .limit(maxMoneyLines + 1);

  const {
    contactEmail,
    hostNotificationEmail,
    manageTokenVersion,
    manageTokenHash,
    ...rest
  } = row;
  return {
    source: { ...rest, items },
    contactEmail,
    hostNotificationEmail,
    manageTokenVersion,
    manageTokenHash,
  };
}
