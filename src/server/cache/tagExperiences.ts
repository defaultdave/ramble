import 'server-only';
import { cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';

/**
 * Tags the running cached entry with the tag of each experience it shows or asks about. One
 * `cacheTag()` call per ID, because Next.js drops the tags past 128 in a single call and puts no
 * cap on the number of calls.
 */
export function tagExperiences(ids: Iterable<string>): void {
  for (const id of ids) cacheTag(tags.experience(id));
}
