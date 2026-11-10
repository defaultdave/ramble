import type { GuestExperience } from '../catalog';
import { textLines } from '../displayText';
import { durationLabel } from '../duration';
import {
  toExperienceCard,
  type CardExperience,
  type ExperienceCard,
} from '../experienceCards';
import { noFilters, type BrowseQuery } from '../filters';
import { photoView, type PhotoView } from '../photoViews';
import type { GuestPhoto } from '../photos';
import type { Place } from './experience';

/** The most bookable experiences the "you can book" module offers. */
export const relatedBookableLimit = 3;

const guideNotFoundTitle = 'Guide entry not found';
export const guideFallbackTitle = 'Guide entry';

export type GuideOutbound = {
  href: string;
  /** True for an affiliate link, which carries `rel=sponsored`. */
  sponsored: boolean;
};

/** The affiliate link when there is one, else the plain link out, else nothing to link to. */
export function chooseOutbound(
  linkOutUrl: string | null,
  affiliateUrl: string | null,
): GuideOutbound | null {
  if (affiliateUrl) return { href: affiliateUrl, sponsored: true };
  return linkOutUrl ? { href: linkOutUrl, sponsored: false } : null;
}

export type GuideEntryView = {
  title: string;
  about: string[];
  hostName: string;
  neighborhoodName: string;
  categoryName: string;
  duration: string | null;
  outbound: GuideOutbound | null;
  /** The entry's cover photo; null shows the empty frame. */
  cover: PhotoView | null;
};

export type GuideEntryInput = {
  experience: GuestExperience;
  photos: readonly GuestPhoto[];
  place: Place;
};

/** What the guide page says, or null when the experience is not a guide-only entry: a live one has its own page. */
export function buildGuideEntry({
  experience,
  photos,
  place,
}: GuideEntryInput): GuideEntryView | null {
  if (experience.status !== 'guide_only') return null;
  const [cover] = photos.toSorted((a, b) => a.position - b.position);
  return {
    title: experience.name,
    about: textLines(experience.description),
    hostName: experience.host.name,
    neighborhoodName: place.neighborhood.name,
    categoryName: place.category.name,
    duration:
      experience.durationMinutes === null
        ? null
        : durationLabel(experience.durationMinutes),
    outbound: chooseOutbound(experience.linkOutUrl, experience.affiliateUrl),
    cover: cover ? photoView(cover) : null,
  };
}

/**
 * The page's title. It names the entry only: what the host says about it is the host's to state,
 * so the head carries no description, as the experience page's does not for a guide entry.
 */
export function guideHead(data: Pick<GuideEntryInput, 'experience'> | null): {
  title: string;
} {
  if (data === null || data.experience.status !== 'guide_only') {
    return { title: guideNotFoundTitle };
  }
  return { title: data.experience.name };
}

/** The first page of browse for the entry's category, the one read the category's own page makes. */
export function relatedQuery(categorySlug: string): BrowseQuery {
  return { filters: { ...noFilters, categories: [categorySlug] }, after: null };
}

/** The bookable cards on that page other than the entry itself, at most `relatedBookableLimit`. */
export function relatedBookableCards(
  items: readonly CardExperience[],
  entryId: string,
): ExperienceCard[] {
  const cards: ExperienceCard[] = [];
  for (const item of items) {
    if (cards.length >= relatedBookableLimit) break;
    if (item.id === entryId || item.status !== 'live') continue;
    const card = toExperienceCard(item);
    if (card) cards.push(card);
  }
  return cards;
}
