import type { Metadata } from 'next';
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
  return <CollectionRoute kind="pick" slug={slug} />;
}
