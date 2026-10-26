import 'server-only';
import type { EmailAdapterName } from '@/lib/email/message';
import type { EmailMode } from '@/lib/email/route';
import { env } from '@/server/env';
import { createFakeAdapter } from './fake';
import { createPostmarkAdapter } from './postmark';
import { createResendAdapter } from './resend';
import type { EmailAdapter } from './types';

export type EmailConfig = {
  mode: EmailMode;
  provider: EmailAdapterName;
  allowlist: readonly string[];
  /** Shown by the dev mailbox only; a real provider needs EMAIL_FROM, which the environment requires. */
  from: string;
  replyTo: string;
  appUrl: string;
  webhookSecret: string | undefined;
};

/** Read on each call, so a test (or a restart) sees the current environment. */
export function getEmailConfig(): EmailConfig {
  return {
    mode: env.EMAIL_MODE,
    provider: env.EMAIL_PROVIDER,
    allowlist: env.EMAIL_ALLOWLIST,
    from: env.EMAIL_FROM ?? 'Ramble <noreply@ramble.invalid>',
    replyTo: env.EMAIL_REPLY_TO ?? 'support@ramble.invalid',
    appUrl: env.APP_URL,
    webhookSecret: env.EMAIL_WEBHOOK_SECRET,
  };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

export function getAdapter(name: EmailAdapterName): EmailAdapter {
  switch (name) {
    case 'fake':
      return createFakeAdapter(env.EMAIL_WEBHOOK_SECRET);
    case 'resend':
      return createResendAdapter({
        apiKey: required(env.RESEND_API_KEY, 'RESEND_API_KEY'),
        webhookSecret: required(
          env.EMAIL_WEBHOOK_SECRET,
          'EMAIL_WEBHOOK_SECRET',
        ),
      });
    case 'postmark':
      return createPostmarkAdapter({
        serverToken: required(
          env.POSTMARK_SERVER_TOKEN,
          'POSTMARK_SERVER_TOKEN',
        ),
        webhookSecret: required(
          env.EMAIL_WEBHOOK_SECRET,
          'EMAIL_WEBHOOK_SECRET',
        ),
      });
  }
}
