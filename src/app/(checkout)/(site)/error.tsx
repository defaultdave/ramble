'use client';

import { ErrorNotice } from '@/components/ErrorNotice';

/** Inside the `(site)` layout, so the guest frame comes from there and stays out of this client module. */
export default function SiteError({ retry }: { retry: () => void }) {
  return <ErrorNotice onRetry={retry} />;
}
