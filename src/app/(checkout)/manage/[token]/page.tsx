import type { Metadata } from 'next';
import { use } from 'react';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Manage booking' };

export default function ManageBookingPage({
  params,
}: PageProps<'/manage/[token]'>) {
  const { token } = use(params);
  return (
    <RoutePlaceholder
      name="Manage booking"
      covers="PRD-26, PRD-30"
      param={token}
    />
  );
}
