import { describe, expect, it } from 'vitest';
import { StartPaymentInputSchema } from '../checkout';
import {
  childAgeKeys,
  errorMessage,
  fieldMessage,
  firstErrorField,
  formIssues,
  initialValues,
  issueCount,
  issueSummary,
  startPaymentInput,
  type FormValues,
} from './checkoutForm';
import type { CheckoutView } from './checkoutPage';

// Behaviours under test:
// - initialValues: nothing ticked (PRD-15), one age box per child
// - startPaymentInput: sends only the fields the page asked for, trims, omits an empty phone
// - formIssues: runs the server's own rules before a try is spent; acceptances are required
// - firstErrorField and the copy: focus order, nested keys, a plain fallback

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const view: CheckoutView = {
  holdId: uuid(1),
  sessionId: uuid(2),
  experience: { id: uuid(3), slug: 'kayak', title: 'Kayak', hostName: 'Club' },
  expiresAt: '2026-10-23T14:10:00.000Z',
  serverNow: '2026-10-23T14:00:00.000Z',
  holdMinutes: 10,
  startsAt: '2026-10-24T21:30:00.000Z',
  timeZone: 'America/New_York',
  dateLabel: 'Sat, Oct 24',
  timeLabel: '5:30 PM',
  guests: 2,
  where: 'Tribeca',
  lines: [{ label: '$65 × 2 guests', amountMinor: 13_000 }],
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  totalMinor: 13_000,
  cancellationLine: 'Free cancellation until Fri, Oct 23, 5:30 PM.',
  ageSubject: { ageRule: 'minimum_age', minAge: 14, maxAge: null },
  children: 0,
  party: [{ priceOptionId: uuid(4), quantity: 2 }],
  termsDocument: { id: uuid(5), href: '/legal/terms' },
  waiverDocument: { id: uuid(6), href: '/legal/waiver-club' },
};

const withChildren: CheckoutView = {
  ...view,
  children: 2,
  ageSubject: { ageRule: 'all_ages', minAge: null, maxAge: null },
};

const filled: FormValues = {
  email: ' alex@example.com ',
  phone: '',
  newsletter: false,
  leadGuestName: ' Alex Rivera ',
  ageConfirmed: true,
  childAges: [],
  guardianName: '',
  guardianContact: '',
  waiverAccepted: true,
  termsAccepted: true,
};

describe('initialValues', () => {
  it('starts with nothing ticked and one age box per child', () => {
    expect(initialValues(withChildren)).toMatchObject({
      newsletter: false,
      ageConfirmed: false,
      waiverAccepted: false,
      termsAccepted: false,
      childAges: ['', ''],
    });
    expect(initialValues(view).childAges).toEqual([]);
  });
});

describe('startPaymentInput', () => {
  it('trims, omits an empty phone, and names the documents', () => {
    const input = startPaymentInput(filled, view);
    expect(input).toEqual({
      holdId: view.holdId,
      contact: { email: 'alex@example.com' },
      leadGuestName: 'Alex Rivera',
      attendees: { ageConfirmed: true },
      waiverDocumentId: view.waiverDocument?.id,
      termsDocumentId: view.termsDocument.id,
      newsletterOptIn: false,
    });
    expect(StartPaymentInputSchema.safeParse(input).success).toBe(true);
  });

  it('sends a phone number that was typed', () => {
    expect(
      startPaymentInput({ ...filled, phone: ' 212 555 0100 ' }, view).contact,
    ).toEqual({ email: 'alex@example.com', phone: '212 555 0100' });
  });

  it('asks for no age confirmation and no waiver where the experience has none', () => {
    const input = startPaymentInput(filled, {
      ...view,
      ageSubject: { ageRule: 'all_ages', minAge: null, maxAge: null },
      waiverDocument: null,
    });
    expect(input.attendees).toEqual({});
    expect(input.waiverDocumentId).toBeUndefined();
  });

  it('sends the children, their ages, and the guardian', () => {
    const input = startPaymentInput(
      {
        ...filled,
        childAges: ['9', ' 12 '],
        guardianName: ' Sam ',
        guardianContact: ' sam@example.com ',
      },
      withChildren,
    );
    expect(input.attendees).toEqual({
      childrenAges: [9, 12],
      guardian: { name: 'Sam', contact: 'sam@example.com' },
    });
  });

  it('sends the newsletter choice as made', () => {
    expect(
      startPaymentInput({ ...filled, newsletter: true }, view).newsletterOptIn,
    ).toBe(true);
  });
});

describe('formIssues', () => {
  it('finds nothing wrong with a filled form', () => {
    expect(formIssues(filled, view)).toEqual({});
  });

  it('requires an email, a name, and every acceptance', () => {
    const errors = formIssues(
      {
        ...filled,
        email: '',
        leadGuestName: '  ',
        ageConfirmed: false,
        waiverAccepted: false,
        termsAccepted: false,
      },
      view,
    );
    expect(errors).toMatchObject({
      'contact.email': 'invalid',
      leadGuestName: 'invalid',
      'attendees.ageConfirmed': 'required',
      waiverDocumentId: 'required',
      termsDocumentId: 'required',
    });
  });

  it('refuses an address that is not one', () => {
    expect(formIssues({ ...filled, email: 'alex' }, view)).toHaveProperty(
      'contact.email',
    );
  });

  it('does not ask for the waiver where there is none', () => {
    expect(
      formIssues(
        { ...filled, waiverAccepted: false },
        { ...view, waiverDocument: null },
      ),
    ).toEqual({});
  });

  it.each([
    [['', '9'], 'required'],
    [['nine', '9'], 'invalid'],
    [['9', '1.5'], 'invalid'],
    [['9', '120'], 'invalid'],
  ])('reads the typed ages %j as %s', (childAges, code) => {
    const errors = formIssues(
      {
        ...filled,
        ageConfirmed: true,
        childAges,
        guardianName: 'Sam',
        guardianContact: 'sam@example.com',
      },
      withChildren,
    );
    expect(errors['attendees.childrenAges']).toBe(code);
  });

  it('applies the experience age range to a child', () => {
    const errors = formIssues(
      {
        ...filled,
        childAges: ['3', '9'],
        guardianName: 'Sam',
        guardianContact: 'sam@example.com',
      },
      {
        ...withChildren,
        ageSubject: { ageRule: 'age_range', minAge: 6, maxAge: 12 },
      },
    );
    expect(errors).toEqual({ 'attendees.childrenAges': 'out_of_range' });
  });

  it('asks for a guardian when children come', () => {
    const errors = formIssues(
      { ...filled, childAges: ['9', '9'] },
      withChildren,
    );
    expect(
      Object.keys(errors).some((key) => key.startsWith('attendees.guardian')),
    ).toBe(true);
  });
});

describe('firstErrorField', () => {
  it('goes to the first field in page order, not the order the codes arrived in', () => {
    expect(
      firstErrorField({
        termsDocumentId: 'required',
        'contact.email': 'invalid',
      }),
    ).toBe('contact.email');
  });

  it('matches a nested key to its group', () => {
    expect(firstErrorField({ 'attendees.guardian.name': 'invalid' })).toBe(
      'attendees.guardian',
    );
  });

  it('falls back to a field it does not know, and to none', () => {
    expect(firstErrorField({ holdId: 'not_payable' })).toBe('holdId');
    expect(firstErrorField({})).toBeNull();
  });
});

describe('copy', () => {
  it('has words for the codes the server sends', () => {
    expect(fieldMessage('contact.email', 'required')).toBe(
      'Enter your email address.',
    );
    expect(fieldMessage('holdId', 'not_payable')).toMatch(/cannot be paid/);
  });

  it.each([
    ['required', 'Fill in this field.'],
    ['out_of_range', 'Check this field.'],
  ])(
    'falls back to a plain sentence for %s on a field with no copy',
    (code, text) => {
      expect(fieldMessage('somethingNew', code)).toBe(text);
    },
  );

  it('reads a child age error from its own key, then the group', () => {
    expect(childAgeKeys(1)).toEqual([
      'attendees.childrenAges.1',
      'attendees.childrenAges',
    ]);
  });

  it('counts the problems and says so', () => {
    expect(issueCount({ a: 'x', b: 'y' })).toBe(2);
    expect(issueSummary(1)).toBe('There is 1 thing to fix before you can pay.');
    expect(issueSummary(3)).toBe(
      'There are 3 things to fix before you can pay.',
    );
  });
});

describe('errorMessage', () => {
  it('reads the first key that has an error', () => {
    expect(
      errorMessage(
        { 'attendees.guardian': 'required' },
        'attendees.guardian.name',
        'attendees.guardian',
      ),
    ).toBe(
      'Enter the name and contact of the adult who comes with the children.',
    );
  });

  it('prefers the more specific key', () => {
    expect(
      errorMessage(
        { 'contact.email': 'required', leadGuestName: 'required' },
        'contact.email',
        'leadGuestName',
      ),
    ).toBe('Enter your email address.');
  });

  it('says nothing when no key has an error', () => {
    expect(errorMessage({}, 'contact.email')).toBeUndefined();
  });
});
