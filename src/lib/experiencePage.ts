import { durationLabel } from './browse';
import {
  type CancellationTier,
  type Category,
  type GuestExperience,
  type Neighborhood,
} from './catalog';
import { MAX_FULL_REFUND_HOURS } from './cancellation';
import { demoCheckoutPath } from './demoCheckout';
import { formatPrice } from './money';
import type { GuestPhoto } from './photos';
import { photoView, type PhotoView } from './photoViews';
import {
  categoryPath,
  giftCheckoutPath,
  neighborhoodPath,
  privateSessionPath,
} from './routes';

// ---- Words ----

function hoursLabel(hours: number): string {
  return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** The text with its ends trimmed, or null when nothing is left. */
function presentText(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}

/** One entry per non-blank line, so a description written in paragraphs or a list keeps its shape. */
export function textLines(value: string | null): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The most rows "What's included" shows; the rest of a longer list is not drawn. */
export const maxIncludedItems = 20;

export function includedItems(included: string | null): string[] {
  return textLines(included).slice(0, maxIncludedItems);
}

type AgeFields = Pick<GuestExperience, 'ageRule' | 'minAge' | 'maxAge'>;

/** "All ages", "Ages 12 and up", "Ages 5 to 10", "21 and over". A rule missing the age it needs is refused, never guessed. */
export function ageLabel({ ageRule, minAge, maxAge }: AgeFields): string {
  switch (ageRule) {
    case 'all_ages':
      return 'All ages';
    case 'twenty_one_plus':
      return '21 and over';
    case 'minimum_age':
      if (minAge === null) throw new RangeError('minimum_age needs an age');
      return `Ages ${String(minAge)} and up`;
    case 'age_range':
      if (minAge === null || maxAge === null) {
        throw new RangeError('age_range needs two ages');
      }
      return `Ages ${String(minAge)} to ${String(maxAge)}`;
  }
}

type WeatherFields = Pick<
  GuestExperience,
  'outdoor' | 'weatherPolicy' | 'weatherDecisionHours'
>;

/** The one-line weather fact and the paragraph under "Weather", or null for an indoor experience (PRD-12). */
export function weatherTerms({
  outdoor,
  weatherPolicy,
  weatherDecisionHours,
}: WeatherFields): { fact: string; detail: string } | null {
  if (!outdoor || weatherPolicy === null) return null;
  if (weatherPolicy === 'rain_or_shine') {
    return {
      fact: 'Runs rain or shine',
      detail: 'This experience runs rain or shine.',
    };
  }
  if (weatherDecisionHours === null) {
    throw new RangeError('decided_before_start needs its hours');
  }
  const before = hoursLabel(weatherDecisionHours);
  return {
    fact: `Weather call ${before} before start`,
    detail: `Go or no-go is decided ${before} before start. If it's off, you're refunded in full and emailed right away.`,
  };
}

/**
 * How long before the start a guest can still cancel, in the tier's own words: whole days from two
 * up, hours otherwise ("24 hours" stays hours, as the design shows it).
 */
function windowLabel(hours: number): string {
  const day = 24;
  return hours >= 2 * day && hours % day === 0
    ? `${String(hours / day)} days`
    : hoursLabel(hours);
}

/**
 * What the page says about cancelling, from the experience's tier (PRD-10, PRD-46). It is stated
 * before any date is chosen, so it names the window; the deadline for one session comes from
 * `cancellationWindow` when a session is picked. A tier outside 0 to a year is refused, as there.
 */
export function cancellationTerms(
  tier: Pick<CancellationTier, 'fullRefundHoursBefore'>,
): { fact: string; detail: string } {
  const hours = tier.fullRefundHoursBefore;
  if (
    !Number.isSafeInteger(hours) ||
    hours < 0 ||
    hours > MAX_FULL_REFUND_HOURS
  ) {
    throw new RangeError('The cancellation window is out of range');
  }
  const refunded =
    'If the host or the weather cancels, you get everything back.';
  if (hours === 0) {
    return {
      fact: 'Free cancellation until it starts',
      detail: `Free cancellation until the experience starts. ${refunded}`,
    };
  }
  const window = windowLabel(hours);
  return {
    fact: `Free cancellation up to ${window} before`,
    detail: `Free cancellation up to ${window} before start. After that, no refund. ${refunded}`,
  };
}

// ---- Prices ----

export type PriceLine = { amount: string; unit: string };

const kindOrder = { adult: 0, child: 1 } as const;

/**
 * One line per price option, adults first. A lone price reads "per person", as the cards do; with
 * a second, each line names who it is for. A price of nothing reads "Free", as when an adult
 * comes along with a child at no charge.
 */
export function priceLines(
  options: GuestExperience['priceOptions'],
): PriceLine[] {
  const sorted = options.toSorted(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind],
  );
  return sorted.map((option) => ({
    amount: option.priceMinor === 0 ? 'Free' : formatPrice(option.priceMinor),
    unit: sorted.length === 1 ? 'per person' : `per ${option.kind}`,
  }));
}

// ---- Where ----

export type Place = {
  category: Pick<Category, 'slug' | 'name'>;
  neighborhood: Pick<Neighborhood, 'slug' | 'name'>;
};

/** The category and neighborhood the experience belongs to. A missing one cannot happen under the foreign keys, so it is refused. */
export function placeOf(
  experience: Pick<GuestExperience, 'categoryId' | 'neighborhoodId'>,
  categories: readonly Category[],
  neighborhoods: readonly Neighborhood[],
): Place {
  const category = categories.find(({ id }) => id === experience.categoryId);
  const neighborhood = neighborhoods.find(
    ({ id }) => id === experience.neighborhoodId,
  );
  if (!category || !neighborhood) {
    throw new RangeError(
      'The experience names a category or neighborhood that is not listed',
    );
  }
  return {
    category: { slug: category.slug, name: category.name },
    neighborhood: { slug: neighborhood.slug, name: neighborhood.name },
  };
}

/** The most of the meeting point's first sentence a Maps search takes; a longer one is no address. */
export const maxMapsQueryLength = 200;

/**
 * A Maps search for the meeting point (PRD-09), or null when there is none or its first sentence
 * is too long to be an address. Only the first sentence is searched: what follows ("The exact
 * door is in your confirmation.") is a note to the guest, not a place.
 */
export function mapsHref(meetingPoint: string | null): string | null {
  const text = presentText(meetingPoint);
  if (text === null) return null;
  const stop = text.indexOf('. ');
  const first = (stop === -1 ? text : text.slice(0, stop)).replace(/\.$/, '');
  if (first === '' || first.length > maxMapsQueryLength) return null;
  const query = encodeURIComponent(`${first}, New York`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

// ---- The gallery ----

/** Photos the desktop grid shows before "See all": the lead and the two beside it. */
export const galleryGridPhotos = 3;

/** How many photos the grid is laid out for; four or more share one layout, with the rest behind "See all". */
type GalleryLayout = 'none' | 'one' | 'two' | 'three' | 'many';

type GalleryPhoto = {
  photo: PhotoView;
  /** The one photo fetched ahead of the rest. */
  isLead: boolean;
  /** "2 of 5" on a phone, or null for a lone photo, which has no place in a set. */
  counter: string | null;
};

export type GalleryView = {
  layout: GalleryLayout;
  /** Every photo, in order; the grid draws the first few and the strip all of them. */
  photos: GalleryPhoto[];
  /** The photos behind "See all". */
  more: PhotoView[];
  /** "See all 15 photos", or null when the grid already shows every photo. */
  seeAllLabel: string | null;
};

function layoutFor(count: number): GalleryLayout {
  switch (count) {
    case 0:
      return 'none';
    case 1:
      return 'one';
    case 2:
      return 'two';
    case 3:
      return 'three';
    default:
      return 'many';
  }
}

/** How the photos are laid out and labelled: the lead, each photo's place in the set, and what sits behind "See all". */
export function galleryView(photos: readonly PhotoView[]): GalleryView {
  const count = photos.length;
  const more = photos.slice(galleryGridPhotos);
  return {
    layout: layoutFor(count),
    photos: photos.map((photo, index) => ({
      photo,
      isLead: index === 0,
      counter: count > 1 ? `${String(index + 1)} of ${String(count)}` : null,
    })),
    more,
    seeAllLabel: more.length > 0 ? `See all ${String(count)} photos` : null,
  };
}

// ---- The page ----

export type KeyFactIcon =
  'place' | 'duration' | 'age' | 'weather' | 'cancellation';
type KeyFact = { icon: KeyFactIcon; text: string };

type ExperienceBadge = {
  tone: 'green' | 'yellow' | 'pink';
  label: string;
  icon?: 'outdoor';
};

export type ExperiencePageView = {
  title: string;
  breadcrumb: { label: string; href: string }[];
  badges: ExperienceBadge[];
  /** Where, how long, and who for, in one line under the title on a wide screen. */
  summary: string;
  prices: PriceLine[];
  keyFacts: KeyFact[];
  gallery: GalleryView;
  about: string[];
  included: string[];
  host: { name: string; initial: string; description: string | null };
  meeting: { text: string; mapsHref: string | null } | null;
  accessibility: string | null;
  weather: string | null;
  cancellation: string;
  /** Goes to the gift checkout, or null while gifts are switched off. */
  giftHref: string | null;
  /** Goes to the checkout. TODO(U-041): replaced by the booking bar and panel, which hold a session first. */
  bookHref: string;
  privateSessionHref: string;
};

export type ExperiencePageInput = {
  experience: GuestExperience;
  photos: readonly GuestPhoto[];
  place: Place;
  giftsEnabled: boolean;
};

function badgesFor(experience: GuestExperience): ExperienceBadge[] {
  const badges: ExperienceBadge[] = [];
  if (experience.outdoor) {
    badges.push({ tone: 'green', label: 'Outdoor', icon: 'outdoor' });
  }
  if (experience.ageRule === 'twenty_one_plus') {
    badges.push({ tone: 'pink', label: '21+' });
  }
  if (experience.priceOptions.some((option) => option.kind === 'child')) {
    badges.push({ tone: 'yellow', label: 'Kids' });
  }
  return badges;
}

/**
 * Everything the experience page says, decided in one place so the page itself only draws it.
 * Null for a guide entry: it has its own page and is not bookable here. The gallery is in the
 * order staff set, whatever order the photos arrive in.
 */
export function buildExperiencePage(
  input: ExperiencePageInput,
): ExperiencePageView | null {
  const { experience, photos, place, giftsEnabled } = input;
  if (experience.status === 'guide_only') return null;

  const cancellation = cancellationTerms(experience.cancellationTier);
  const weather = weatherTerms(experience);
  const keyFacts: KeyFact[] = [
    { icon: 'place', text: place.neighborhood.name },
    ...(experience.durationMinutes === null
      ? []
      : [
          {
            icon: 'duration' as const,
            text: durationLabel(experience.durationMinutes),
          },
        ]),
    { icon: 'age', text: ageLabel(experience) },
    ...(weather ? [{ icon: 'weather' as const, text: weather.fact }] : []),
    { icon: 'cancellation', text: cancellation.fact },
  ];

  const meetingText = presentText(experience.meetingPoint);
  return {
    title: experience.name,
    breadcrumb: [
      {
        label: place.neighborhood.name,
        href: neighborhoodPath(place.neighborhood.slug),
      },
      { label: place.category.name, href: categoryPath(place.category.slug) },
    ],
    badges: badgesFor(experience),
    summary: keyFacts
      .filter(
        ({ icon }) => icon === 'place' || icon === 'duration' || icon === 'age',
      )
      .map(({ text }) => text)
      .join(' · '),
    prices: priceLines(experience.priceOptions),
    keyFacts,
    gallery: galleryView(
      photos
        .toSorted((a, b) => a.position - b.position)
        .map((photo) => photoView(photo)),
    ),
    about: textLines(experience.description),
    included: includedItems(experience.included),
    host: {
      name: experience.host.name,
      initial: Array.from(experience.host.name)[0]?.toUpperCase() ?? '',
      description: presentText(experience.host.description),
    },
    meeting:
      meetingText === null
        ? null
        : { text: meetingText, mapsHref: mapsHref(meetingText) },
    accessibility: presentText(experience.accessibilityNotes),
    weather: weather?.detail ?? null,
    cancellation: cancellation.detail,
    giftHref: giftsEnabled ? giftCheckoutPath(experience.id) : null,
    bookHref: demoCheckoutPath(experience.id),
    privateSessionHref: privateSessionPath,
  };
}

export const maxMetaDescriptionLength = 160;

const trailingPunctuation = new Set([' ', '\t', '.', ',', ';', ':']);

function withoutTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && trailingPunctuation.has(text.charAt(end - 1))) end--;
  return text.slice(0, end);
}

/** The text a search result shows under the title: the description's opening, cut at a word, or a plain line when there is none. */
export function metaDescription(
  experience: Pick<GuestExperience, 'name' | 'description'>,
  neighborhoodName: string,
): string {
  const [opening] = textLines(experience.description);
  if (opening === undefined) {
    return `${experience.name} in ${neighborhoodName}, on Ramble.`;
  }
  if (opening.length <= maxMetaDescriptionLength) return opening;
  const cut = opening.slice(0, maxMetaDescriptionLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${withoutTrailingPunctuation(lastSpace > 0 ? cut.slice(0, lastSpace) : cut)}…`;
}

export const fallbackTitle = 'Experience';

/**
 * The title and description for the page's head. A guide entry or an experience that is not there
 * gets the plain title and no description: its page is not this one, and what it says is not ours to state.
 */
export function experienceHead(
  data: Pick<ExperiencePageInput, 'experience' | 'place'> | null,
): { title: string; description: string | null } {
  if (data === null || data.experience.status === 'guide_only') {
    return { title: fallbackTitle, description: null };
  }
  return {
    title: data.experience.name,
    description: metaDescription(data.experience, data.place.neighborhood.name),
  };
}
