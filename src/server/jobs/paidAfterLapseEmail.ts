import 'server-only';
import type { z } from 'zod';
import { paidAfterLapseData } from '@/lib/bookingEmails';
import {
  paidAfterLapseDedupeKey,
  type PaidAfterLapsePayloadSchema,
} from '@/lib/refundPath';
import type { Transaction } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { env } from '@/server/env';
import { sendEmail } from '@/server/ports/email';
import { BookingEmailError } from './bookingEmails';

/**
 * Tells a guest the payment that reached us after their booking was given up on is being refunded
 * (S10). The payload is ids and an amount, so a job row holds no address or name. Safe to run
 * twice: the email's idempotency key is built from the order.
 */
export async function sendPaidAfterLapse({
  tx,
  payload,
}: {
  tx: Transaction;
  payload: z.output<typeof PaidAfterLapsePayloadSchema>;
}): Promise<void> {
  const order = await readBookingEmailOrder(tx, payload.orderId);
  if (!order) throw new BookingEmailError('there is no such booking');
  const { source } = order;
  await sendEmail({
    template: 'paid-after-lapse',
    to: order.contactEmail,
    data: paidAfterLapseData({
      recipientName: source.leadGuestName,
      reference: source.reference,
      experienceName: source.experienceName,
      startsAt: source.startsAt,
      timeZone: source.timeZone,
      amountMinor: payload.amountMinor,
      reason: payload.reason,
      appUrl: env.APP_URL,
    }),
    idempotencyKey: paidAfterLapseDedupeKey(payload.orderId),
  });
}
