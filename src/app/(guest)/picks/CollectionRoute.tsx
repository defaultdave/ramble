import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BrowseResults } from '@/components/BrowseResults';
import { LandingPage } from '@/components/LandingPage';
import { PageError } from '@/components/PageError';
import { RichText } from '@/components/RichText';
import { landingResultsId } from '@/lib/pages/landing';
import {
  collectionFallbackTitle,
  collectionHead,
  collectionPath,
  collectionView,
  type CollectionPageKind,
} from '@/lib/pages/picks';
import { browsePath } from '@/lib/routes';
import { getCollectionPage } from '@/server/collections';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

type CollectionProps = { kind: CollectionPageKind; slug: string | null };

export async function collectionMetadata({
  kind,
  slug,
}: CollectionProps): Promise<Metadata> {
  try {
    const data = await getCollectionPage(kind, slug);
    if (!data) return { title: collectionFallbackTitle(kind) };
    const { title, description } = collectionHead(data.collection);
    return description === null ? { title } : { title, description };
  } catch (error) {
    rethrowOrLog('The collection page head could not be read', error);
    // The page reads the same entry and shows the error state, which keeps this plain title as its h1.
    return { title: collectionFallbackTitle(kind) };
  }
}

/** A published Pick or the gift guide: the editor's title and intro over its experiences, in the order the editor set. */
export async function CollectionRoute({ kind, slug }: CollectionProps) {
  const path = collectionPath(kind, slug);
  let data;
  try {
    data = await getCollectionPage(kind, slug);
  } catch (error) {
    rethrowOrLog('The collection page could not be read', error);
    return (
      <PageError
        title={collectionFallbackTitle(kind)}
        alertTitle="We couldn't load this page"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={path}
      />
    );
  }
  if (!data) notFound();

  const { collection, experiences } = data;
  return (
    <LandingPage
      heading={collection.title}
      intro={collection.intro ? <RichText content={collection.intro} /> : null}
      browseHref={browsePath}
      results={
        <div id={landingResultsId} data-reveal-without-script>
          <BrowseResults {...collectionView(collection.items, experiences)} />
        </div>
      }
      body={null}
    />
  );
}
