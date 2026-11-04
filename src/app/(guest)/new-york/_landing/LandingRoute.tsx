import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { BrowseResults } from '@/components/BrowseResults';
import { BrowseSkeleton } from '@/components/BrowseSkeleton';
import { LandingPage } from '@/components/LandingPage';
import { PageError } from '@/components/PageError';
import { RichText } from '@/components/RichText';
import {
  landingBrowseHref,
  landingErrorTitle,
  landingErrorView,
  landingFallbackTitle,
  landingHead,
  landingHeading,
  landingPath,
  landingQuery,
  landingView,
  type LandingKind,
} from '@/lib/pages/landing';
import { minuteAsOf } from '@/lib/time';
import { getBrowseResults } from '@/server/browse';
import { getLandingData } from '@/server/landing';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { systemClock } from '@/server/ports/clock';

type LandingProps = { kind: LandingKind; slug: string };

export async function landingMetadata({
  kind,
  slug,
}: LandingProps): Promise<Metadata> {
  try {
    const data = await getLandingData(kind, slug);
    if (!data) return { title: landingFallbackTitle };
    const { title, description } = landingHead(kind, data.name, data.copy);
    return description === null ? { title } : { title, description };
  } catch (error) {
    rethrowOrLog('The landing page head could not be read', error);
    // The page reads the same entry and shows the error state; the head names the page by its address, as that state's h1 does.
    return { title: landingErrorTitle(kind, slug) };
  }
}

/**
 * The experiences are streamed, because the minute they are read for is a request-time value; the
 * heading and the editor's copy are in the prerendered page around them.
 */
async function LandingResults({ kind, slug }: LandingProps) {
  await connection();
  const asOf = minuteAsOf(systemClock.now());
  let page;
  try {
    page = await getBrowseResults(landingQuery(kind, slug), asOf);
  } catch (error) {
    rethrowOrLog('The landing page experiences could not be read', error);
    return (
      <div data-reveal-without-script>
        <BrowseResults {...landingErrorView(kind, slug)} />
      </div>
    );
  }
  return (
    <div data-reveal-without-script>
      <BrowseResults {...landingView(kind, slug, page)} />
    </div>
  );
}

export async function LandingRoute({ kind, slug }: LandingProps) {
  let data;
  try {
    data = await getLandingData(kind, slug);
  } catch (error) {
    rethrowOrLog('The landing page could not be read', error);
    return (
      <PageError
        title={landingErrorTitle(kind, slug)}
        alertTitle="We couldn't load this page"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={landingPath(kind, slug)}
      />
    );
  }
  if (!data) notFound();

  const { name, copy } = data;
  return (
    <LandingPage
      heading={landingHeading(kind, name, copy)}
      intro={copy?.intro ? <RichText content={copy.intro} /> : null}
      browseHref={landingBrowseHref(kind, slug)}
      results={
        <Suspense fallback={<BrowseSkeleton filters={false} />}>
          <LandingResults kind={kind} slug={slug} />
        </Suspense>
      }
      body={copy?.body ? <RichText content={copy.body} /> : null}
    />
  );
}
