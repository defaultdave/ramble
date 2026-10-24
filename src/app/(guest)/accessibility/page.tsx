import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Accessibility' };

export default function AccessibilityPage() {
  return <RoutePlaceholder name="Accessibility" covers="PRD-69" />;
}
