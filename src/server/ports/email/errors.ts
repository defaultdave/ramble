import 'server-only';
import type { EmailAdapterName } from '@/lib/email/message';

export class EmailProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    adapter: EmailAdapterName,
    detail: string,
    options: { retryable: boolean; cause?: unknown },
  ) {
    super(`${adapter} email send failed: ${detail}`, { cause: options.cause });
    this.name = 'EmailProviderError';
    this.retryable = options.retryable;
  }
}

export class WebhookPayloadError extends Error {
  constructor(adapter: EmailAdapterName) {
    super(`${adapter} webhook body is not a delivery event`);
    this.name = 'WebhookPayloadError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('That idempotency key was used for a different email');
    this.name = 'IdempotencyConflictError';
  }
}

export class SendAttemptsExhaustedError extends Error {
  constructor() {
    super('Every send attempt for this email has been used');
    this.name = 'SendAttemptsExhaustedError';
  }
}
