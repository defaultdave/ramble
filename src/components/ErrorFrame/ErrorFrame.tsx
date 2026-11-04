import type { ReactNode } from 'react';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { SkipLink } from '@/components/SkipLink';
import { footerChrome, footerGroups } from '@/lib/pages/siteFooter';

/**
 * The frame of an error state that a client module draws: skip link, home link, the notice, and
 * the footer. It uses no part of the guest frame that loads the catalog schemas, whose
 * `Function("")` probe trips the nonce policy when a client module ships them.
 */
export function ErrorFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <Header variant="plain" />
      <main id="main">{children}</main>
      <Footer
        linkGroups={footerGroups}
        tagline={footerChrome.tagline}
        copyright={footerChrome.copyright}
      />
    </>
  );
}
