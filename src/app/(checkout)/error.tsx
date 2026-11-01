'use client';

import { ErrorNotice } from '@/components/ErrorNotice';
import { GuestShell } from '@/components/GuestShell';

/** At the group's root, above the `(site)` frame, so it brings its own. */
export default function GroupError({ retry }: { retry: () => void }) {
  return (
    <GuestShell>
      <ErrorNotice onRetry={retry} />
    </GuestShell>
  );
}
