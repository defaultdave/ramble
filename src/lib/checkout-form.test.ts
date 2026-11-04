import { describe, expect, it } from 'vitest';
import {
  StartPaymentInputSchema,
  acceptedDocumentIds,
  attendeeIssues,
  inputIssues,
  invalidStartPayment,
  legalIssues,
} from './checkout';
import {
  holdId,
  termsId,
  waiverId,
  validInput,
  parsed,
} from './checkout.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the form: a full one parses with ids lower-cased and the email folded; the optional parts may be
//   left out; each bad field is refused (ids, email, names, phone, ages, guardian, attribution), and
//   an oversize string is refused without being walked
// - a failed parse is one code per field, keyed by its whole path, `required` only when a rule says so
// - age rules (PRD-23): every limit needs the booker's confirmation; each child gives one age in range;
//   a guardian comes with children and only with children
// - terms and waiver (PRD-24): terms must be the current published version; a waiver is required exactly
//   when the experience requires one, and is that experience's own published document

describe('the form', () => {
  it('parses a full form, lower-casing ids and folding the email', () => {
    const parsed = StartPaymentInputSchema.parse({
      holdId: holdId.toUpperCase(),
      contact: { email: 'Pat@Example.COM', phone: '212-555-0100' },
      leadGuestName: 'Pat Smith',
      attendees: {
        ageConfirmed: true,
        childrenAges: [7, 9],
        guardian: { name: 'Pat Smith', contact: 'pat@example.com' },
      },
      waiverDocumentId: waiverId.toUpperCase(),
      termsDocumentId: termsId.toUpperCase(),
      newsletterOptIn: true,
      attribution: { source: 'news', campaign: 'fall', issue: '12' },
    });

    expect(parsed.holdId).toBe(holdId);
    expect(parsed.contact.email).toBe('pat@example.com');
    expect(parsed.waiverDocumentId).toBe(waiverId);
    expect(parsed.termsDocumentId).toBe(termsId);
  });

  it('parses a form with every optional part left out', () => {
    expect(StartPaymentInputSchema.safeParse(validInput).success).toBe(true);
    expect(
      StartPaymentInputSchema.safeParse({
        ...validInput,
        contact: { email: 'pat@example.com' },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a hold id that is not an id', { holdId: 'nope' }],
    ['no terms version', { termsDocumentId: undefined }],
    ['a waiver id that is not an id', { waiverDocumentId: 'nope' }],
    ['a newsletter flag that is not a boolean', { newsletterOptIn: 'yes' }],
    ['a blank lead guest', { leadGuestName: '   ' }],
    ['a lead guest of 121 characters', { leadGuestName: 'a'.repeat(121) }],
    [
      'a lead guest of a million characters',
      { leadGuestName: 'a'.repeat(1e6) },
    ],
    ['an email with no domain', { contact: { email: 'pat@' } }],
    ['an erased-guest address', { contact: { email: 'x@anonymized.invalid' } }],
    [
      'a phone of 41 characters',
      { contact: { email: 'pat@example.com', phone: '1'.repeat(41) } },
    ],
    ['a blank phone', { contact: { email: 'pat@example.com', phone: '  ' } }],
    ['a child aged -1', { attendees: { childrenAges: [-1] } }],
    ['a child aged 18', { attendees: { childrenAges: [18] } }],
    ['a child aged 7.5', { attendees: { childrenAges: [7.5] } }],
    ['an empty list of ages', { attendees: { childrenAges: [] } }],
    [
      'more ages than a party can hold',
      { attendees: { childrenAges: Array.from({ length: 101 }, () => 5) } },
    ],
    [
      'a guardian with no contact',
      { attendees: { guardian: { name: 'Pat Smith' } } },
    ],
    [
      'a guardian contact of 255 characters',
      {
        attendees: {
          guardian: { name: 'Pat Smith', contact: 'a'.repeat(255) },
        },
      },
    ],
    [
      'an attribution source of 101 characters',
      { attribution: { source: 'a'.repeat(101) } },
    ],
    ['a blank attribution campaign', { attribution: { campaign: ' ' } }],
  ])('refuses %s', (_name, change) => {
    expect(
      StartPaymentInputSchema.safeParse({ ...validInput, ...change }).success,
    ).toBe(false);
  });

  it('keys a failed parse by the whole path and says required only when a rule does', () => {
    const parsed = StartPaymentInputSchema.safeParse({
      ...validInput,
      contact: { email: 'pat@' },
      leadGuestName: ' ',
      attendees: { childrenAges: [30] },
    });
    if (parsed.success) throw new Error('expected a refusal');

    expect(invalidStartPayment(parsed.error.issues)).toEqual({
      status: 'invalid',
      fieldErrors: {
        'contact.email': 'invalid',
        leadGuestName: 'invalid',
        'attendees.childrenAges.0': 'invalid',
      },
    });
  });

  it('names the whole input when the issue has no path', () => {
    expect(
      invalidStartPayment([{ path: [], message: 'Invalid input' }]),
    ).toEqual({ status: 'invalid', fieldErrors: { input: 'invalid' } });
  });
});

describe('age rules', () => {
  const allAges = { ageRule: 'all_ages', minAge: null, maxAge: null } as const;
  const twentyOne = {
    ageRule: 'twenty_one_plus',
    minAge: null,
    maxAge: null,
  } as const;
  const minimum = { ageRule: 'minimum_age', minAge: 8, maxAge: null } as const;
  const range = { ageRule: 'age_range', minAge: 6, maxAge: 12 } as const;
  const guardian = { name: 'Pat Smith', contact: 'pat@example.com' };

  it.each([
    ['an all-ages party of adults', allAges, {}, 0, {}],
    [
      'an all-ages party with a child of any age',
      allAges,
      { childrenAges: [0], guardian },
      1,
      {},
    ],
    ['a 21+ party confirmed', twentyOne, { ageConfirmed: true }, 0, {}],
    [
      'a 21+ party not confirmed',
      twentyOne,
      {},
      0,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a 21+ party confirmed false',
      twentyOne,
      { ageConfirmed: false },
      0,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a minimum-age party not confirmed',
      minimum,
      {},
      0,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a range party not confirmed',
      range,
      { childrenAges: [8], guardian },
      1,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a child at the minimum age',
      minimum,
      { ageConfirmed: true, childrenAges: [8], guardian },
      1,
      {},
    ],
    [
      'a child below the minimum age',
      minimum,
      { ageConfirmed: true, childrenAges: [7], guardian },
      1,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'a child at the bottom of the range',
      range,
      { ageConfirmed: true, childrenAges: [6], guardian },
      1,
      {},
    ],
    [
      'a child at the top of the range',
      range,
      { ageConfirmed: true, childrenAges: [12], guardian },
      1,
      {},
    ],
    [
      'a child above the range',
      range,
      { ageConfirmed: true, childrenAges: [13], guardian },
      1,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'one of two children out of range',
      range,
      { ageConfirmed: true, childrenAges: [7, 15], guardian },
      2,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'a child at a 21+ experience',
      twentyOne,
      { ageConfirmed: true, childrenAges: [9], guardian },
      1,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'children with no ages',
      allAges,
      { guardian },
      2,
      { 'attendees.childrenAges': 'required' },
    ],
    [
      'fewer ages than children',
      allAges,
      { childrenAges: [7], guardian },
      2,
      { 'attendees.childrenAges': 'invalid' },
    ],
    [
      'more ages than children',
      allAges,
      { childrenAges: [7, 8] },
      1,
      { 'attendees.childrenAges': 'invalid', 'attendees.guardian': 'required' },
    ],
    [
      'ages with no children in the party',
      allAges,
      { childrenAges: [7] },
      0,
      { 'attendees.childrenAges': 'invalid' },
    ],
    [
      'children with no guardian',
      allAges,
      { childrenAges: [7] },
      1,
      { 'attendees.guardian': 'required' },
    ],
    [
      'a guardian with no children',
      allAges,
      { guardian },
      0,
      { 'attendees.guardian': 'invalid' },
    ],
  ])('%s', (_name, subject, attendees, children, expected) => {
    expect(
      attendeeIssues(subject, parsed({ attendees }).attendees, children),
    ).toEqual(expected);
  });
});

describe('terms and waiver', () => {
  const needsWaiver = { waiverRequired: true, waiverDocumentId: waiverId };
  const noWaiver = { waiverRequired: false, waiverDocumentId: null };
  const current = { terms: { id: termsId }, waiver: null };
  const withWaiver = { terms: { id: termsId }, waiver: { id: waiverId } };

  const input = (change: object = {}) =>
    parsed({ waiverDocumentId: undefined, ...change });

  it.each([
    ['current terms, no waiver needed', noWaiver, input(), current, {}],
    [
      'current terms and the experience waiver',
      needsWaiver,
      input({ waiverDocumentId: waiverId }),
      withWaiver,
      {},
    ],
    [
      'terms that are not the current version',
      noWaiver,
      input({ termsDocumentId: waiverId }),
      current,
      { termsDocumentId: 'invalid' },
    ],
    [
      'no current terms published',
      noWaiver,
      input(),
      { terms: null, waiver: null },
      { termsDocumentId: 'invalid' },
    ],
    [
      'a required waiver left out',
      needsWaiver,
      input(),
      withWaiver,
      { waiverDocumentId: 'required' },
    ],
    [
      'a waiver sent where none is needed',
      noWaiver,
      input({ waiverDocumentId: waiverId }),
      withWaiver,
      { waiverDocumentId: 'invalid' },
    ],
    [
      'another document sent as the waiver',
      needsWaiver,
      input({ waiverDocumentId: termsId }),
      { terms: { id: termsId }, waiver: { id: termsId } },
      { waiverDocumentId: 'invalid' },
    ],
    [
      'a waiver that is not published',
      needsWaiver,
      input({ waiverDocumentId: waiverId }),
      current,
      { waiverDocumentId: 'invalid' },
    ],
    [
      'an experience that requires a waiver but names none',
      { waiverRequired: true, waiverDocumentId: null },
      input({ waiverDocumentId: waiverId }),
      withWaiver,
      { waiverDocumentId: 'invalid' },
    ],
  ])('%s', (_name, experience, form, published, expected) => {
    expect(legalIssues(experience, form, published)).toEqual(expected);
  });

  it('lists the age and the terms issues together', () => {
    expect(
      inputIssues(
        {
          ageRule: 'twenty_one_plus',
          minAge: null,
          maxAge: null,
          ...noWaiver,
        },
        input({ termsDocumentId: waiverId }),
        0,
        current,
      ),
    ).toEqual({
      'attendees.ageConfirmed': 'required',
      termsDocumentId: 'invalid',
    });
  });

  it('accepts the terms, and the waiver when one was sent', () => {
    expect(acceptedDocumentIds(input())).toEqual([termsId]);
    expect(acceptedDocumentIds(input({ waiverDocumentId: waiverId }))).toEqual([
      termsId,
      waiverId,
    ]);
  });
});
