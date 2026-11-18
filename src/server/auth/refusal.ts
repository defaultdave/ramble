import 'server-only';
import { errorKind } from '@/lib/errorKind';
import {
  counterRefusal,
  type CounterOutcome,
  type RateLimitSurface,
} from '@/lib/rateLimits';
import { logger } from '@/server/monitoring/logger';
import { consumeRateLimit } from '@/server/ports/rate-limit';

export const noStore = { 'Cache-Control': 'no-store' } as const;

/** An empty, uncacheable refusal: the auth handlers never say more than the status. */
export function refusal(
  status: 400 | 413 | 429 | 503,
  headers: Record<string, string> = {},
) {
  return new Response(null, { status, headers: { ...noStore, ...headers } });
}

/**
 * Counts one try on `surface` for `subject`. A counter that throws is `failed`; the log holds the
 * surface and error name, never the subject.
 */
export async function countRateLimit(
  surface: RateLimitSurface,
  subject: string,
): Promise<CounterOutcome> {
  try {
    return {
      kind: 'counted',
      decision: await consumeRateLimit(surface, subject),
    };
  } catch (error) {
    logger.error('The rate limit counter failed', {
      surface,
      errorName: errorKind(error),
    });
    return { kind: 'failed' };
  }
}

/** The lib's refusal for a counted try as a Response (429 with Retry-After, or 503), or `null` to go on. */
export function refusalFor(outcome: CounterOutcome): Response | null {
  const over = counterRefusal(outcome);
  if (over === null) return null;
  return over.status === 429
    ? refusal(429, { 'Retry-After': String(over.retryAfterSeconds) })
    : refusal(503);
}

/** Counts one try and returns its refusal, or `null` to go on. It fails closed. */
export async function refuseOverLimit(
  surface: RateLimitSurface,
  subject: string,
): Promise<Response | null> {
  return refusalFor(await countRateLimit(surface, subject));
}
