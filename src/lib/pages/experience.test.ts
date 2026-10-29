import { describe, expect, it } from 'vitest';
import type { Category, Neighborhood } from '../catalog';
import { demoCheckoutPath } from '../demoCheckout';
import {
  ageLabel,
  buildExperiencePage,
  cancellationTerms,
  experienceHead,
  galleryGridPhotos,
  galleryView,
  includedItems,
  mapsHref,
  maxIncludedItems,
  maxMapsQueryLength,
  maxMetaDescriptionLength,
  metaDescription,
  placeOf,
  priceLines,
  weatherTerms,
  type ExperiencePageInput,
} from './experience';
import { experience, id, place } from './experience.fixtures';
import type { GuestPhoto } from '../photos';

// Behaviours under test, one per decision, branch or risk:
// - an age rule reads in words, and a rule missing the age it needs is refused rather than guessed
// - an indoor experience has no weather terms; rain or shine and a weather call each read their own way; a call with no hours is refused
// - cancellation names the window in hours, or in days from two up, and a window outside 0 to a year is refused
// - prices read per person when alone and per adult and per child when two, adults first, and nothing reads Free
// - the place is the category and neighborhood by ID, and one that is not listed is refused
// - a Maps search takes the first sentence of the meeting point, and none is made for a blank or an overlong one
// - the included list is one row per line, blank lines dropped, at most the limit
// - a guide entry is not this page; a bookable one shows its facts in order and leaves out what it does not have
// - the badges: outdoor, 21+, kids; each only when it applies
// - gifts switched off leave the gift entry out; the private-session entry stays
// - the gallery is in the order staff set; a blank text section is left out
// - the gallery layout follows the photo count (none, one, two, three, many); only the first photo leads; each photo of a set says its place and a lone one says nothing; "See all" and the photos behind it appear only past the grid
// - the head: a plain title for a guide entry or a missing experience, the name and an opening otherwise; the opening is cut at a word

const photo = (position: number): GuestPhoto => ({
  id: id(100 + position),
  experienceId: id(1),
  position,
  url: `https://store.example/public/photos/${String(position)}.jpg`,
  width: 1600,
  height: 1000,
  decorative: false,
  altText: `Photo ${String(position)}`,
  blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
});

const build = (overrides: Partial<ExperiencePageInput> = {}) =>
  buildExperiencePage({
    experience: experience(),
    photos: [],
    place,
    giftsEnabled: true,
    ...overrides,
  });

describe('ageLabel', () => {
  it.each([
    [{ ageRule: 'all_ages', minAge: null, maxAge: null }, 'All ages'],
    [{ ageRule: 'twenty_one_plus', minAge: null, maxAge: null }, '21 and over'],
    [{ ageRule: 'minimum_age', minAge: 12, maxAge: null }, 'Ages 12 and up'],
    [{ ageRule: 'age_range', minAge: 5, maxAge: 10 }, 'Ages 5 to 10'],
  ] as const)('reads %j as %s', (rule, label) => {
    expect(ageLabel(rule)).toBe(label);
  });

  it.each([
    { ageRule: 'minimum_age', minAge: null, maxAge: null },
    { ageRule: 'age_range', minAge: 5, maxAge: null },
    { ageRule: 'age_range', minAge: null, maxAge: 10 },
  ] as const)('refuses %j', (rule) => {
    expect(() => ageLabel(rule)).toThrow(RangeError);
  });
});

describe('weatherTerms', () => {
  it('has none for an indoor experience', () => {
    expect(
      weatherTerms({
        outdoor: false,
        weatherPolicy: null,
        weatherDecisionHours: null,
      }),
    ).toBeNull();
  });

  it('says an outdoor experience runs rain or shine', () => {
    expect(
      weatherTerms({
        outdoor: true,
        weatherPolicy: 'rain_or_shine',
        weatherDecisionHours: null,
      }),
    ).toEqual({
      fact: 'Runs rain or shine',
      detail: 'This experience runs rain or shine.',
    });
  });

  it.each([
    [3, '3 hours'],
    [1, '1 hour'],
  ])('names a call %i hours before start as %s', (hours, phrase) => {
    const terms = weatherTerms({
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: hours,
    });
    expect(terms?.fact).toBe(`Weather call ${phrase} before start`);
    expect(terms?.detail).toContain(`decided ${phrase} before start`);
  });

  it('refuses a weather call with no hours', () => {
    expect(() =>
      weatherTerms({
        outdoor: true,
        weatherPolicy: 'decided_before_start',
        weatherDecisionHours: null,
      }),
    ).toThrow(RangeError);
  });
});

describe('cancellationTerms', () => {
  it.each([
    [1, '1 hour'],
    [24, '24 hours'],
    [36, '36 hours'],
    [48, '2 days'],
    [168, '7 days'],
  ])('names a window of %i hours as %s', (hours, window) => {
    const terms = cancellationTerms({ fullRefundHoursBefore: hours });
    expect(terms.fact).toBe(`Free cancellation up to ${window} before`);
    expect(terms.detail).toBe(
      `Free cancellation up to ${window} before start. After that, no refund. If the host or the weather cancels, you get everything back.`,
    );
  });

  it('reads a window of nothing as free until the start', () => {
    expect(cancellationTerms({ fullRefundHoursBefore: 0 })).toEqual({
      fact: 'Free cancellation until it starts',
      detail:
        'Free cancellation until the experience starts. If the host or the weather cancels, you get everything back.',
    });
  });

  it.each([-1, 1.5, 24 * 365 + 1, Number.NaN])('refuses %s hours', (hours) => {
    expect(() => cancellationTerms({ fullRefundHoursBefore: hours })).toThrow(
      RangeError,
    );
  });

  it('takes the longest window', () => {
    expect(
      cancellationTerms({ fullRefundHoursBefore: 24 * 365 }).fact,
    ).toContain('365 days');
  });
});

describe('priceLines', () => {
  const option = (kind: 'adult' | 'child', priceMinor: number) => ({
    id: id(kind === 'adult' ? 10 : 11),
    experienceId: id(1),
    kind,
    priceMinor,
    usesSpace: true,
  });

  it('reads a lone price per person', () => {
    expect(priceLines([option('adult', 6500)])).toEqual([
      { amount: '$65', unit: 'per person' },
    ]);
  });

  it('keeps the cents of a price that has them', () => {
    expect(priceLines([option('adult', 1250)])[0]?.amount).toBe('$12.50');
  });

  it('names who each of two prices is for, adults first, and reads nothing as Free', () => {
    expect(priceLines([option('child', 4500), option('adult', 0)])).toEqual([
      { amount: 'Free', unit: 'per adult' },
      { amount: '$45', unit: 'per child' },
    ]);
  });

  it('has no line when there is no price', () => {
    expect(priceLines([])).toEqual([]);
  });
});

describe('placeOf', () => {
  const categories: Category[] = [
    { id: id(3), slug: 'outdoors', name: 'Outdoors' },
    { id: id(30), slug: 'cooking', name: 'Cooking' },
  ];
  const neighborhoods: Neighborhood[] = [
    { id: id(4), slug: 'tribeca', name: 'Tribeca' },
  ];

  it('finds the category and neighborhood by ID', () => {
    expect(placeOf(experience(), categories, neighborhoods)).toEqual(place);
  });

  it('refuses an experience whose category or neighborhood is not listed', () => {
    expect(() => placeOf(experience(), [], neighborhoods)).toThrow(RangeError);
    expect(() => placeOf(experience(), categories, [])).toThrow(RangeError);
  });
});

describe('mapsHref', () => {
  it('searches the first sentence of the meeting point, in New York', () => {
    expect(
      mapsHref(
        'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
      ),
    ).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Pier 26 boathouse, Tribeca, New York')}`,
    );
  });

  it('drops the full stop of a single sentence', () => {
    expect(mapsHref('Wheelhouse Kids Studio, Williamsburg.')).toContain(
      encodeURIComponent('Wheelhouse Kids Studio, Williamsburg, New York'),
    );
  });

  it('encodes what would otherwise end the query', () => {
    expect(mapsHref('A&B #1')).toContain(
      encodeURIComponent('A&B #1, New York'),
    );
  });

  const searchFor = (place: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, New York`)}`;

  it.each([
    ['W. 23rd St. The door is on the left.', 'W. 23rd St'],
    ['St. Marks Pl', 'St. Marks Pl'],
    ['St. Marks Pl. Ring the bell.', 'St. Marks Pl'],
    ['Meet at St. Marks Pl', 'Meet at St. Marks Pl'],
    ['Meet at St. Marks Pl. Ring the bell.', 'Meet at St. Marks Pl'],
    ['Near St. Marks Pl', 'Near St. Marks Pl'],
    ['Pier 57, St. Johns Pl', 'Pier 57, St. Johns Pl'],
    ['Hudson St. The door is on the left.', 'Hudson St'],
    ['Park Ave. Meet at the gate.', 'Park Ave'],
    ['Union Sq. Meet at the fountain.', 'Union Sq'],
    ['Meet at Gate B. The desk is open.', 'Meet at Gate B'],
    ['Bleecker St. and Mott St. Ring bell.', 'Bleecker St. and Mott St'],
    ['Ave. B and E 4th St.', 'Ave. B and E 4th St'],
    // Pinned limit: a single letter after a street reads as "Ave. B", so the note stays in.
    ['Hudson St. A door', 'Hudson St. A door'],
    ['Ave. B', 'Ave. B'],
    ['Pier 26. A guide will wait there.', 'Pier 26'],
    ['The Cloisters. A staff member opens at 9.', 'The Cloisters'],
    ["Central Park Zoo. I'm in a red hat.", 'Central Park Zoo'],
    ['Pier 26. 5 minutes early please', 'Pier 26'],
    ['Pier 26. 4 people wait.', 'Pier 26'],
    ['Park Ave. 5 is closed', 'Park Ave'],
    ['Ave. 5 is closed', 'Ave. 5 is closed'],
    // Pinned limit: a lowercase next word reads as the same sentence, so this note stays in.
    ['Hudson St. use the side door', 'Hudson St. use the side door'],
    ['Meet at 10 Ave. B', 'Meet at 10 Ave. B'],
    ['Pier 57, 25 11th Ave. Meet at the gate.', 'Pier 57, 25 11th Ave'],
    ['Gate 5. Meet at the sign.', 'Gate 5'],
    ['Pier 26! Look for the flag.', 'Pier 26'],
    ['Where is it? Pier 26.', 'Where is it'],
    [
      'Pier 26, Tribeca\nThe exact door is in your confirmation.',
      'Pier 26, Tribeca',
    ],
    ['Pier 26, \t Tribeca. Ring the bell.', 'Pier 26, Tribeca'],
    ['Pier   26 \t Tribeca', 'Pier 26 Tribeca'],
    ['123 Main St.', '123 Main St'],
  ])('searches the first real sentence of %j', (text, place) => {
    expect(mapsHref(text)).toBe(searchFor(place));
  });

  it('refuses a first sentence that is long before whitespace collapses, without walking on', () => {
    expect(mapsHref(`${'a '.repeat(maxMapsQueryLength * 2)}end.`)).toBeNull();
  });

  it.each([null, '', '   ', '. Only a note'])('makes none for %j', (text) => {
    expect(mapsHref(text)).toBeNull();
  });

  it('takes a first sentence at the limit and refuses one past it', () => {
    expect(mapsHref('a'.repeat(maxMapsQueryLength))).not.toBeNull();
    expect(mapsHref('a'.repeat(maxMapsQueryLength + 1))).toBeNull();
  });
});

describe('includedItems', () => {
  it('has none for no text', () => {
    expect(includedItems('')).toEqual([]);
  });

  it('keeps a sentence as one row', () => {
    expect(includedItems('A kayak, paddle, and a dry bag.')).toEqual([
      'A kayak, paddle, and a dry bag.',
    ]);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: maxIncludedItems + 5 }, (_, n) =>
      String(n),
    ).join('\n');
    expect(includedItems(many)).toHaveLength(maxIncludedItems);
  });
});

describe('buildExperiencePage', () => {
  it('is not the page of a guide entry', () => {
    expect(
      build({
        experience: experience({
          status: 'guide_only',
          linkOutUrl: 'https://host.example/',
        }),
      }),
    ).toBeNull();
  });

  it('shows the facts in order, with the neighborhood, length, ages, weather, and cancellation', () => {
    expect(build()?.keyFacts).toEqual([
      { icon: 'place', text: 'Tribeca' },
      { icon: 'duration', text: '2\u00a0hr' },
      { icon: 'age', text: 'Ages 14 and up' },
      { icon: 'weather', text: 'Weather call 3 hours before start' },
      { icon: 'cancellation', text: 'Free cancellation up to 24 hours before' },
    ]);
  });

  it('leaves out the length and weather it does not have', () => {
    const view = build({
      experience: experience({
        durationMinutes: null,
        outdoor: false,
        weatherPolicy: null,
        weatherDecisionHours: null,
      }),
    });

    expect(view?.keyFacts.map(({ icon }) => icon)).toEqual([
      'place',
      'age',
      'cancellation',
    ]);
    expect(view?.weather).toBeNull();
    expect(view?.summary).toBe('Tribeca · Ages 14 and up');
  });

  it('puts where, how long, and who for on one line', () => {
    expect(build()?.summary).toBe('Tribeca · 2\u00a0hr · Ages 14 and up');
  });

  it('links the breadcrumb to the neighborhood and the category', () => {
    expect(build()?.breadcrumb).toEqual([
      { label: 'Tribeca', href: '/new-york/neighborhoods/tribeca' },
      { label: 'Outdoors', href: '/new-york/things-to-do/outdoors' },
    ]);
  });

  it('badges an outdoor experience', () => {
    expect(build()?.badges).toEqual([
      { tone: 'green', label: 'Outdoor', icon: 'outdoor' },
    ]);
  });

  it('badges 21+ and kids, and nothing for an ordinary indoor experience', () => {
    const indoor = {
      outdoor: false,
      weatherPolicy: null,
      weatherDecisionHours: null,
    } as const;
    expect(
      build({
        experience: experience({
          ...indoor,
          ageRule: 'twenty_one_plus',
          minAge: null,
        }),
      })?.badges,
    ).toEqual([{ tone: 'pink', label: '21+' }]);
    expect(
      build({
        experience: experience({
          ...indoor,
          priceOptions: [
            {
              id: id(6),
              experienceId: id(1),
              kind: 'child',
              priceMinor: 4500,
              usesSpace: true,
            },
          ],
        }),
      })?.badges,
    ).toEqual([{ tone: 'yellow', label: 'Kids' }]);
    expect(build({ experience: experience(indoor) })?.badges).toEqual([]);
  });

  it('books through the demo checkout with the experience id', () => {
    expect(build()?.bookHref).toBe(demoCheckoutPath(id(1)));
  });

  it('goes to the gift checkout when gifts are on, and has no gift entry when they are off', () => {
    expect(build()?.giftHref).toBe(`/gifts/checkout/${id(1)}`);
    const off = build({ giftsEnabled: false });
    expect(off?.giftHref).toBeNull();
    expect(off?.privateSessionHref).toBe('/contact');
  });

  it('orders the gallery by position, whatever order the photos arrive in', () => {
    expect(
      build({
        photos: [photo(2), photo(0), photo(1)],
      })?.gallery.photos.map(({ photo: { alt } }) => alt),
    ).toEqual(['Photo 0', 'Photo 1', 'Photo 2']);
  });

  it('leaves out each text section that is blank', () => {
    const view = build({
      experience: experience({
        description: null,
        included: '  ',
        meetingPoint: '\n',
        accessibilityNotes: '',
      }),
    });

    expect(view).toMatchObject({
      about: [],
      included: [],
      meeting: null,
      accessibility: null,
    });
  });

  it('gives the meeting point a Maps link, and the host an initial and a trimmed description', () => {
    const view = build({
      experience: experience({
        host: {
          id: id(2),
          slug: 'h',
          name: 'élan Studio',
          description: '   ',
        },
      }),
    });

    expect(view?.meeting?.mapsHref).toContain('maps');
    expect(view?.host).toEqual({
      name: 'élan Studio',
      initial: 'É',
      description: null,
    });
  });

  it('states the cancellation terms of the tier', () => {
    expect(build()?.cancellation).toContain('up to 24 hours before start');
  });

  it('lists the prices', () => {
    expect(build()?.prices).toEqual([{ amount: '$65', unit: 'per person' }]);
  });
});

describe('metaDescription', () => {
  const named = (description: string | null) => ({
    name: 'Sunset kayak',
    description,
  });

  it('is the opening line of the description', () => {
    expect(metaDescription(named('Paddle out.\nSecond line.'), 'Tribeca')).toBe(
      'Paddle out.',
    );
  });

  it('keeps a description at the limit whole', () => {
    const text = 'a'.repeat(maxMetaDescriptionLength);
    expect(metaDescription(named(text), 'Tribeca')).toBe(text);
  });

  it('cuts a longer one at a word and ends it with an ellipsis', () => {
    const text = `${'word '.repeat(40)}end`;
    const cut = metaDescription(named(text), 'Tribeca');
    expect(cut.length).toBeLessThanOrEqual(maxMetaDescriptionLength);
    expect(cut.endsWith('word…')).toBe(true);
  });

  it('cuts a long word that has no space where it must', () => {
    const cut = metaDescription(
      named('a'.repeat(maxMetaDescriptionLength + 10)),
      'Tribeca',
    );
    expect(cut).toBe(`${'a'.repeat(maxMetaDescriptionLength - 1)}…`);
  });

  it('says what and where when there is no description', () => {
    expect(metaDescription(named(null), 'Tribeca')).toBe(
      'Sunset kayak in Tribeca, on Ramble.',
    );
  });
});

describe('experienceHead', () => {
  it('names the experience and describes it', () => {
    expect(experienceHead({ experience: experience(), place })).toEqual({
      title: 'Sunset kayak on the Hudson',
      description: 'Paddle out as the light goes gold.',
    });
  });

  it.each([
    ['an experience that is not there', null],
    [
      'a guide entry',
      {
        experience: experience({
          status: 'guide_only',
          linkOutUrl: 'https://host.example/',
        }),
        place,
      },
    ],
  ])('gives the plain title for %s', (_name, data) => {
    expect(experienceHead(data)).toEqual({
      title: 'Experience',
      description: null,
    });
  });
});

describe('galleryView', () => {
  const views = (count: number) =>
    Array.from({ length: count }, (_, n) => ({
      src: `https://store.example/${String(n)}.jpg`,
      width: 1600,
      height: 1000,
      alt: `Photo ${String(n)}`,
      blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    }));

  it.each([
    [0, 'none'],
    [1, 'one'],
    [2, 'two'],
    [3, 'three'],
    [4, 'many'],
    [20, 'many'],
  ])('lays out %i photos as %s', (count, layout) => {
    expect(galleryView(views(count)).layout).toBe(layout);
  });

  it('marks only the first photo as the lead, and keeps the order', () => {
    const gallery = galleryView(views(3));

    expect(gallery.photos.map(({ isLead }) => isLead)).toEqual([
      true,
      false,
      false,
    ]);
    expect(gallery.photos.map(({ photo: { alt } }) => alt)).toEqual([
      'Photo 0',
      'Photo 1',
      'Photo 2',
    ]);
  });

  it('says where each photo of a set is, and nothing for a lone photo', () => {
    expect(galleryView(views(3)).photos.map(({ counter }) => counter)).toEqual([
      '1 of 3',
      '2 of 3',
      '3 of 3',
    ]);
    expect(galleryView(views(1)).photos.map(({ counter }) => counter)).toEqual([
      null,
    ]);
    expect(galleryView(views(0)).photos).toEqual([]);
  });

  it.each([0, 1, 2, galleryGridPhotos])(
    'offers no "See all" and holds nothing back for %i photos',
    (count) => {
      const gallery = galleryView(views(count));
      expect(gallery.seeAllLabel).toBeNull();
      expect(gallery.more).toEqual([]);
    },
  );

  it.each([4, 5, 15, 20])(
    'puts every photo after the grid behind "See all %i photos"',
    (count) => {
      const gallery = galleryView(views(count));
      expect(gallery.seeAllLabel).toBe(`See all ${String(count)} photos`);
      expect(gallery.more.map(({ alt }) => alt)).toEqual(
        views(count)
          .slice(galleryGridPhotos)
          .map(({ alt }) => alt),
      );
      expect(gallery.photos).toHaveLength(count);
    },
  );
});
