import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Operations' };

export default function OperationsPage() {
  return (
    <RoutePlaceholder
      name="Operations"
      covers="PRD-39, PRD-40, PRD-50 to PRD-59"
    />
  );
}
