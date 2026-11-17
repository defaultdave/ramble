import { describe, expect, it } from 'vitest';
import type { Collection } from './editorial';
import {
  addableOptions,
  applyItemOp,
  buildCollectionRows,
  buildItemRows,
  collectionOutcomeFor,
  collectionRedirect,
  findPick,
  parseCollectionForm,
  parseItemOp,
  picksOf,
  savedCollectionNotice,
  settleCollection,
  settleItems,
  type ExperienceChoice,
} from './editorialCollections';
import { paragraphs } from './richText/paragraphs';

// Behaviours under test:
// - only Picks are listed, found and edited; the gift guide is never offered, and reads as missing
// - the details form reads title, address, summary and introduction, and refuses what the schema refuses with the fields named
// - a blank address keeps the stored one, or is made from the title for a new Pick
// - a form with no known intent, or an oversized field, changes nothing
// - an introduction edited to nothing is stored as none
// - a save takes status and entries from the stored Pick, so a stale tab cannot unpublish or drop entries
// - a Pick with no entries cannot be published, but can be saved and taken down
// - a missing Pick and one of another kind are refused alike
// - a click on the list names the action, place and experience, and a value that is not one is no click
// - an add names an experience and an optional note, and refuses an unreadable id or a long note
// - a click moves an entry one place, removes it, or adds it at the end; a stale click changes nothing
// - a duplicate or an over-full add is refused
// - each outcome has one destination, and a saved new Pick goes to its own page
// - rows show names, counts, the status the way the other lists do, and which buttons apply
// - the add list leaves out what is listed and marks experiences guests cannot book

/** The entry at a place, or a failure that names the place: a test never reads past the end. */
function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`Nothing at ${String(index)}`);
  return found;
}
const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const a = '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const b = '2a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const c = '3a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const intro = paragraphs('Welcome');

function form(fields: Record<string, string>) {
  return (name: string) => fields[name];
}

const pick: Collection = {
  id,
  kind: 'pick',
  slug: 'weekend-workshops',
  title: 'Weekend workshops',
  summary: null,
  intro,
  status: 'draft',
  publishedAt: null,
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  items: [
    { experienceId: a, note: 'Warm up' },
    { experienceId: b, note: null },
  ],
};
const gift: Collection = { ...pick, id: c, kind: 'gift_guide', slug: 'gifts' };

const details = (overrides = {}) => ({
  id,
  slug: 'weekend-workshops',
  title: 'Weekend workshops',
  summary: null,
  intro,
  intent: 'save' as const,
  ...overrides,
});

describe('picksOf and findPick', () => {
  it('leaves the gift guide out of the list and the lookup', () => {
    expect(picksOf([pick, gift])).toEqual([pick]);
    expect(findPick([pick, gift], id)).toEqual(pick);
    expect(findPick([pick, gift], c)).toBeNull();
    expect(findPick([pick], a)).toBeNull();
  });
});

describe('parseCollectionForm', () => {
  const base = { intent: 'save', title: 'Weekend workshops' };

  it('reads the details, and makes a new Pick its address from the title', () => {
    expect(
      parseCollectionForm(
        form({
          ...base,
          summary: ' Make things ',
          intro: JSON.stringify(intro),
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        id: undefined,
        slug: 'weekend-workshops',
        title: 'Weekend workshops',
        summary: 'Make things',
        intro,
        intent: 'save',
      },
    });
  });

  it('keeps the stored address of an existing Pick when the field is blank, and the typed one otherwise', () => {
    const kept = parseCollectionForm(
      form({ ...base, title: 'Renamed', id, currentSlug: 'weekend-workshops' }),
    );
    expect(kept).toMatchObject({
      ok: true,
      value: { id, slug: 'weekend-workshops' },
    });
    const typed = parseCollectionForm(
      form({ ...base, id, currentSlug: 'old', slug: 'new-address' }),
    );
    expect(typed).toMatchObject({ ok: true, value: { slug: 'new-address' } });
  });

  it('stores an introduction edited to nothing as none', () => {
    expect(
      parseCollectionForm(
        form({ ...base, intro: JSON.stringify({ type: 'doc', content: [] }) }),
      ),
    ).toMatchObject({ ok: true, value: { intro: null } });
  });

  it.each([
    [
      'a blank title, which leaves no address either',
      { title: '' },
      ['title', 'slug'],
    ],
    ['an address with capitals', { slug: 'Not A Slug' }, ['slug']],
    ['a title that leaves no address', { title: '!!!' }, ['slug']],
    ['a summary over the limit', { summary: 's'.repeat(301) }, ['summary']],
    ['an introduction that is not JSON', { intro: 'plain' }, ['intro']],
    ['a field too long to read', { title: 't'.repeat(1001) }, ['title']],
    [
      'an introduction too large to read',
      { intro: 'i'.repeat(200_001) },
      ['intro'],
    ],
  ])('refuses %s and names the field', (_name, extra, fields) => {
    expect(parseCollectionForm(form({ ...base, ...extra }))).toEqual({
      ok: false,
      fields,
    });
  });

  it.each([
    ['none', {}],
    ['an unknown one', { intent: 'delete' }],
  ])('reads a form with %s intent as refused with no field', (_name, extra) => {
    expect(parseCollectionForm(form({ title: 'A', ...extra }))).toEqual({
      ok: false,
      fields: [],
    });
  });
});

describe('settleCollection', () => {
  it('writes a new Pick as a draft with no entries', () => {
    expect(settleCollection(details({ id: undefined }), null)).toEqual({
      status: 'ready',
      input: {
        kind: 'pick',
        slug: 'weekend-workshops',
        title: 'Weekend workshops',
        summary: null,
        intro,
        status: 'draft',
        items: [],
      },
    });
  });

  it.each([
    ['save', 'draft', 'draft'],
    ['save', 'published', 'published'],
    ['publish', 'draft', 'published'],
    ['unpublish', 'published', 'draft'],
  ] as const)(
    '%s on a stored %s Pick writes %s',
    (intent, current, written) => {
      const settled = settleCollection(details({ intent }), {
        ...pick,
        status: current,
      });
      expect(settled).toMatchObject({
        status: 'ready',
        input: { id, status: written },
      });
    },
  );

  it('takes the entries from the stored Pick, not the form', () => {
    const settled = settleCollection(details(), pick);
    expect(settled.status === 'ready' && settled.input.items).toEqual(
      pick.items,
    );
  });

  it('refuses to publish a Pick with no entries, and still lets it be saved and taken down', () => {
    const empty = { ...pick, items: [] };
    expect(settleCollection(details({ intent: 'publish' }), empty)).toEqual({
      status: 'no_entries',
    });
    expect(
      settleCollection(details({ id: undefined, intent: 'publish' }), null),
    ).toEqual({
      status: 'no_entries',
    });
    expect(settleCollection(details({ intent: 'save' }), empty).status).toBe(
      'ready',
    );
    expect(
      settleCollection(details({ intent: 'unpublish' }), {
        ...empty,
        status: 'published',
      }).status,
    ).toBe('ready');
  });

  it.each([
    ['a Pick that is gone', null],
    ['the gift guide', gift],
  ])('refuses %s as not found', (_name, stored) => {
    expect(settleCollection(details(), stored)).toEqual({
      status: 'not_found',
    });
  });
});

describe('parseItemOp', () => {
  it('reads what a list button posts', () => {
    expect(parseItemOp(form({ op: `up:1:${a}` }))).toEqual({
      ok: true,
      op: { action: 'up', index: 1, experienceId: a },
    });
  });

  it('reads an add with its note, trimmed, or none', () => {
    expect(
      parseItemOp(form({ op: 'add', experienceId: a, note: ' Nice ' })),
    ).toEqual({
      ok: true,
      op: { action: 'add', experienceId: a, note: 'Nice' },
    });
    expect(parseItemOp(form({ op: 'add', experienceId: a }))).toMatchObject({
      ok: true,
      op: { note: null },
    });
  });

  it.each([
    ['an add with no experience', { op: 'add' }, ['experienceId']],
    [
      'an add with an experience that is not an id',
      { op: 'add', experienceId: 'x' },
      ['experienceId'],
    ],
    [
      'an add with a long note',
      { op: 'add', experienceId: a, note: 'n'.repeat(281) },
      ['note'],
    ],
  ])('refuses %s and names the field', (_name, fields, named) => {
    expect(parseItemOp(form(fields))).toEqual({ ok: false, fields: named });
  });

  it.each([
    ['nothing', {}],
    ['an unknown action', { op: `drop:1:${a}` }],
    ['a place that is not a number', { op: `up:x:${a}` }],
    ['an experience that is not an id', { op: 'up:1:nope' }],
    ['an extra part', { op: `up:1:${a}:more` }],
    ['a value that is too long', { op: `up:1:${'a'.repeat(80)}` }],
  ])('reads %s as no click', (_name, fields) => {
    expect(parseItemOp(form(fields))).toBeNull();
  });
});

describe('applyItemOp', () => {
  const items = [
    { experienceId: a, note: 'Warm up' },
    { experienceId: b, note: null },
  ];

  it('moves an entry one place', () => {
    expect(
      applyItemOp(items, { action: 'down', index: 0, experienceId: a }),
    ).toEqual({
      status: 'changed',
      done: 'entry_moved',
      items: [items[1], items[0]],
    });
    expect(
      applyItemOp(items, { action: 'up', index: 1, experienceId: b }),
    ).toMatchObject({
      items: [items[1], items[0]],
    });
  });

  it('removes an entry', () => {
    expect(
      applyItemOp(items, { action: 'remove', index: 0, experienceId: a }),
    ).toEqual({
      status: 'changed',
      done: 'entry_removed',
      items: [items[1]],
    });
  });

  it('adds an entry at the end with its note', () => {
    expect(
      applyItemOp(items, { action: 'add', experienceId: c, note: 'New' }),
    ).toEqual({
      status: 'changed',
      done: 'entry_added',
      items: [...items, { experienceId: c, note: 'New' }],
    });
  });

  it.each([
    ['moving the first entry up', { action: 'up', index: 0, experienceId: a }],
    [
      'moving the last entry down',
      { action: 'down', index: 1, experienceId: b },
    ],
    [
      'a different experience now at that place',
      { action: 'remove', index: 0, experienceId: b },
    ],
    ['a place past the end', { action: 'remove', index: 5, experienceId: a }],
  ] as const)('refuses %s as stale', (_name, op) => {
    expect(applyItemOp(items, op)).toEqual({ status: 'entry_stale' });
  });

  it('refuses an experience that is already listed', () => {
    expect(
      applyItemOp(items, { action: 'add', experienceId: a, note: null }),
    ).toEqual({
      status: 'entry_listed',
    });
  });

  it('refuses an add to a full list, and allows one fewer than full', () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        experienceId: `${String(i).padStart(8, '0')}-4b5a-4697-8a9b-0c1d2e3f4a5b`,
        note: null,
      }));
    expect(
      applyItemOp(ids(60), { action: 'add', experienceId: c, note: null }),
    ).toEqual({
      status: 'list_full',
    });
    expect(
      applyItemOp(ids(59), { action: 'add', experienceId: c, note: null })
        .status,
    ).toBe('changed');
  });
});

describe('settleItems', () => {
  it('saves the stored Pick with its entries changed and everything else as stored', () => {
    const settled = settleItems(pick, {
      action: 'remove',
      index: 0,
      experienceId: a,
    });
    expect(settled).toEqual({
      status: 'ready',
      done: 'entry_removed',
      input: {
        id,
        kind: 'pick',
        slug: pick.slug,
        title: pick.title,
        summary: null,
        intro,
        status: 'draft',
        items: [pick.items[1]],
      },
    });
  });

  it.each([
    ['a Pick that is gone', null],
    ['the gift guide', gift],
  ])('refuses %s as not found', (_name, stored) => {
    expect(
      settleItems(stored, { action: 'add', experienceId: c, note: null }),
    ).toEqual({
      status: 'not_found',
    });
  });

  it('passes a stale click on', () => {
    expect(
      settleItems(pick, { action: 'remove', index: 0, experienceId: b }),
    ).toEqual({
      status: 'entry_stale',
    });
  });
});

describe('outcomes and redirects', () => {
  it.each([
    [
      'a taken address',
      null,
      { status: 'slug_taken' },
      '/ops/editorial/collections/new?notice=slug_taken&fields=slug',
    ],
    [
      'a taken address on an existing Pick',
      id,
      { status: 'slug_taken' },
      `/ops/editorial/collections/${id}?notice=slug_taken&fields=slug`,
    ],
    [
      'a missing Pick',
      id,
      { status: 'not_found' },
      '/ops/editorial/collections?notice=not_found',
    ],
    [
      'a second gift guide, which a Pick never is',
      id,
      { status: 'gift_guide_exists' },
      '/ops/editorial/collections?notice=not_found',
    ],
    [
      'an unknown experience',
      id,
      { status: 'unknown_experience' },
      `/ops/editorial/collections/${id}?notice=unknown_experience`,
    ],
  ] as const)('%s', (_name, posted, result, href) => {
    expect(
      collectionRedirect(posted, collectionOutcomeFor(result, 'saved')),
    ).toBe(href);
  });

  it('sends a saved new Pick to its own page, with what the click did', () => {
    expect(
      collectionRedirect(
        null,
        collectionOutcomeFor({ status: 'saved', value: { id } }, 'saved'),
      ),
    ).toBe(`/ops/editorial/collections/${id}?notice=saved`);
  });

  it.each([
    ['save', 'saved'],
    ['publish', 'published'],
    ['unpublish', 'unpublished'],
  ] as const)('the %s button earns the %s notice', (intent, notice) => {
    expect(savedCollectionNotice(intent)).toBe(notice);
  });

  it('sends a refused form back to the form with the fields to look at', () => {
    expect(
      collectionRedirect(null, {
        status: 'invalid',
        fields: ['title', 'intro'],
      }),
    ).toBe(
      '/ops/editorial/collections/new?notice=invalid&fields=title%2Cintro',
    );
  });

  it.each([
    ['no_entries'],
    ['entry_stale'],
    ['entry_listed'],
    ['list_full'],
  ] as const)('returns %s to the Pick it came from', (status) => {
    expect(collectionRedirect(id, { status })).toBe(
      `/ops/editorial/collections/${id}?notice=${status}`,
    );
  });
});

describe('buildCollectionRows', () => {
  it('lists Picks with their entry count and status', () => {
    const rows = buildCollectionRows([pick, gift]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      title: 'Weekend workshops',
      slug: 'weekend-workshops',
      status: 'draft',
      entryCount: 2,
    });
    expect(rows[0]?.updatedLabel).toContain('Nov');
  });
});

describe('buildItemRows and addableOptions', () => {
  const choices: ExperienceChoice[] = [
    { id: a, name: 'Pottery night', status: 'live' },
    { id: c, name: 'Glass blowing', status: 'draft' },
    {
      id: '4a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
      name: 'Weaving',
      status: 'live',
    },
  ];

  it('names each entry and says where it can move', () => {
    const rows = buildItemRows(pick.items, choices);
    expect(
      rows.map((r) => [r.name, r.note, r.canMoveUp, r.canMoveDown]),
    ).toEqual([
      ['Pottery night', 'Warm up', false, true],
      ['An experience that is no longer listed', null, true, false],
    ]);
    expect(rows[0]).toMatchObject({
      upValue: `up:0:${a}`,
      downValue: `down:0:${a}`,
      removeValue: `remove:0:${a}`,
    });
  });

  it('offers what is not listed, marking what guests cannot book', () => {
    expect(addableOptions(pick.items, choices)).toEqual([
      { value: c, label: 'Glass blowing (Draft)' },
      { value: '4a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b', label: 'Weaving' },
    ]);
  });

  it('offers nothing when every experience is listed', () => {
    expect(
      addableOptions([{ experienceId: a, note: null }], [at(choices, 0)]),
    ).toEqual([]);
  });
});
