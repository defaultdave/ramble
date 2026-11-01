import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { Category, Neighborhood } from '@/lib/catalog';
import type { Collection, HomeModule } from '@/lib/editorial';
import {
  homePickIds,
  homeExperienceIds,
  homeLimits,
  thisWeekExperienceIds,
  type HomePick,
} from '@/lib/pages/home';
import type { CardExperience } from '@/lib/experienceCards';
import { upcomingWindow } from '@/lib/sessionWindow';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import {
  getPublishedGiftGuide,
  listHomeModules,
  listHomePicks,
} from '@/server/db/editorial';
import { listHomeExperiences, listThisWeekSessions } from '@/server/db/home';
import { getFilterOptions } from '@/server/filterOptions';

export type HomeContent = {
  modules: HomeModule[];
  picks: HomePick[];
  giftGuide: Collection | null;
  categories: Category[];
  neighborhoods: Neighborhood[];
  experiences: CardExperience[];
};

/**
 * Everything the home modules show except "On this week" and the gift switch. A home module, a
 * Pick, or the gift guide reaches it through `tags.home`; a rename of a category or neighborhood
 * through `tags.taxonomy`, which `getFilterOptions` hands to this entry. A listing change reaches
 * it only through the tag of each experience a Pick names. That includes one a guest cannot see
 * yet, so publishing it adds its card, and it is why the tag follows the IDs asked for and not
 * the cards that came back.
 */
export async function getHomeContent(): Promise<HomeContent> {
  'use cache';
  cacheLife('editorial');
  cacheTag(tags.home);
  return readOrRefuse('Home', async () => {
    // The Picks wait for the modules, which say which ones to read; the rest read beside them.
    const [{ modules, picks }, giftGuide, { categories, neighborhoods }] =
      await Promise.all([
        listHomeModules().then(async (listed) => ({
          modules: listed,
          picks: await listHomePicks(homePickIds(listed)),
        })),
        getPublishedGiftGuide(),
        getFilterOptions(),
      ]);
    const experienceIds = homeExperienceIds(modules, picks);
    for (const id of experienceIds) cacheTag(tags.experience(id));
    const experiences = await listHomeExperiences(experienceIds, {
      covers: false,
    });
    return {
      modules,
      picks,
      giftGuide,
      categories,
      neighborhoods,
      experiences,
    };
  });
}

export type ThisWeekContent = {
  /** The experiences with an open session, soonest first. */
  experienceIds: string[];
  experiences: CardExperience[];
};

/**
 * The experiences with an open session in the next week. `asOf` is the minute (`minuteAsOf`), so
 * guests inside one minute share an entry. A schedule change reaches it through the tag of each
 * experience it lists. A booking change publishes `session:<id>`, which no read carries, and a
 * session added to an experience that is not listed reaches nothing, so both wait for the entry to
 * roll over with the minute, about 60 seconds.
 */
export async function getThisWeek(asOf: string): Promise<ThisWeekContent> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  const content = await readOrRefuse('This week', async () => {
    const window = upcomingWindow(asOf, homeLimits.thisWeekDays);
    const sessions = await listThisWeekSessions(window);
    const experienceIds = thisWeekExperienceIds(
      sessions,
      window,
      homeLimits.thisWeekCandidates,
    );
    const experiences = await listHomeExperiences(experienceIds, {
      covers: true,
    });
    return { experienceIds, experiences };
  });
  for (const experience of content.experiences) {
    cacheTag(tags.experience(experience.id));
  }
  return content;
}
