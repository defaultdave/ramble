import 'server-only';
import type { z } from 'zod';
import {
  bookingCancellationData,
  bookingEmailKey,
  bookingRefundData,
  cancellationDecision,
  hostNoticeDecision,
  refundEmailDecision,
  refundEmailKey,
} from '@/lib/bookingEmails';
import type {
  GuestCancellationPayloadSchema,
  GuestRefundPayloadSchema,
  HostCancellationPayloadSchema,
} from '@/lib/cancelBooking';
import type { Transaction } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { readRefundForEmail } from '@/server/db/cancellationEmails';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';
import { sendEmail } from '@/server/ports/email';

// The emails a cancellation sends: the guest's cancellation notice, the host's notice that a guest
// cancelled, and the refund email when the provider confirms the money is on its way back. Payloads
// are ids and amounts, so a job row holds no address or name. Each handler is safe to run twice: the
// email's idempotency key is built from the order or the refund.

/** Thrown for a job that should not exist. The message names no address, name, or token. */
class CancellationEmailError extends Error {
  constructor(reason: string) {
    super(`Cancellation email refused: ${reason}`);
    this.name = 'CancellationEmailError';
  }
}

async function loadCancelledOrder(tx: Transaction, orderId: string) {
  const order = await readBookingEmailOrder(tx, orderId);
  if (!order) throw new CancellationEmailError('there is no such booking');
  if (cancellationDecision(order.source) === 'refuse') {
    throw new CancellationEmailError('the order is not a cancelled booking');
  }
  return order;
}

export async function sendGuestCancellation({
  tx,
  payload,
}: {
  tx: Transaction;
  payload: z.output<typeof GuestCancellationPayloadSchema>;
}): Promise<void> {
  const order = await loadCancelledOrder(tx, payload.orderId);
  const { source } = order;
  await sendEmail({
    template: 'booking-cancellation',
    to: order.contactEmail,
    data: bookingCancellationData({
      audience: 'guest',
      recipientName: source.leadGuestName,
      reference: source.reference,
      experienceName: source.experienceName,
      startsAt: source.startsAt,
      timeZone: source.timeZone,
      items: source.items,
      cancelledBy: payload.cancelledBy,
      refundMinor: payload.refundMinor,
      otherDatesPath: null,
      appUrl: env.APP_URL,
    }),
    idempotencyKey: bookingEmailKey('guest-cancellation', payload.orderId),
  });
}

export async function sendHostCancellationNotice({
  tx,
  payload,
}: {
  tx: Transaction;
  payload: z.output<typeof HostCancellationPayloadSchema>;
}): Promise<void> {
  const order = await loadCancelledOrder(tx, payload.orderId);
  const notice = hostNoticeDecision(order);
  if (notice.kind === 'refuse') {
    throw new CancellationEmailError('the host has no notification address');
  }
  const { source } = order;
  await sendEmail({
    template: 'booking-cancellation',
    to: notice.to,
    data: bookingCancellationData({
      audience: 'host',
      recipientName: source.hostName,
      reference: source.reference,
      experienceName: source.experienceName,
      startsAt: source.startsAt,
      timeZone: source.timeZone,
      items: source.items,
      cancelledBy: payload.cancelledBy,
      refundMinor: 0,
      otherDatesPath: null,
      appUrl: env.APP_URL,
    }),
    idempotencyKey: bookingEmailKey(
      'host-cancellation-notice',
      payload.orderId,
    ),
  });
}

/** Queued when the provider confirms a refund; only a guest's own cancellation sends it. */
export async function sendGuestRefund({
  tx,
  payload,
  jobId,
}: {
  tx: Transaction;
  payload: z.output<typeof GuestRefundPayloadSchema>;
  jobId: string;
}): Promise<void> {
  const refund = await readRefundForEmail(tx, payload.refundId);
  if (!refund) throw new CancellationEmailError('there is no such refund');
  const decision = refundEmailDecision(refund);
  if (decision === 'refuse') {
    throw new CancellationEmailError('the refund has not succeeded');
  }
  if (decision === 'skip') {
    logger.info('refund email skipped', { jobId, reason: 'other-reason' });
    return;
  }
  const order = await readBookingEmailOrder(tx, refund.orderId);
  if (!order) throw new CancellationEmailError('there is no such booking');
  await sendEmail({
    template: 'booking-refund',
    to: order.contactEmail,
    data: bookingRefundData({
      recipientName: order.source.leadGuestName,
      reference: order.source.reference,
      experienceName: order.source.experienceName,
      refundMinor: refund.amountMinor,
    }),
    idempotencyKey: refundEmailKey(payload.refundId),
  });
}
