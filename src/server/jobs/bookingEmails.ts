import 'server-only';
import { z } from 'zod';
import {
  bookingEmailKey,
  confirmationDecision,
  type ConfirmationDecision,
  guestConfirmationData,
  hostBookingNoticeData,
  hostNoticeDecision,
  moveEmailKey,
  resendEmailKey,
  reminderDecision,
  sessionReminderData,
} from '@/lib/bookingEmails';
import { WriteIdSchema } from '@/lib/catalog';
import type { GuestMovePayloadSchema } from '@/lib/moveBooking';
import type { GuestResendPayloadSchema } from '@/lib/opsBookings';
import type { Transaction } from '@/server/db/client';
import {
  readBookingEmailOrder,
  type BookingEmailOrder,
} from '@/server/db/bookingEmails';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';
import type { EmailRequest } from '@/lib/email/templates';
import type { Clock } from '@/server/ports/clock';
import { sendEmail } from '@/server/ports/email';
import { secureEqual } from '@/server/hash';
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

/** Reads the order and applies the email's decision to it; a `refuse` is a job that should not exist, and throws `refusal`. */
export async function loadOrder(
  tx: Transaction,
  orderId: string,
  decide: (
    source: BookingEmailOrder['source'],
  ) => ConfirmationDecision = confirmationDecision,
  refusal = 'the order is not a confirmed booking',
) {
  const order = await readBookingEmailOrder(tx, orderId);
  if (!order) throw new BookingEmailError('there is no such booking');
  const decision = decide(order.source);
  if (decision === 'refuse') throw new BookingEmailError(refusal);
  return { order, decision };
}

/**
 * The manage token for the order at its current version, only if the order's stored hash is the
 * token's hash. A link that would not open the order (the confirm step wrote no hash yet, or a bump
 * left this version behind) is never sent.
 */
function liveManageToken(order: BookingEmailOrder): string {
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

/** The guest-confirmation email (with its `.ics`) for an order, its link rebuilt at the order's current version, to the address on the order. */
export function guestConfirmationRequest(
  order: BookingEmailOrder,
  idempotencyKey: string,
): Extract<EmailRequest, { template: 'guest-confirmation' }> {
  return {
    template: 'guest-confirmation',
    to: order.contactEmail,
    data: guestConfirmationData(order.source, {
      appUrl: env.APP_URL,
      manageToken: liveManageToken(order),
    }),
    idempotencyKey,
  };
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
  await sendEmail(
    guestConfirmationRequest(
      order,
      bookingEmailKey('guest-confirmation', payload.orderId),
    ),
  );
}

/**
 * The confirmation of a move: the booking as it now stands, with a link rebuilt from the order's
 * version. A booking cancelled since is skipped, as for the first confirmation.
 */
export async function sendGuestMoveConfirmation({
  tx,
  payload,
  jobId,
}: {
  tx: Transaction;
  payload: z.output<typeof GuestMovePayloadSchema>;
  jobId: string;
}): Promise<void> {
  const { order, decision } = await loadOrder(tx, payload.orderId);
  if (decision === 'skip') {
    logger.info('booking email skipped', { jobId, reason: 'cancelled' });
    return;
  }
  await sendEmail({
    template: 'booking-moved',
    to: order.contactEmail,
    data: guestConfirmationData(order.source, {
      appUrl: env.APP_URL,
      manageToken: liveManageToken(order),
    }),
    idempotencyKey: moveEmailKey(payload.moveId),
  });
}

/**
 * The confirmation an ops resend queued: the booking as it now stands, with a link rebuilt from the
 * order's version, to the address on the order, under the resend's own key. A booking cancelled since
 * is skipped, as for the first confirmation.
 */
export async function sendGuestResend({
  tx,
  payload,
  jobId,
}: {
  tx: Transaction;
  payload: z.output<typeof GuestResendPayloadSchema>;
  jobId: string;
}): Promise<void> {
  const { order, decision } = await loadOrder(tx, payload.orderId);
  if (decision === 'skip') {
    logger.info('booking email skipped', { jobId, reason: 'cancelled' });
    return;
  }
  await sendEmail(
    guestConfirmationRequest(order, resendEmailKey(payload.resendId)),
  );
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
  const notice = hostNoticeDecision(order);
  if (notice.kind === 'refuse') {
    throw new BookingEmailError('the host has no notification address');
  }
  await sendEmail({
    template: 'host-booking-notice',
    to: notice.to,
    data: hostBookingNoticeData(order.source),
    idempotencyKey: bookingEmailKey('host-booking-notice', payload.orderId),
  });
}

/**
 * The reminder to the guest (PRD-27). It was queued at confirm to run 24 hours before the session,
 * so the order may have been cancelled since: that, and a session that has already started, send
 * nothing.
 */
export async function sendSessionReminder({
  tx,
  payload,
  jobId,
  clock,
}: Context & { clock: Clock }): Promise<void> {
  const order = await readBookingEmailOrder(tx, payload.orderId);
  if (!order) throw new BookingEmailError('there is no such booking');
  const decision = reminderDecision(order.source, clock.now());
  if (decision === 'refuse') {
    throw new BookingEmailError('the order is not a confirmed booking');
  }
  if (decision === 'skip') {
    logger.info('booking email skipped', { jobId, reason: 'not-due' });
    return;
  }
  await sendEmail({
    template: 'session-reminder',
    to: order.contactEmail,
    data: sessionReminderData(order.source, {
      appUrl: env.APP_URL,
      manageToken: liveManageToken(order),
    }),
    idempotencyKey: bookingEmailKey('session-reminder', payload.orderId),
  });
}
