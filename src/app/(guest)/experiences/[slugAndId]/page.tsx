import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Experience' };

export function generateStaticParams() {
  return [{ slugAndId: 'sample' }];
}

export default function ExperiencePage({
  params,
}: PageProps<'/experiences/[slugAndId]'>) {
  const { slugAndId } = use(params);
  return (
    <RoutePlaceholder
      name="Experience"
      covers="PRD-09 to PRD-12, PRD-66"
      param={slugAndId}
    />
  );
}
