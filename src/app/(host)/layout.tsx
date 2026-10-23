import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/SiteShell';
import '@/styles/tokens.css';
import { fontVariables } from '../fonts';

export const metadata: Metadata = {
  title: { default: 'Ramble', template: '%s | Ramble' },
  description: 'A marketplace for things worth doing.',
  robots: { index: false },
};

export const instant = false;

export default function HostLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <SiteShell areaName="For hosts">{children}</SiteShell>
      </body>
    </html>
  );
}
