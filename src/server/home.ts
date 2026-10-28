import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { Category, Neighborhood } from '@/lib/catalog';
import type { Collection, HomeModule } from '@/lib/editorial';
import {
  homeExperienceIds,
  homeLimits,
  thisWeekExperienceIds,
  thisWeekWindow,
  type HomeExperience,
} from '@/lib/home';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listCategories, listNeighborhoods } from '@/server/db/catalog';
import { listHomeModules, listPublishedPicks } from '@/server/db/editorial';
import { listHomeExperiences, listThisWeekSessions } from '@/server/db/home';

export type HomeContent = {
  modules: HomeModule[];
  picks: Collection[];
  categories: Category[];
  neighborhoods: Neighborhood[];
  experiences: HomeExperience[];
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
    const [modules, picks, categories, neighborhoods] = await Promise.all([
      listHomeModules(),
      listPublishedPicks(),
      listCategories(),
      listNeighborhoods(),
    ]);
    const experiences = await listHomeExperiences(
      homeExperienceIds(modules, picks),
    );
    return { modules, picks, categories, neighborhoods, experiences };
  });
  for (const experience of content.experiences) {
    cacheTag(tags.experience(experience.id));
  }
  return content;
}

export type ThisWeekContent = {
  /** The experiences with an open session, soonest first. */
  experienceIds: string[];
  experiences: HomeExperience[];
};

/**
 * The experiences with an open session in the next week. `asOf` is the minute (`homeAsOf`), so
 * guests inside one minute share an entry. A schedule or booking change reaches it through the
 * tag of each experience it lists; a session added to an experience that is not listed waits for
 * the `browse` profile to run out, about a minute.
 */
export async function getThisWeek(asOf: string): Promise<ThisWeekContent> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  const content = await readOrRefuse('This week', async () => {
    const window = thisWeekWindow(asOf);
    const sessions = await listThisWeekSessions(window);
    // Twice what is shown, so an experience that cannot be a card does not leave the module short.
    const experienceIds = thisWeekExperienceIds(
      sessions,
      window,
      homeLimits.thisWeekShown * 2,
    );
    const experiences = await listHomeExperiences(experienceIds);
    return { experienceIds, experiences };
  });
  for (const experience of content.experiences) {
    cacheTag(tags.experience(experience.id));
  }
  return content;
}
