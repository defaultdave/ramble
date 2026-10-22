import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/SiteShell';

export const metadata: Metadata = {
  title: { default: 'Ramble', template: '%s | Ramble' },
  description: 'A marketplace for things worth doing.',
  robots: { index: false },
};

export const instant = false;

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteShell areaName="Operations">{children}</SiteShell>
      </body>
    </html>
  );
}
