import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Legal' };

export function generateStaticParams() {
  return [{ doc: 'sample' }];
}

export default function LegalPage({ params }: PageProps<'/legal/[doc]'>) {
  const { doc } = use(params);
  return <RoutePlaceholder name="Legal" covers="PRD-53" param={doc} />;
}
