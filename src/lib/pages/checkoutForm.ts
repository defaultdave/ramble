import {
  StartPaymentInputSchema,
  attendeeIssues,
  invalidStartPayment,
  type FieldErrors,
  type StartPaymentInput,
} from '../checkout';
import { ageRequirements } from '../checkout';
import type { CheckoutView } from './checkoutPage';

// The checkout form: what the guest types, what it becomes, and what is wrong with it. The same
// rules the server applies run here first, so a form that cannot pay does not spend one of the
// hold's five tries (`payment_tries`).

export type FormValues = {
  email: string;
  phone: string;
  newsletter: boolean;
  leadGuestName: string;
  ageConfirmed: boolean;
  /** One entry per child, as typed. */
  childAges: string[];
  guardianName: string;
  guardianContact: string;
  waiverAccepted: boolean;
  termsAccepted: boolean;
};

/** The empty form for a hold: nothing ticked, not even the newsletter (PRD-15), one age box per child. */
export function initialValues(
  view: Pick<CheckoutView, 'children'>,
): FormValues {
  return {
    email: '',
    phone: '',
    newsletter: false,
    leadGuestName: '',
    ageConfirmed: false,
    childAges: Array.from({ length: view.children }, () => ''),
    guardianName: '',
    guardianContact: '',
    waiverAccepted: false,
    termsAccepted: false,
  };
}

const childAgeText = /^\d{1,2}$/;

function ageNumber(text: string): number {
  return childAgeText.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * The input `startPayment` takes. Only fields the page asked for are sent: the age confirmation
 * when the rule needs one, children's ages and a guardian when children come, the waiver when the
 * experience has one. Call it after `formIssues` found nothing, so every age is a number.
 */
export function startPaymentInput(
  values: FormValues,
  view: CheckoutView,
): StartPaymentInput {
  const needs = ageRequirements(view.ageSubject, view.children);
  const phone = values.phone.trim();
  return {
    holdId: view.holdId,
    contact: {
      email: values.email.trim(),
      ...(phone === '' ? {} : { phone }),
    },
    leadGuestName: values.leadGuestName.trim(),
    attendees: {
      ...(needs.confirmation === null
        ? {}
        : { ageConfirmed: values.ageConfirmed }),
      ...(needs.childAges === null
        ? {}
        : { childrenAges: values.childAges.map(ageNumber) }),
      ...(needs.guardian
        ? {
            guardian: {
              name: values.guardianName.trim(),
              contact: values.guardianContact.trim(),
            },
          }
        : {}),
    },
    ...(view.waiverDocument === null
      ? {}
      : { waiverDocumentId: view.waiverDocument.id }),
    termsDocumentId: view.termsDocument.id,
    newsletterOptIn: values.newsletter,
  };
}

/**
 * What is wrong with the form, one code per field and keyed as `startPayment` keys them. The
 * server's own schema and age rules run, plus the acceptances (a box left unticked is `required`)
 * and the typed ages, which the server only ever sees as numbers.
 */
export function formIssues(
  values: FormValues,
  view: CheckoutView,
): FieldErrors {
  const mine: FieldErrors = {};
  if (!values.termsAccepted) mine.termsDocumentId = 'required';
  if (view.waiverDocument !== null && !values.waiverAccepted) {
    mine.waiverDocumentId = 'required';
  }
  const needs = ageRequirements(view.ageSubject, view.children);
  if (needs.childAges !== null) {
    const ages = values.childAges.map((age) => age.trim());
    if (ages.some((age) => age === '')) {
      mine['attendees.childrenAges'] = 'required';
    } else if (ages.some((age) => !childAgeText.test(age))) {
      mine['attendees.childrenAges'] = 'invalid';
    }
  }

  const input = startPaymentInput(values, view);
  const parsed = StartPaymentInputSchema.safeParse(input);
  const schema: FieldErrors = parsed.success
    ? {}
    : invalidFields(parsed.error.issues);
  const rules = attendeeIssues(view.ageSubject, input.attendees, view.children);
  return { ...schema, ...rules, ...mine };
}

function invalidFields(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): FieldErrors {
  const result = invalidStartPayment(issues);
  return result.status === 'invalid' ? result.fieldErrors : {};
}

/** The order the fields appear in, so focus goes to the first one that is wrong. */
const fieldOrder = [
  'contact.email',
  'contact.phone',
  'leadGuestName',
  'attendees.ageConfirmed',
  'attendees.childrenAges',
  'attendees.guardian',
  'waiverDocumentId',
  'termsDocumentId',
] as const;

/** The key of the field to focus, matching nested keys (`attendees.childrenAges.0`) to their group. */
export function firstErrorField(errors: FieldErrors): string | null {
  const keys = Object.keys(errors);
  for (const field of fieldOrder) {
    if (keys.some((key) => key === field || key.startsWith(`${field}.`))) {
      return field;
    }
  }
  return keys[0] ?? null;
}

const messages: Record<string, Record<string, string>> = {
  'contact.email': {
    required: 'Enter your email address.',
    invalid: 'Enter an email address like alex@example.com.',
  },
  'contact.phone': {
    invalid: 'Enter a phone number, or leave it blank.',
  },
  leadGuestName: {
    required: "Enter the lead guest's name.",
    invalid: "Enter the lead guest's name.",
  },
  'attendees.ageConfirmed': {
    required: 'Confirm the age rule to continue.',
  },
  'attendees.childrenAges': {
    required: "Enter each child's age.",
    invalid: "Enter each child's age as a number, such as 9.",
    out_of_range: "A child's age is outside what this experience allows.",
  },
  'attendees.guardian': {
    required:
      'Enter the name and contact of the adult who comes with the children.',
    invalid:
      'Enter the name and contact of the adult who comes with the children.',
  },
  waiverDocumentId: {
    required: 'Accept the waiver to continue.',
    invalid: 'The waiver has changed. Reload the page to read the new one.',
  },
  termsDocumentId: {
    required: 'Accept the terms to continue.',
    invalid: 'The terms have changed. Reload the page to read the new ones.',
  },
  holdId: {
    not_payable: 'This booking cannot be paid for online.',
  },
};

/** Safe copy for a field's code. A field or code with no copy of its own still gets a plain sentence. */
export function fieldMessage(field: string, code: string): string {
  const own = messages[field]?.[code];
  if (own !== undefined) return own;
  return code === 'required' ? 'Fill in this field.' : 'Check this field.';
}

/** The fields whose error shows under the guardian inputs: the pair as a whole, or either part. */
export const guardianKeys = {
  name: ['attendees.guardian.name', 'attendees.guardian'],
  contact: ['attendees.guardian.contact', 'attendees.guardian'],
} as const;

/** The id of an input, from its field key: every dot becomes a hyphen. */
export function inputId(field: string): string {
  return field.replaceAll('.', '-');
}

/** The id of the first input that holds a field group, so an error can move focus to it. */
export function focusId(field: string): string {
  switch (field) {
    case 'attendees.childrenAges':
      return inputId('attendees.childrenAges.0');
    case 'attendees.guardian':
      return inputId('attendees.guardian.name');
    default:
      return inputId(field);
  }
}

/** The key a child's age error is read from: its own, then the group's. */
export function childAgeKeys(index: number): string[] {
  return [`attendees.childrenAges.${String(index)}`, 'attendees.childrenAges'];
}

/** The words for the first of `keys` that has an error, or nothing when none does. */
export function errorMessage(
  errors: FieldErrors,
  ...keys: string[]
): string | undefined {
  const key = keys.find((candidate) => errors[candidate] !== undefined);
  return key === undefined
    ? undefined
    : fieldMessage(key, errors[key] ?? 'invalid');
}

/** How many problems the form has, for the summary line above the button. */
export function issueCount(errors: FieldErrors): number {
  return Object.keys(errors).length;
}

export function issueSummary(count: number): string {
  return count === 1
    ? 'There is 1 thing to fix before you can pay.'
    : `There are ${String(count)} things to fix before you can pay.`;
}
