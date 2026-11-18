import { z } from 'zod';
import { count } from './copy/format';

export const rateLimitSurfaces = [
  'sign_in_link',
  'sign_in_link_client',
  'confirm_sign_in',
  'end_session',
  'host_staff_invite',
  'reserve',
  'payment_tries',
  'manage',
  'forms',
  'email_webhook',
  'email_webhook_failed',
  'payment_webhook',
  'payment_webhook_failed',
  'mailbox_unlock_failed',
  'pulse',
  'pulse_failed',
] as const;

export type RateLimitSurface = (typeof rateLimitSurfaces)[number];

type RateLimitPolicy = {
  limit: number;
  windowSeconds: number;
  /** Puts the subject in the one spelling a person or device can have, so variants share a counter. */
  normalizeSubject: (subject: string) => string;
};

const trimmed = (subject: string) => subject.trim();

// Per surface, and per subject within it: the subject is an email, a device key, a hold ID, a
// capability token, or an address plus a form name. The numbers are demo defaults that change
// here, without a migration.
export const rateLimitPolicies = {
  // Per destination address, so it bounds the mail sent to one address. Anyone can spend this
  // count for an address they do not own, so it sits above twice `sign_in_link_client`: the
  // windows are fixed, so one client can straddle the end of its own window and send up to twice
  // its limit inside one address window, and that must still leave the address some of its count.
  sign_in_link: {
    limit: 25,
    windowSeconds: 60 * 60,
    normalizeSubject: (subject) => subject.trim().toLowerCase(),
  },
  // Per client address, across every destination. Twice this is below the `sign_in_link` count,
  // so one client alone cannot use up an address's count and lock its owner out.
  sign_in_link_client: {
    limit: 10,
    windowSeconds: 60 * 60,
    normalizeSubject: (subject) => subject.trim().toLowerCase(),
  },
  // The confirm page's post, per client address. A guest confirms a link once and a bad link is
  // retried rarely; the count bounds guessing of link tokens from one address.
  confirm_sign_in: {
    limit: 10,
    windowSeconds: 60 * 60,
    normalizeSubject: (subject) => subject.trim().toLowerCase(),
  },
  // The header's Sign out post, per client address. Generous, and apart from `forms`, so signing
  // out is never refused because of the contact forms' tight count; it only bounds a flood.
  end_session: {
    limit: 30,
    windowSeconds: 10 * 60,
    normalizeSubject: (subject) => subject.trim().toLowerCase(),
  },
  // Invitations a host owner sends, per owner: each makes an account and sends an email from our
  // domain, so the count bounds what one account can do. Twice the cap on staff, once an hour.
  host_staff_invite: {
    limit: 20,
    windowSeconds: 60 * 60,
    normalizeSubject: trimmed,
  },
  reserve: { limit: 30, windowSeconds: 10 * 60, normalizeSubject: trimmed },
  // At most 5 tries per hold. The window outlasts a hold plus its payment grace, so the count
  // cannot reset while the hold is still live.
  payment_tries: {
    limit: 5,
    windowSeconds: 60 * 60,
    normalizeSubject: trimmed,
  },
  manage: { limit: 30, windowSeconds: 10 * 60, normalizeSubject: trimmed },
  forms: { limit: 5, windowSeconds: 60 * 60, normalizeSubject: trimmed },
  // Verified webhook traffic only, on one shared counter: it bounds the database writes a flood of
  // genuine events could cause. A request is counted here only after its signature or secret
  // checked out, so nobody without the secret can use this budget up.
  email_webhook: { limit: 600, windowSeconds: 60, normalizeSubject: trimmed },
  // Failed webhook verifications, per source address. Kept apart from the counter above so a flood
  // of bad requests can never refuse a real bounce or complaint.
  email_webhook_failed: {
    limit: 20,
    windowSeconds: 10 * 60,
    normalizeSubject: trimmed,
  },
  // The same two counters for the payment provider's webhooks, kept apart from the email ones.
  payment_webhook: { limit: 600, windowSeconds: 60, normalizeSubject: trimmed },
  payment_webhook_failed: {
    limit: 20,
    windowSeconds: 10 * 60,
    normalizeSubject: trimmed,
  },
  // Wrong dev-mailbox secrets, per source address. A correct secret is never counted or refused.
  mailbox_unlock_failed: {
    limit: 10,
    windowSeconds: 10 * 60,
    normalizeSubject: trimmed,
  },
  // Authenticated pulse calls on one shared counter. The schedule fires every 30 minutes and a demo
  // adds a few manual ones, so this only stops a leaked secret from being used to hammer the drain.
  pulse: { limit: 30, windowSeconds: 10 * 60, normalizeSubject: trimmed },
  // Pulse calls with a wrong or missing secret, per source address; kept apart so bad traffic
  // cannot refuse the real schedule.
  pulse_failed: {
    limit: 20,
    windowSeconds: 10 * 60,
    normalizeSubject: trimmed,
  },
} as const satisfies Record<RateLimitSurface, RateLimitPolicy>;

export const maxSubjectLength = 512;
export const maxLimit = 10_000;
export const maxWindowSeconds = 24 * 60 * 60;

/** A sha-256 digest in lowercase hex, the shape every hashed key in the database takes. */
export const sha256HexDigits = String.raw`[0-9a-f]{64}`;

/**
 * `<surface>:<sha-256 of the subject, hex>`. Hashing bounds the length whatever the subject was and
 * keeps email addresses out of the table. The database CHECK on `rate_limits.key` spells the same
 * pattern, case-sensitively, so the two cannot disagree.
 */
export const rateLimitKeyPattern = `^[a-z][a-z_]{0,31}:${sha256HexDigits}$`;

export const RateLimitKeySchema = z
  .string()
  .regex(new RegExp(rateLimitKeyPattern));

export const ConsumeInputSchema = z.object({
  key: RateLimitKeySchema,
  limit: z.int().min(1).max(maxLimit),
  windowSeconds: z.int().min(1).max(maxWindowSeconds),
});

const RawSubjectSchema = z.string().max(maxSubjectLength);
const NormalizedSubjectSchema = z.string().min(1);

/**
 * The bound comes first so normalizing never works on an unbounded string; the emptiness check
 * comes after, because a subject of spaces normalizes to nothing and would otherwise put every
 * such caller on one shared counter. Throws on either.
 */
export function normalizeSubject(
  surface: RateLimitSurface,
  subject: string,
): string {
  return NormalizedSubjectSchema.parse(
    rateLimitPolicies[surface].normalizeSubject(
      RawSubjectSchema.parse(subject),
    ),
  );
}

/** "1 minute" or "3 minutes": how a wait is said wherever a limit tells a guest to try again. */
export function waitMinutesLabel(minutes: number): string {
  return count(minutes, 'minute');
}

const secondsPerMinute = 60;

/** A wait in seconds as whole minutes, rounded up (never under one) so a guest is never told to retry too early. */
export function retryAfterMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / secondsPerMinute));
}

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/** What a try at a counter came to: its decision, or that the counter could not be reached. */
export type CounterOutcome =
  { kind: 'counted'; decision: RateLimitDecision } | { kind: 'failed' };

export type CounterRefusal =
  { status: 429; retryAfterSeconds: number } | { status: 503 };

/**
 * What a try is answered with, or `null` while it may go on. A counter that could not be read
 * refuses with 503: a request that was not counted is never let through.
 */
export function counterRefusal(outcome: CounterOutcome): CounterRefusal | null {
  if (outcome.kind === 'failed') return { status: 503 };
  return outcome.decision.allowed
    ? null
    : { status: 429, retryAfterSeconds: outcome.decision.retryAfterSeconds };
}

/**
 * Whether the address counter is spent after the client counter was tried. Only a client the
 * counter let through spends it: a refused or failed client must not use up the address's count,
 * or one client could lock a guest out by being refused.
 */
export function addressCountFollows(client: CounterOutcome): boolean {
  return client.kind === 'counted' && client.decision.allowed;
}

/** `count` is the row's count after this try. It stops at limit + 1, so a refusal reads as limit + 1. */
export function decideRateLimit(input: {
  count: number;
  limit: number;
  retryAfterSeconds: number;
}): RateLimitDecision {
  return input.count <= input.limit
    ? { allowed: true, remaining: input.limit - input.count }
    : { allowed: false, retryAfterSeconds: input.retryAfterSeconds };
}
