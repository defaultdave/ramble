import type { Metadata } from 'next';
import { landingPlaceholderSlug } from '@/lib/pages/landing';
import { LandingRoute, landingMetadata } from '../../_landing/LandingRoute';

// The build has no database to list neighborhoods from, so it prerenders the placeholder; a real
// neighborhood renders on its first request and is kept by the cached reads under it.
export function generateStaticParams() {
  return [{ neighborhood: landingPlaceholderSlug }];
}

export async function generateMetadata({
  params,
}: PageProps<'/new-york/neighborhoods/[neighborhood]'>): Promise<Metadata> {
  const { neighborhood } = await params;
  return landingMetadata({ kind: 'neighborhood', slug: neighborhood });
}

export default async function NeighborhoodPage({
  params,
}: PageProps<'/new-york/neighborhoods/[neighborhood]'>) {
  const { neighborhood } = await params;
  return <LandingRoute kind="neighborhood" slug={neighborhood} />;
}
