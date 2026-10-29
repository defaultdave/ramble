import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { EntityIdSchema, type GuestExperience } from '@/lib/catalog';
import { placeOf, type Place } from '@/lib/experiencePage';
import type { GuestPhoto } from '@/lib/photos';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import {
  getGuestExperience,
  listCategories,
  listNeighborhoods,
} from '@/server/db/catalog';
import { listGuestPhotos } from '@/server/db/photos';

export type ExperiencePageData = {
  experience: GuestExperience;
  photos: GuestPhoto[];
  place: Place;
};

/**
 * What the experience page reads, or null when no experience with this ID is visible to guests.
 * Publishing, editing, or taking the experience down reaches it through `tags.experience(id)`, and a
 * renamed category or neighborhood through `tags.catalog`. A hidden experience is cached as null too,
 * so a request for one never reaches the database twice inside the profile.
 */
export async function getExperiencePage(
  id: string,
): Promise<ExperiencePageData | null> {
  'use cache';
  cacheLife('catalog');
  // safeParse, not parse: a ZodError carries the raw value, and Next.js logs what a cached function throws.
  if (!EntityIdSchema.safeParse(id).success) return null;
  cacheTag(tags.experience(id.toLowerCase()), tags.catalog);
  return readOrRefuse('Experience', async () => {
    const experience = await getGuestExperience(id);
    if (!experience) return null;
    const [photos, categories, neighborhoods] = await Promise.all([
      listGuestPhotos(id),
      listCategories(),
      listNeighborhoods(),
    ]);
    return {
      experience,
      photos,
      place: placeOf(experience, categories, neighborhoods),
    };
  });
}
