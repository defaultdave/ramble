import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Browse' };

export default function BrowsePage() {
  return (
    <RoutePlaceholder name="Browse" covers="PRD-02, PRD-05, PRD-06, PRD-07" />
  );
}
