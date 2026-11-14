import { commonCopy } from '../copy/common';
import { footerChrome, type SiteLink } from './siteFooter';
import { browseHref, defaultGuests, noFilters } from '../filters';
import { guestsLabel } from '../copy/format';
import { browsePath, giftGuidePath, homePicksHref } from '../routes';

export type { SiteLink } from './siteFooter';
export { footerGroups } from './siteFooter';

/** The header's main links and the menu's, in the order the Figma header shows them. */
export const mainLinks: SiteLink[] = [
  { label: commonCopy.nav.thingsToDo, href: browsePath },
  { label: commonCopy.nav.ramblePicks, href: homePicksHref },
  { label: commonCopy.nav.giftGuide, href: giftGuidePath },
];

/** Where the header's search pill goes. It names no day, since the static shell cannot know today. */
export const searchHref = browseHref({
  filters: { ...noFilters, guests: defaultGuests },
  after: null,
});

export const siteChrome = {
  /** What the header's search pill says. It links to `searchHref`, so it names no filter that link does not apply. */
  searchLabel: commonCopy.nav.searchLabel(guestsLabel(defaultGuests)),
  ...footerChrome,
} as const;
