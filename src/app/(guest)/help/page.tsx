import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage() {
  return <RoutePlaceholder name="Help" covers="PRD-53, PRD-54" />;
}
