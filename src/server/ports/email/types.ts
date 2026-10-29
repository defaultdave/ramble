import 'server-only';
import type {
  DeliveryEvent,
  EmailAdapterName,
  EmailAttachment,
} from '@/lib/email/message';

/** A fully rendered message, ready for a provider. */
export type OutboundEmail = {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: readonly EmailAttachment[];
  idempotencyKey: string;
};

type WebhookRequest = {
  headers: Headers;
  rawBody: string;
  /** Unix seconds, for providers that sign a timestamp. */
  nowSeconds: number;
};

/** What every adapter does, and what the shared contract tests hold each one to. */
export type EmailAdapter = {
  readonly name: EmailAdapterName;
  /** Throws EmailProviderError when the provider does not accept the message. */
  send(email: OutboundEmail): Promise<{ providerMessageId: string }>;
  /** True only when the request carries this provider's valid signature or secret. */
  verifyWebhook(request: WebhookRequest): boolean;
  /**
   * The delivery event in an already verified body, or null for an event kind Ramble ignores.
   * Throws WebhookPayloadError for a body that is not this provider's event.
   */
  parseWebhook(rawBody: string): DeliveryEvent | null;
};
