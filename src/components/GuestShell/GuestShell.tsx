import type { ReactNode } from 'react';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { SkipLink } from '@/components/SkipLink';
import { giftGuidePath } from '@/lib/routes';
import {
  footerGroups,
  mainLinks,
  searchHref,
  siteChrome,
} from '@/lib/pages/siteNav';
import { SiteMenu } from './SiteMenu';

export type GuestShellProps = {
  /** The site notice above the header, or nothing. */
  banner?: ReactNode;
  children: ReactNode;
};

/** The frame of every guest page: skip link, notice, header, the page, and footer. */
export function GuestShell({ banner, children }: GuestShellProps) {
  return (
    <>
      <SkipLink />
      {banner}
      <Header
        links={mainLinks}
        giftsHref={giftGuidePath}
        searchLabel={siteChrome.searchLabel}
        searchHref={searchHref}
        menu={<SiteMenu links={mainLinks} />}
      />
      <main id="main">{children}</main>
      <Footer
        linkGroups={footerGroups}
        tagline={siteChrome.tagline}
        copyright={siteChrome.copyright}
      />
    </>
  );
}
