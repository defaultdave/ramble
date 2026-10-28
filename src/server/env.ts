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
import { seedTargets } from '@/lib/seed/target';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const apiCredential = z.string().min(1).max(256);
// Long enough that guessing it is out of reach. The dev mailbox counts wrong guesses per source
// address, but a right secret is never refused, so length is the real protection.
const sharedSecret = z.string().min(32).max(256);

// A dashboard that stores an empty value should read as "not configured", not as an invalid one.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );

const httpsUrl = z.url({ protocol: /^https$/ });

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: postgresUrl.optional(),
    DATABASE_URL_UNPOOLED: postgresUrl.optional(),
    VERCEL: z.string().optional(),
    VERCEL_ENV: optional(z.enum(['production', 'preview', 'development'])),
    VERCEL_GIT_COMMIT_SHA: optional(z.string().max(64)),
    // Read only by the seed command, which refuses to run unless this says what the database is.
    SEED_TARGET: optional(z.enum(seedTargets)),
    EMAIL_MODE: z.enum(emailModes).default('sink'),
    EMAIL_PROVIDER: z.enum(emailAdapterNames).default('fake'),
    EMAIL_ALLOWLIST: EmailAllowlistSchema.default([]),
    EMAIL_FROM: EmailSenderSchema.optional(),
    EMAIL_REPLY_TO: EmailAddressSchema.optional(),
    RESEND_API_KEY: apiCredential.optional(),
    POSTMARK_SERVER_TOKEN: apiCredential.optional(),
    EMAIL_WEBHOOK_SECRET: sharedSecret.optional(),
    DEV_MAILBOX_SECRET: sharedSecret.optional(),
    SENTRY_DSN: optional(httpsUrl),
    SENTRY_BROWSER_DSN: optional(httpsUrl),
    AXIOM_TOKEN: optional(z.string().min(8).max(256).regex(/^\S+$/)),
    AXIOM_DATASET: optional(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)),
    // Signs the form-guard token. Read only when a guest form renders or is submitted, which throws if it is unset outside development and test.
    FORM_GUARD_SECRET: z.string().min(32).optional(),
  })
  .superRefine((value, ctx) => {
    for (const { name, message } of emailSettingIssues(value)) {
      ctx.addIssue({ code: 'custom', path: [name], message });
    }
  })
  .superRefine((value, ctx) => {
    if (!value.AXIOM_TOKEN !== !value.AXIOM_DATASET) {
      ctx.addIssue({
        code: 'custom',
        path: [value.AXIOM_TOKEN ? 'AXIOM_DATASET' : 'AXIOM_TOKEN'],
        message: 'AXIOM_TOKEN and AXIOM_DATASET are set together or not at all',
      });
    }
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
