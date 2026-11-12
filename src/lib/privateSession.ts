import { z } from 'zod';
import { opsNoticeLimits, type OpsNoticeData } from '@/lib/email/opsNotice';
import { readTextFields } from '@/lib/formFields';
import { formatMoney } from '@/lib/money';
import { EmailFieldSchema, supportLimits } from '@/lib/support';
import {
  oneLineClipped,
  requiredText,
  wholeNumberPattern,
  wholeNumberText,
} from '@/lib/text';

export const privateSessionLimits = {
  nameMaxChars: supportLimits.nameMaxChars,
  messageMaxChars: supportLimits.messageMaxChars,
  maxGroupSize: 200,
  maxBudgetDollars: 1_000_000,
} as const;

const centsPerDollar = 100;

/** The form's field names, which are also the keys of the field errors. */
export const privateSessionFields = [
  'date',
  'groupSize',
  'budget',
  'name',
  'email',
  'message',
] as const;
export type PrivateSessionField = (typeof privateSessionFields)[number];

const trim = (value: string) => value.trim();

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date that exists: 2026-02-30 matches the shape and is refused here. */
function isRealDate(value: string): boolean {
  if (!isoDate.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Dollars as a person types them: "1200", "$1,200", " 1 200 ". Cents are not asked for. */
const dollarsText = (value: string) => value.replace(/[$,\s]/g, '');

/**
 * The form's input, checked against New York's calendar date `today` so a past date is refused.
 * The budget is typed in whole dollars and kept in integer cents.
 */
export function privateRequestSchema(today: string) {
  return z.object({
    date: z
      .string()
      .transform(trim)
      .refine(isRealDate)
      .refine((value) => value >= today),
    groupSize: wholeNumberText(1, privateSessionLimits.maxGroupSize),
    budgetMinor: z
      .string()
      .transform(dollarsText)
      .refine((value) => wholeNumberPattern.test(value))
      .transform((value) => Number(value) * centsPerDollar)
      .refine(
        (value) =>
          value >= centsPerDollar &&
          value <= privateSessionLimits.maxBudgetDollars * centsPerDollar,
      ),
    name: requiredText(privateSessionLimits.nameMaxChars).transform(trim),
    email: EmailFieldSchema,
    message: z
      .string()
      .transform(trim)
      .pipe(
        z.union([
          z.literal('').transform(() => null),
          requiredText(privateSessionLimits.messageMaxChars),
        ]),
      ),
  });
}

export type PrivateRequestInput = z.output<
  ReturnType<typeof privateRequestSchema>
>;

export const privateSessionFieldMessages = {
  date: 'Choose a date that is today or later.',
  groupSize: `Enter how many people, from 1 to ${String(privateSessionLimits.maxGroupSize)}.`,
  budget: 'Enter your budget in whole dollars, like 1200.',
  name: 'Enter your name.',
  email: 'Enter an email address like name@example.com.',
  message: 'Keep your message under 2,000 characters.',
} satisfies Record<PrivateSessionField, string>;

export type PrivateSessionFieldErrors = Partial<
  Record<PrivateSessionField, string>
>;

/** What the guest typed, kept as text so a refused form comes back as it was sent. */
export type PrivateSessionFormValues = Record<PrivateSessionField, string>;

export const emptyPrivateSessionValues: PrivateSessionFormValues = {
  date: '',
  groupSize: '',
  budget: '',
  name: '',
  email: '',
  message: '',
};

export type PrivateSessionFormState =
  | { status: 'idle' }
  | { status: 'sent' }
  | {
      status: 'invalid';
      values: PrivateSessionFormValues;
      errors: PrivateSessionFieldErrors;
    }
  | { status: 'rate_limited'; values: PrivateSessionFormValues }
  | { status: 'expired'; values: PrivateSessionFormValues }
  | { status: 'failed'; values: PrivateSessionFormValues };

/** The schema keys the form's fields by their stored names; the form calls `budgetMinor` "budget". */
const fieldOfKey = {
  date: 'date',
  groupSize: 'groupSize',
  budgetMinor: 'budget',
  name: 'name',
  email: 'email',
  message: 'message',
} as const satisfies Record<string, PrivateSessionField>;

/** Reads the form's text fields; see `readTextFields`. */
export function readPrivateSessionValues(
  get: (field: PrivateSessionField) => unknown,
): PrivateSessionFormValues {
  return readTextFields(
    privateSessionFields,
    get,
    privateSessionLimits.messageMaxChars * 2,
  );
}

const isSchemaKey = (key: unknown): key is keyof typeof fieldOfKey =>
  typeof key === 'string' && Object.hasOwn(fieldOfKey, key);

/** One message per field the schema refused, in the words the form shows. */
export function privateSessionFieldErrors(
  error: z.ZodError,
): PrivateSessionFieldErrors {
  const errors: PrivateSessionFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (isSchemaKey(key)) {
      const field = fieldOfKey[key];
      errors[field] ??= privateSessionFieldMessages[field];
    }
  }
  return errors;
}

/** The notice ops gets: the request in labelled fields, with the optional message left out when there is none. */
export function privateRequestNotice(
  request: PrivateRequestInput,
  stored: { id: string; createdAt: Date; experienceName: string },
): OpsNoticeData {
  return {
    // An experience name has no length limit that fits a subject, so the subject is clipped to what the notice accepts.
    subject: oneLineClipped(
      `Private session request: ${stored.experienceName}`,
      opsNoticeLimits.subjectMaxChars,
    ),
    fields: [
      { label: 'Experience', value: stored.experienceName },
      { label: 'Name', value: request.name },
      { label: 'Email', value: request.email },
      { label: 'Date', value: request.date },
      { label: 'Group size', value: String(request.groupSize) },
      { label: 'Budget', value: formatMoney(request.budgetMinor) },
      ...(request.message === null
        ? []
        : [{ label: 'Message', value: request.message }]),
      { label: 'Request ID', value: stored.id },
      { label: 'Received', value: stored.createdAt.toISOString() },
    ],
  };
}
