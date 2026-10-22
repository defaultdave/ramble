'use client';

import { ErrorNotice } from '@/components/ErrorNotice';

export default function GroupError({ retry }: { retry: () => void }) {
  return <ErrorNotice onRetry={retry} />;
}
