import { tags } from '../cacheTags';
import type { PageCopy } from '../editorial';
import {
  hrefForFilters,
  noFilters,
  type BrowseFilters,
  type BrowseQuery,
} from '../filters';
import { categoryPath, neighborhoodPath } from '../routes';
import {
  browseView,
  type BrowsePage,
  type BrowseView,
  type FormTarget,
} from './browse';

/** The two kinds of editorial page: a category's and a neighborhood's. Their copy is stored by the same kinds. */
export type LandingKind = PageCopy['kind'];

type Named = { slug: string; name: string };

/**
 * The slug the build prerenders. It is not a slug (an underscore is not allowed in one), so the page
 * refuses it before reading anything: a build has no database to ask, and no made-up address may
 * turn into a stored error page.
 */
export const landingPlaceholderSlug = 'not_a_slug';

/** The title of a landing page that has no name to show: its read failed, or the address names nothing. */
export const landingFallbackTitle = 'Things to do in New York';

/** The address of a landing page. */
export function landingPath(kind: LandingKind, slug: string): string {
  return kind === 'category' ? categoryPath(slug) : neighborhoodPath(slug);
}

/** The cache tag that editing this page's copy publishes. */
export function landingTag(kind: LandingKind, slug: string): string {
  return kind === 'category' ? tags.category(slug) : tags.neighborhood(slug);
}

/** The category or neighborhood the address names, or null when the catalog has none by that slug. */
export function landingTarget(
  kind: LandingKind,
  slug: string,
  options: {
    categories: readonly Named[];
    neighborhoods: readonly Named[];
  },
): Named | null {
  const list = kind === 'category' ? options.categories : options.neighborhoods;
  const found = list.find((option) => option.slug === slug);
  return found ? { slug: found.slug, name: found.name } : null;
}

/** The filters of the browse query this page shows: the one category or neighborhood, nothing else. */
export function landingFilters(kind: LandingKind, slug: string): BrowseFilters {
  return kind === 'category'
    ? { ...noFilters, categories: [slug] }
    : { ...noFilters, neighborhoods: [slug] };
}

/** The query the page reads: browse's first page for those filters. */
export function landingQuery(kind: LandingKind, slug: string): BrowseQuery {
  return { filters: landingFilters(kind, slug), after: null };
}

/** The same filters on the browse page, where a guest can add a day, a party size, or more places. */
export function landingBrowseHref(kind: LandingKind, slug: string): string {
  return hrefForFilters(landingFilters(kind, slug));
}

/** The page heading: the editor's words when the copy has a heading, otherwise one made from the name. */
export function landingHeading(
  kind: LandingKind,
  name: string,
  copy: Pick<PageCopy, 'heading'> | null,
): string {
  if (copy?.heading) return copy.heading;
  return kind === 'category'
    ? `${name} experiences in New York`
    : `Things to do in ${name}`;
}

/** What the page puts in the document head. The description is absent until an editor writes one. */
export function landingHead(
  kind: LandingKind,
  name: string,
  copy: Pick<PageCopy, 'heading' | 'metaDescription'> | null,
): { title: string; description: string | null } {
  return {
    title: landingHeading(kind, name, copy),
    description: copy?.metaDescription ?? null,
  };
}

/** The results area: the browse query's first page, drawn as browse draws it. */
export function landingView(
  kind: LandingKind,
  slug: string,
  page: BrowsePage,
): BrowseView {
  // A landing page has no date, so the calendar days browse looks the next day up in are not needed.
  const view = browseView(landingQuery(kind, slug), page, []);
  // The page's filter is its subject, not a filter a guest can take off, so an empty page is not a filtered one.
  return view.state === 'empty'
    ? { state: 'empty', filtered: false, dated: null, wording: 'landing' }
    : view;
}

/** Try again reloads this page, not browse: the failed read was the page's own. */
export function landingErrorView(kind: LandingKind, slug: string): BrowseView {
  const retry: FormTarget = { action: landingPath(kind, slug), fields: [] };
  return { state: 'error', retry, wording: 'landing' };
}
