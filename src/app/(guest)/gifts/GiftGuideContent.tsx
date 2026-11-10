import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PageError } from '@/components/PageError';
import { collectionPath, giftGuideFallbackTitle } from '@/lib/pages/picks';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { getCachedGuestSettings } from '@/server/siteSettings';
import { CollectionRoute } from '../picks/CollectionRoute';

/**
 * The gift guide, behind the one gifts switch: with it off the page is not there, as the home
 * module and its link are not. The switch is read per request, so building the site needs no database.
 */
export async function GiftGuideContent() {
  await connection();
  let giftsEnabled;
  try {
    ({ giftsEnabled } = await getCachedGuestSettings());
  } catch (error) {
    rethrowOrLog('The gift guide switch could not be read', error);
    return (
      <PageError
        title={giftGuideFallbackTitle}
        alertTitle="We couldn't load this page"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={collectionPath('gift_guide', null)}
      />
    );
  }
  if (!giftsEnabled) notFound();
  return <CollectionRoute kind="gift_guide" slug={null} />;
}
