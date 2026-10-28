import 'server-only';
import { unstable_rethrow } from 'next/navigation';

/**
 * What leaves a failed read inside a cached function. A database error carries its query and
 * values, and Next.js logs whatever a cached function throws, so the cause stays inside and only
 * the name of its kind comes out.
 */
class CachedReadError extends Error {
  constructor(read: string, kind: string) {
    super(`${read} read failed: ${kind}`);
    this.name = 'CachedReadError';
  }
}

/** Runs one read; a failure is refused with its kind alone, never repaired or turned into an empty answer. */
export async function readOrRefuse<T>(
  read: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Next.js ends a prerender by throwing; swallowing that breaks the render.
    unstable_rethrow(error);
    throw new CachedReadError(
      read,
      error instanceof Error ? error.name : 'unknown',
    );
  }
}
