import type { Metadata } from 'next';
import { RoutePlaceholder } from '@/components/RoutePlaceholder';

export const metadata: Metadata = { title: 'Host tools' };

export default function HostToolsPage() {
  return (
    <RoutePlaceholder
      name="Host tools"
      covers="PRD-28, PRD-41, PRD-45, PRD-47, PRD-48"
    />
  );
}
