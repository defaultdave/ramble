import { z } from 'zod';
import { EmailAddressSchema, normalizeEmailAddress } from './email/address';

// What sign-in and sessions are, in numbers and rules. src/server/auth wires them into Better Auth.

/** A sign-in link works once, and for this long (ADR 0002). */
export const signInLinkTtlSeconds = 5 * 60;

/** A session ends this long after its first sign-in, however busy (ADR 0002). */
export const sessionMaxAgeSeconds = 8 * 60 * 60;

/** A session ends this long after the last request that used it. */
export const sessionIdleSeconds = 30 * 60;

/** Activity is written down at most this often, so a page with many requests writes once. */
const sessionTouchSeconds = 60;

type SessionTimes = { createdAt: Date; expiresAt: Date };

const ceilingOf = (session: SessionTimes) =>
  session.createdAt.getTime() + sessionMaxAgeSeconds * 1000;

/** Where a session's deadline starts: the idle window from its first moment. */
export function initialSessionExpiry(now: Date): Date {
  return new Date(now.getTime() + sessionIdleSeconds * 1000);
}

/** A session is live before its deadline and before its ceiling. */
export function isSessionLive(session: SessionTimes, now: Date): boolean {
  return (
    now.getTime() < session.expiresAt.getTime() &&
    now.getTime() < ceilingOf(session)
  );
}

/**
 * The deadline after a request at `now`: the idle window from now, never past the ceiling. Null
 * when the stored deadline is already within one touch interval of that, so nothing is written.
 */
export function touchedSessionExpiry(
  session: SessionTimes,
  now: Date,
): Date | null {
  const next = Math.min(
    now.getTime() + sessionIdleSeconds * 1000,
    ceilingOf(session),
  );
  return next - session.expiresAt.getTime() < sessionTouchSeconds * 1000
    ? null
    : new Date(next);
}

const signInLinkPath = '/api/auth/sign-in/magic-link';

export function isSignInLinkRequest(method: string, pathname: string): boolean {
  return method === 'POST' && pathname === signInLinkPath;
}

/** The sign-in request body is a short JSON object; anything longer is refused unread. */
export const maxSignInBodyBytes = 4096;

/** The address, folded to lower case, in the narrow shape every stored address has. Other keys are left to Better Auth. */
export const SignInLinkRequestSchema = z.looseObject({
  email: z
    .string()
    .max(254)
    .transform(normalizeEmailAddress)
    .pipe(EmailAddressSchema),
});

/** Stand-ins for the two secrets, used outside production only. */
const developmentSecrets = {
  betterAuth: 'development-only-better-auth-secret-0000',
  signInLink: 'development-only-sign-in-link-secret-0000',
} as const;

/** The configured secret; else a fixed one outside production; else null, and the caller throws. */
export function pickAuthSecret(
  kind: keyof typeof developmentSecrets,
  configured: string | undefined,
  nodeEnv: 'development' | 'test' | 'production',
): string | null {
  if (configured) return configured;
  return nodeEnv === 'production' ? null : developmentSecrets[kind];
}

/** A deployed environment must say its own address: a localhost default would put it in every sign-in link. */
export function appUrlIsRequired(
  vercelEnv: string | undefined,
  configured: boolean,
): boolean {
  return (vercelEnv === 'production' || vercelEnv === 'preview') && !configured;
}
