import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { GuestShell } from '@/components/GuestShell';
import { AccountControl } from '@/components/Header/AccountControl';
import { VercelMeasurement } from '@/server/analytics/VercelMeasurement';
import { SentryBrowserScript } from '@/server/monitoring/SentryBrowserScript';
import { siteMetadata } from '@/lib/copy/meta';
import '@/styles/base.css';
import '@/styles/tokens.css';
import '@/styles/forced-colors.css';
import { fontVariables } from '../fonts';
import { GuestBanner } from './GuestBanner';
import { HeaderAccount } from './HeaderAccount';

export const metadata: Metadata = {
  ...siteMetadata,
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
          account={
            <Suspense fallback={<AccountControl signedIn={false} />}>
              <HeaderAccount />
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
