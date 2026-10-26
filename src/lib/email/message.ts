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

export const RenderedEmailSchema = z.object({
  subject: z.string().max(maxSubjectLength).regex(new RegExp(subjectPattern)),
  html: z.string().min(1).max(maxBodyLength),
  text: z.string().min(1).max(maxBodyLength),
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
