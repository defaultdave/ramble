import 'server-only';
import {
  coverLookupIds,
  coversByExperience,
  type PhotoView,
} from '@/lib/photoViews';
import { getCoverPhotos } from '@/server/coverPhotos';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

/**
 * The covers of the cards on a guest page. A photo is decoration, so a failed read costs the
 * photos and not the page: it is logged under `message` and the cards render with no image.
 */
export async function readGuestCovers(
  message: string,
  experienceIds: readonly string[],
): Promise<Map<string, PhotoView>> {
  try {
    return coversByExperience(
      await getCoverPhotos(coverLookupIds(experienceIds)),
    );
  } catch (error) {
    rethrowOrLog(message, error);
    return new Map();
  }
}
