import { commonCopy } from '../copy/common';
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
    title: commonCopy.footer.groups.explore,
    links: [
      { label: commonCopy.footer.links.giftGuide, href: giftGuidePath },
      { label: commonCopy.footer.links.ramblePicks, href: homePicksHref },
      { label: commonCopy.footer.links.thingsToDo, href: browsePath },
    ],
  },
  {
    title: commonCopy.footer.groups.help,
    links: [
      { label: commonCopy.footer.links.helpCenter, href: helpPath },
      { label: commonCopy.footer.links.contact, href: contactPath },
      { label: commonCopy.footer.links.accessibility, href: accessibilityPath },
    ],
  },
  {
    title: commonCopy.footer.groups.brand,
    links: [
      { label: commonCopy.footer.links.terms, href: legalPath('terms') },
      { label: commonCopy.footer.links.privacy, href: legalPath('privacy') },
    ],
  },
];

export const footerChrome = {
  tagline: commonCopy.footer.tagline,
  copyright: commonCopy.footer.copyright,
} as const;
