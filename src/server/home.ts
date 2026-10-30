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
import { listCategories, listNeighborhoods } from '@/server/db/catalog';
import {
  getPublishedGiftGuide,
  listHomeModules,
  listHomePicks,
} from '@/server/db/editorial';
import { listHomeExperiences, listThisWeekSessions } from '@/server/db/home';

export type HomeContent = {
  modules: HomeModule[];
  picks: HomePick[];
  giftGuide: Collection | null;
  categories: Category[];
  neighborhoods: Neighborhood[];
  experiences: CardExperience[];
};

/**
 * Everything the home modules show except "On this week" and the gift switch. Publishing a home
 * module, a Pick, or a category reaches it through `tags.home` and `tags.catalog`, and an
 * experience on a Pick card reaches it through that experience's tag.
 */
export async function getHomeContent(): Promise<HomeContent> {
  'use cache';
  cacheLife('editorial');
  cacheTag(tags.home, tags.catalog);
  const content = await readOrRefuse('Home', async () => {
    // The Picks wait for the modules, which say which ones to read; the rest read beside them.
    const [{ modules, picks }, giftGuide, categories, neighborhoods] =
      await Promise.all([
        listHomeModules().then(async (listed) => ({
          modules: listed,
          picks: await listHomePicks(homePickIds(listed)),
        })),
        getPublishedGiftGuide(),
        listCategories(),
        listNeighborhoods(),
      ]);
    const experiences = await listHomeExperiences(
      homeExperienceIds(modules, picks),
      { covers: false },
    );
    return {
      modules,
      picks,
      giftGuide,
      categories,
      neighborhoods,
      experiences,
    };
  });
  for (const experience of content.experiences) {
    cacheTag(tags.experience(experience.id));
  }
  return content;
}

export type ThisWeekContent = {
  /** The experiences with an open session, soonest first. */
  experienceIds: string[];
  experiences: CardExperience[];
};

/**
 * The experiences with an open session in the next week. `asOf` is the minute (`minuteAsOf`), so
 * guests inside one minute share an entry. A schedule or booking change reaches it through the
 * tag of each experience it lists; a session added to an experience that is not listed waits for
 * the `browse` profile to run out, about a minute.
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
