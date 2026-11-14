import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { siteMetadata } from '@/lib/copy/meta';
import '@/styles/base.css';
import '@/styles/tokens.css';
import '@/styles/forced-colors.css';
import { fontVariables } from '../fonts';
import { RenderPerRequest } from '../renderPerRequest';

export const metadata: Metadata = {
  ...siteMetadata,
  robots: { index: false },
};

export const instant = false;

export default function HostLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <SiteShell areaName="For hosts">{children}</SiteShell>
        <RenderPerRequest />
      </body>
    </html>
  );
}
