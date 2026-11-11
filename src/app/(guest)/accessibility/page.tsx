import type { Metadata } from 'next';
import { AccessibilityStatement } from '@/components/AccessibilityStatement';

export const metadata: Metadata = {
  title: 'Accessibility',
  description:
    'How Ramble is built for access, where it falls short, and how to tell us about a barrier.',
};

export default function AccessibilityPage() {
  return <AccessibilityStatement />;
}
