import { GuestShell } from '@/components/GuestShell';
import { NotFoundNotice } from '@/components/NotFoundNotice';

/** At the group's root, above the `(site)` frame, so it brings its own. */
export default function NotFound() {
  return (
    <GuestShell>
      <NotFoundNotice />
    </GuestShell>
  );
}
