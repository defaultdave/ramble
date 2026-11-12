import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import {
  changedExperienceFields,
  experienceContentOf,
  experienceLimits,
  experienceRuleFailures,
  newExperienceValues,
  parseExperienceCreateForm,
  parseExperienceEditForm,
  priceFieldValue,
  type ExperienceFormField,
} from './experienceEditor';

// Behaviours under test, one per decision, branch or risk:
// - a price in the form is read in integer cents, one past the limit or malformed is refused,
//   and a saved price shows back as a person would type it
// - a valid create form yields the content and the host, a blank slug is made from the name, and
//   the host is required
// - an edit form with a blank slug is refused, never renamed, and it carries no host
// - a field a choice makes irrelevant is dropped: age limits, weather hours, the waiver document
// - each rule that ties fields together faults the field the catalog names, and the edit-time
//   check faults a guide-only entry with no link
// - a field over the raw limit is refused unread, each bad field is named in form order
// - a child price needs an adult price; a required waiver needs a document
// - the saved experience becomes the content, and only differing fields are reported as changed

const base: Record<string, string> = {
  hostId: id(1),
  name: 'Pottery night',
  slug: '',
  categoryId: id(2),
  neighborhoodId: id(3),
  cancellationTierId: id(4),
  ageRule: 'all_ages',
  taxTreatment: 'unknown',
};

function formOf(entries: Record<string, string | null> = {}) {
  const merged: Record<string, string | null> = { ...base, ...entries };
  return (name: string) => merged[name] ?? null;
}

function failedFields(entries: Record<string, string | null>) {
  const result = parseExperienceCreateForm(formOf(entries));
  return result.ok ? [] : result.fields;
}

describe('prices in the form', () => {
  const priced = (adultPrice: string) => {
    const result = parseExperienceCreateForm(formOf({ adultPrice }));
    return result.ok ? result.value.adultPriceMinor : result.fields;
  };

  it.each([
    ['12', 1200],
    ['$12.50', 1250],
    ['1,200.00', 120_000],
    ['0', 0],
    ['99999.99', experienceLimits.priceMinor],
  ])('reads %j as %j cents', (text, minor) => {
    expect(priced(text)).toBe(minor);
  });

  it.each(['100000', '12.505', '-1', '1e3', 'free', '12,50', '1,25'])(
    'refuses %j as the adult price',
    (text) => {
      expect(priced(text)).toEqual(['adultPrice']);
    },
  );
});

describe('priceFieldValue', () => {
  it.each([
    [null, ''],
    [0, '0'],
    [1250, '12.50'],
    [8500, '85'],
    [170_000, '1700'],
  ])('%j shows as %j', (minor, shown) => {
    expect(priceFieldValue(minor)).toBe(shown);
  });
});

describe('parseExperienceCreateForm', () => {
  it('reads a minimal form into the content and the host, with the slug made from the name', () => {
    const result = parseExperienceCreateForm(formOf());

    expect(result).toEqual({
      ok: true,
      value: {
        ...newExperienceValues({
          categoryId: id(2),
          neighborhoodId: id(3),
          cancellationTierId: id(4),
        }),
        hostId: id(1),
        name: 'Pottery night',
        slug: 'pottery-night',
        childUsesSpace: false,
      },
    });
  });

  it('reads every field, lower-casing the ids and reading the prices in cents', () => {
    const result = parseExperienceCreateForm(
      formOf({
        hostId: id(1).toUpperCase(),
        slug: 'wheel-night',
        description: ' Throw a bowl. ',
        meetingPoint: 'The studio door',
        included: 'Clay and tools',
        accessibilityNotes: 'Step-free',
        durationMinutes: '150',
        outdoor: 'on',
        weatherPolicy: 'decided_before_start',
        weatherDecisionHours: '6',
        ageRule: 'age_range',
        minAge: '8',
        maxAge: '14',
        taxTreatment: 'taxable',
        waiverRequired: 'on',
        waiverDocumentId: id(5),
        linkOutUrl: 'https://example.com/guide',
        affiliateUrl: 'https://example.com/aff',
        adultPrice: '85',
        childPrice: '$40.50',
        childUsesSpace: 'on',
      }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        hostId: id(1),
        name: 'Pottery night',
        slug: 'wheel-night',
        description: 'Throw a bowl.',
        meetingPoint: 'The studio door',
        included: 'Clay and tools',
        accessibilityNotes: 'Step-free',
        durationMinutes: 150,
        categoryId: id(2),
        neighborhoodId: id(3),
        cancellationTierId: id(4),
        outdoor: true,
        weatherPolicy: 'decided_before_start',
        weatherDecisionHours: 6,
        ageRule: 'age_range',
        minAge: 8,
        maxAge: 14,
        taxTreatment: 'taxable',
        waiverRequired: true,
        waiverDocumentId: id(5),
        linkOutUrl: 'https://example.com/guide',
        affiliateUrl: 'https://example.com/aff',
        adultPriceMinor: 8500,
        childPriceMinor: 4050,
        childUsesSpace: true,
      },
    });
  });

  it('refuses a form with no host', () => {
    expect(failedFields({ hostId: null })).toEqual(['hostId']);
  });

  it('drops what a choice makes irrelevant instead of refusing it', () => {
    const result = parseExperienceCreateForm(
      formOf({
        ageRule: 'all_ages',
        minAge: '8',
        maxAge: '12',
        weatherPolicy: 'rain_or_shine',
        weatherDecisionHours: '4',
        waiverDocumentId: id(5),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        minAge: null,
        maxAge: null,
        weatherPolicy: 'rain_or_shine',
        weatherDecisionHours: null,
        waiverRequired: false,
        waiverDocumentId: null,
      },
    });
  });

  it('keeps only the minimum for a minimum age', () => {
    const result = parseExperienceCreateForm(
      formOf({ ageRule: 'minimum_age', minAge: '18', maxAge: '30' }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { minAge: 18, maxAge: null },
    });
  });

  it.each<[string, Record<string, string | null>, ExperienceFormField[]]>([
    ['a blank name', { name: '   ' }, ['name']],
    ['a name over the limit', { name: 'a'.repeat(121) }, ['name']],
    ['a name that makes no slug', { name: '!!!' }, ['slug']],
    ['a typed slug in capitals', { slug: 'Pottery' }, ['slug']],
    ['a typed slug over the limit', { slug: 'a'.repeat(81) }, ['slug']],
    ['no category', { categoryId: null }, ['categoryId']],
    [
      'a malformed neighborhood',
      { neighborhoodId: 'nope' },
      ['neighborhoodId'],
    ],
    ['no tier', { cancellationTierId: null }, ['cancellationTierId']],
    ['an unknown age rule', { ageRule: 'toddlers' }, ['ageRule']],
    ['an unknown tax treatment', { taxTreatment: 'maybe' }, ['taxTreatment']],
    ['a zero duration', { durationMinutes: '0' }, ['durationMinutes']],
    ['a fractional duration', { durationMinutes: '1.5' }, ['durationMinutes']],
    ['a day and a minute', { durationMinutes: '1441' }, ['durationMinutes']],
    [
      'a link that is not http',
      { linkOutUrl: 'ftp://example.com' },
      ['linkOutUrl'],
    ],
    [
      'an affiliate link with credentials',
      { affiliateUrl: 'https://a:b@x.com' },
      ['affiliateUrl'],
    ],
    ['a price with three decimals', { adultPrice: '1.234' }, ['adultPrice']],
    ['a price past the limit', { adultPrice: '100000' }, ['adultPrice']],
    ['a child price with no adult price', { childPrice: '10' }, ['childPrice']],
    [
      'a required waiver with no document',
      { waiverRequired: 'on' },
      ['waiverDocumentId'],
    ],
    [
      'an outdoor experience with no policy',
      { outdoor: 'on' },
      ['weatherPolicy'],
    ],
    [
      'a decided policy with no hours',
      { weatherPolicy: 'decided_before_start' },
      ['weatherDecisionHours'],
    ],
    ['a minimum age with no minimum', { ageRule: 'minimum_age' }, ['minAge']],
    [
      'an age range with no maximum',
      { ageRule: 'age_range', minAge: '8' },
      ['minAge'],
    ],
    [
      'an age range that runs backwards',
      { ageRule: 'age_range', minAge: '12', maxAge: '8' },
      ['maxAge'],
    ],
    ['an age over 120', { ageRule: 'minimum_age', minAge: '121' }, ['minAge']],
  ])('refuses %s', (_label, entries, fields) => {
    expect(failedFields(entries)).toEqual(fields);
  });

  it('names every bad field once, in form order', () => {
    expect(
      failedFields({
        affiliateUrl: 'nope',
        name: '',
        hostId: null,
        categoryId: null,
      }),
    ).toEqual(['hostId', 'name', 'categoryId', 'affiliateUrl']);
  });

  it('refuses a field over the raw limit without reading it', () => {
    const huge = 'a'.repeat(experienceLimits.rawField + 1);

    expect(failedFields({ description: huge })).toEqual(['description']);
  });
});

describe('parseExperienceEditForm', () => {
  it('refuses a blank slug, so an edit never renames silently', () => {
    const result = parseExperienceEditForm(formOf({ slug: '' }));

    expect(result).toEqual({ ok: false, fields: ['slug'] });
  });

  it('reads the content and carries no host', () => {
    const result = parseExperienceEditForm(
      formOf({ slug: 'pottery-night', hostId: id(9) }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && 'hostId' in result.value).toBe(false);
  });
});

describe('experienceRuleFailures', () => {
  const content = newExperienceValues({
    categoryId: id(2),
    neighborhoodId: id(3),
    cancellationTierId: id(4),
  });

  it('faults a guide-only entry with no link and passes the same content as a draft', () => {
    expect(experienceRuleFailures(content, 'guide_only')).toEqual([
      'linkOutUrl',
    ]);
    expect(experienceRuleFailures(content, 'draft')).toEqual([]);
  });

  it('passes a guide-only entry that links out', () => {
    expect(
      experienceRuleFailures(
        { ...content, linkOutUrl: 'https://example.com' },
        'guide_only',
      ),
    ).toEqual([]);
  });
});

describe('experienceContentOf and changedExperienceFields', () => {
  const row = {
    ...newExperienceValues({
      categoryId: id(2),
      neighborhoodId: id(3),
      cancellationTierId: id(4),
    }),
    name: 'Pottery night',
    slug: 'pottery-night',
  };
  const options = [
    { kind: 'adult', priceMinor: 8500, usesSpace: true },
    { kind: 'child', priceMinor: 4000, usesSpace: false },
  ];

  it('reads the two price options into the content', () => {
    expect(experienceContentOf(row, options)).toMatchObject({
      adultPriceMinor: 8500,
      childPriceMinor: 4000,
      childUsesSpace: false,
    });
  });

  it('reads no options as no prices, with a child taking a space', () => {
    expect(experienceContentOf(row, [])).toMatchObject({
      adultPriceMinor: null,
      childPriceMinor: null,
      childUsesSpace: true,
    });
  });

  it('reports no field for identical content', () => {
    const content = experienceContentOf(row, options);

    expect(changedExperienceFields(content, { ...content })).toEqual([]);
  });

  it('reports each differing field in form order', () => {
    const content = experienceContentOf(row, options);

    expect(
      changedExperienceFields(content, {
        ...content,
        childPriceMinor: 4500,
        name: 'Wheel night',
        waiverRequired: true,
      }),
    ).toEqual(['name', 'waiverRequired', 'childPriceMinor']);
  });
});
