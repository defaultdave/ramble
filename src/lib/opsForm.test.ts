import { describe, expect, it } from 'vitest';
import {
  changedFields,
  errorProps,
  fieldsFromIssues,
  formHas,
  inFieldOrder,
  formText,
  noticeHref,
  noticeText,
  oversizedFields,
  parseIdField,
  parseNotice,
  parseProblemFields,
  problemText,
  slugFor,
} from './opsForm';

// Behaviours under test, one per decision, branch or risk:
// - posted text is trimmed, and missing, blank or non-text reads as absent
// - a checkbox is ticked when the form carries it at all
// - fields over the raw limit are named, in the list's order
// - a slug is typed or derived when asked, and a missing, over-long or empty one is refused
// - an id field is lower-cased, and anything else is null
// - a notice is read from the codes it is given, and a repeated or unknown one is null
// - the notice text is looked up, and none is none
// - problem fields keep the list's order and only its names
// - the notice address leaves out an empty field list and joins a full one

const form = (fields: Record<string, unknown>) => (name: string) =>
  fields[name] ?? null;

describe('formText', () => {
  it.each([
    ['  Pat  ', 'Pat'],
    ['   ', undefined],
    ['', undefined],
    [null, undefined],
    [42, undefined],
  ])('%j reads as %j', (raw, expected) => {
    expect(formText(form({ name: raw }), 'name')).toBe(expected);
  });
});

describe('formHas', () => {
  it.each([
    ['on', true],
    ['', true],
    [null, false],
    [undefined, false],
  ])('%j is %s', (raw, expected) => {
    expect(formHas(form({ box: raw }), 'box')).toBe(expected);
  });
});

describe('oversizedFields', () => {
  it('names the fields over the limit, in the list order', () => {
    const get = form({ a: 'xxxxxx', b: 'x', c: 'xxxxxx', d: 7 });

    expect(oversizedFields(get, ['c', 'b', 'a', 'd'], 5)).toEqual(['c', 'a']);
  });
});

describe('slugFor', () => {
  it.each<[string, string | undefined, boolean, string | null]>([
    ['Pottery Night', undefined, true, 'pottery-night'],
    ['Pottery Night', 'wheel', true, 'wheel'],
    ['Pottery Night', undefined, false, null],
    ['!!!', undefined, true, null],
    ['a'.repeat(81), undefined, true, null],
    ['a'.repeat(80), undefined, true, 'a'.repeat(80)],
  ])('%j typed %j deriving %s is %j', (name, typed, derive, expected) => {
    expect(slugFor(name, typed, derive, 80)).toBe(expected);
  });
});

describe('parseIdField', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it.each([
    [id, id],
    [id.toUpperCase().replace(/X/g, 'x'), id],
    ['nope', null],
    [null, null],
    [7, null],
  ])('%j is %j', (raw, expected) => {
    expect(parseIdField(raw)).toBe(expected);
  });
});

describe('parseNotice and noticeText', () => {
  const codes = ['saved', 'failed'] as const;

  it('reads a known code and refuses an unknown, repeated or missing one', () => {
    expect(parseNotice('saved', codes)).toBe('saved');
    expect(parseNotice('exploded', codes)).toBeNull();
    expect(parseNotice(['saved', 'failed'], codes)).toBeNull();
    expect(parseNotice(undefined, codes)).toBeNull();
  });

  it('looks up the text of a code, and none for none', () => {
    const notices = {
      saved: { tone: 'success', title: 'Saved.' },
      failed: { tone: 'danger', title: 'Failed.' },
    } as const;

    expect(noticeText(notices, 'failed')).toEqual(notices.failed);
    expect(noticeText(notices, null)).toBeNull();
  });
});

describe('parseProblemFields', () => {
  const fields = ['name', 'slug', 'price'] as const;

  it('keeps the list order and only its names', () => {
    expect(parseProblemFields('price,bogus,name', fields)).toEqual([
      'name',
      'price',
    ]);
  });

  it.each([[undefined], [['name']]])('reads %j as none', (raw) => {
    expect(parseProblemFields(raw, fields)).toEqual([]);
  });
});

describe('noticeHref', () => {
  it('leaves out an empty field list and joins a full one', () => {
    expect(noticeHref('/ops/x', 'saved')).toBe('/ops/x?notice=saved');
    expect(noticeHref('/ops/x', 'invalid', ['name', 'price'])).toBe(
      '/ops/x?notice=invalid&fields=name%2Cprice',
    );
  });
});

describe('inFieldOrder', () => {
  it('keeps the list order and only the failed fields', () => {
    expect(
      inFieldOrder(['a', 'b', 'c'], new Set<'a' | 'b' | 'c'>(['c', 'a'])),
    ).toEqual(['a', 'c']);
  });
});

describe('fieldsFromIssues', () => {
  const fields = ['name', 'slug', 'price'] as const;

  it('names each field once, in the list order, and drops a name outside the list', () => {
    const issues = [
      { path: ['price'] },
      { path: ['name'] },
      { path: ['price', 0] },
      { path: ['bogus'] },
      { path: [] },
    ];

    expect(fieldsFromIssues(issues, fields)).toEqual(['name', 'price']);
  });

  it('names nothing for no issues', () => {
    expect(fieldsFromIssues([], fields)).toEqual([]);
  });

  it('reads the name an issue stands for from the mapper a nested form gives', () => {
    const issues = [
      { path: ['rights', 'slug'] },
      { path: ['rights', 'other'] },
      { path: ['name'] },
    ];

    expect(
      fieldsFromIssues(issues, fields, (path) =>
        path[0] === 'rights' ? path[1] : null,
      ),
    ).toEqual(['slug']);
  });
});

describe('changedFields', () => {
  it('lists the differing fields in the list order, and none for equal values', () => {
    const before = { a: 1, b: 'x', c: null };

    expect(
      changedFields(['c', 'b', 'a'], before, { a: 2, b: 'x', c: 0 }),
    ).toEqual(['c', 'a']);
    expect(changedFields(['a', 'b', 'c'], before, { ...before })).toEqual([]);
  });
});

describe('problemText and errorProps', () => {
  const texts = { name: 'Enter a name.', slug: 'Enter a slug.' } as const;

  it('gives the sentence of a refused field and nothing for another', () => {
    expect(problemText(['name'], texts, 'name')).toBe('Enter a name.');
    expect(problemText(['name'], texts, 'slug')).toBeUndefined();
    expect(errorProps(['name'], texts, 'name')).toEqual({
      errorText: 'Enter a name.',
    });
    expect(errorProps(['name'], texts, 'slug')).toEqual({});
  });
});
