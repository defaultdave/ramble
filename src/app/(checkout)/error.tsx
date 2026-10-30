'use client';

import { ErrorNotice } from '@/components/ErrorNotice';
import { SiteShell } from '@/components/SiteShell';

/** At the group's root, above the `(site)` frame, so it brings its own. */
export default function GroupError({ retry }: { retry: () => void }) {
  return (
    <SiteShell>
      <ErrorNotice onRetry={retry} />
    </SiteShell>
  );
}
