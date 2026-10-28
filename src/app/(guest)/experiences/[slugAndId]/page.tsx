import type { Metadata } from 'next';
import { notFound, unstable_rethrow } from 'next/navigation';
import { ExperienceError, ExperiencePage } from '@/components/ExperiencePage';
import { errorDigest } from '@/lib/errorDigest';
import {
  buildExperiencePage,
  experienceHead,
  fallbackTitle,
  parseExperienceAddress,
} from '@/lib/experiencePage';
import { experiencePath } from '@/lib/home';
import { getExperiencePage } from '@/server/experiencePage';
import { logger } from '@/server/monitoring/logger';
import { getCachedGuestSettings } from '@/server/siteSettings';

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
    // Next.js ends a prerender by throwing; swallowing that would break the render.
    unstable_rethrow(error);
    // The page reads the same entry and shows the error state; the head only falls back to the plain title.
    return { title: fallbackTitle };
  }
}

export default async function ExperienceRoute({
  params,
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
    // Next.js ends a prerender by throwing; swallowing that would break the render.
    unstable_rethrow(error);
    // Only the digest is logged. Next.js strips the message of an error that crosses a cached
    // function, and the digest finds the line it logged there, which names the kind of failure.
    logger.error('The experience page could not be read', {
      digest: errorDigest(error),
    });
    return (
      <ExperienceError
        retryHref={experiencePath({ ...address, status: 'live' })}
      />
    );
  }

  if (!view) notFound();
  return <ExperiencePage view={view} />;
}
