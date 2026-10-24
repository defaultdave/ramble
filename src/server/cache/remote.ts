import 'server-only';
import { unstable_rethrow } from 'next/navigation';

// TODO(U-014b): first caller, the runtime-cached spaces-left read.
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
    // Only the message is logged: the error can carry connection details.
    console.error(
      `[readRemoteOrFallback] Runtime cache read failed, reading Postgres instead: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback();
  }
}
