import { browsePath, giftGuidePath, picksAnchor } from './home';

export type SiteLink = { label: string; href: string };
export type SiteLinkGroup = { title: string; links: SiteLink[] };

const picksPath = `/#${picksAnchor}`;

/** The header's main links and the menu's, in the order the Figma header shows them. */
export const mainLinks: SiteLink[] = [
  { label: 'Things to do', href: browsePath },
  { label: 'Ramble Picks', href: picksPath },
  { label: 'Gift guide', href: giftGuidePath },
];

/** The footer's groups. Only pages that exist are linked; every address is distinct, since the footer keys its links by address. */
export const footerGroups: SiteLinkGroup[] = [
  {
    title: 'Explore',
    links: [
      { label: 'Gift guide', href: giftGuidePath },
      { label: 'Ramble Picks', href: picksPath },
      { label: 'Things to do', href: browsePath },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Help center', href: '/help' },
      { label: 'Contact us', href: '/contact' },
      { label: 'Accessibility', href: '/accessibility' },
    ],
  },
  {
    title: 'Ramble',
    links: [
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Privacy', href: '/legal/privacy' },
    ],
  },
];

export const siteChrome = {
  /** What the header's search pill says. It links to browse, so it names no filter it does not apply. */
  searchLabel: 'Anywhere · Any day',
  tagline: 'The friend who always knows what to do in New York.',
  copyright: '© 2026 Ramble. Made in Brooklyn.',
} as const;
