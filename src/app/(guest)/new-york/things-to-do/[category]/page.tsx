import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Category' };

export function generateStaticParams() {
  return [{ category: 'sample' }];
}

export default function CategoryPage({
  params,
}: PageProps<'/new-york/things-to-do/[category]'>) {
  const { category } = use(params);
  return (
    <RoutePlaceholder
      name="Category"
      covers="PRD-02, PRD-65"
      param={category}
    />
  );
}
