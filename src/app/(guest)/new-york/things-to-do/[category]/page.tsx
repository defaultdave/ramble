import type { Metadata } from 'next';
import { landingPlaceholderSlug } from '@/lib/pages/landing';
import { LandingRoute, landingMetadata } from '../../_landing/LandingRoute';

// The build has no database to list categories from, so it prerenders the placeholder; a real
// category renders on its first request and is kept by the cached reads under it.
export function generateStaticParams() {
  return [{ category: landingPlaceholderSlug }];
}

export async function generateMetadata({
  params,
}: PageProps<'/new-york/things-to-do/[category]'>): Promise<Metadata> {
  const { category } = await params;
  return landingMetadata({ kind: 'category', slug: category });
}

export default async function CategoryPage({
  params,
}: PageProps<'/new-york/things-to-do/[category]'>) {
  const { category } = await params;
  return <LandingRoute kind="category" slug={category} />;
}
