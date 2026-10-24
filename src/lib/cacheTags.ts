// The one place that names a cache tag. A cached function tags its output with these builders
// (`cacheTag(tags.experience(id))`), and every publish or booking change finds the tags to
// invalidate through `tagsForChange()`, so a page can only go stale if this file is wrong.
//
// A listing that features an experience (a Picks page, the gift guide, a home module) tags itself
// with that experience's tag for each entry it shows, so an experience change reaches it without
// this file knowing which collections hold the experience.

export const tags = {
  home: 'home',
  /** The two catalog indexes (by category, by neighborhood) that listings and browse filter. */
  catalog: 'catalog',
  settings: 'settings',
  giftGuide: 'gift-guide',
  helpArticles: 'help-articles',
  experience: (id: string) => `experience:${id}`,
  guideEntry: (id: string) => `guide-entry:${id}`,
  category: (slug: string) => `category:${slug}`,
  neighborhood: (slug: string) => `neighborhood:${slug}`,
  pick: (slug: string) => `pick:${slug}`,
  legalDocument: (doc: string) => `legal:${doc}`,
  session: (sessionId: string) => `session:${sessionId}`,
} as const;

/** What changed. Each kind carries only what its tags are built from. */
export type CacheChange =
  /** An experience or guide entry is published, edited, approved, taken down, or suspended, itself or through its host. */
  | {
      kind: 'listing';
      id: string;
      categorySlugs: readonly string[];
      neighborhoodSlug: string;
    }
  /** Sessions of an experience were added, moved, or cancelled. */
  | { kind: 'schedule'; experienceId: string }
  /** A hold, booking, or release changed the spaces left in one session. */
  | { kind: 'spaces'; sessionId: string }
  | { kind: 'homeModules' }
  | { kind: 'pick'; slug: string }
  | { kind: 'giftGuide' }
  | { kind: 'categoryCopy'; slug: string }
  | { kind: 'neighborhoodCopy'; slug: string }
  | { kind: 'helpArticles' }
  | { kind: 'legalDocument'; doc: string }
  | { kind: 'settings' };

function tagsFor(change: CacheChange): string[] {
  switch (change.kind) {
    case 'listing':
      return [
        tags.experience(change.id),
        tags.guideEntry(change.id),
        tags.catalog,
        tags.home,
        tags.neighborhood(change.neighborhoodSlug),
        ...change.categorySlugs.map(tags.category),
      ];
    case 'schedule':
      return [tags.experience(change.experienceId)];
    case 'spaces':
      return [tags.session(change.sessionId)];
    case 'homeModules':
      return [tags.home];
    case 'pick':
      return [tags.pick(change.slug), tags.home];
    case 'giftGuide':
      return [tags.giftGuide, tags.home];
    case 'categoryCopy':
      return [tags.category(change.slug)];
    case 'neighborhoodCopy':
      return [tags.neighborhood(change.slug)];
    case 'helpArticles':
      return [tags.helpArticles];
    case 'legalDocument':
      return [tags.legalDocument(change.doc)];
    case 'settings':
      return [tags.settings];
  }
}

/** The tags a change invalidates, without repeats and in a stable order. */
export function tagsForChange(change: CacheChange): string[] {
  return [...new Set(tagsFor(change))].sort();
}
