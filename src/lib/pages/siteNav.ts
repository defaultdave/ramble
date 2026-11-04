import { footerChrome, type SiteLink } from './siteFooter';
import { browseHref, defaultGuests, noFilters } from '../filters';
import { guestsLabel } from '../orderSummary';
import { browsePath, giftGuidePath, homePicksHref } from '../routes';

export type { SiteLink } from './siteFooter';
export { footerGroups } from './siteFooter';

/** The header's main links and the menu's, in the order the Figma header shows them. */
export const mainLinks: SiteLink[] = [
  { label: 'Things to do', href: browsePath },
  { label: 'Ramble Picks', href: homePicksHref },
  { label: 'Gift guide', href: giftGuidePath },
];

/** Where the header's search pill goes. It names no day, since the static shell cannot know today. */
export const searchHref = browseHref({
  filters: { ...noFilters, guests: defaultGuests },
  after: null,
});

export const siteChrome = {
  /** What the header's search pill says. It links to `searchHref`, so it names no filter that link does not apply. */
  searchLabel: `Anywhere · Any day · ${guestsLabel(defaultGuests)}`,
  ...footerChrome,
} as const;
