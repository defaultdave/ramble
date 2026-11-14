import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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

/** The document only. The checkout page draws its own header, which carries the hold timer; the other routes in the group sit inside `(site)`. */
export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        {children}
        <RenderPerRequest />
      </body>
    </html>
  );
}
