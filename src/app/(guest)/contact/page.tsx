import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return <RoutePlaceholder name="Contact" covers="PRD-54" />;
}
