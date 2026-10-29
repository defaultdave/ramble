import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { EntityIdSchema } from '@/lib/catalog';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { readRemoteOrFallback } from '@/server/cache/remote';
import { readSessionSpacesLeft } from '@/server/db/holds';

/**
 * One entry per session in the runtime cache. Every write that changes the spaces of the session
 * (a hold placed, released, or superseded, the cleanup job, a capacity edit) invalidates
 * `tags.session(id)` through `tagsForChanges`, and the profile lets an entry live a few seconds
 * for the writes that never reach it (a deadline passing).
 */
async function cachedSpacesLeft(sessionId: string): Promise<number | null> {
  'use cache: remote';
  cacheLife('spacesLeft');
  cacheTag(tags.session(sessionId));
  return readOrRefuse('Spaces left', () => readSessionSpacesLeft(sessionId));
}

// TODO(U-040): first caller, the spaces-left stream on the experience page.
/**
 * Spaces left in a session for display, or null when no session guests can see has this ID. Zero
 * or less reads as sold out. Only a well-formed ID reaches a cache key, and a failure of the
 * runtime cache falls back to Postgres. Never a decision: a reserve recomputes under its lock.
 */
export async function getSpacesLeft(sessionId: string): Promise<number | null> {
  // safeParse, not parse: a ZodError carries the raw value, and Next.js logs what a cached function throws.
  if (!EntityIdSchema.safeParse(sessionId).success) return null;
  const id = sessionId.toLowerCase();
  return readRemoteOrFallback(
    () => cachedSpacesLeft(id),
    () => readOrRefuse('Spaces left', () => readSessionSpacesLeft(id)),
  );
}
