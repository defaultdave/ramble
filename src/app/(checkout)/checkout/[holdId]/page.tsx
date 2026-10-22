import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage({
  params,
}: PageProps<'/checkout/[holdId]'>) {
  const { holdId } = use(params);
  return (
    <RoutePlaceholder
      name="Checkout"
      covers="PRD-14 to PRD-24"
      param={holdId}
    />
  );
}
