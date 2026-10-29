import 'server-only';
import { z } from 'zod';
import {
  confirmationDecision,
  guestConfirmationData,
  hostBookingNoticeData,
} from '@/lib/bookingEmails';
import { WriteIdSchema } from '@/lib/catalog';
import type { Transaction } from '@/server/db/client';
import {
  readBookingEmailOrder,
  type BookingEmailOrder,
} from '@/server/db/bookingEmails';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';
import { sendEmail } from '@/server/ports/email';
import { secureEqual } from '@/server/secureEqual';
import { capabilityToken, hashToken } from '@/server/tokens';

// The guest-confirmation and host-booking-notice jobs (PRD-25, PRD-44). The payload is the order id
// and nothing else: the handler reads the order, so the job row holds no address, name, or token.
// Both handlers are safe to run twice. The email's idempotency key is built from the order, so a
// retry, a second job for the order, or a crash after the send delivers one message, and the link
// is rebuilt from the order's version, so every attempt carries the same one.

export const BookingEmailPayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
});
export type BookingEmailPayload = z.output<typeof BookingEmailPayloadSchema>;

type Context = { tx: Transaction; payload: BookingEmailPayload; jobId: string };

/** Thrown for an order that should not have a job. The message names no address, name, or token. */
export class BookingEmailError extends Error {
  constructor(reason: string) {
    super(`Booking email refused: ${reason}`);
    this.name = 'BookingEmailError';
  }
}

async function loadOrder(tx: Transaction, orderId: string) {
  const order = await readBookingEmailOrder(tx, orderId);
  if (!order) throw new BookingEmailError('there is no such booking');
  const decision = confirmationDecision(order.source);
  if (decision === 'refuse') {
    throw new BookingEmailError('the order is not a confirmed booking');
  }
  return { order, decision };
}

/**
 * The manage token for the order at its current version, only if the order's stored hash is the
 * token's hash. A link that would not open the order (the confirm step wrote no hash yet, or a bump
 * left this version behind) is never sent.
 */
export function liveManageToken(order: BookingEmailOrder): string {
  const token = capabilityToken(
    'manage',
    order.source.orderId,
    order.manageTokenVersion,
  );
  if (
    order.manageTokenHash === null ||
    !secureEqual(hashToken(token), order.manageTokenHash)
  ) {
    throw new BookingEmailError('the order has no live manage link');
  }
  return token;
}

export async function sendGuestConfirmation({
  tx,
  payload,
  jobId,
}: Context): Promise<void> {
  const { order, decision } = await loadOrder(tx, payload.orderId);
  if (decision === 'skip') {
    logger.info('booking email skipped', { jobId, reason: 'cancelled' });
    return;
  }
  await sendEmail({
    template: 'guest-confirmation',
    to: order.contactEmail,
    data: guestConfirmationData(order.source, {
      appUrl: env.APP_URL,
      manageToken: liveManageToken(order),
    }),
    idempotencyKey: `guest-confirmation:${payload.orderId}`,
  });
}

export async function sendHostBookingNotice({
  tx,
  payload,
  jobId,
}: Context): Promise<void> {
  const { order, decision } = await loadOrder(tx, payload.orderId);
  if (decision === 'skip') {
    logger.info('booking email skipped', { jobId, reason: 'cancelled' });
    return;
  }
  if (order.hostNotificationEmail === null) {
    throw new BookingEmailError('the host has no notification address');
  }
  await sendEmail({
    template: 'host-booking-notice',
    to: order.hostNotificationEmail,
    data: hostBookingNoticeData(order.source),
    idempotencyKey: `host-booking-notice:${payload.orderId}`,
  });
}
