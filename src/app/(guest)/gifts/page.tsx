import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Gift guide' };

export default function GiftGuidePage() {
  return <RoutePlaceholder name="Gift guide" covers="PRD-04" />;
}
