import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Neighborhood' };

export function generateStaticParams() {
  return [{ neighborhood: 'sample' }];
}

export default function NeighborhoodPage({
  params,
}: PageProps<'/new-york/neighborhoods/[neighborhood]'>) {
  const { neighborhood } = use(params);
  return (
    <RoutePlaceholder
      name="Neighborhood"
      covers="PRD-02, PRD-65"
      param={neighborhood}
    />
  );
}
