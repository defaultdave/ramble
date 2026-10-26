import 'server-only';
import {
  maxFailureReasonLength,
  maxSendAttempts,
  type MessageStatus,
} from '@/lib/email/message';
import { chooseAdapter } from '@/lib/email/route';
import { parseEmailRequest, type EmailRequest } from '@/lib/email/templates';
import {
  claimRetry,
  findMessageByKey,
  insertMessage,
  isAddressSuppressed,
  recordFailed,
  recordSent,
  recordSuppressed,
  type MessageRecord,
} from '@/server/db/messages';
import { getAdapter, getEmailConfig } from './config';
import { IdempotencyConflictError, SendAttemptsExhaustedError } from './errors';
import { renderEmail } from './render';

export type SendEmailResult = {
  messageId: string;
  status: MessageStatus;
  /** True when this key had already been sent (or is being sent), so nothing was sent now. */
  deduplicated: boolean;
};

const settled = (message: MessageRecord): SendEmailResult => ({
  messageId: message.id,
  status: message.status,
  deduplicated: true,
});

/** A failed message, or one a crashed sender left queued, can be sent again. */
const canResume = (status: MessageStatus) =>
  status === 'failed' || status === 'queued';

function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message.slice(0, maxFailureReasonLength) || 'Unknown error';
}

// TODO(U-004a): first caller, the sign-in link.
/**
 * The only way the app sends email. Renders the template, applies EMAIL_MODE, skips suppressed
 * addresses, logs the message, and hands it to one adapter. The same idempotency key sends once:
 * a repeat returns the earlier message, and a failed send can be retried under its key, up to
 * `maxSendAttempts` provider calls. A provider failure is logged and then thrown.
 */
export async function sendEmail(input: EmailRequest): Promise<SendEmailResult> {
  const request = parseEmailRequest(input);
  const config = getEmailConfig();
  const adapterName = chooseAdapter({ ...config, to: request.to });
  const adapter = getAdapter(adapterName);

  const existing = await findMessageByKey(request.idempotencyKey);
  if (existing) {
    if (
      existing.template !== request.template ||
      existing.recipient !== request.to
    ) {
      throw new IdempotencyConflictError();
    }
    if (!canResume(existing.status)) return settled(existing);
  }

  const rendered = await renderEmail(request, config.appUrl);
  const suppressed = await isAddressSuppressed(request.to);

  let claimed: MessageRecord | null;
  if (existing) {
    if (suppressed) {
      await recordSuppressed(existing.id);
      return {
        messageId: existing.id,
        status: 'suppressed',
        deduplicated: false,
      };
    }
    claimed = await claimRetry(existing.id);
  } else {
    claimed = await insertMessage(
      {
        idempotencyKey: request.idempotencyKey,
        template: request.template,
        recipient: request.to,
        subject: rendered.subject,
        adapter: adapterName,
      },
      suppressed ? 'suppressed' : 'attempt',
    );
    if (claimed?.status === 'suppressed') {
      return {
        messageId: claimed.id,
        status: 'suppressed',
        deduplicated: false,
      };
    }
  }

  if (!claimed) {
    const current = await findMessageByKey(request.idempotencyKey);
    if (!current) throw new Error('A message row vanished while being sent');
    if (current.status === 'failed' && current.attempts >= maxSendAttempts) {
      throw new SendAttemptsExhaustedError();
    }
    return settled(current);
  }

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await adapter.send({
      from: config.from,
      replyTo: config.replyTo,
      to: request.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: request.idempotencyKey,
    }));
  } catch (error) {
    await recordFailed(claimed.id, failureReason(error));
    throw error;
  }

  // Only the dev mailbox keeps a body: a real send's body can hold a capability link.
  const kept = adapter.name === 'fake';
  const status = kept ? 'captured' : 'sent';
  await recordSent(claimed.id, {
    status,
    providerMessageId,
    ...(kept ? { body: { html: rendered.html, text: rendered.text } } : {}),
  });
  return { messageId: claimed.id, status, deduplicated: false };
}
