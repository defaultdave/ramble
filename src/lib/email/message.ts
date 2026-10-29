import { z } from 'zod';
import { EmailAddressSchema } from './address';

export const messageStatuses = [
  'queued',
  'sent',
  'captured',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'suppressed',
] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const emailAdapterNames = ['fake', 'resend', 'postmark'] as const;
export type EmailAdapterName = (typeof emailAdapterNames)[number];

export const suppressionReasons = ['hard_bounce', 'complaint'] as const;
export type SuppressionReason = (typeof suppressionReasons)[number];

/** After this many provider calls for one message the row is final; the caller gives up. */
export const maxSendAttempts = 5;

/** A message still queued after this long was abandoned by a crashed sender and may be claimed. */
export const staleQueuedMinutes = 10;

export const maxFailureReasonLength = 500;
export const maxProviderMessageIdLength = 200;
export const maxTemplateNameLength = 64;
export const maxSubjectLength = 200;
export const maxBodyLength = 300_000;

/** Printable ASCII, 1 to 200 characters: safe as the provider's idempotency header. */
export const idempotencyKeyPattern = String.raw`^[!-~]{1,200}$`;
export const templateNamePattern = String.raw`^[a-z][a-z0-9-]*$`;
/** One header line: no line break can smuggle a second header. */
export const subjectPattern = String.raw`^[^\r\n]+$`;

export const IdempotencyKeySchema = z
  .string()
  .regex(new RegExp(idempotencyKeyPattern));

const maxAttachments = 2;
export const maxAttachmentChars = 20_000;
const maxAttachmentNameLength = 100;

/** A file sent with a message. `content` is the file's text; an adapter encodes it for its provider. */
export const EmailAttachmentSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(maxAttachmentNameLength)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  contentType: z.enum(['text/calendar; charset=utf-8']),
  content: z.string().min(1).max(maxAttachmentChars),
});
export type EmailAttachment = z.infer<typeof EmailAttachmentSchema>;

export const RenderedEmailSchema = z.object({
  subject: z.string().max(maxSubjectLength).regex(new RegExp(subjectPattern)),
  html: z.string().min(1).max(maxBodyLength),
  text: z.string().min(1).max(maxBodyLength),
  attachments: EmailAttachmentSchema.array().max(maxAttachments),
});
export type RenderedEmail = z.infer<typeof RenderedEmailSchema>;

export const MailboxSummarySchema = z.object({
  id: z.uuid(),
  recipient: EmailAddressSchema,
  template: z.string().max(maxTemplateNameLength),
  subject: z.string().max(maxSubjectLength),
  status: z.enum(messageStatuses),
  createdAt: z.date(),
});
export type MailboxSummary = z.infer<typeof MailboxSummarySchema>;

export const MailboxMessageSchema = MailboxSummarySchema.extend({
  html: z.string().max(maxBodyLength),
  textBody: z.string().max(maxBodyLength),
});
export type MailboxMessage = z.infer<typeof MailboxMessageSchema>;

export type DeliveryEventKind = 'delivered' | 'hard_bounce' | 'complaint';

export type DeliveryEvent = {
  providerMessageId: string;
  kind: DeliveryEventKind;
};

const statusAfterEvent: Record<DeliveryEventKind, MessageStatus> = {
  delivered: 'delivered',
  hard_bounce: 'bounced',
  complaint: 'complained',
};

// Provider events arrive out of order and more than once. A status only moves toward a worse
// outcome, so a late "delivered" never hides a bounce and a replay changes nothing.
const rank: Partial<Record<MessageStatus, number>> = {
  sent: 1,
  captured: 1,
  delivered: 2,
  bounced: 3,
  complained: 4,
};

/**
 * The status a message takes after a delivery event, or null when it keeps its status. Messages
 * that never left (queued, failed, suppressed) take no events.
 */
export function statusAfterDeliveryEvent(
  current: MessageStatus,
  event: DeliveryEventKind,
): MessageStatus | null {
  const from = rank[current];
  if (from === undefined) return null;
  const next = statusAfterEvent[event];
  return (rank[next] ?? 0) > from ? next : null;
}

export function suppressionReasonFor(
  event: DeliveryEventKind,
): SuppressionReason | null {
  switch (event) {
    case 'hard_bounce':
      return 'hard_bounce';
    case 'complaint':
      return 'complaint';
    case 'delivered':
      return null;
  }
}

const statusLabels: Record<MessageStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  captured: 'In dev mailbox',
  delivered: 'Delivered',
  bounced: 'Bounced',
  complained: 'Spam complaint',
  failed: 'Failed',
  suppressed: 'Suppressed',
};

export function messageStatusLabel(status: MessageStatus): string {
  return statusLabels[status];
}

const timestampFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatMailboxTimestamp(at: Date): string {
  return `${timestampFormat.format(at)} UTC`;
}

/** What the send path does with a message that already has this idempotency key. */
export type ExistingMessagePlan =
  'settled' | 'resume' | 'conflict' | 'adapter_changed';

/**
 * A key already used for another template or recipient is a conflict, never a second send. A
 * message past `queued` or `failed` is settled. One that can be resumed is resumed only through
 * the adapter it started on: a changed configuration between attempts must fail, because the row
 * (its adapter, and whether it may hold a body) would no longer describe the send.
 */
export function planExistingMessage(
  existing: {
    status: MessageStatus;
    template: string;
    recipient: string;
    adapter: EmailAdapterName;
  },
  request: { template: string; to: string; adapter: EmailAdapterName },
): ExistingMessagePlan {
  if (
    existing.template !== request.template ||
    existing.recipient !== request.to
  ) {
    return 'conflict';
  }
  if (existing.status !== 'failed' && existing.status !== 'queued') {
    return 'settled';
  }
  return existing.adapter === request.adapter ? 'resume' : 'adapter_changed';
}

/** True once a failed message has used every provider call it gets. */
export function sendAttemptsExhausted(message: {
  status: MessageStatus;
  attempts: number;
}): boolean {
  return message.status === 'failed' && message.attempts >= maxSendAttempts;
}

/** The text stored for a failed send: the error's message cut to the column limit, never empty. */
export function failureReasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message.slice(0, maxFailureReasonLength) || 'Unknown error';
}

/**
 * The status a sent message takes, and whether its body is kept. Only the fake adapter (the dev
 * mailbox) keeps a body: a real send's body can hold a capability link.
 */
export function outcomeForAdapter(adapter: EmailAdapterName): {
  status: 'sent' | 'captured';
  keepsBody: boolean;
} {
  return adapter === 'fake'
    ? { status: 'captured', keepsBody: true }
    : { status: 'sent', keepsBody: false };
}

/**
 * True when a provider's bounce type means the address will not accept mail, so it should be
 * suppressed. Resend says `Permanent`; Postmark says `HardBounce` or `BadEmailAddress`. A transient
 * or unknown type may still be delivered later and suppresses nothing.
 */
export function isPermanentBounce(
  provider: 'resend' | 'postmark',
  type: string | undefined,
): boolean {
  switch (provider) {
    case 'resend':
      return type === 'Permanent';
    case 'postmark':
      return type === 'HardBounce' || type === 'BadEmailAddress';
  }
}

/** True when a provider answer's status says the same request could succeed later. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The start of a provider's refusal, on one line, short enough for the failure column. */
export function summarizeRefusal(body: string, maxLength: number): string {
  return body.slice(0, maxLength).replaceAll(/\s+/g, ' ').trim();
}

/** True when a Content-Length header declares more than `max` bytes. An absent header declares nothing. */
export function declaredLengthExceeds(
  header: string | null,
  max: number,
): boolean {
  return Number(header ?? 0) > max;
}

/** True when a signed timestamp (unix seconds) is within `toleranceSeconds` of now, either way. */
export function isFreshTimestamp(
  timestamp: number,
  nowSeconds: number,
  toleranceSeconds: number,
): boolean {
  return Math.abs(nowSeconds - timestamp) <= toleranceSeconds;
}

/**
 * Whether the dev mailbox may be used and who is let in. It exists only where mail does not really
 * leave: it is off in live mode and until a secret is set. `cookieMatches` is the constant-time
 * comparison of the presented cookie with the one the secret yields.
 */
export function mailboxAccess(input: {
  liveMode: boolean;
  secretConfigured: boolean;
  hasCookie: boolean;
  cookieMatches: boolean;
}): 'disabled' | 'locked' | 'open' {
  if (input.liveMode || !input.secretConfigured) return 'disabled';
  return input.hasCookie && input.cookieMatches ? 'open' : 'locked';
}
