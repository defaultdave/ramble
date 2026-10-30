import { describe, expect, it } from 'vitest';
import { EmailAddressSchema } from './email/address';
import {
  GuestEmailSchema,
  GuestSchema,
  RecordConsentInputSchema,
  RecordPrivacyRequestInputSchema,
  anonymizeDecision,
  anonymizedEmail,
  consentDecision,
  consentKinds,
  consentKindsToWithdraw,
  consentSources,
  consentSourceAllowsStatus,
  consentStatuses,
  guestAcceptsWrites,
  isAnonymizedEmail,
  privacyRequestDecision,
  type PrivacyRequest,
} from './guests';

// Behaviours, one per decision, branch, or risk:
// - an email is stored in one spelling (case folded) and nothing else is repaired
// - an email the narrow pattern, the length limit, or the reserved erased-guest domain refuses is refused
// - a very long email is refused without being walked
// - the erased-guest address is derived from the id, is itself a valid address, and is recognized
// - each source records only the statuses it may (a table of every pair)
// - a consent input lower-cases the guest id, takes no extra field, and refuses an unknown kind, status, source
// - a repeat of the latest status records nothing; any other change, or a first answer, is recorded
// - an erasure withdraws each kind whose latest row is a grant, once each, in the kind list's order
// - a guest who is missing or erased accepts no writes
// - the anonymize decision names missing, already erased, and the guest to erase
// - a privacy request input lower-cases the guest id, takes no extra field, and refuses an unknown kind
// - a second open request of a kind returns the open one

const guestId = '11111111-1111-4111-8111-111111111111';

describe('GuestEmailSchema', () => {
  it('folds case and keeps the rest as given', () => {
    expect(GuestEmailSchema.parse('Pat.Smith+Tickets@Example.COM')).toBe(
      'pat.smith+tickets@example.com',
    );
  });

  it.each([
    ['blank', ''],
    ['no domain', 'pat@'],
    ['no at sign', 'pat.example.com'],
    ['a display name', 'Pat <pat@example.com>'],
    ['a space', 'pat smith@example.com'],
    ['a trailing space', 'pat@example.com '],
    ['a trailing newline', 'pat@example.com\n'],
    ['a single-label domain', 'pat@localhost'],
    ['non-ASCII', 'pät@example.com'],
    ['the erased-guest domain', 'pat@anonymized.invalid'],
    ['the erased-guest domain in capitals', 'pat@ANONYMIZED.INVALID'],
    ['254 characters and one more', `${'a'.repeat(243)}@example.com`],
  ])('refuses %s', (_name, email) => {
    expect(GuestEmailSchema.safeParse(email).success).toBe(false);
  });

  it('accepts the longest address the limit allows', () => {
    const email = `${'a'.repeat(242)}@example.com`;
    expect(email).toHaveLength(254);

    expect(GuestEmailSchema.safeParse(email).success).toBe(true);
  });

  it('refuses an input of a million characters', () => {
    expect(GuestEmailSchema.safeParse('a'.repeat(1_000_000)).success).toBe(
      false,
    );
  });
});

describe('the erased-guest address', () => {
  it('is derived from the lower-cased id', () => {
    expect(anonymizedEmail(guestId.toUpperCase())).toBe(
      `erased-${guestId}@anonymized.invalid`,
    );
  });

  it('is a valid address that is recognized as erased', () => {
    const email = anonymizedEmail(guestId);

    expect(EmailAddressSchema.safeParse(email).success).toBe(true);
    expect(isAnonymizedEmail(email)).toBe(true);
    expect(GuestSchema.shape.email.safeParse(email).success).toBe(true);
  });

  it('is not claimed by an ordinary address', () => {
    expect(isAnonymizedEmail('pat@example.com')).toBe(false);
    expect(isAnonymizedEmail('pat@sub.anonymized.invalid.example.com')).toBe(
      false,
    );
  });
});

describe('consentSourceAllowsStatus', () => {
  const allowed = new Set([
    'checkout:granted',
    'unsubscribe:withdrawn',
    'ops:granted',
    'ops:withdrawn',
    'erasure:withdrawn',
  ]);
  const pairs = consentSources.flatMap((source) =>
    consentStatuses.map((status) => ({ source, status })),
  );

  it.each(pairs)('$source with $status', ({ source, status }) => {
    expect(consentSourceAllowsStatus(source, status)).toBe(
      allowed.has(`${source}:${status}`),
    );
  });
});

describe('RecordConsentInputSchema', () => {
  const valid = {
    guestId,
    kind: 'newsletter',
    status: 'granted',
    source: 'checkout',
  };

  it('lower-cases the guest id', () => {
    expect(
      RecordConsentInputSchema.parse({
        ...valid,
        guestId: guestId.toUpperCase(),
      }).guestId,
    ).toBe(guestId);
  });

  it.each([
    ['an extra field', { ...valid, recordedAt: '2020-01-01' }],
    ['an unknown kind', { ...valid, kind: 'sms' }],
    ['an unknown status', { ...valid, status: 'pending' }],
    ['an unknown source', { ...valid, source: 'import' }],
    ['a guest id that is not a uuid', { ...valid, guestId: 'pat' }],
    ['a checkout that withdraws', { ...valid, status: 'withdrawn' }],
    [
      'an erasure that grants',
      { ...valid, source: 'erasure', status: 'granted' },
    ],
    [
      'an unsubscribe that grants',
      { ...valid, source: 'unsubscribe', status: 'granted' },
    ],
  ])('refuses %s', (_name, input) => {
    expect(RecordConsentInputSchema.safeParse(input).success).toBe(false);
  });

  it.each(consentKinds)('accepts the %s kind', (kind) => {
    expect(RecordConsentInputSchema.safeParse({ ...valid, kind }).success).toBe(
      true,
    );
  });
});

describe('consentDecision', () => {
  it.each([
    [null, 'granted', 'record'],
    [null, 'withdrawn', 'record'],
    ['granted', 'granted', 'unchanged'],
    ['withdrawn', 'withdrawn', 'unchanged'],
    ['granted', 'withdrawn', 'record'],
    ['withdrawn', 'granted', 'record'],
  ] as const)('latest %s, requested %s: %s', (latest, requested, expected) => {
    expect(consentDecision(latest, requested)).toBe(expected);
  });
});

describe('consentKindsToWithdraw', () => {
  it('withdraws nothing when there is no history', () => {
    expect(consentKindsToWithdraw([])).toEqual([]);
  });

  it('ignores a kind whose latest row is a withdrawal', () => {
    expect(
      consentKindsToWithdraw([{ kind: 'newsletter', status: 'withdrawn' }]),
    ).toEqual([]);
  });

  it('withdraws each granted kind once, in the kind list order', () => {
    expect(
      consentKindsToWithdraw([
        { kind: 'attribution', status: 'granted' },
        { kind: 'newsletter', status: 'granted' },
        { kind: 'newsletter', status: 'granted' },
      ]),
    ).toEqual(consentKinds);
  });
});

describe('guestAcceptsWrites', () => {
  it.each([
    ['a live guest', { anonymizedAt: null }, true],
    ['an erased guest', { anonymizedAt: new Date(0) }, false],
    ['no guest', null, false],
  ])('%s', (_name, guest, expected) => {
    expect(guestAcceptsWrites(guest)).toBe(expected);
  });
});

describe('anonymizeDecision', () => {
  it('names a missing guest', () => {
    expect(anonymizeDecision(null)).toEqual({ action: 'not_found' });
  });

  it('names an erased guest', () => {
    expect(anonymizeDecision({ anonymizedAt: new Date(0) })).toEqual({
      action: 'already_anonymized',
    });
  });

  it('returns the guest to erase', () => {
    const guest = { id: guestId, anonymizedAt: null };

    expect(anonymizeDecision(guest)).toEqual({ action: 'anonymize', guest });
  });
});

describe('RecordPrivacyRequestInputSchema', () => {
  it('lower-cases the guest id', () => {
    expect(
      RecordPrivacyRequestInputSchema.parse({
        guestId: guestId.toUpperCase(),
        kind: 'access',
      }).guestId,
    ).toBe(guestId);
  });

  it.each([
    ['an extra field', { guestId, kind: 'access', status: 'completed' }],
    ['an unknown kind', { guestId, kind: 'rectification' }],
    ['no kind', { guestId }],
    ['a guest id that is not a uuid', { guestId: 'pat', kind: 'access' }],
  ])('refuses %s', (_name, input) => {
    expect(RecordPrivacyRequestInputSchema.safeParse(input).success).toBe(
      false,
    );
  });
});

describe('privacyRequestDecision', () => {
  const open: PrivacyRequest = {
    id: '22222222-2222-4222-8222-222222222222',
    guestId,
    kind: 'deletion',
    status: 'open',
    createdAt: new Date(0),
    resolvedAt: null,
  };

  it('creates when none is open', () => {
    expect(privacyRequestDecision(null)).toEqual({ action: 'create' });
  });

  it('returns the open one', () => {
    expect(privacyRequestDecision(open)).toEqual({
      action: 'already_open',
      request: open,
    });
  });
});
