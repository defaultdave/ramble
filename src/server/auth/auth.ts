import 'server-only';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import {
  initialSessionExpiry,
  pickAuthSecret,
  sessionMaxAgeSeconds,
  signInLinkTtlSeconds,
} from '@/lib/auth';
import { db } from '@/server/db/client';
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from '@/server/db/schema';
import { env } from '@/server/env';
import { systemClock } from '@/server/ports/clock';
import { sendEmail } from '@/server/ports/email';
import { hashSignInToken } from './signInToken';

function createAuth() {
  const secret = pickAuthSecret(
    'betterAuth',
    env.BETTER_AUTH_SECRET,
    env.NODE_ENV,
  );
  if (secret === null) throw new Error('BETTER_AUTH_SECRET is not set');

  return betterAuth({
    appName: 'Ramble',
    baseURL: env.APP_URL,
    secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { authUsers, authSessions, authAccounts, authVerifications },
    }),
    user: { modelName: 'authUsers' },
    session: {
      modelName: 'authSessions',
      // The cookie lives as long as the ceiling. The row's `expires_at` is the idle deadline, which
      // getCaller moves forward; Better Auth does not refresh it (see src/lib/auth.ts).
      expiresIn: sessionMaxAgeSeconds,
      disableSessionRefresh: true,
    },
    account: { modelName: 'authAccounts' },
    verification: { modelName: 'authVerifications' },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { disableIpTracking: true },
    },
    // Sign-in links are counted per address in `rate_limits` (src/server/auth/handler.ts). The
    // library's own counter lives in the memory of one serverless instance, so it would count nothing.
    rateLimit: { enabled: false },
    databaseHooks: {
      session: {
        create: {
          before: () =>
            Promise.resolve({
              data: {
                expiresAt: initialSessionExpiry(systemClock.now()),
                ipAddress: null,
                userAgent: null,
              },
            }),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: signInLinkTtlSeconds,
        storeToken: { type: 'custom-hasher', hash: hashSignInToken },
        async sendMagicLink({ email, url }) {
          await sendEmail({
            template: 'sign-in-link',
            to: email,
            data: { url, expiresInMinutes: signInLinkTtlSeconds / 60 },
            idempotencyKey: `sign-in-link-${randomUUID()}`,
          });
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Built on first use, so importing it needs no secret and no database, as `next build` imports every route. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
