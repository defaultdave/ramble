import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { EntityIdSchema, type GuestExperience } from '@/lib/catalog';
import { placeOf, type Place } from '@/lib/pages/experience';
import type { GuestPhoto } from '@/lib/photos';
import type { Rating } from '@/lib/rating';
import type { ReviewRow } from '@/lib/reviewList';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { getGuestExperience } from '@/server/db/catalog';
import { listReviewRows, readRatings } from '@/server/db/reviewsRead';
import { getFilterOptions } from '@/server/filterOptions';
import { listGuestPhotos } from '@/server/db/photos';

export type ExperiencePageData = {
  experience: GuestExperience;
  photos: GuestPhoto[];
  place: Place;
  /** What the visible reviews come to and the newest of them; the page decides whether to show either. */
  reviews: { rating: Rating | null; rows: ReviewRow[] };
};

/**
 * What the experience page reads, or null when no experience with this ID is visible to guests.
 * Publishing, editing, or taking the experience down, and a new review, reach it through `tags.experience(id)`; a
 * renamed category or neighborhood reaches it when its profile runs out. A miss is not kept (the
 * `uncached` profile), so made-up IDs fill nothing; a hidden experience costs one read per request.
 */
export async function getExperiencePage(
  id: string,
): Promise<ExperiencePageData | null> {
  'use cache';
  cacheLife('catalog');
  // safeParse, not parse: a ZodError carries the raw value, and Next.js logs what a cached function throws.
  if (!EntityIdSchema.safeParse(id).success) {
    cacheLife('uncached');
    return null;
  }
  cacheTag(tags.experience(id.toLowerCase()));
  const page = await readOrRefuse('Experience', async () => {
    const experience = await getGuestExperience(id);
    if (!experience) return null;
    const [photos, { categories, neighborhoods }, [rating], rows] =
      await Promise.all([
        listGuestPhotos(id),
        getFilterOptions(),
        readRatings([experience.id]),
        listReviewRows(experience.id),
      ]);
    return {
      experience,
      photos,
      place: placeOf(experience, categories, neighborhoods),
      reviews: {
        rating: rating
          ? { average: rating.average, count: rating.count }
          : null,
        rows,
      },
    };
  });
  if (page === null) cacheLife('uncached');
  return page;
}
