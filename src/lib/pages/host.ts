import { isSlug, type CancellationTier, type GuestHost } from '../catalog';
import { cancellationTerms } from '../cancellation';
import { initialOf, textLines } from '../displayText';
import type { CardExperience } from '../experienceCards';
import { maxAddressLength } from '../routes';
import type { BrowseView } from './browse';
import { collectionView } from './picks';

/** What the host page is built from: the host, their live experiences as cards, and each one's tier. */
export type HostPageData = {
  host: GuestHost;
  experiences: CardExperience[];
  tiers: { experienceId: string; tier: CancellationTier }[];
};

/**
 * The slug the build prerenders. It is not a slug (an underscore is not allowed in one), so the
 * page refuses it before reading anything: a build has no database to ask.
 */
export const hostPlaceholderSlug = 'not_a_slug';

/** A slug within the length an address is held to, so a request for a megabyte path is refused before it reaches a cache key or the database. */
export function isHostSlug(slug: string): boolean {
  return slug.length <= maxAddressLength && isSlug(slug);
}

export const hostFallbackTitle = 'Host';
export const hostNotFoundTitle = 'Host not found';

/** The head: the host's name, and the first paragraph of their about text when there is one. */
export function hostHead(host: GuestHost | null): {
  title: string;
  description: string | null;
} {
  if (host === null) return { title: hostNotFoundTitle, description: null };
  return {
    title: host.name,
    description: textLines(host.description)[0] ?? null,
  };
}

/**
 * What the page says about cancelling. The experiences on the page share one tier's words when
 * every card reads the same, so they are said once; otherwise each experience gets its own line.
 * Only experiences shown as a card count, so the terms never describe one the page hides.
 */
type HostCancellation =
  | { kind: 'shared'; text: string }
  | { kind: 'varies'; rows: { id: string; title: string; text: string }[] };

export type HostPageView = {
  name: string;
  initial: string;
  about: string[];
  /** The live experiences as the browse list shows them, or its empty state. */
  results: BrowseView;
  /** Null when no experience is shown, since the terms belong to experiences. */
  cancellation: HostCancellation | null;
};

export function hostPageView({
  host,
  experiences,
  tiers,
}: HostPageData): HostPageView {
  const results = collectionView(
    tiers.map(({ experienceId }) => ({ experienceId })),
    experiences,
  );
  const cards = results.state === 'results' ? results.cards : [];
  const tierOf = new Map(
    tiers.map(({ experienceId, tier }) => [experienceId, tier]),
  );
  const rows = cards.flatMap(({ id, title }) => {
    const tier = tierOf.get(id);
    return tier ? [{ id, title, terms: cancellationTerms(tier) }] : [];
  });
  const [first] = rows;
  const cancellation: HostCancellation | null =
    first === undefined
      ? null
      : rows.every(({ terms }) => terms.fact === first.terms.fact)
        ? { kind: 'shared', text: first.terms.detail }
        : {
            kind: 'varies',
            rows: rows.map(({ id, title, terms }) => ({
              id,
              title,
              text: terms.fact,
            })),
          };
  return {
    name: host.name,
    initial: initialOf(host.name),
    about: textLines(host.description),
    results,
    cancellation,
  };
}
