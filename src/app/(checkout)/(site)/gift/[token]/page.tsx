import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Redeem a gift' };

export default function RedeemAGiftPage({
  params,
}: PageProps<'/gift/[token]'>) {
  const { token } = use(params);
  return (
    <RoutePlaceholder name="Redeem a gift" covers="PRD-33" param={token} />
  );
}
