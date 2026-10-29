import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { GuestPhoto } from '@/lib/photos';
import { CoverLookupSchema } from '@/lib/photoViews';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listGuestCoverPhotos } from '@/server/db/photos';

/**
 * The cover photo of each listed experience, for the cards of one page. Pass the IDs through
 * `coverLookupIds` so two pages that list the same experiences share an entry. The entry carries the
 * tag of each experience it was asked about, but `addPhoto` publishes no tag, so a new cover shows
 * only when the `catalog` revalidate runs out, or when a listing change publishes the experience tag.
 * TODO(U-074b): publish the experience tag after a photo commit
 */
export async function getCoverPhotos(
  experienceIds: string[],
): Promise<GuestPhoto[]> {
  'use cache';
  cacheLife('catalog');
  return readOrRefuse('Cover photos', async () => {
    // Parsed before anything is tagged, so a list past the limit or an ID that is no uuid is
    // refused (by kind only) before it costs a tag. The tag is the lower-case ID an upload invalidates.
    const ids = CoverLookupSchema.parse(experienceIds);
    for (const id of ids) cacheTag(tags.experience(id.toLowerCase()));
    return listGuestCoverPhotos(ids);
  });
}
