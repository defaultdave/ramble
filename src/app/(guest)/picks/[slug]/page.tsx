import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Ramble Picks' };

export function generateStaticParams() {
  return [{ slug: 'sample' }];
}

export default function RamblePicksPage({
  params,
}: PageProps<'/picks/[slug]'>) {
  const { slug } = use(params);
  return <RoutePlaceholder name="Ramble Picks" covers="PRD-03" param={slug} />;
}
