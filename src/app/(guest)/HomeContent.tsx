import { unstable_rethrow } from 'next/navigation';
import { connection } from 'next/server';
import { HomeModules } from '@/components/HomeModules';
import { RichText } from '@/components/RichText';
import { HomeEmpty, HomeError, HomeTitle } from '@/components/HomeStates';
import { errorDigest } from '@/lib/errorDigest';
import {
  buildHomePage,
  homeAsOf,
  homeCardIds,
  venueToday,
  withHomeCovers,
} from '@/lib/home';
import { coverLookupIds, coversByExperience } from '@/lib/photoViews';
import { getCoverPhotos } from '@/server/coverPhotos';
import { getHomeContent, getThisWeek } from '@/server/home';
import { logger } from '@/server/monitoring/logger';
import { getCachedGuestSettings } from '@/server/siteSettings';

export async function HomeContent() {
  // The day and the week are request-time values, so a prefetch of this page stops here instead of reading them.
  await connection();
  // TODO(U-005): read the time from the Clock port once it exists.
  const now = new Date();

  let page;
  try {
    const [content, thisWeek, settings] = await Promise.all([
      getHomeContent(),
      getThisWeek(homeAsOf(now)),
      getCachedGuestSettings(),
    ]);
    const built = buildHomePage({ ...content, thisWeek, settings });
    const covers = await getCoverPhotos(coverLookupIds(homeCardIds(built)));
    page = withHomeCovers(built, coversByExperience(covers));
  } catch (error) {
    // Next.js ends a prerender by throwing; swallowing that would break the render.
    unstable_rethrow(error);
    // Only the digest is logged. Next.js strips the message of an error that crosses a cached
    // function, and the digest finds the line it logged there, which names the kind of failure.
    logger.error('The home page could not be read', {
      digest: errorDigest(error),
    });
    return <HomeError />;
  }

  if (page.kind === 'empty') return <HomeEmpty />;
  return (
    <>
      {page.needsTitle ? <HomeTitle /> : null}
      <HomeModules
        modules={page.modules}
        today={venueToday(now)}
        renderCopy={(doc) => <RichText content={doc} />}
      />
    </>
  );
}
