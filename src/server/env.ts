import 'server-only';
import { z } from 'zod';
import {
  EmailAddressSchema,
  EmailAllowlistSchema,
  EmailSenderSchema,
} from '@/lib/email/address';
import { emailAdapterNames } from '@/lib/email/message';
import { emailModes } from '@/lib/email/route';
import { emailSettingIssues } from '@/lib/email/settings';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const apiCredential = z.string().min(1).max(256);
// Long enough that guessing it is out of reach. The dev mailbox counts wrong guesses per source
// address, but a right secret is never refused, so length is the real protection.
const sharedSecret = z.string().min(32).max(256);

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: postgresUrl.optional(),
    DATABASE_URL_UNPOOLED: postgresUrl.optional(),
    VERCEL: z.string().optional(),
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
    EMAIL_MODE: z.enum(emailModes).default('sink'),
    EMAIL_PROVIDER: z.enum(emailAdapterNames).default('fake'),
    EMAIL_ALLOWLIST: EmailAllowlistSchema.default([]),
    EMAIL_FROM: EmailSenderSchema.optional(),
    EMAIL_REPLY_TO: EmailAddressSchema.optional(),
    RESEND_API_KEY: apiCredential.optional(),
    POSTMARK_SERVER_TOKEN: apiCredential.optional(),
    EMAIL_WEBHOOK_SECRET: sharedSecret.optional(),
    DEV_MAILBOX_SECRET: sharedSecret.optional(),
    // Signs the form-guard token. Read only when a guest form renders or is submitted, which throws if it is unset outside development and test.
    FORM_GUARD_SECRET: z.string().min(32).optional(),
  })
  .superRefine((value, ctx) => {
    for (const { name, message } of emailSettingIssues(value)) {
      ctx.addIssue({ code: 'custom', path: [name], message });
    }
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'test') return;
    // next build evaluates layouts that import this module; CI builds with no database.
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const) {
      if (!value[name]) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'Required outside test',
        });
      }
    }
  });

function readEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export const env = readEnv();
