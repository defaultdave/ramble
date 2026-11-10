import 'server-only';
import type { OpsNoticeData } from '@/lib/email/opsNotice';
import { sendEmail } from '@/server/ports/email';
import { getEmailConfig } from '@/server/ports/email/config';

// The ops-notice job: one email to Ramble's own support address. The payload is the template's data
// and carries whatever the caller put in it (a contact message holds a guest's name and address), so
// a finished job's row is as personal as the request it announces; the PII inventory says so.

type Context = { payload: OpsNoticeData; jobId: string };

/** Safe to run twice: the email's idempotency key is the job's ID, so a retry delivers one message. */
export async function sendOpsNotice({
  payload,
  jobId,
}: Context): Promise<void> {
  await sendEmail({
    template: 'ops-notice',
    to: getEmailConfig().replyTo,
    data: payload,
    idempotencyKey: `ops-notice:${jobId}`,
  });
}
