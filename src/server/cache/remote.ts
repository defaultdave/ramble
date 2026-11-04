import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { errorKind } from '@/lib/errorKind';
import { logger } from '@/server/monitoring/logger';

/**
 * The only way to call a `'use cache: remote'` function. When the runtime cache is unreachable the
 * remote function throws inside the streamed hole and the guest sees an error, so the failure is
 * caught here and the answer is read from Postgres instead, which stays authoritative anyway.
 */
export async function readRemoteOrFallback<T>(
  remote: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await remote();
  } catch (error) {
    // Next.js ends a prerender or a navigation by throwing; swallowing that breaks the render.
    unstable_rethrow(error);
    // Only the kind is logged: the message and cause can carry connection details.
    logger.error('Runtime cache read failed, reading Postgres instead', {
      kind: errorKind(error),
    });
    return fallback();
  }
}
