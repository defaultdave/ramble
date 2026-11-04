import { brandName } from './brand';
import {
  accessibilityPath,
  browsePath,
  contactPath,
  giftGuidePath,
  helpPath,
  homePicksHref,
  legalPath,
} from '../paths';

export type SiteLink = { label: string; href: string };
type SiteLinkGroup = { title: string; links: SiteLink[] };

/** The footer's groups, which load no catalog schema, so a client module can show the footer. Only pages that exist are linked; every address is distinct, since the footer keys its links by address. */
export const footerGroups: SiteLinkGroup[] = [
  {
    title: 'Explore',
    links: [
      { label: 'Gift guide', href: giftGuidePath },
      { label: 'Ramble Picks', href: homePicksHref },
      { label: 'Things to do', href: browsePath },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Help center', href: helpPath },
      { label: 'Contact us', href: contactPath },
      { label: 'Accessibility', href: accessibilityPath },
    ],
  },
  {
    title: 'Ramble',
    links: [
      { label: 'Terms', href: legalPath('terms') },
      { label: 'Privacy', href: legalPath('privacy') },
    ],
  },
];

export const footerChrome = {
  tagline: 'The friend who always knows what to do in New York.',
  copyright: `© 2026 ${brandName}. Made in Brooklyn.`,
} as const;
