import type { Collection, CollectionItem } from '../editorial';
import { toExperienceCard, type CardExperience } from '../experienceCards';
import { giftGuidePath, picksPath } from '../routes';
import { resultsSummary, type BrowseView } from './browse';

/** The two collection pages: a Ramble Pick by its slug, and the one gift guide. */
export type CollectionPageKind = Extract<
  Collection['kind'],
  'pick' | 'gift_guide'
>;

/**
 * The slug the build prerenders. It is not a slug (an underscore is not allowed in one), so the page
 * refuses it before reading anything: a build has no database to ask, and no made-up address may
 * turn into a stored error page.
 */
export const picksPlaceholderSlug = 'not_a_slug';

const picksFallbackTitle = 'Ramble Picks';
export const giftGuideFallbackTitle = 'Gift guide';

/** The address of a collection page; the gift guide is the one page with no slug. */
export function collectionPath(
  kind: CollectionPageKind,
  slug: string | null,
): string {
  return kind === 'pick' && slug !== null ? picksPath(slug) : giftGuidePath;
}

/** The title of a page whose read failed or that names nothing, so the page still says what it is. */
export function collectionFallbackTitle(kind: CollectionPageKind): string {
  return kind === 'gift_guide' ? giftGuideFallbackTitle : picksFallbackTitle;
}

/** What the page puts in the document head. The description is the collection's summary, absent when an editor wrote none. */
export function collectionHead(
  collection: Pick<Collection, 'title' | 'summary'>,
): { title: string; description: string | null } {
  return {
    title: collection.title,
    description: collection.summary ?? null,
  };
}

/**
 * The experiences in the collection's own order, which is the editor's. An entry with no experience
 * to show (hidden since, or read after it went) is left out, never replaced.
 */
export function inCollectionOrder(
  items: readonly Pick<CollectionItem, 'experienceId'>[],
  experiences: readonly CardExperience[],
): CardExperience[] {
  const byId = new Map(
    experiences.map((experience) => [experience.id, experience]),
  );
  return items.flatMap(({ experienceId }) => byId.get(experienceId) ?? []);
}

/** The results area: every card in one list, with no further page, as a collection holds at most `editorialLimits.collectionItems` entries. */
export function collectionView(
  items: readonly Pick<CollectionItem, 'experienceId'>[],
  experiences: readonly CardExperience[],
): BrowseView {
  const cards = inCollectionOrder(items, experiences).flatMap(
    (experience) => toExperienceCard(experience) ?? [],
  );
  if (cards.length === 0) {
    return { state: 'empty', filtered: false, dated: null, wording: 'landing' };
  }
  return {
    state: 'results',
    cards,
    summary: resultsSummary(cards.length, false),
    showMore: null,
    startHref: null,
  };
}
