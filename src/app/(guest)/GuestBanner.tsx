import { connection } from 'next/server';
import { SiteBanner } from '@/components/GuestShell';
import { bannerText } from '@/lib/settings';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { getCachedGuestSettings } from '@/server/siteSettings';

/**
 * The ops banner, read from the cached settings. A failed read leaves the banner out rather than
 * every guest page with it: the switches that matter, such as paused bookings, are enforced where
 * they act, never by this notice.
 */
export async function GuestBanner() {
  // The banner is read per request, so building the site needs no database.
  await connection();
  let text;
  try {
    text = bannerText(await getCachedGuestSettings());
  } catch (error) {
    rethrowOrLog('The site banner could not be read', error);
    return null;
  }
  return text === null ? null : <SiteBanner text={text} />;
}
