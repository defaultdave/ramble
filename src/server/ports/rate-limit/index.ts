import 'server-only';
import { createHash } from 'node:crypto';
import {
  ConsumeInputSchema,
  rateLimitPolicies,
  normalizeSubject,
  type RateLimitDecision,
  type RateLimitSurface,
} from '@/lib/rateLimits';
import { postgresRateLimiter } from './postgres';

export type { RateLimitDecision, RateLimitSurface } from '@/lib/rateLimits';

export type ConsumeInput = {
  /** `<surface>:<sha-256 hex>`; build it with `rateLimitKey`. */
  key: string;
  limit: number;
  windowSeconds: number;
};

/**
 * Counts one try against `key` and says whether it fits. Two tries at the limit must not both pass,
 * so an adapter does the count and the comparison in one atomic step.
 */
export type RateLimiter = {
  consume: (input: ConsumeInput) => Promise<RateLimitDecision>;
};

function rateLimitKey(surface: RateLimitSurface, subject: string): string {
  const normalized = normalizeSubject(surface, subject);
  const digest = createHash('sha256').update(normalized).digest('hex');
  return `${surface}:${digest}`;
}

// TODO(U-004a): first caller, with `sign_in_link`; U-014a (`reserve`), U-047a (`payment_tries`),
// U-055 (`manage`), U-038 and U-043 (`forms`) follow.
/**
 * Spends one try on the surface's policy for this subject. Refuses (`allowed: false`) once the
 * policy's limit is reached within its window. Throws on a bad subject or a failed store, so a
 * caller fails closed instead of letting the try through.
 */
export async function consumeRateLimit(
  surface: RateLimitSurface,
  subject: string,
  limiter: RateLimiter = postgresRateLimiter,
): Promise<RateLimitDecision> {
  const { limit, windowSeconds } = rateLimitPolicies[surface];
  return limiter.consume(
    ConsumeInputSchema.parse({
      key: rateLimitKey(surface, subject),
      limit,
      windowSeconds,
    }),
  );
}
