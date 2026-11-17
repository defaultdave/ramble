import 'server-only';
import { reviewInviteData } from '@/lib/email/reviewInvite';
import {
  reviewInviteDecision,
  reviewInviteEmailKey,
  type ReviewInvitePayload,
} from '@/lib/reviews';
import type { Transaction } from '@/server/db/client';
import { readReviewOrder } from '@/server/db/reviews';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';
import type { Clock } from '@/server/ports/clock';
import { sendEmail } from '@/server/ports/email';
import { capabilityToken } from '@/server/tokens';

// The review-invite job. The payload is the order id (and, for a hand-sent invite, the send id):
// the handler reads the order, so the job row holds no address, name, or token. It is safe to run
// twice: the email's key is built from the order (or the send), so a retry, a second job, or a crash
// after the send delivers one message, and the link is rebuilt from the order's token version, so
// every attempt carries the same one.

/** Thrown for an order that should not have an invite job. The message names no address, name, or token. */
export class ReviewInviteError extends Error {
  constructor(reason: string) {
    super(`Review invite refused: ${reason}`);
    this.name = 'ReviewInviteError';
  }
}

export async function sendReviewInvite({
  tx,
  payload,
  jobId,
  clock,
}: {
  tx: Transaction;
  payload: ReviewInvitePayload;
  jobId: string;
  clock: Clock;
}): Promise<void> {
  const order = await readReviewOrder(tx, payload.orderId);
  if (!order) throw new ReviewInviteError('there is no such booking');
  const decision = reviewInviteDecision(order.facts, clock.now());
  if (decision === 'refuse') {
    throw new ReviewInviteError('the order is not a booking');
  }
  if (decision === 'skip') {
    logger.info('review invite skipped', { jobId });
    return;
  }
  await sendEmail({
    template: 'review-invite',
    to: order.contactEmail,
    data: reviewInviteData(order, {
      reference: order.reference,
      token: capabilityToken('review', order.orderId, order.manageTokenVersion),
      appUrl: env.APP_URL,
    }),
    idempotencyKey: reviewInviteEmailKey(payload),
  });
}
