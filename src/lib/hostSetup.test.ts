import { describe, expect, it } from 'vitest';
import {
  agreementRecordPrompt,
  agreementTickLabel,
  acceptanceRecordLabel,
  agreementNotice,
  agreementRefusal,
  isSlugTakenError,
  buildHostDetail,
  buildHostListRows,
  changedHostFields,
  decideHostAcceptance,
  hostAcceptanceState,
  hostLimits,
  hostNotices,
  hostPath,
  inviteNotice,
  ownerCellLabel,
  parseHostCreateForm,
  parseHostEditForm,
  type HostInput,
  hostFieldProblems,
  hostFormFields,
  hostNoticeCodes,
} from './hostSetup';
import { noticeHref, parseNotice } from './opsForm';

// Behaviours under test, one per decision, branch, or risk:
// - the create form turns a filled form into a host and an owner: text is trimmed, a blank slug comes from the name, blank optional fields are null, addresses are lower-cased
// - the create form names every field it refuses, and nothing else: a blank or long name, a bad or long slug, a name that leaves no slug, an unknown or malformed time zone, a bad notice address, a long or blank-only description, a missing or bad owner address
// - a field longer than the raw limit is refused unread
// - the agreement box carries the version it was ticked for, lower-cased, and anything else is no acceptance
// - the edit form never derives a slug: a blank one is refused, and an owner address is ignored
// - the changed fields are exactly the ones that differ, in form order
// - an acceptance is decided against the current version: none to accept, a version since replaced, already accepted, or recorded
// - a host stands as accepted, outdated, missing, or without a document to accept
// - the list and the detail pick each host's own owners and acceptances
// - addresses name a known notice only and the fields a refused form needs another look at
// - every result of an invite or an acceptance has one notice, and a lapsed host or owner is a failure to send

const filled = {
  name: '  Spoke & Saddle ',
  slug: '',
  description: ' Two cycling teachers. ',
  timeZone: ' America/New_York ',
  notificationEmail: ' Bookings@Example.com ',
  ownerEmail: ' Owner@Example.com ',
};

const formOf = (fields: Record<string, unknown>) => (name: string) =>
  fields[name];

describe('parseHostCreateForm', () => {
  it('reads a filled form, deriving the slug and lower-casing the addresses', () => {
    expect(parseHostCreateForm(formOf(filled))).toEqual({
      ok: true,
      value: {
        name: 'Spoke & Saddle',
        slug: 'spoke-saddle',
        description: 'Two cycling teachers.',
        timeZone: 'America/New_York',
        notificationEmail: 'bookings@example.com',
        ownerEmail: 'owner@example.com',
        acceptedLegalDocumentId: null,
      },
    });
  });

  it('keeps a typed slug and leaves blank optional fields null', () => {
    const result = parseHostCreateForm(
      formOf({
        name: 'Quill',
        slug: 'quill-press',
        description: '  ',
        timeZone: 'UTC',
        notificationEmail: '',
        ownerEmail: 'a@example.com',
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        slug: 'quill-press',
        description: null,
        notificationEmail: null,
      },
    });
  });

  it.each([
    ['a blank name', { name: ' ' }, ['name']],
    [
      'a name over the limit',
      { name: 'a'.repeat(hostLimits.name + 1) },
      ['name'],
    ],
    ['a slug with capitals', { slug: 'Bad Slug' }, ['slug']],
    [
      'a slug over the limit',
      { slug: 'a'.repeat(hostLimits.slug + 1) },
      ['slug'],
    ],
    ['a name that leaves no slug', { name: '!!!', slug: '' }, ['slug']],
    [
      'a name too long to make a slug from',
      { name: 'a'.repeat(hostLimits.slug + 1), slug: '' },
      ['slug'],
    ],
    ['a time zone that is not a name', { timeZone: 'new york' }, ['timeZone']],
    [
      'a time zone Intl does not know',
      { timeZone: 'Mars/Phobos' },
      ['timeZone'],
    ],
    ['a missing time zone', { timeZone: '' }, ['timeZone']],
    [
      'a notice address that is not one',
      { notificationEmail: 'nope' },
      ['notificationEmail'],
    ],
    [
      'a description over the limit',
      { description: 'a'.repeat(hostLimits.description + 1) },
      ['description'],
    ],
    ['a missing owner address', { ownerEmail: '' }, ['ownerEmail']],
    [
      'an owner address that is not one',
      { ownerEmail: 'owner' },
      ['ownerEmail'],
    ],
    [
      'several at once, in form order',
      { ownerEmail: 'x', name: '', timeZone: 'no' },
      ['name', 'timeZone', 'ownerEmail'],
    ],
  ])('refuses %s and names the field', (_label, change, fields) => {
    expect(
      parseHostCreateForm(formOf({ ...filled, slug: 'ok-slug', ...change })),
    ).toEqual({ ok: false, fields });
  });

  it('refuses a field over the raw limit without reading it', () => {
    const huge = 'a'.repeat(hostLimits.rawField + 1);

    expect(
      parseHostCreateForm(formOf({ ...filled, description: huge })),
    ).toEqual({ ok: false, fields: ['description'] });
  });

  it('treats a value that is not text as absent', () => {
    expect(
      parseHostCreateForm(formOf({ ...filled, name: new Blob(['x']) })),
    ).toEqual({ ok: false, fields: ['name'] });
  });

  it.each([
    [
      'an id',
      '0F1E2D3C-4B5A-4697-8A9B-0C1D2E3F4A5B',
      '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    ],
    ['nothing', undefined, null],
  ])('reads the agreement box as %s', (_label, ticked, expected) => {
    const result = parseHostCreateForm(
      formOf({ ...filled, acceptLegalDocumentId: ticked }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { acceptedLegalDocumentId: expected },
    });
  });
});

describe('parseHostEditForm', () => {
  it('reads the record and ignores an owner address', () => {
    const result = parseHostEditForm(
      formOf({ ...filled, slug: 'spoke-saddle', ownerEmail: 'x@example.com' }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Spoke & Saddle',
        slug: 'spoke-saddle',
        description: 'Two cycling teachers.',
        timeZone: 'America/New_York',
        notificationEmail: 'bookings@example.com',
      },
    });
  });

  it('refuses a blank slug instead of renaming the host from its name', () => {
    expect(parseHostEditForm(formOf({ ...filled, slug: '' }))).toEqual({
      ok: false,
      fields: ['slug'],
    });
  });
});

describe('changedHostFields', () => {
  const before: HostInput = {
    name: 'A',
    slug: 'a',
    description: null,
    timeZone: 'UTC',
    notificationEmail: null,
  };

  it('lists the fields that differ, in form order', () => {
    expect(
      changedHostFields(before, {
        ...before,
        timeZone: 'America/New_York',
        name: 'B',
        description: 'Now there is one.',
      }),
    ).toEqual(['name', 'description', 'timeZone']);
  });

  it('lists nothing for the same record', () => {
    expect(changedHostFields(before, { ...before })).toEqual([]);
  });
});

describe('decideHostAcceptance', () => {
  it.each([
    ['there is no current version', null, 'a', [], 'no_current_document'],
    ['the version shown is no longer current', 'b', 'a', [], 'stale'],
    ['no version was shown', 'b', null, [], 'stale'],
    [
      'the current version is already accepted',
      'b',
      'b',
      ['a', 'b'],
      'already_accepted',
    ],
    ['only an older version was accepted', 'b', 'b', ['a'], 'recorded'],
    ['nothing was accepted yet', 'b', 'b', [], 'recorded'],
  ])(
    'when %s the outcome is %s',
    (_label, currentId, submittedId, acceptedIds, outcome) => {
      expect(
        decideHostAcceptance({ currentId, submittedId, acceptedIds }),
      ).toBe(outcome);
    },
  );
});

describe('hostAcceptanceState', () => {
  it.each([
    [null, [], 'no_document'],
    [null, ['a'], 'no_document'],
    ['b', ['a', 'b'], 'accepted'],
    ['b', ['a'], 'outdated'],
    ['b', [], 'missing'],
  ])('current %j with %j accepted is %s', (currentId, acceptedIds, state) => {
    expect(hostAcceptanceState({ currentId, acceptedIds })).toBe(state);
  });
});

describe('buildHostListRows and buildHostDetail', () => {
  const hostA = { id: 'ha', name: 'A', slug: 'a', timeZone: 'UTC' };
  const hostB = { id: 'hb', name: 'B', slug: 'b', timeZone: 'UTC' };
  const owners = [
    { hostId: 'ha', userId: 'u1', email: 'one@example.com' },
    { hostId: 'hb', userId: 'u2', email: 'two@example.com' },
    { hostId: 'ha', userId: 'u3', email: 'three@example.com' },
    { hostId: null, userId: 'u4', email: 'four@example.com' },
  ];
  const at = new Date('2026-11-01T15:00:00Z');
  const acceptances = [
    { hostId: 'ha', legalDocumentId: 'doc2', version: 2, acceptedAt: at },
    { hostId: 'hb', legalDocumentId: 'doc1', version: 1, acceptedAt: at },
  ];

  it('gives each host its own owners and its own standing against the current agreement', () => {
    expect(
      buildHostListRows({
        hosts: [hostA, hostB],
        owners,
        acceptances,
        currentAgreementId: 'doc2',
      }),
    ).toEqual([
      {
        ...hostA,
        ownerEmails: ['one@example.com', 'three@example.com'],
        acceptance: 'accepted',
      },
      { ...hostB, ownerEmails: ['two@example.com'], acceptance: 'outdated' },
    ]);
  });

  it('builds one host with only its own owners and acceptances', () => {
    const detail = buildHostDetail({
      host: { ...hostB, description: 'Text', notificationEmail: null },
      owners,
      acceptances,
      agreement: { id: 'doc2', version: 2, title: 'Host agreement' },
    });

    expect(detail.owners).toEqual([{ userId: 'u2', email: 'two@example.com' }]);
    expect(detail.acceptances).toEqual([
      { legalDocumentId: 'doc1', version: 1, acceptedAt: at },
    ]);
    expect(detail.host).toMatchObject({ id: 'hb', description: 'Text' });
    expect(detail.agreement).toEqual({
      id: 'doc2',
      version: 2,
      title: 'Host agreement',
    });
  });

  it('keeps no agreement when none is published', () => {
    expect(
      buildHostDetail({
        host: { ...hostA, description: null, notificationEmail: null },
        owners: [],
        acceptances: [],
        agreement: null,
      }).agreement,
    ).toBeNull();
  });
});

describe('labels', () => {
  it('names an owner column by its addresses, or none', () => {
    expect(ownerCellLabel(['a@example.com', 'b@example.com'])).toBe(
      'a@example.com, b@example.com',
    );
    expect(ownerCellLabel([])).toBe('None');
  });

  it('writes an acceptance as its version and its day in the host zone', () => {
    expect(
      acceptanceRecordLabel(
        {
          legalDocumentId: 'x',
          version: 3,
          acceptedAt: new Date('2026-11-02T03:30:00Z'),
        },
        'America/New_York',
      ),
    ).toBe('Version 3, accepted Sunday, November 1, 2026');
  });

  it('has no em dash in any notice', () => {
    expect(JSON.stringify(hostNotices)).not.toContain('—');
  });
});

describe('notices in the address', () => {
  it('names exactly the codes that have a notice', () => {
    expect([...hostNoticeCodes].sort()).toEqual(
      Object.keys(hostNotices).sort(),
    );
  });

  it('names exactly the form fields that have a problem sentence', () => {
    expect([...hostFormFields].sort()).toEqual(
      Object.keys(hostFieldProblems).sort(),
    );
  });

  it('builds the address of a host', () => {
    expect(hostPath('x')).toBe('/ops/hosts/x');
  });
});

describe('the notice an action ends on', () => {
  it.each([
    ['sent', true, 'created'],
    ['sent', false, 'invited'],
    ['rate_limited', true, 'rate_limited'],
    ['rate_limited', false, 'rate_limited'],
    ['failed', true, 'created_invite_failed'],
    ['failed', false, 'invite_failed'],
    ['not_found', true, 'created_invite_failed'],
    ['not_found', false, 'invite_failed'],
  ] as const)(
    'an invite %s after create %s is %s',
    (result, afterCreate, notice) => {
      expect(inviteNotice(result, afterCreate)).toBe(notice);
    },
  );

  it.each([
    ['recorded', 'accepted'],
    ['already_accepted', 'already_accepted'],
    ['stale', 'stale_agreement'],
    ['no_current_document', 'no_agreement'],
  ] as const)('an acceptance %s is %s', (outcome, notice) => {
    expect(agreementNotice(outcome)).toBe(notice);
  });
});

describe('a ticked agreement box that cannot be read', () => {
  it.each([['on'], ['not-an-id'], [42]])(
    'refuses %j as a bad form, not as not ticked',
    (ticked) => {
      expect(
        parseHostCreateForm(
          formOf({ ...filled, acceptLegalDocumentId: ticked }),
        ),
      ).toEqual({ ok: false, fields: ['acceptLegalDocumentId'] });
    },
  );

  it.each([[''], [undefined], [null]])('reads %j as not ticked', (empty) => {
    expect(
      parseHostCreateForm(formOf({ ...filled, acceptLegalDocumentId: empty })),
    ).toMatchObject({ ok: true, value: { acceptedLegalDocumentId: null } });
  });
});

describe('agreementRefusal', () => {
  it.each([
    ['stale', 'stale'],
    ['no_current_document', 'no_current_document'],
    ['recorded', null],
    ['already_accepted', null],
  ] as const)('%s refuses as %s', (outcome, refusal) => {
    expect(agreementRefusal(outcome)).toBe(refusal);
  });
});

describe('isSlugTakenError', () => {
  const unique = (constraint: string, code = '23505') => ({ code, constraint });

  it.each([
    [
      'a driver error wrapped by the query layer',
      { cause: unique('hosts_slug_unique') },
      true,
    ],
    ['the bare driver error', unique('hosts_slug_unique'), true],
    [
      'another unique index',
      { cause: unique('auth_users_email_unique') },
      false,
    ],
    [
      'another error code',
      { cause: unique('hosts_slug_unique', '23514') },
      false,
    ],
    ['an error with no cause', new Error('x'), false],
    ['a value that is not an error', 'hosts_slug_unique', false],
    ['null', null, false],
  ])('%s is %s', (_label, error, expected) => {
    expect(isSlugTakenError(error)).toBe(expected);
  });
});

describe('the slug-taken notice', () => {
  it('is a known notice that names the slug field', () => {
    expect(parseNotice('slug_taken', hostNoticeCodes)).toBe('slug_taken');
    expect(noticeHref('/ops/hosts/new', 'slug_taken', ['slug'])).toBe(
      '/ops/hosts/new?notice=slug_taken&fields=slug',
    );
    expect(hostNotices.slug_taken.tone).toBe('danger');
  });
});

describe('buildHostDetail acceptance', () => {
  const host = {
    id: 'h',
    name: 'H',
    slug: 'h',
    timeZone: 'UTC',
    description: null,
    notificationEmail: null,
  };
  const at = new Date('2026-11-01T15:00:00Z');
  const build = (acceptedId: string | null, agreementId: string | null) =>
    buildHostDetail({
      host,
      owners: [],
      acceptances: acceptedId
        ? [
            {
              hostId: 'h',
              legalDocumentId: acceptedId,
              version: 1,
              acceptedAt: at,
            },
          ]
        : [],
      agreement: agreementId
        ? { id: agreementId, version: 2, title: 'A' }
        : null,
    }).acceptance;

  it.each([
    ['accepted the current one', 'x', 'x', 'accepted'],
    ['accepted an older one', 'old', 'x', 'outdated'],
    ['accepted none', null, 'x', 'missing'],
    ['no agreement published', null, null, 'no_document'],
  ])('a host that %s is %s', (_label, accepted, current, state) => {
    expect(build(accepted, current)).toBe(state);
  });
});

describe('agreement wording', () => {
  const agreement = { title: 'Host agreement', version: 3 };

  it('names the document and version in the tick label', () => {
    expect(agreementTickLabel(agreement)).toBe(
      'The host has accepted the current Host agreement (version 3), which includes the content-rights terms.',
    );
  });

  it('names the document and version in the record prompt', () => {
    expect(agreementRecordPrompt(agreement)).toBe(
      'Record that this host accepted the current Host agreement, version 3, which includes the content-rights terms.',
    );
  });
});
