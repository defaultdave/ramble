import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { GuestPhoto } from '@/lib/photos';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listGuestCoverPhotos } from '@/server/db/photos';

/**
 * The cover photo of each listed experience, for the cards of one page. Pass the IDs through
 * `coverLookupIds` so two pages that list the same experiences share an entry. A new photo reaches
 * it through the tag of each experience it was asked about, which is the tag an upload invalidates.
 */
export async function getCoverPhotos(
  experienceIds: string[],
): Promise<GuestPhoto[]> {
  'use cache';
  cacheLife('catalog');
  for (const id of experienceIds) cacheTag(tags.experience(id));
  return readOrRefuse('Cover photos', () =>
    listGuestCoverPhotos(experienceIds),
  );
}
