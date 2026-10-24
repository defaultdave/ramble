import 'server-only';
import { revalidateTag, updateTag } from 'next/cache';
import { type CacheChange, tagsForChanges } from '@/lib/cacheTags';

// TODO(U-076a): first caller, the editorial publish action.
/**
 * For Server Actions (the ops publish flow): the next request after the action sees fresh data.
 * `updateTag` throws anywhere else.
 */
export function updateTagsForChanges(changes: readonly CacheChange[]): void {
  for (const tag of tagsForChanges(changes)) updateTag(tag);
}

// TODO(U-014b): first caller, the hold cleanup job that releases spaces.
/**
 * For webhooks and jobs, which cannot call `updateTag`: stale-while-revalidate, so one response
 * after the call may still be the old page. No correctness rule may depend on `expire: 0`.
 */
export function revalidateTagsForChanges(
  changes: readonly CacheChange[],
): void {
  for (const tag of tagsForChanges(changes)) revalidateTag(tag, 'max');
}
