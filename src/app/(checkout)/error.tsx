'use client';

import { ErrorNotice } from '@/components/ErrorNotice';
import { SiteShell } from '@/components/SiteShell';

/**
 * For the checkout page, which draws its own header. It brings the plain frame, not `GuestShell`: an error
 * file is a client module, so the guest frame's navigation would ship the catalog schemas to every page in
 * the group, and their `Function("")` probe trips the nonce policy. The other routes have `(site)/error.tsx`.
 */
export default function GroupError({ retry }: { retry: () => void }) {
  return (
    <SiteShell>
      <ErrorNotice onRetry={retry} />
    </SiteShell>
  );
}
