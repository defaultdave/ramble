import { connection } from 'next/server';
import { HomeModules } from '@/components/HomeModules';
import { RichText } from '@/components/RichText';
import { HomeEmpty, HomeError, HomeTitle } from '@/components/HomeStates';
import { buildHomePage, homeCardIds, withHomeCovers } from '@/lib/home';
import { minuteAsOf } from '@/lib/time';
import { venueToday } from '@/lib/venue';
import { readGuestCovers } from '@/server/guestCovers';
import { getHomeContent, getThisWeek } from '@/server/home';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
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
      getThisWeek(minuteAsOf(now)),
      getCachedGuestSettings(),
    ]);
    const built = buildHomePage({ ...content, thisWeek, settings });
    const covers = await readGuestCovers(
      'The home page covers could not be read',
      homeCardIds(built),
    );
    page = withHomeCovers(built, covers);
  } catch (error) {
    rethrowOrLog('The home page could not be read', error);
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
