import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { isSlug } from '@/lib/catalog';
import { picksPlaceholderSlug } from '@/lib/pages/picks';
import { CollectionRoute, collectionMetadata } from '../CollectionRoute';

// The build has no database to list Picks from, so it prerenders the placeholder; a real Pick
// renders on its first request and is kept by the cached read under it.
export function generateStaticParams() {
  return [{ slug: picksPlaceholderSlug }];
}

export async function generateMetadata({
  params,
}: PageProps<'/picks/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  return collectionMetadata({ kind: 'pick', slug });
}

export default async function RamblePicksPage({
  params,
}: PageProps<'/picks/[slug]'>) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  // A miss is read with the `uncached` profile, which a prerender of the shell cannot hold. The read
  // sits behind Suspense so an unknown slug reaches its `notFound()` in the request.
  return (
    <Suspense fallback={null}>
      <CollectionRoute kind="pick" slug={slug} />
    </Suspense>
  );
}
