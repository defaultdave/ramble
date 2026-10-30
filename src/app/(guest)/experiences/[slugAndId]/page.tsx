import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ExperienceError, ExperiencePage } from '@/components/ExperiencePage';
import { UpcomingSessionsSkeleton } from '@/components/UpcomingSessions';
import {
  buildExperiencePage,
  experienceHead,
  fallbackTitle,
} from '@/lib/pages/experience';
import { experiencePath, parseExperienceAddress } from '@/lib/routes';
import { getExperiencePage } from '@/server/experiencePage';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { getCachedGuestSettings } from '@/server/siteSettings';
import { UpcomingSessionsContent } from './UpcomingSessionsContent';

export function generateStaticParams() {
  return [{ slugAndId: 'sample' }];
}

export async function generateMetadata({
  params,
}: PageProps<'/experiences/[slugAndId]'>): Promise<Metadata> {
  const address = parseExperienceAddress((await params).slugAndId);
  if (!address) return { title: fallbackTitle };
  try {
    const { title, description } = experienceHead(
      await getExperiencePage(address.id),
    );
    return description === null ? { title } : { title, description };
  } catch (error) {
    rethrowOrLog('The experience head could not be read', error);
    // The page reads the same entry and shows the error state; the head only falls back to the plain title.
    return { title: fallbackTitle };
  }
}

export default async function ExperienceRoute({
  params,
  searchParams,
}: PageProps<'/experiences/[slugAndId]'>) {
  const address = parseExperienceAddress((await params).slugAndId);
  if (!address) notFound();

  let view;
  try {
    const [data, settings] = await Promise.all([
      getExperiencePage(address.id),
      getCachedGuestSettings(),
    ]);
    view = data
      ? buildExperiencePage({ ...data, giftsEnabled: settings.giftsEnabled })
      : null;
  } catch (error) {
    rethrowOrLog('The experience page could not be read', error);
    return <ExperienceError retryHref={experiencePath(address)} />;
  }

  if (!view) notFound();
  return (
    <ExperiencePage
      view={view}
      dates={
        <Suspense fallback={<UpcomingSessionsSkeleton />}>
          <UpcomingSessionsContent
            upcoming={view.upcoming}
            bookHref={view.bookHref}
            searchParams={searchParams}
            retryHref={experiencePath(address)}
          />
        </Suspense>
      }
    />
  );
}
