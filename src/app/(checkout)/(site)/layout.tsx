import type { ReactNode } from 'react';
import { SiteShell } from '@/components/SiteShell';

/** The stand-in frame of the checkout-group routes that are not checkout itself. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
