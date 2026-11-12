import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import {
  ageRuleLabels,
  buildExperienceChoices,
  desiredPriceOptions,
  experienceColumnsOf,
  isGuestVisible,
  labelledOptions,
  listingChanges,
  newExperienceValues,
  numberInputValue,
  removedPriceFields,
  type ExperienceContent,
} from './experienceEditor';

// Behaviours under test, one per decision, branch or risk:
// - the price options a save writes are the ones with a price, an adult always taking a space and
//   a child as the form says
// - a saved price cannot be taken away, and each price that tried is named
// - the row's columns are the content without the price options
// - only the statuses guests see reach the cache; a move invalidates the old place and the new one
// - the default tier is the one the shared data marks, and none is empty
// - labels and numbers show as the form needs them

const content: ExperienceContent = newExperienceValues({
  categoryId: id(1),
  neighborhoodId: id(2),
  cancellationTierId: id(3),
});

describe('desiredPriceOptions', () => {
  it.each<[string, Partial<ExperienceContent>, unknown[]]>([
    ['no prices', {}, []],
    [
      'an adult price alone',
      { adultPriceMinor: 8500 },
      [{ kind: 'adult', priceMinor: 8500, usesSpace: true }],
    ],
    [
      'both, a child taking no space',
      { adultPriceMinor: 8500, childPriceMinor: 0, childUsesSpace: false },
      [
        { kind: 'adult', priceMinor: 8500, usesSpace: true },
        { kind: 'child', priceMinor: 0, usesSpace: false },
      ],
    ],
  ])('%s', (_label, overrides, expected) => {
    expect(desiredPriceOptions({ ...content, ...overrides })).toEqual(expected);
  });
});

describe('removedPriceFields', () => {
  const priced = { ...content, adultPriceMinor: 8500, childPriceMinor: 4000 };

  it.each<[string, Partial<ExperienceContent>, string[]]>([
    ['nothing changes', {}, []],
    ['a price changes', { adultPriceMinor: 9000 }, []],
    ['the adult price goes', { adultPriceMinor: null }, ['adultPrice']],
    ['the child price goes', { childPriceMinor: null }, ['childPrice']],
    [
      'both go',
      { adultPriceMinor: null, childPriceMinor: null },
      ['adultPrice', 'childPrice'],
    ],
  ])('when %s', (_label, overrides, expected) => {
    expect(removedPriceFields(priced, { ...priced, ...overrides })).toEqual(
      expected,
    );
  });

  it('lets a price be added where there was none', () => {
    expect(
      removedPriceFields(content, { ...content, adultPriceMinor: 8500 }),
    ).toEqual([]);
  });
});

describe('experienceColumnsOf', () => {
  it('keeps every content field but the price options', () => {
    const columns = experienceColumnsOf({
      ...content,
      name: 'Pottery night',
      adultPriceMinor: 8500,
    });

    expect(columns).toMatchObject({
      name: 'Pottery night',
      ageRule: 'all_ages',
    });
    expect(columns).not.toHaveProperty('adultPriceMinor');
    expect(columns).not.toHaveProperty('childPriceMinor');
    expect(columns).not.toHaveProperty('childUsesSpace');
  });
});

describe('isGuestVisible', () => {
  it.each([
    ['draft', false],
    ['in_review', false],
    ['live', true],
    ['paused', false],
    ['guide_only', true],
  ] as const)('%s is %s', (status, visible) => {
    expect(isGuestVisible(status)).toBe(visible);
  });
});

describe('listingChanges', () => {
  const soho = { categorySlug: 'classes', neighborhoodSlug: 'soho' };

  it('is one change when the experience stays where it was', () => {
    expect(listingChanges(id(9), soho, { ...soho })).toEqual([
      {
        kind: 'listing',
        id: id(9),
        categorySlugs: ['classes'],
        neighborhoodSlug: 'soho',
      },
    ]);
  });

  it.each([
    ['category', { ...soho, categorySlug: 'tours' }],
    ['neighborhood', { ...soho, neighborhoodSlug: 'chelsea' }],
  ])('is the old place and the new one when the %s moves', (_label, moved) => {
    const changes = listingChanges(id(9), soho, moved);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      categorySlugs: [soho.categorySlug],
      neighborhoodSlug: soho.neighborhoodSlug,
    });
    expect(changes[1]).toMatchObject({
      categorySlugs: [moved.categorySlug],
      neighborhoodSlug: moved.neighborhoodSlug,
    });
  });
});

describe('the default cancellation tier', () => {
  const tier = (n: number, isDefault: boolean) => ({
    id: id(n),
    key: `tier-${String(n)}`,
    name: `Tier ${String(n)}`,
    fullRefundHoursBefore: 24 * n,
    isDefault,
  });
  const empty = { hosts: [], categories: [], neighborhoods: [], waivers: [] };

  it('is the tier the data marks', () => {
    const choices = buildExperienceChoices({
      ...empty,
      cancellationTiers: [tier(1, false), tier(2, true)],
    });

    expect(choices.defaultCancellationTierId).toBe(id(2));
  });

  it('is empty when none is marked', () => {
    const choices = buildExperienceChoices({
      ...empty,
      cancellationTiers: [tier(1, false)],
    });

    expect(choices.defaultCancellationTierId).toBe('');
  });
});

describe('form display helpers', () => {
  it('turns a label map into options in its order', () => {
    expect(labelledOptions(ageRuleLabels)[0]).toEqual({
      value: 'all_ages',
      label: 'All ages',
    });
    expect(labelledOptions(ageRuleLabels)).toHaveLength(4);
  });

  it.each([
    [null, ''],
    [0, '0'],
    [150, '150'],
  ])('shows %j as %j', (value, shown) => {
    expect(numberInputValue(value)).toBe(shown);
  });
});
