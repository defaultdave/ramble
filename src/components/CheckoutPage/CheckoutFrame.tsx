import type { ReactNode } from 'react';
import { Footer } from '@/components/Footer';
import { footerGroups, siteChrome } from '@/lib/pages/siteNav';
import styles from './CheckoutFrame.module.css';

/** The frame around checkout: a skip link, the page, and the footer. The checkout header carries the hold timer, so the page renders it. */
export function CheckoutFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>
      {children}
      <Footer
        linkGroups={footerGroups}
        tagline={siteChrome.tagline}
        copyright={siteChrome.copyright}
      />
    </>
  );
}
