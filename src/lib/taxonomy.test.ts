import { describe, expect, it } from 'vitest';
import { catalogLimits } from './catalog';
import {
  TaxonomyAddSchema,
  TaxonomyClickSchema,
  TaxonomyRenameSchema,
  decideAdd,
  decideClick,
  decideRename,
  isOfferable,
  mayReference,
  taxonomyAuditEntry,
  taxonomyCapacity,
  taxonomyChange,
  taxonomyLimits,
  type TaxonomyTerm,
} from './taxonomy';

// Behaviours under test, one per decision, branch or risk:
// - an added term goes last; a taken address, a taken name (any case, any padding) and a full list are refused
// - a rename changes only the name and keeps the address; the same name changes nothing; another term's name is refused, the term's own in other case is not
// - up and down swap neighbours and write only the places that changed; a list that began with ties ends with none
// - a move past either end, a button for a term that is gone, and a retire or restore of a term already in that state are stale
// - the last term that is not retired cannot be retired, however many retired ones sit beside it
// - a retired term can be named only by the experience that already names it, and a missing one by nobody
// - the audit row names the kind of change and the term and holds no name
// - the schemas refuse a blank or over-long name and a bad address, and lower-case an id

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
] as const;

function term(
  n: 0 | 1 | 2,
  overrides: Partial<TaxonomyTerm> = {},
): TaxonomyTerm {
  return {
    id: ids[n],
    slug: `term-${String(n)}`,
    name: `Term ${String(n)}`,
    position: n,
    retiredAt: null,
    ...overrides,
  };
}

const retiredAt = new Date('2026-11-01T00:00:00Z');
const three = [term(0), term(1), term(2)];

describe('decideAdd', () => {
  it('puts the new term at the end of the list', () => {
    expect(
      decideAdd('category', three, { name: 'Hiking', slug: 'hiking' }),
    ).toEqual({
      status: 'create',
      done: 'added',
      slug: 'hiking',
      name: 'Hiking',
      position: 3,
    });
  });

  it.each([
    [
      'an address another term has',
      { name: 'New', slug: 'term-1' },
      'slug_taken',
    ],
    ['a name in other case', { name: 'TERM 1', slug: 'new' }, 'name_taken'],
    ['a name with padding', { name: '  term 2 ', slug: 'new' }, 'name_taken'],
  ])('refuses %s', (_label, input, reason) => {
    expect(decideAdd('category', three, input)).toEqual({
      status: 'refused',
      reason,
    });
  });

  it('refuses a full list, counting retired terms', () => {
    const full = Array.from(
      { length: taxonomyCapacity('neighborhood') },
      (_, n) => ({
        ...term(0),
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        slug: `n-${String(n)}`,
        name: `N ${String(n)}`,
        retiredAt,
      }),
    );
    expect(
      decideAdd('neighborhood', full, { name: 'One more', slug: 'one-more' }),
    ).toEqual({ status: 'refused', reason: 'list_full' });
  });

  it('has a capacity per kind that matches the guest read caps', () => {
    expect(taxonomyCapacity('category')).toBe(catalogLimits.categories);
    expect(taxonomyCapacity('neighborhood')).toBe(catalogLimits.neighborhoods);
  });
});

describe('decideRename', () => {
  it('changes the name of the one term and nothing else', () => {
    expect(decideRename(three, { id: ids[1], name: 'Renamed' })).toEqual({
      status: 'apply',
      done: 'renamed',
      subjectId: ids[1],
      changes: [{ id: ids[1], name: 'Renamed' }],
    });
  });

  it('changes nothing when the name is the same', () => {
    expect(decideRename(three, { id: ids[1], name: 'Term 1' })).toEqual({
      status: 'unchanged',
    });
  });

  it('lets a term change the case of its own name', () => {
    expect(decideRename(three, { id: ids[1], name: 'TERM 1' }).status).toBe(
      'apply',
    );
  });

  it.each([
    ['another term has the name', ids[1], 'term 2', 'name_taken'],
    [
      'the term is gone',
      '00000000-0000-4000-8000-0000000000ff',
      'Any',
      'stale',
    ],
  ])('refuses when %s', (_label, id, name, reason) => {
    expect(decideRename(three, { id, name })).toEqual({
      status: 'refused',
      reason,
    });
  });
});

describe('decideClick moving a term', () => {
  it('swaps a term with its neighbour and writes only the two places that changed', () => {
    expect(decideClick(three, { action: 'down', id: ids[0] })).toEqual({
      status: 'apply',
      done: 'moved',
      subjectId: ids[0],
      changes: [
        { id: ids[1], position: 0 },
        { id: ids[0], position: 1 },
      ],
    });
    expect(decideClick(three, { action: 'up', id: ids[2] })).toMatchObject({
      changes: [
        { id: ids[2], position: 1 },
        { id: ids[1], position: 2 },
      ],
    });
  });

  it('numbers every term when the list began with ties', () => {
    const tied = three.map((t) => ({ ...t, position: 0 }));
    expect(decideClick(tied, { action: 'down', id: ids[0] })).toMatchObject({
      changes: [
        { id: ids[0], position: 1 },
        { id: ids[2], position: 2 },
      ],
    });
  });

  it.each([
    ['up from the top', 'up', ids[0]],
    ['down from the bottom', 'down', ids[2]],
    ['a term that is gone', 'up', '00000000-0000-4000-8000-0000000000ff'],
  ] as const)('is stale for %s', (_label, action, id) => {
    expect(decideClick(three, { action, id })).toEqual({
      status: 'refused',
      reason: 'stale',
    });
  });
});

describe('decideClick retiring and restoring', () => {
  it('retires a term that is not the last active one', () => {
    expect(decideClick(three, { action: 'retire', id: ids[1] })).toEqual({
      status: 'apply',
      done: 'retired',
      subjectId: ids[1],
      changes: [{ id: ids[1], retired: true }],
    });
  });

  it('refuses to retire the last term that is not retired, with retired ones beside it', () => {
    const list = [term(0, { retiredAt }), term(1), term(2, { retiredAt })];
    expect(decideClick(list, { action: 'retire', id: ids[1] })).toEqual({
      status: 'refused',
      reason: 'last_active',
    });
  });

  it('refuses to retire the only term', () => {
    expect(decideClick([term(0)], { action: 'retire', id: ids[0] })).toEqual({
      status: 'refused',
      reason: 'last_active',
    });
  });

  it('brings a retired term back', () => {
    const list = [term(0), term(1, { retiredAt })];
    expect(decideClick(list, { action: 'restore', id: ids[1] })).toEqual({
      status: 'apply',
      done: 'restored',
      subjectId: ids[1],
      changes: [{ id: ids[1], retired: false }],
    });
  });

  it.each([
    ['retire of a retired term', 'retire', true],
    ['restore of a term in use', 'restore', false],
  ] as const)('is stale for a %s', (_label, action, isRetired) => {
    const list = [
      term(0),
      term(1, { retiredAt: isRetired ? retiredAt : null }),
    ];
    expect(decideClick(list, { action, id: ids[1] })).toEqual({
      status: 'refused',
      reason: 'stale',
    });
  });
});

describe('what an experience may name', () => {
  it.each([
    ['an active term', { id: ids[0], retiredAt: null }, undefined, true],
    [
      'a retired term nobody names',
      { id: ids[0], retiredAt },
      undefined,
      false,
    ],
    [
      'a retired term another one names',
      { id: ids[0], retiredAt },
      ids[1],
      false,
    ],
    [
      'a retired term it already names',
      { id: ids[0], retiredAt },
      ids[0],
      true,
    ],
    ['a term that is not there', undefined, ids[0], false],
  ])('%s: %s', (_label, found, kept, allowed) => {
    expect(mayReference(found, kept)).toBe(allowed);
  });

  it('offers a retired term only to the experience that names it', () => {
    expect(isOfferable({ id: ids[0], retiredAt }, ids[0])).toBe(true);
    expect(isOfferable({ id: ids[0], retiredAt }, undefined)).toBe(false);
    expect(isOfferable({ id: ids[0], retiredAt: null }, undefined)).toBe(true);
  });
});

describe('the audit row and the cache change', () => {
  it('names the kind of change, the term and the user, and no name', () => {
    expect(taxonomyAuditEntry(ids[0], 'category', 'retired', ids[1])).toEqual({
      actorKind: 'user',
      actorId: ids[0],
      action: 'category.retired',
      subjectKind: 'category',
      subjectId: ids[1],
    });
  });

  it('reaches the taxonomy tag through one change kind', () => {
    expect(taxonomyChange).toEqual({ kind: 'taxonomy' });
  });
});

describe('the write schemas', () => {
  it.each([
    ['a blank name', { kind: 'category', name: '   ', slug: 'a' }],
    [
      'a name over the limit',
      {
        kind: 'category',
        name: 'x'.repeat(taxonomyLimits.name + 1),
        slug: 'a',
      },
    ],
    ['an address with capitals', { kind: 'category', name: 'A', slug: 'Bad' }],
    [
      'an address over the limit',
      {
        kind: 'category',
        name: 'A',
        slug: 'a'.repeat(taxonomyLimits.slug + 1),
      },
    ],
    ['an unknown kind', { kind: 'host', name: 'A', slug: 'a' }],
    [
      'a field it does not know',
      { kind: 'category', name: 'A', slug: 'a', x: 1 },
    ],
  ])('refuses %s', (_label, input) => {
    expect(TaxonomyAddSchema.safeParse(input).success).toBe(false);
  });

  it('lower-cases the id of a rename and of a click', () => {
    const upper = ids[0].toUpperCase();
    expect(
      TaxonomyRenameSchema.parse({ kind: 'category', id: upper, name: 'A' }).id,
    ).toBe(ids[0]);
    expect(
      TaxonomyClickSchema.parse({ kind: 'category', action: 'up', id: upper })
        .id,
    ).toBe(ids[0]);
  });
});
