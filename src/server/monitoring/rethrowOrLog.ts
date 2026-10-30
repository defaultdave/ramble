import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { errorDigest } from '@/lib/errorDigest';
import { isPrerenderEnd } from '@/lib/prerender';
import { logger } from '@/server/monitoring/logger';

/**
 * The catch block of a page that shows its own error view. Next.js ends a prerender by throwing,
 * and swallowing that breaks the render, so those errors pass through. Anything else is logged by
 * kind and digest only: the message and the cause of a database error carry the query and its
 * values. Next.js strips the message of an error that crossed a cached function, and the digest
 * finds the line it logged there. The field is `kind`, not `name`, which the redactor hides.
 */
export function rethrowOrLog(message: string, error: unknown): void {
  unstable_rethrow(error);
  // A driver wraps the framework's "prerender is complete" error, so it is looked for by message.
  if (isPrerenderEnd(error)) throw error;
  logger.error(message, {
    digest: errorDigest(error),
    kind: error instanceof Error ? error.name : 'unknown',
  });
}
