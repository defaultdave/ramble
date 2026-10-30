import { NotFoundNotice } from '@/components/NotFoundNotice';
import { SiteShell } from '@/components/SiteShell';

/** At the group's root, above the `(site)` frame, so it brings its own. */
export default function NotFound() {
  return (
    <SiteShell>
      <NotFoundNotice />
    </SiteShell>
  );
}
