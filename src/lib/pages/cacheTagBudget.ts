import { browsePageSize } from './browse';
import { homeLimits } from './home';
import { photoLimits } from '../photos';

// Test-only by design: the budget is enforced by tests against the real tagging code, so nothing in
// production imports it.

/**
 * The most tags one cached response may carry. Next.js drops the tags past 128 in one `cacheTag()`
 * call (with a console warning) and sets no cap across calls, so tagging once per ID gets past it;
 * Vercel allows 128 tags, each up to 256 bytes with no comma, on one cached response. An entry past
 * this has tags that never invalidate it.
 */
export const cacheTagBudget = 128;

/**
 * The most tags each cached read can carry, from the bounds its page is built for. An entry holds
 * the tags of the cached reads nested in it, so `taxonomy` (from `getFilterOptions`) counts toward
 * every entry that calls it.
 */
export const cacheEntryTagCounts = {
  /** `home`, `taxonomy`, and an experience tag for each ID the Picks name. */
  home: 2 + homeLimits.maxCardIds,
  /** `catalog` and an experience tag for each experience listed. */
  thisWeek: 1 + homeLimits.thisWeekCandidates,
  /** An experience tag for each cover asked for. */
  coverPhotos: photoLimits.maxCoverLookups,
  /** `catalog` and an experience tag for each card of the page. */
  browse: 1 + browsePageSize,
  /** `taxonomy` and the experience's own tag. */
  experiencePage: 2,
  /** The settings tag. */
  settings: 1,
} as const;

/**
 * The most tags the home page response can carry if it takes in every cached read it uses, none of
 * the experiences shared: the home entry, "On this week", and settings. The covers add
 * nothing, as they are asked for only for cards that the other two already tag.
 */
export const homePageTagCount =
  cacheEntryTagCounts.home +
  cacheEntryTagCounts.thisWeek +
  cacheEntryTagCounts.settings;
