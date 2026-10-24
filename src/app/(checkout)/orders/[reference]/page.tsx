import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Order confirmation' };

export default function OrderConfirmationPage({
  params,
}: PageProps<'/orders/[reference]'>) {
  const { reference } = use(params);
  return (
    <RoutePlaceholder
      name="Order confirmation"
      covers="PRD-25"
      param={reference}
    />
  );
}
