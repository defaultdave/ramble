import 'server-only';
import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: postgresUrl.optional(),
    DATABASE_URL_UNPOOLED: postgresUrl.optional(),
    VERCEL: z.string().optional(),
    // Signs the form-guard token. Read only when a guest form renders or is submitted, which throws if it is unset outside development and test.
    FORM_GUARD_SECRET: z.string().min(32).optional(),
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
