import 'server-only';
import { errorKind } from '@/lib/errorKind';
import {
  counterFailureStatus,
  rateLimitRefusal,
  type RateLimitSurface,
} from '@/lib/rateLimits';
import { logger } from '@/server/monitoring/logger';
import { consumeRateLimit } from '@/server/ports/rate-limit';

export const noStore = { 'Cache-Control': 'no-store' } as const;

/** An empty, uncacheable refusal: the auth handlers never say more than the status. */
export function refusal(
  status: 400 | 413 | 429 | typeof counterFailureStatus,
  headers: Record<string, string> = {},
) {
  return new Response(null, { status, headers: { ...noStore, ...headers } });
}

/**
 * Counts one try on `surface` for `subject`. Returns the refusal (the lib's 429 with Retry-After,
 * or 503 when the counter cannot be reached), or `null` to go on. It fails closed: a request that
 * was not counted is not let through. The log holds the surface and error name, never the subject.
 */
export async function refuseOverLimit(
  surface: RateLimitSurface,
  subject: string,
): Promise<Response | null> {
  try {
    const over = rateLimitRefusal(await consumeRateLimit(surface, subject));
    return over
      ? refusal(over.status, { 'Retry-After': String(over.retryAfterSeconds) })
      : null;
  } catch (error) {
    logger.error('The rate limit counter failed', {
      surface,
      errorName: errorKind(error),
    });
    return refusal(counterFailureStatus);
  }
}
