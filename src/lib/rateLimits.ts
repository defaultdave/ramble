import { z } from 'zod';

export const rateLimitSurfaces = [
  'sign_in_link',
  'reserve',
  'payment_tries',
  'manage',
  'forms',
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
} as const satisfies Record<RateLimitSurface, RateLimitPolicy>;

export const maxSubjectLength = 512;
export const maxLimit = 10_000;
export const maxWindowSeconds = 24 * 60 * 60;

/**
 * `<surface>:<sha-256 of the subject, hex>`. Hashing bounds the length whatever the subject was and
 * keeps email addresses out of the table. The database CHECK on `rate_limits.key` spells the same
 * pattern, case-sensitively, so the two cannot disagree.
 */
export const rateLimitKeyPattern = String.raw`^[a-z][a-z_]{0,31}:[0-9a-f]{64}$`;

export const RateLimitKeySchema = z
  .string()
  .regex(new RegExp(rateLimitKeyPattern));

export const ConsumeInputSchema = z.object({
  key: RateLimitKeySchema,
  limit: z.int().min(1).max(maxLimit),
  windowSeconds: z.int().min(1).max(maxWindowSeconds),
});

export const SubjectSchema = z.string().min(1).max(maxSubjectLength);

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };
