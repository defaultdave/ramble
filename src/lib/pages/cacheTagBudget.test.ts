import { describe, expect, it } from 'vitest';
import {
  cacheEntryTagCounts,
  cacheTagBudget,
  homePageTagCount,
} from './cacheTagBudget';
import { editorialLimits, picksCandidates } from '../editorial';
import { cardLookupLimit, coverLookupLimit } from '../idLookup';
import { homeLimits } from './home';
import { photoLimits } from '../photos';

// Behaviours under test, one per decision, branch or risk:
// - no cached read can carry more tags than the budget, whatever its page bounds are
// - the home page response stays inside the budget too, with every entry it uses taken together
// - the cover read is bounded by the cards the page draws, not by the candidates the home read looks at
// - every Pick keeps a margin of candidates over the cards it shows
// - the budget is the 128 tags Next.js and Vercel allow

describe('cacheEntryTagCounts', () => {
  it.each(Object.entries(cacheEntryTagCounts))(
    'the %s entry cannot carry more tags than the budget',
    (_entry, count) => {
      expect(count).toBeLessThanOrEqual(cacheTagBudget);
    },
  );

  it('counts the cover entry as one tag per cover asked for', () => {
    expect(cacheEntryTagCounts.coverPhotos).toBe(photoLimits.maxCoverLookups);
    expect(photoLimits.maxCoverLookups).toBe(coverLookupLimit);
  });

  it('asks for covers of the cards shown, which are fewer than the candidates looked at', () => {
    const mostCardsShown =
      editorialLimits.homeModules *
      Math.max(homeLimits.picksShown, homeLimits.thisWeekShown);
    expect(coverLookupLimit).toBe(mostCardsShown);
    expect(coverLookupLimit).toBeLessThan(cardLookupLimit);
  });

  it('keeps more Pick candidates than cards shown, so a module that cannot show its first cards is filled', () => {
    expect(picksCandidates).toBeGreaterThan(homeLimits.picksShown);
  });
});

describe('homePageTagCount', () => {
  it('stays inside the budget with the home entry, "On this week", and settings together', () => {
    expect(homePageTagCount).toBeLessThanOrEqual(cacheTagBudget);
  });
});

describe('cacheTagBudget', () => {
  it('is the 128 tags Next.js and Vercel allow', () => {
    expect(cacheTagBudget).toBe(128);
  });
});
