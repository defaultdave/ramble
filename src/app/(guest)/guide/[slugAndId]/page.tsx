import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { GuideEntry } from '@/components/GuideEntry';
import { PageError } from '@/components/PageError';
import {
  buildGuideEntry,
  guideFallbackTitle,
  guideHead,
} from '@/lib/pages/guide';
import { type GuestExperience } from '@/lib/catalog';
import {
  experiencePath,
  guidePath,
  parseExperienceAddress,
  type ExperienceAddress,
} from '@/lib/routes';
import { getExperiencePage } from '@/server/experiencePage';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { RelatedContent } from './RelatedContent';

export function generateStaticParams() {
  return [{ slugAndId: 'sample' }];
}

export async function generateMetadata({
  params,
}: PageProps<'/guide/[slugAndId]'>): Promise<Metadata> {
  const address = parseExperienceAddress((await params).slugAndId);
  if (!address) return guideHead(null);
  try {
    return guideHead(await getExperiencePage(address.id));
  } catch (error) {
    rethrowOrLog('The guide entry head could not be read', error);
    // The page reads the same entry and shows the error state; the head only falls back to the plain title.
    return { title: guideFallbackTitle };
  }
}

/**
 * Where a request for this entry should have gone, or null when it is already there. The ID is the
 * key, so a retired or wrong slug finds the entry and is sent to the current one; an entry that
 * has gone live is sent to its experience page.
 */
function canonicalPath(
  experience: GuestExperience,
  requested: ExperienceAddress,
): string | null {
  if (experience.status === 'live') return experiencePath(experience);
  return experience.slug === requested.slug ? null : guidePath(experience);
}

export default async function GuideEntryRoute({
  params,
}: PageProps<'/guide/[slugAndId]'>) {
  const address = parseExperienceAddress((await params).slugAndId);
  if (!address) notFound();

  let data;
  try {
    data = await getExperiencePage(address.id);
  } catch (error) {
    rethrowOrLog('The guide entry could not be read', error);
    return (
      <PageError
        title={guideFallbackTitle}
        alertTitle="We couldn't load this entry"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={guidePath(address)}
      />
    );
  }

  const target = data && canonicalPath(data.experience, address);
  if (target) permanentRedirect(target);

  const view = data ? buildGuideEntry(data) : null;
  if (!data || !view) notFound();
  return (
    <GuideEntry
      entry={view}
      related={
        <Suspense fallback={null}>
          <RelatedContent
            entryId={data.experience.id}
            categorySlug={data.place.category.slug}
            categoryName={view.categoryName}
          />
        </Suspense>
      }
    />
  );
}
