import { describe, expect, it } from 'vitest';
import { tagsForChanges, type CacheChange } from './cacheTags';
import {
  CollectionInputSchema,
  HelpArticleInputSchema,
  HomeModulesInputSchema,
  PageCopyInputSchema,
  PageCopySchema,
  RichTextInputSchema,
  RichTextStoredSchema,
  changesWhenSaved,
  collectionChange,
  editorialLimits,
  hasCollectionKindMismatch,
  pageCopyChange,
  publishedAtAfter,
  visibleChange,
  withItems,
} from './editorial';

// Behaviours under test, one per decision, branch or risk:
// - a stored document is refused when it needs repair, or is over the size limit, and a read repairs instead of throwing
// - a text field counts characters the way Postgres does, and refuses blank text and text over its limit
// - a collection refuses a repeated experience, too many entries, an unknown key, and a bad slug
// - a home page refuses a collection on a module kind that shows none, and too many modules
// - a picks module may show a Pick and a gift_guide module the gift guide, and nothing else
// - page copy carries the slug of a category or neighborhood as that table stores it, not the 80-character editorial limit
// - a save invalidates what guests could see before and after, and nothing for a draft that stays one
// - the publication time is stamped on the way to published, kept while published, and cleared as a draft
// - items are grouped under their collection in arrival order
// - the cache change for each content type reaches the tags the pages are tagged with

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function paragraph(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

const baseCollection = {
  kind: 'pick',
  slug: 'summer-on-the-water',
  title: 'Summer on the water',
  summary: null,
  intro: null,
  status: 'draft',
  items: [],
} as const;

describe('rich text fields', () => {
  it('keeps a valid document as written', () => {
    expect(RichTextInputSchema.parse(paragraph('Hello'))).toEqual(
      paragraph('Hello'),
    );
  });

  it.each([
    [
      'a javascript: link',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                ],
              },
            ],
          },
        ],
      },
    ],
    ['an unknown node', { type: 'doc', content: [{ type: 'script' }] }],
    ['a string', 'hello'],
    ['nothing', undefined],
  ])('refuses %s instead of repairing it', (_name, value) => {
    expect(RichTextInputSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a document over the size limit and accepts one at it', () => {
    const overhead = JSON.stringify(paragraph('')).length;
    const atLimit = paragraph(
      'a'.repeat(editorialLimits.richTextBytes - overhead),
    );
    const over = paragraph(
      'a'.repeat(editorialLimits.richTextBytes - overhead + 1),
    );

    expect(RichTextInputSchema.safeParse(atLimit).success).toBe(true);
    expect(RichTextInputSchema.safeParse(over).success).toBe(false);
  });

  it('counts bytes, so multi-byte text reaches the limit sooner', () => {
    const overhead = JSON.stringify(paragraph('')).length;
    const characters =
      Math.ceil((editorialLimits.richTextBytes - overhead) / 3) + 1;

    expect(
      RichTextInputSchema.safeParse(paragraph('€'.repeat(characters))).success,
    ).toBe(false);
  });

  it('repairs a bad stored document on read instead of throwing', () => {
    expect(
      RichTextStoredSchema.parse({
        type: 'doc',
        content: [{ type: 'script' }],
      }),
    ).toEqual({ type: 'doc', content: [] });
    expect(RichTextStoredSchema.parse(null)).toEqual({
      type: 'doc',
      content: [],
    });
  });
});

describe('text fields', () => {
  const titled = (title: string) =>
    CollectionInputSchema.safeParse({ ...baseCollection, title }).success;

  it.each([
    ['one character', 'a', true],
    ['the longest title', 'a'.repeat(editorialLimits.title), true],
    ['one over the longest', 'a'.repeat(editorialLimits.title + 1), false],
    ['an empty title', '', false],
    ['spaces only', '   \n\t', false],
    [
      'emoji, which Postgres counts as one character each',
      '😀'.repeat(editorialLimits.title),
      true,
    ],
    ['one emoji over the limit', '😀'.repeat(editorialLimits.title + 1), false],
  ])('a title of %s is accepted: %s', (_name, title, accepted) => {
    expect(titled(title)).toBe(accepted);
  });

  it.each([
    ['upper case', 'Summer'],
    ['a trailing hyphen', 'summer-'],
    ['a space', 'summer sun'],
    ['empty', ''],
    ['over the limit', 'a'.repeat(editorialLimits.slug + 1)],
  ])('refuses a slug that is %s', (_name, slug) => {
    expect(
      CollectionInputSchema.safeParse({ ...baseCollection, slug }).success,
    ).toBe(false);
  });
});

describe('collection input', () => {
  const item = (n: number) => ({ experienceId: uuid(n), note: null });

  it('accepts a full collection and keeps the entries in order', () => {
    const parsed = CollectionInputSchema.parse({
      ...baseCollection,
      items: [item(2), item(1)],
    });

    expect(parsed.items.map((entry) => entry.experienceId)).toEqual([
      uuid(2),
      uuid(1),
    ]);
  });

  it('refuses an experience that appears twice', () => {
    expect(
      CollectionInputSchema.safeParse({
        ...baseCollection,
        items: [item(1), item(1)],
      }).success,
    ).toBe(false);
  });

  it('refuses more entries than the limit and accepts exactly the limit', () => {
    const entries = (count: number) =>
      Array.from({ length: count }, (_, index) => item(index + 1));

    expect(
      CollectionInputSchema.safeParse({
        ...baseCollection,
        items: entries(editorialLimits.collectionItems),
      }).success,
    ).toBe(true);
    expect(
      CollectionInputSchema.safeParse({
        ...baseCollection,
        items: entries(editorialLimits.collectionItems + 1),
      }).success,
    ).toBe(false);
  });

  it('refuses a field it does not know, such as a publication time', () => {
    expect(
      CollectionInputSchema.safeParse({
        ...baseCollection,
        publishedAt: new Date('2026-10-26T12:00:00Z'),
      }).success,
    ).toBe(false);
  });
});

describe('home modules input', () => {
  const homeModule = (kind: string, collectionId: string | null) => ({
    kind,
    enabled: true,
    heading: null,
    body: null,
    collectionId,
  });

  it.each([
    ['picks', true],
    ['gift_guide', true],
    ['hero_search', false],
    ['category_rail', false],
    ['this_week', false],
    ['reassurance', false],
  ])('a %s module may point at a collection: %s', (kind, allowed) => {
    expect(
      HomeModulesInputSchema.safeParse([homeModule(kind, uuid(1))]).success,
    ).toBe(allowed);
  });

  it('accepts any module without a collection', () => {
    expect(
      HomeModulesInputSchema.safeParse([homeModule('hero_search', null)])
        .success,
    ).toBe(true);
  });

  it('refuses more modules than the limit', () => {
    const modules = Array.from(
      { length: editorialLimits.homeModules + 1 },
      () => homeModule('this_week', null),
    );

    expect(HomeModulesInputSchema.safeParse(modules).success).toBe(false);
    expect(HomeModulesInputSchema.safeParse(modules.slice(1)).success).toBe(
      true,
    );
  });
});

describe('page copy and help article input', () => {
  it('refuses a meta description over its limit', () => {
    const copy = {
      kind: 'category',
      targetId: uuid(1),
      heading: null,
      metaDescription: 'a'.repeat(editorialLimits.metaDescription + 1),
      status: 'draft',
      intro: null,
      body: null,
    };

    expect(PageCopyInputSchema.safeParse(copy).success).toBe(false);
    expect(
      PageCopyInputSchema.safeParse({ ...copy, metaDescription: 'ok' }).success,
    ).toBe(true);
  });

  it.each([
    ['below zero', -1, false],
    ['zero', 0, true],
    ['the highest', editorialLimits.helpPosition, true],
    ['above the highest', editorialLimits.helpPosition + 1, false],
    ['a fraction', 1.5, false],
  ])(
    'a help article position %s is accepted: %s',
    (_name, position, accepted) => {
      expect(
        HelpArticleInputSchema.safeParse({
          slug: 'cancel-a-booking',
          title: 'How do I cancel?',
          summary: null,
          position,
          status: 'draft',
          body: paragraph('You can cancel from the link in your email.'),
        }).success,
      ).toBe(accepted);
    },
  );
});

describe('what a save invalidates', () => {
  const pickSummer = collectionChange('pick', 'summer');
  const pickAutumn = collectionChange('pick', 'autumn');

  it('is nothing for a draft that stays a draft', () => {
    expect(
      changesWhenSaved(
        visibleChange('draft', pickSummer),
        visibleChange('draft', pickSummer),
      ),
    ).toEqual([]);
  });

  it('is the new address when a draft is published', () => {
    expect(
      changesWhenSaved(null, visibleChange('published', pickSummer)),
    ).toEqual([pickSummer]);
  });

  it('is the old address when a page is unpublished', () => {
    expect(
      changesWhenSaved(visibleChange('published', pickSummer), null),
    ).toEqual([pickSummer]);
  });

  it('is both addresses when a published page is renamed', () => {
    expect(
      changesWhenSaved(
        visibleChange('published', pickSummer),
        visibleChange('published', pickAutumn),
      ),
    ).toEqual([pickSummer, pickAutumn]);
  });

  it('is nothing for a row that did not exist and is saved as a draft', () => {
    expect(changesWhenSaved(undefined, null)).toEqual([]);
  });
});

describe('the cache change for each content type', () => {
  it.each([
    ['a pick', collectionChange('pick', 'summer'), ['home', 'pick:summer']],
    [
      'the gift guide',
      collectionChange('gift_guide', 'gift-guide'),
      ['gift-guide', 'home'],
    ],
    [
      'category copy',
      pageCopyChange('category', 'kayaking'),
      ['category:kayaking'],
    ],
    [
      'neighborhood copy',
      pageCopyChange('neighborhood', 'red-hook'),
      ['neighborhood:red-hook'],
    ],
  ] satisfies [string, CacheChange, string[]][])(
    'for %s reaches %j',
    (_name, change, expected) => {
      expect(tagsForChanges([change])).toEqual(expected);
    },
  );
});

describe('publishedAtAfter', () => {
  const earlier = new Date('2026-01-01T00:00:00Z');

  it.each([
    ['a new row saved as a draft', undefined, 'draft', null],
    ['a new row published', undefined, 'published', 'now'],
    [
      'a draft published',
      { status: 'draft', publishedAt: null },
      'published',
      'now',
    ],
    [
      'a published row saved again',
      { status: 'published', publishedAt: earlier },
      'published',
      earlier,
    ],
    [
      'a published row unpublished',
      { status: 'published', publishedAt: earlier },
      'draft',
      null,
    ],
    [
      'a published row that lost its time',
      { status: 'published', publishedAt: null },
      'published',
      'now',
    ],
  ] as const)('%s', (_name, before, status, expected) => {
    expect(publishedAtAfter(before, status)).toEqual(expected);
  });
});

describe('withItems', () => {
  it('groups items under their collection in arrival order and gives an empty one an empty list', () => {
    const grouped = withItems(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { collectionId: 'a', experienceId: 'x1', note: null },
        { collectionId: 'b', experienceId: 'y1', note: 'Why' },
        { collectionId: 'a', experienceId: 'x2', note: null },
      ],
    );

    expect(grouped).toEqual([
      {
        id: 'a',
        items: [
          { experienceId: 'x1', note: null },
          { experienceId: 'x2', note: null },
        ],
      },
      { id: 'b', items: [{ experienceId: 'y1', note: 'Why' }] },
      { id: 'c', items: [] },
    ]);
  });

  it('ignores items of a collection it was not given', () => {
    expect(
      withItems(
        [{ id: 'a' }],
        [{ collectionId: 'z', experienceId: 'x', note: null }],
      ),
    ).toEqual([{ id: 'a', items: [] }]);
  });
});

describe('hasCollectionKindMismatch', () => {
  const kinds = new Map<string, 'pick' | 'gift_guide'>([
    ['p', 'pick'],
    ['g', 'gift_guide'],
  ]);

  it.each([
    ['a picks module on a Pick', 'picks', 'p', false],
    ['a gift_guide module on the gift guide', 'gift_guide', 'g', false],
    ['a picks module on the gift guide', 'picks', 'g', true],
    ['a gift_guide module on a Pick', 'gift_guide', 'p', true],
    ['a module on a collection that is not known', 'picks', 'z', true],
    ['a module with no collection', 'picks', null, false],
  ] as const)('%s: mismatch is %s', (_name, kind, collectionId, expected) => {
    expect(hasCollectionKindMismatch([{ kind, collectionId }], kinds)).toBe(
      expected,
    );
  });

  it('finds one bad module among good ones', () => {
    expect(
      hasCollectionKindMismatch(
        [
          { kind: 'picks', collectionId: 'p' },
          { kind: 'hero_search', collectionId: null },
          { kind: 'gift_guide', collectionId: 'p' },
        ],
        kinds,
      ),
    ).toBe(true);
  });
});

describe('page copy slug', () => {
  const copy = (slug: string) => ({
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'category',
    slug,
    heading: null,
    metaDescription: null,
    status: 'draft',
    intro: null,
    body: null,
    publishedAt: null,
    updatedAt: new Date('2026-10-26T12:00:00Z'),
  });

  it('reads a slug longer than the editorial limit, because the category table owns that column', () => {
    expect(
      PageCopySchema.safeParse(copy('a'.repeat(editorialLimits.slug + 1)))
        .success,
    ).toBe(true);
  });

  it('still refuses a slug that is not a slug', () => {
    expect(PageCopySchema.safeParse(copy('Not A Slug')).success).toBe(false);
  });
});
