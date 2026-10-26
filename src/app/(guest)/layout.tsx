import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { VercelMeasurement } from '@/server/analytics/VercelMeasurement';
import { SentryBrowserScript } from '@/server/monitoring/SentryBrowserScript';
import '@/styles/tokens.css';
import { fontVariables } from '../fonts';

export const metadata: Metadata = {
  title: { default: 'Ramble', template: '%s | Ramble' },
  description: 'A marketplace for things worth doing.',
};

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <SiteShell>{children}</SiteShell>
        <VercelMeasurement />
        <SentryBrowserScript />
      </body>
    </html>
  );
}
