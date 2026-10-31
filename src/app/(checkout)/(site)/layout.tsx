import type { ReactNode } from 'react';
import { GuestShell } from '@/components/GuestShell';

/** The guest frame of the checkout-group routes that are not checkout itself, with no site notice or third-party tags (ADR 0007). */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <GuestShell>{children}</GuestShell>;
}
