import 'server-only';
import { randomUUID } from 'node:crypto';
import { confirmationDecision, resendEmailKey } from '@/lib/bookingEmails';
import { WriteIdSchema } from '@/lib/catalog';
import { confirmationResentEntry } from '@/lib/opsBookings';
import type { Caller } from '@/server/auth/caller';
import { recordAudit, requireOpsUserId } from '@/server/db/audit';
import { db } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { guestConfirmationRequest } from '@/server/jobs/bookingEmails';
import { sendEmail } from '@/server/ports/email';

export type ResendOutcome = 'sent' | 'not_found' | 'not_resendable';

/**
 * Sends the booking's confirmation again, with a manage link rebuilt at the order's current token
 * version and the `.ics`, to the address on the booking and to no other: the address is read from
 * the order, never from the request. The send is logged in the message log under a key made from the
 * resend's id, and the audit row carrying that id is written first, so a resend that cannot be
 * recorded is not sent.
 */
export async function resendBookingConfirmation(
  caller: Caller,
  orderId: string,
): Promise<ResendOutcome> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(orderId);
  const order = await db.transaction((tx) => readBookingEmailOrder(tx, id));
  if (order === null) return 'not_found';
  if (confirmationDecision(order.source) !== 'send') return 'not_resendable';
  const resendId = randomUUID();
  const request = guestConfirmationRequest(order, resendEmailKey(resendId));
  await recordAudit(confirmationResentEntry(userId, id, resendId));
  await sendEmail(request);
  return 'sent';
}
