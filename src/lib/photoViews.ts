import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { photoLimits, type GuestPhoto } from './photos';

/** What a page needs to draw one photo with `next/image`: an empty `alt` marks a decorative photo. */
export type PhotoView = {
  src: string;
  width: number;
  height: number;
  alt: string;
  blurDataUrl: string;
};

export function photoView(photo: GuestPhoto): PhotoView {
  return {
    src: photo.url,
    width: photo.width,
    height: photo.height,
    alt: photo.decorative ? '' : (photo.altText ?? ''),
    blurDataUrl: photo.blurDataUrl,
  };
}

/** The experiences one batch read of cover photos takes, bounded so the read cannot grow with the page. */
export const CoverLookupSchema = z
  .array(EntityIdSchema)
  .max(photoLimits.maxCoverLookups);

/**
 * The IDs a cover read looks up, each once, lower-case and in one order, so two pages that list the
 * same experiences in a different order share one cache entry.
 */
export function coverLookupIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
}

/** The cover of each experience: its photo with the lowest position, whatever order the photos arrive in. */
export function coversByExperience(
  photos: readonly GuestPhoto[],
): Map<string, PhotoView> {
  const lowest = new Map<string, GuestPhoto>();
  for (const photo of photos) {
    const held = lowest.get(photo.experienceId);
    if (!held || photo.position < held.position) {
      lowest.set(photo.experienceId, photo);
    }
  }
  return new Map(
    [...lowest].map(([experienceId, photo]) => [
      experienceId,
      photoView(photo),
    ]),
  );
}

/** Each card with its experience's cover, or with no image when the experience has no photo. */
export function withCovers<T extends { id: string; image: PhotoView | null }>(
  cards: readonly T[],
  covers: ReadonlyMap<string, PhotoView>,
): T[] {
  return cards.map((card) => ({ ...card, image: covers.get(card.id) ?? null }));
}
