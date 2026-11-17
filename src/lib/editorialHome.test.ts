import { describe, expect, it } from 'vitest';
import type { HomeModule, HomeModulesInput } from './editorial';
import {
  applyHomeModuleEdit,
  applyHomeModuleOp,
  buildHomeModuleRows,
  editableModule,
  homeModuleFields,
  homeModuleOpValue,
  homeOutcomeFor,
  homeRedirect,
  parseHomeModuleForm,
  parseHomeModuleOp,
  pickOptions,
  toHomeModulesInput,
} from './editorialHome';
import { paragraphs } from './richText/paragraphs';

// Behaviours under test:
// - each kind of module shows the settings the guest page reads for it, and the gift guide none
// - a button posts its action, place and kind, and a value that is not one of those is no click
// - a click moves a module one place, never past either end, and swaps it with its neighbour
// - a click switches a module on or off; the gift guide module cannot be switched
// - a click drawn for a module that is no longer there, or already in that state, changes nothing
// - the edit form reads the module by place and kind, and a form that names none is no edit
// - an oversized, unreadable or malformed field refuses the form and names the field
// - an edit writes only the settings its kind shows, and the saved list is checked as the save checks it
// - an edit that empties the text stores none, so the guest page uses its standard copy
// - each outcome has one destination: the list, or the form for a refusal of an edit
// - a row says what the module is, whether it shows, what it points at, and which buttons apply
// - an address names an editable module or none
// - a Pick can be chosen by name, with drafts marked

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const text = paragraphs('Hello');

function form(fields: Record<string, string>) {
  return (name: string) => fields[name];
}

function moduleWith(
  overrides: Partial<HomeModulesInput[number]> = {},
): HomeModulesInput[number] {
  return {
    kind: 'this_week',
    enabled: true,
    heading: null,
    collectionId: null,
    body: null,
    ...overrides,
  };
}

const list: HomeModulesInput = [
  moduleWith({ kind: 'hero_search', heading: 'Find something' }),
  moduleWith({ kind: 'picks', collectionId: id }),
  moduleWith({ kind: 'gift_guide' }),
  moduleWith({ kind: 'this_week', enabled: false }),
];

const stored = list.map((m, position) => ({
  id: `${String(position)}f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b`,
  position,
  ...m,
})) as HomeModule[];

describe('homeModuleFields', () => {
  it.each([
    ['hero_search', ['heading', 'body']],
    ['picks', ['heading', 'collectionId']],
    ['category_rail', ['heading']],
    ['this_week', ['heading']],
    ['gift_guide', []],
    ['reassurance', []],
  ] as const)('%s shows %j', (kind, fields) => {
    expect(homeModuleFields(kind)).toEqual(fields);
  });
});

describe('toHomeModulesInput', () => {
  it('drops the id and the position, which the list order carries', () => {
    expect(toHomeModulesInput(stored)).toEqual(list);
  });
});

describe('parseHomeModuleOp', () => {
  it('reads what a button posts', () => {
    expect(
      parseHomeModuleOp(form({ op: homeModuleOpValue('down', 3, 'picks') })),
    ).toEqual({ action: 'down', position: 3, kind: 'picks' });
  });

  it.each([
    ['nothing', {}],
    ['an unknown action', { op: 'delete:1:picks' }],
    ['an unknown kind', { op: 'up:1:banner' }],
    ['a place that is not a number', { op: 'up:x:picks' }],
    ['a negative place', { op: 'up:-1:picks' }],
    ['a missing kind', { op: 'up:1' }],
    ['an extra part', { op: 'up:1:picks:more' }],
    ['a value that is too long', { op: `up:1:${'p'.repeat(60)}` }],
  ])('reads %s as no click', (_name, fields) => {
    expect(parseHomeModuleOp(form(fields))).toBeNull();
  });
});

describe('applyHomeModuleOp', () => {
  it.each([
    ['up', 1, ['picks', 'hero_search', 'gift_guide', 'this_week']],
    ['down', 1, ['hero_search', 'gift_guide', 'picks', 'this_week']],
  ] as const)(
    '%s at place %i swaps with its neighbour',
    (action, position, kinds) => {
      const applied = applyHomeModuleOp(list, {
        action,
        position,
        kind: list[position]?.kind ?? 'picks',
      });
      expect(applied).toMatchObject({ status: 'changed', done: 'moved' });
      expect(
        applied.status === 'changed' && applied.modules.map((m) => m.kind),
      ).toEqual(kinds);
    },
  );

  it.each([
    ['up', 0],
    ['down', 3],
  ] as const)(
    '%s at the end of the list changes nothing',
    (action, position) => {
      expect(
        applyHomeModuleOp(list, {
          action,
          position,
          kind: list[position]?.kind ?? 'picks',
        }),
      ).toEqual({ status: 'stale' });
    },
  );

  it('switches a module on and off', () => {
    const on = applyHomeModuleOp(list, {
      action: 'enable',
      position: 3,
      kind: 'this_week',
    });
    expect(on).toMatchObject({ status: 'changed', done: 'enabled' });
    expect(on.status === 'changed' && on.modules[3]?.enabled).toBe(true);
    const off = applyHomeModuleOp(list, {
      action: 'disable',
      position: 0,
      kind: 'hero_search',
    });
    expect(off).toMatchObject({ status: 'changed', done: 'disabled' });
    expect(off.status === 'changed' && off.modules[0]?.enabled).toBe(false);
  });

  it('leaves the gift guide module as it is', () => {
    expect(
      applyHomeModuleOp(list, {
        action: 'disable',
        position: 2,
        kind: 'gift_guide',
      }),
    ).toEqual({ status: 'managed_elsewhere' });
  });

  it.each([
    [
      'a different kind now at that place',
      { action: 'up', position: 1, kind: 'hero_search' },
    ],
    ['a place past the end', { action: 'up', position: 9, kind: 'picks' }],
    [
      'a module already on',
      { action: 'enable', position: 0, kind: 'hero_search' },
    ],
    [
      'a module already off',
      { action: 'disable', position: 3, kind: 'this_week' },
    ],
  ] as const)('refuses a click for %s', (_name, op) => {
    expect(applyHomeModuleOp(list, op)).toEqual({ status: 'stale' });
  });

  it('can move a module past the gift guide module, which keeps its settings', () => {
    const applied = applyHomeModuleOp(list, {
      action: 'down',
      position: 1,
      kind: 'picks',
    });
    expect(applied.status === 'changed' && applied.modules[1]).toEqual(list[2]);
  });
});

describe('parseHomeModuleForm', () => {
  const base = { position: '0', kind: 'hero_search' };

  it('reads the module, its state and its settings', () => {
    expect(
      parseHomeModuleForm(
        form({
          ...base,
          enabled: 'on',
          heading: '  Find something ',
          body: JSON.stringify(text),
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        position: 0,
        kind: 'hero_search',
        enabled: true,
        heading: 'Find something',
        body: text,
        collectionId: null,
      },
    });
  });

  it('reads an unticked box as off and blank text as none', () => {
    expect(
      parseHomeModuleForm(
        form({
          ...base,
          body: JSON.stringify({ type: 'doc', content: [] }),
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: { enabled: false, heading: null, body: null },
    });
  });

  it.each([
    ['no place', { kind: 'picks' }],
    ['a place that is not a number', { position: 'x', kind: 'picks' }],
    ['no kind', { position: '1' }],
    ['an unknown kind', { position: '1', kind: 'banner' }],
  ])('is no edit for %s', (_name, fields) => {
    expect(parseHomeModuleForm(form(fields))).toBeNull();
  });

  it.each([
    ['a heading too long to read', { heading: 'h'.repeat(1001) }, 'heading'],
    ['a body too large to read', { body: 'b'.repeat(200_001) }, 'body'],
    ['a body that is not JSON', { body: 'not json' }, 'body'],
    ['a body that is not a document', { body: '{"type":"x"}' }, 'body'],
    ['a Pick that is not an id', { collectionId: 'nope' }, 'collectionId'],
  ])('refuses %s and names the field', (_name, extra, field) => {
    expect(parseHomeModuleForm(form({ ...base, ...extra }))).toEqual({
      ok: false,
      position: 0,
      fields: [field],
    });
  });
});

describe('applyHomeModuleEdit', () => {
  const edit = {
    position: 0,
    kind: 'hero_search',
    enabled: true,
    heading: 'New heading',
    body: text,
    collectionId: null,
  } as const;

  it('writes the settings the kind shows', () => {
    const applied = applyHomeModuleEdit(list, edit);
    expect(applied).toMatchObject({ status: 'changed', done: 'saved' });
    expect(applied.status === 'changed' && applied.modules[0]).toEqual({
      ...list[0],
      heading: 'New heading',
      body: text,
    });
  });

  it('keeps the settings the kind does not show', () => {
    const applied = applyHomeModuleEdit(list, {
      ...edit,
      position: 3,
      kind: 'this_week',
      enabled: true,
      body: text,
      collectionId: id,
    });
    expect(applied.status === 'changed' && applied.modules[3]).toEqual({
      ...list[3],
      enabled: true,
      heading: 'New heading',
    });
  });

  it('points a Picks module at the Pick the form names', () => {
    const applied = applyHomeModuleEdit(list, {
      ...edit,
      position: 1,
      kind: 'picks',
      collectionId: '1f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    });
    expect(
      applied.status === 'changed' && applied.modules[1]?.collectionId,
    ).toBe('1f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b');
  });

  it('refuses a heading the save would refuse and names it', () => {
    expect(
      applyHomeModuleEdit(list, { ...edit, heading: 'h'.repeat(121) }),
    ).toEqual({ status: 'invalid', fields: ['heading'] });
  });

  it.each([
    ['a different kind now at that place', { ...edit, kind: 'picks' }, 'stale'],
    ['a place past the end', { ...edit, position: 9 }, 'stale'],
    [
      'the gift guide module',
      { ...edit, position: 2, kind: 'gift_guide' },
      'managed_elsewhere',
    ],
  ] as const)('refuses an edit for %s', (_name, refused, status) => {
    expect(applyHomeModuleEdit(list, refused)).toEqual({ status });
  });
});

describe('homeOutcomeFor and homeRedirect', () => {
  const changed = { status: 'changed', modules: list, done: 'moved' } as const;

  it.each([
    [
      'a saved click',
      changed,
      { status: 'saved' },
      '/ops/editorial/home?notice=moved',
    ],
    [
      'a click with no save to make',
      { status: 'stale' },
      null,
      '/ops/editorial/home?notice=stale',
    ],
    [
      'a gift guide click',
      { status: 'managed_elsewhere' },
      null,
      '/ops/editorial/home?notice=managed_elsewhere',
    ],
  ] as const)('sends %s to the list', (_name, applied, saved, href) => {
    expect(homeRedirect(null, homeOutcomeFor(applied, saved))).toBe(href);
  });

  it.each([['unknown_collection'], ['collection_kind_mismatch']] as const)(
    'sends a save answered %s back to the form with the Pick marked',
    (status) => {
      expect(homeRedirect(1, homeOutcomeFor(changed, { status }))).toBe(
        `/ops/editorial/home/1?notice=${status}&fields=collectionId`,
      );
    },
  );

  it('sends a refused Pick met from the list to the list, with no field to mark', () => {
    expect(
      homeRedirect(
        null,
        homeOutcomeFor(changed, { status: 'unknown_collection' }),
      ),
    ).toBe('/ops/editorial/home?notice=unknown_collection');
  });

  it('sends an invalid edit back to its form with the fields', () => {
    expect(
      homeRedirect(
        2,
        homeOutcomeFor(
          { status: 'invalid', fields: ['heading', 'body'] },
          null,
        ),
      ),
    ).toBe('/ops/editorial/home/2?notice=invalid&fields=heading%2Cbody');
  });

  it('sends a saved edit to the list with the saved notice', () => {
    expect(
      homeRedirect(
        2,
        homeOutcomeFor(
          { status: 'changed', modules: list, done: 'saved' },
          { status: 'saved' },
        ),
      ),
    ).toBe('/ops/editorial/home?notice=saved');
  });
});

describe('buildHomeModuleRows', () => {
  const rows = buildHomeModuleRows(stored, [
    { id, title: 'Weekend workshops' },
  ]);

  it('says what each module is, its state, and what it shows', () => {
    expect(rows.map((r) => [r.label, r.stateLabel, r.detail])).toEqual([
      ['Hero and search', 'On', 'Find something'],
      ['Ramble Picks', 'On', 'Standard heading · Weekend workshops'],
      ['Gift guide', 'On', 'Managed with the gift guide.'],
      ['On this week', 'Off', 'Standard heading'],
    ]);
    expect(rows.map((r) => r.stateTone)).toEqual([
      'success',
      'success',
      'success',
      'neutral',
    ]);
  });

  it('offers a move only where there is a place to move to', () => {
    expect(rows.map((r) => [r.canMoveUp, r.canMoveDown])).toEqual([
      [false, true],
      [true, true],
      [true, true],
      [true, false],
    ]);
  });

  it('gives the gift guide row no switch and no editor, and offers the opposite switch to the others', () => {
    expect(rows.map((r) => [r.canSwitch, r.editable])).toEqual([
      [true, true],
      [true, true],
      [false, false],
      [true, true],
    ]);
    expect(rows[0]).toMatchObject({
      switchLabel: 'Turn off',
      switchValue: 'disable:0:hero_search',
      moveDownValue: 'down:0:hero_search',
    });
    expect(rows[3]).toMatchObject({
      switchLabel: 'Turn on',
      switchValue: 'enable:3:this_week',
    });
  });

  it('names a Pick that is not in the read by nothing rather than by its id', () => {
    expect(buildHomeModuleRows(stored, [])[1]?.detail).toBe('Standard heading');
  });
});

describe('editableModule', () => {
  it.each([
    ['a module with settings', '0', true],
    ['the gift guide module', '2', false],
    ['a place past the end', '9', false],
    ['a place that is not a number', 'x', false],
    ['a negative place', '-1', false],
  ])('%s: %s', (_name, place, found) => {
    expect(editableModule(stored, place) !== null).toBe(found);
  });

  it('finds no settings on a module that shows none', () => {
    const reassurance = [{ ...stored[0], kind: 'reassurance' }] as HomeModule[];
    expect(editableModule(reassurance, '0')).toBeNull();
  });
});

describe('pickOptions', () => {
  it('lists Picks only, marking drafts', () => {
    expect(
      pickOptions([
        { id, title: 'Live one', kind: 'pick', status: 'published' },
        { id: 'b', title: 'Draft one', kind: 'pick', status: 'draft' },
        { id: 'c', title: 'Gifts', kind: 'gift_guide', status: 'published' },
      ]),
    ).toEqual([
      { value: id, label: 'Live one' },
      { value: 'b', label: 'Draft one (draft)' },
    ]);
  });
});
