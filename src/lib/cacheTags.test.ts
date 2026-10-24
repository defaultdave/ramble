import { describe, expect, it } from 'vitest';
import {
  type CacheChange,
  tagsForChange,
  tagsForChanges,
  tags,
} from './cacheTags';

describe('tags', () => {
  it.each([
    [tags.experience('e1'), 'experience:e1'],
    [tags.guideEntry('e1'), 'guide-entry:e1'],
    [tags.category('kayaking'), 'category:kayaking'],
    [tags.neighborhood('red-hook'), 'neighborhood:red-hook'],
    [tags.pick('summer'), 'pick:summer'],
    [tags.legalDocument('terms'), 'legal:terms'],
    [tags.session('s1'), 'session:s1'],
  ])('builds %s', (actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('never gives two entities the same tag for the same id', () => {
    expect(tags.experience('1')).not.toBe(tags.guideEntry('1'));
    expect(tags.category('1')).not.toBe(tags.neighborhood('1'));
  });
});

describe('tagsForChange', () => {
  const listing: CacheChange = {
    kind: 'listing',
    id: 'e1',
    categorySlugs: ['kayaking', 'outdoors'],
    neighborhoodSlug: 'red-hook',
  };

  it.each<[string, CacheChange, string[]]>([
    [
      'a listing reaches its pages, its category and neighborhood listings, the catalog, and home',
      listing,
      [
        'catalog',
        'category:kayaking',
        'category:outdoors',
        'experience:e1',
        'guide-entry:e1',
        'home',
        'neighborhood:red-hook',
      ],
    ],
    [
      'a schedule change reaches the experience page only',
      { kind: 'schedule', experienceId: 'e1' },
      ['experience:e1'],
    ],
    [
      'a booking change reaches one session and nothing else',
      { kind: 'spaces', sessionId: 's1' },
      ['session:s1'],
    ],
    ['home modules', { kind: 'homeModules' }, ['home']],
    [
      'a Pick reaches its page and home',
      { kind: 'pick', slug: 'summer' },
      ['home', 'pick:summer'],
    ],
    [
      'the gift guide reaches its page and home',
      { kind: 'giftGuide' },
      ['gift-guide', 'home'],
    ],
    [
      'category copy',
      { kind: 'categoryCopy', slug: 'kayaking' },
      ['category:kayaking'],
    ],
    [
      'neighborhood copy',
      { kind: 'neighborhoodCopy', slug: 'red-hook' },
      ['neighborhood:red-hook'],
    ],
    ['help articles', { kind: 'helpArticles' }, ['help-articles']],
    [
      'a legal document',
      { kind: 'legalDocument', doc: 'terms' },
      ['legal:terms'],
    ],
    ['settings', { kind: 'settings' }, ['settings']],
  ])('%s', (_name, change, expected) => {
    expect(tagsForChange(change)).toEqual(expected);
  });

  it('lists a tag once when a category slug repeats', () => {
    const result = tagsForChange({
      ...listing,
      categorySlugs: ['kayaking', 'kayaking'],
    });

    expect(result.filter((tag) => tag === 'category:kayaking')).toHaveLength(1);
  });

  it('lists a listing with no categories without a category tag', () => {
    const result = tagsForChange({ ...listing, categorySlugs: [] });

    expect(result.some((tag) => tag.startsWith('category:'))).toBe(false);
  });
});

describe('tagsForChanges', () => {
  it('joins the tags of several changes, once each and in order', () => {
    expect(
      tagsForChanges([
        { kind: 'pick', slug: 'summer' },
        { kind: 'giftGuide' },
        { kind: 'homeModules' },
      ]),
    ).toEqual(['gift-guide', 'home', 'pick:summer']);
  });

  it('is empty for no changes', () => {
    expect(tagsForChanges([])).toEqual([]);
  });
});
