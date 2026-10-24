import 'server-only';
import { revalidateTag, updateTag } from 'next/cache';
import { type CacheChange, tagsForChange } from '@/lib/cacheTags';

function uniqueTags(changes: readonly CacheChange[]): string[] {
  return [...new Set(changes.flatMap(tagsForChange))].sort();
}

/**
 * For Server Actions (the ops publish flow): the next request after the action sees fresh data.
 * `updateTag` throws anywhere else.
 */
export function updateTagsForChanges(changes: readonly CacheChange[]): void {
  for (const tag of uniqueTags(changes)) updateTag(tag);
}

/**
 * For webhooks and jobs, which cannot call `updateTag`: stale-while-revalidate, so one response
 * after the call may still be the old page. No correctness rule may depend on `expire: 0`.
 */
export function revalidateTagsForChanges(
  changes: readonly CacheChange[],
): void {
  for (const tag of uniqueTags(changes)) revalidateTag(tag, 'max');
}
