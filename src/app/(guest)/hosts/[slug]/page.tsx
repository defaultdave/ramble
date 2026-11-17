import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import {
  hostFallbackTitle,
  hostHead,
  hostNotFoundTitle,
  hostPlaceholderSlug,
  isHostSlug,
} from '@/lib/pages/host';
import { getHostPage } from '@/server/hostPage';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { HostContent } from './HostContent';

// The build has no database to list hosts from, so it prerenders the placeholder; a real host
// renders on its first request and is kept by the cached read under it.
export function generateStaticParams() {
  return [{ slug: hostPlaceholderSlug }];
}

export async function generateMetadata({
  params,
}: PageProps<'/hosts/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  if (!isHostSlug(slug)) return { title: hostNotFoundTitle };
  try {
    const data = await getHostPage(slug);
    const { title, description } = hostHead(data?.host ?? null);
    return description === null ? { title } : { title, description };
  } catch (error) {
    rethrowOrLog('The host head could not be read', error);
    // The page reads the same entry and shows the error state; the head only falls back to the plain title.
    return { title: hostFallbackTitle };
  }
}

export default async function HostRoute({
  params,
}: PageProps<'/hosts/[slug]'>) {
  const { slug } = await params;
  if (!isHostSlug(slug)) notFound();
  // A miss is read with the `uncached` profile, which a prerender of the shell cannot hold. The read
  // sits behind Suspense so an unknown slug reaches its `notFound()` in the request.
  return (
    <Suspense fallback={null}>
      <HostContent slug={slug} />
    </Suspense>
  );
}
