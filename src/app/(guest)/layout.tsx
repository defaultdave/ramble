import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { GuestShell } from '@/components/GuestShell';
import { VercelMeasurement } from '@/server/analytics/VercelMeasurement';
import { SentryBrowserScript } from '@/server/monitoring/SentryBrowserScript';
import '@/styles/base.css';
import '@/styles/tokens.css';
import '@/styles/forced-colors.css';
import { fontVariables } from '../fonts';
import { GuestBanner } from './GuestBanner';

export const metadata: Metadata = {
  title: { default: 'Ramble', template: '%s | Ramble' },
  description: 'A marketplace for things worth doing.',
};

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <GuestShell
          banner={
            <Suspense fallback={null}>
              <GuestBanner />
            </Suspense>
          }
        >
          {children}
        </GuestShell>
        <VercelMeasurement />
        <SentryBrowserScript />
      </body>
    </html>
  );
}
