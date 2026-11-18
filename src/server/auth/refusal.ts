import 'server-only';
import { clientAddress } from '@/lib/clientAddress';
import { errorKind } from '@/lib/errorKind';
import type { RateLimitSurface } from '@/lib/rateLimits';
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
 * Counts the request against its client address on `surface`. Returns the refusal (429 with
 * Retry-After over the limit, 503 when the counter cannot be reached), or `null` to go on. It
 * fails closed: a request that was not counted is not let through.
 */
export async function refuseOverClientLimit(
  surface: RateLimitSurface,
  request: Request,
): Promise<Response | null> {
  try {
    const decision = await consumeRateLimit(
      surface,
      clientAddress(request.headers.get('x-forwarded-for')),
    );
    return decision.allowed
      ? null
      : refusal(429, { 'Retry-After': String(decision.retryAfterSeconds) });
  } catch (error) {
    logger.error('The auth form counter failed', {
      surface,
      errorName: errorKind(error),
    });
    return refusal(503);
  }
}
