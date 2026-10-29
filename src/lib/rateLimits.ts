import { z } from 'zod';

export const rateLimitSurfaces = [
  'sign_in_link',
  'reserve',
  'payment_tries',
  'manage',
  'forms',
  'email_webhook',
  'email_webhook_failed',
  'mailbox_unlock_failed',
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
  // Links expire in 5 minutes, so five an hour covers a guest who mistypes and retries.
  sign_in_link: {
    limit: 5,
    windowSeconds: 60 * 60,
    normalizeSubject: (subject) => subject.trim().toLowerCase(),
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
  // Wrong dev-mailbox secrets, per source address. A correct secret is never counted or refused.
  mailbox_unlock_failed: {
    limit: 10,
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

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

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
