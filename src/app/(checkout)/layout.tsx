import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/base.css';
import '@/styles/tokens.css';
import '@/styles/forced-colors.css';
import { fontVariables } from '../fonts';
import { RenderPerRequest } from '../renderPerRequest';

export const metadata: Metadata = {
  title: { default: 'Ramble', template: '%s | Ramble' },
  description: 'A marketplace for things worth doing.',
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
