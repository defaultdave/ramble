import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Gift checkout' };

export default function GiftCheckoutPage({
  params,
}: PageProps<'/gifts/checkout/[experienceId]'>) {
  const { experienceId } = use(params);
  return (
    <RoutePlaceholder
      name="Gift checkout"
      covers="PRD-33"
      param={experienceId}
    />
  );
}
