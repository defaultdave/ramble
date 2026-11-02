'use client';

import { ErrorNotice } from '@/components/ErrorNotice';
import { SiteShell } from '@/components/SiteShell';

/**
 * Catches what the frames of this group could not: an error thrown by the `(site)` layout or the
 * checkout layout, whose frames are the ones that failed. It brings the plain frame, not `GuestShell`:
 * an error file is a client module, so the guest frame's navigation would ship the catalog schemas to
 * every page in the group, and their `Function("")` probe trips the nonce policy.
 */
export default function GroupError({ retry }: { retry: () => void }) {
  return (
    <SiteShell>
      <ErrorNotice onRetry={retry} />
    </SiteShell>
  );
}
