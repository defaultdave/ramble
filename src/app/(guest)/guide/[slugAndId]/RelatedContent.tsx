import { connection } from 'next/server';
import { GuideRelated } from '@/components/GuideEntry';
import { relatedBookableCards, relatedQuery } from '@/lib/pages/guide';
import { minuteAsOf } from '@/lib/time';
import { getBrowseResults } from '@/server/browse';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { systemClock } from '@/server/ports/clock';

type RelatedContentProps = {
  entryId: string;
  categorySlug: string;
  categoryName: string;
};

/**
 * Streamed after the page: browse is read for a request-time minute. The module is a bonus, so a
 * failed read leaves it out rather than taking the entry down with it.
 */
export async function RelatedContent({
  entryId,
  categorySlug,
  categoryName,
}: RelatedContentProps) {
  await connection();
  let page;
  try {
    page = await getBrowseResults(
      relatedQuery(categorySlug),
      minuteAsOf(systemClock.now()),
    );
  } catch (error) {
    rethrowOrLog('The guide entry experiences could not be read', error);
    return null;
  }
  if (!page.ok) return null;
  return (
    <GuideRelated
      categoryName={categoryName}
      cards={relatedBookableCards(page.items, entryId)}
    />
  );
}
