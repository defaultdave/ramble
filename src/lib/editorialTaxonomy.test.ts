import { describe, expect, it } from 'vitest';
import {
  buildTaxonomyRows,
  findTerm,
  noticeCodeFor,
  parseAddForm,
  parseClick,
  parseKindParam,
  parseRenameForm,
  taxonomyRedirect,
} from './editorialTaxonomy';
import { taxonomyLimits, type TaxonomyTerm } from './taxonomy';

// Behaviours under test, one per decision, branch or risk:
// - an address names a kind or nothing
// - the add form makes the address from the name when it is blank, refuses one it cannot make, a blank or long name, and an over-long field unread
// - a form that names no known kind (or no id) is nothing at all, and its refusal returns to its own form
// - a list button is read back as the click it was drawn for, and anything else is nothing
// - each answer of the data layer maps to one notice code; a refusal of a form's own field returns to the form with that field, and the rest show on the lists
// - rows: the first cannot move up, the last cannot move down, a retired row offers to bring it back, and the last active one cannot be retired

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const form = (fields: Record<string, string>) => (name: string) =>
  fields[name] ?? null;

function term(n: string, overrides: Partial<TaxonomyTerm> = {}): TaxonomyTerm {
  return {
    id: n,
    slug: `slug-${n.slice(-1)}`,
    name: `Name ${n.slice(-1)}`,
    position: 0,
    retiredAt: null,
    ...overrides,
  };
}

describe('parseKindParam', () => {
  it.each([
    ['category', 'category'],
    ['neighborhood', 'neighborhood'],
    ['host', null],
    ['', null],
  ])('%s is %s', (raw, expected) => {
    expect(parseKindParam(raw)).toBe(expected);
  });
});

describe('parseAddForm', () => {
  it('makes the address from the name when it is blank', () => {
    expect(
      parseAddForm(form({ kind: 'category', name: ' Pottery & Glass ' })),
    ).toEqual({
      ok: true,
      value: {
        kind: 'category',
        name: 'Pottery & Glass',
        slug: 'pottery-glass',
      },
    });
  });

  it('keeps an address that was typed', () => {
    expect(
      parseAddForm(
        form({ kind: 'neighborhood', name: 'Dumbo', slug: 'down-under' }),
      ),
    ).toMatchObject({ ok: true, value: { slug: 'down-under' } });
  });

  it.each([
    ['a blank name', { name: '  ' }, ['name', 'slug']],
    [
      'a name with no letters to make an address from',
      { name: '!!!' },
      ['slug'],
    ],
    ['an address with capitals', { name: 'A', slug: 'Bad' }, ['slug']],
    [
      'a name over the limit',
      { name: 'n'.repeat(taxonomyLimits.name + 1), slug: 'ok' },
      ['name'],
    ],
  ])('refuses %s and names the fields', (_label, fields, named) => {
    expect(parseAddForm(form({ kind: 'category', ...fields }))).toEqual({
      ok: false,
      form: '/ops/editorial/taxonomy/category/new',
      fields: named,
    });
  });

  it('refuses a field too long to be read without parsing it', () => {
    expect(
      parseAddForm(
        form({ kind: 'category', name: 'x'.repeat(5000), slug: 'a' }),
      ),
    ).toMatchObject({ ok: false, fields: ['name'] });
  });

  it('is nothing for a form that names no known kind', () => {
    expect(parseAddForm(form({ kind: 'host', name: 'A' }))).toBeNull();
    expect(parseAddForm(form({ name: 'A' }))).toBeNull();
  });
});

describe('parseRenameForm', () => {
  it('reads the kind, the lower-cased id and the name', () => {
    expect(
      parseRenameForm(
        form({ kind: 'category', id: id.toUpperCase(), name: ' New ' }),
      ),
    ).toEqual({ ok: true, value: { kind: 'category', id, name: 'New' } });
  });

  it('refuses a blank name and returns to the rename form', () => {
    expect(parseRenameForm(form({ kind: 'category', id, name: '' }))).toEqual({
      ok: false,
      form: `/ops/editorial/taxonomy/category/${id}`,
      fields: ['name'],
    });
  });

  it.each([
    ['no kind', { id, name: 'A' }],
    ['an unknown kind', { kind: 'host', id, name: 'A' }],
    ['no id', { kind: 'category', name: 'A' }],
    ['a bad id', { kind: 'category', id: 'nope', name: 'A' }],
  ])('is nothing for %s', (_label, fields) => {
    expect(parseRenameForm(form(fields))).toBeNull();
  });
});

describe('parseClick', () => {
  it('reads what a list button posts', () => {
    expect(parseClick(form({ op: `retire:category:${id}` }))).toEqual({
      action: 'retire',
      kind: 'category',
      id,
    });
  });

  it.each([
    ['no button', {}],
    ['an unknown action', { op: `delete:category:${id}` }],
    ['an unknown kind', { op: `up:host:${id}` }],
    ['a bad id', { op: 'up:category:nope' }],
    ['too few parts', { op: 'up:category' }],
    ['too many parts', { op: `up:category:${id}:x` }],
    ['a value over the length', { op: `up:category:${'a'.repeat(200)}` }],
  ])('is nothing for %s', (_label, fields) => {
    expect(parseClick(form(fields))).toBeNull();
  });
});

describe('noticeCodeFor and taxonomyRedirect', () => {
  it.each([
    [{ status: 'saved', done: 'moved' }, 'moved'],
    [{ status: 'saved', done: 'added' }, 'added'],
    [{ status: 'unchanged' }, 'unchanged'],
    [{ status: 'refused', reason: 'last_active' }, 'last_active'],
    [{ status: 'refused', reason: 'stale' }, 'stale'],
  ] as const)('%j is the notice %s', (result, code) => {
    expect(noticeCodeFor(result)).toBe(code);
  });

  it.each([
    [
      'a taken address returns to the form with the address',
      '/f',
      'slug_taken',
      [],
      '/f?notice=slug_taken&fields=slug',
    ],
    [
      'a taken name returns to the form with the name',
      '/f',
      'name_taken',
      [],
      '/f?notice=name_taken&fields=name',
    ],
    [
      'a refused form returns with its fields',
      '/f',
      'invalid',
      ['name'],
      '/f?notice=invalid&fields=name',
    ],
    [
      'a saved add shows on the lists',
      '/f',
      'added',
      [],
      '/ops/editorial/taxonomy?notice=added',
    ],
    [
      'a full list shows on the lists',
      '/f',
      'list_full',
      [],
      '/ops/editorial/taxonomy?notice=list_full',
    ],
    [
      'a click has no form and shows on the lists',
      null,
      'stale',
      [],
      '/ops/editorial/taxonomy?notice=stale',
    ],
    [
      'a click that is refused for no form still shows on the lists',
      null,
      'slug_taken',
      [],
      '/ops/editorial/taxonomy?notice=slug_taken',
    ],
  ] as const)('%s', (_label, formPath, code, fields, expected) => {
    expect(taxonomyRedirect(formPath, code, fields)).toBe(expected);
  });
});

describe('buildTaxonomyRows', () => {
  const retiredAt = new Date('2026-11-01T00:00:00Z');
  const rows = buildTaxonomyRows('category', [
    term(id),
    term(other, { retiredAt }),
  ]);

  it('lets the first row move down only and the last row move up only', () => {
    expect(rows.map((r) => [r.canMoveUp, r.canMoveDown])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('posts each button as its action, the kind and the row', () => {
    expect(rows[0]).toMatchObject({
      moveDownValue: `down:category:${id}`,
      switchValue: `retire:category:${id}`,
      renameHref: `/ops/editorial/taxonomy/category/${id}`,
    });
  });

  it('offers a retired row to be brought back, and blocks retiring the last row in use', () => {
    expect(rows[1]).toMatchObject({
      retired: true,
      switchLabel: 'Bring back',
      switchValue: `restore:category:${other}`,
      canSwitch: true,
    });
    expect(rows[0]).toMatchObject({ switchLabel: 'Retire', canSwitch: false });
  });

  it('gives the reason each disabled button has, and none for one that works', () => {
    expect(rows[0]).toMatchObject({
      moveUpReason: 'Already first.',
      moveDownReason: null,
      switchReason: 'The last one that is not retired cannot be retired.',
    });
    expect(rows[1]).toMatchObject({
      moveUpReason: null,
      moveDownReason: 'Already last.',
      switchReason: null,
    });
  });

  it('lets a row be retired while another is in use', () => {
    expect(
      buildTaxonomyRows('neighborhood', [term(id), term(other)]).map(
        (r) => r.canSwitch,
      ),
    ).toEqual([true, true]);
  });
});

describe('findTerm', () => {
  it('finds a term by a lower- or upper-case id and nothing for another', () => {
    const terms = [term(id)];
    expect(findTerm(terms, id.toUpperCase())).toBe(terms[0]);
    expect(findTerm(terms, other)).toBeNull();
    expect(findTerm(terms, 'nope')).toBeNull();
  });
});
