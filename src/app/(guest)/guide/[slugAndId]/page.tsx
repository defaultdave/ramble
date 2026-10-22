import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Guide entry' };

export function generateStaticParams() {
  return [{ slugAndId: 'sample' }];
}

export default function GuideEntryPage({
  params,
}: PageProps<'/guide/[slugAndId]'>) {
  const { slugAndId } = use(params);
  return (
    <RoutePlaceholder
      name="Guide entry"
      covers="PRD-13, PRD-64"
      param={slugAndId}
    />
  );
}
