import 'server-only';
import { cacheLife } from 'next/cache';
import type { GuestPhoto } from '@/lib/photos';
import { CoverLookupSchema } from '@/lib/photoViews';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { tagExperiences } from '@/server/cache/tagExperiences';
import { listGuestCoverPhotos } from '@/server/db/photos';

/**
 * The cover photo of each listed experience, for the cards of one page. Pass the IDs through
 * `coverLookupIds` so two pages that list the same experiences share an entry. The entry carries the
 * tag of each experience it was asked about, and `addPhoto` publishes that tag after a photo commits,
 * so a new cover shows on the next request.
 */
export async function getCoverPhotos(
  experienceIds: string[],
): Promise<GuestPhoto[]> {
  'use cache';
  cacheLife('catalog');
  return readOrRefuse('Cover photos', async () => {
    // Parsed before anything is tagged, so a list past the limit or an ID that is no uuid is
    // refused (by kind only) before it costs a tag. The tag is the lower-case ID.
    const ids = CoverLookupSchema.parse(experienceIds);
    tagExperiences(ids.map((id) => id.toLowerCase()));
    return listGuestCoverPhotos(ids);
  });
}
