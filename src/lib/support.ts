import { z } from 'zod';
import {
  EmailAddressSchema,
  maxEmailAddressLength,
  normalizeEmailAddress,
} from '@/lib/email/address';
import { readTextFields } from '@/lib/formFields';
import { requiredText } from '@/lib/text';

export const supportTopics = [
  'booking',
  'change_or_cancel',
  'refund',
  'gift',
  'accessibility',
  'other',
] as const;

export type SupportTopic = (typeof supportTopics)[number];

export const supportTopicLabels = {
  booking: 'A booking',
  change_or_cancel: 'Changing or cancelling a booking',
  refund: 'A refund or payment',
  gift: 'A gift',
  accessibility: 'Accessibility',
  other: 'Something else',
} satisfies Record<SupportTopic, string>;

export const supportLimits = {
  nameMaxChars: 120,
  messageMaxChars: 2000,
  /** The note ops write when marking a request resolved. */
  resolutionNoteMaxChars: 500,
  /** A resolve-form field longer than this is refused unread, so no rule walks an unbounded string. */
  rawField: 2000,
} as const;

/** The form's field names, which are also the keys of the field errors. */
const supportFields = ['name', 'email', 'topic', 'message'] as const;
export type SupportField = (typeof supportFields)[number];

const trim = (value: string) => value.trim();

/** Trimmed and folded to lower case first: the one spelling the stored address and its CHECK accept. */
export const EmailFieldSchema = z
  .string()
  .max(maxEmailAddressLength * 2)
  .transform((raw) => normalizeEmailAddress(raw.trim()))
  .pipe(EmailAddressSchema);

export const SupportRequestSchema = z.object({
  name: requiredText(supportLimits.nameMaxChars).transform(trim),
  email: EmailFieldSchema,
  topic: z.enum(supportTopics),
  message: requiredText(supportLimits.messageMaxChars).transform(trim),
});

export type SupportRequestInput = z.output<typeof SupportRequestSchema>;

export const supportFieldMessages = {
  name: 'Enter your name.',
  email: 'Enter an email address like name@example.com.',
  topic: 'Choose what this is about.',
  message: 'Tell us how we can help.',
} satisfies Record<SupportField, string>;

export type SupportFieldErrors = Partial<Record<SupportField, string>>;

/** What the guest typed, kept as text so a refused form comes back as it was sent. */
export type SupportFormValues = Record<SupportField, string>;

export const emptySupportValues: SupportFormValues = {
  name: '',
  email: '',
  topic: '',
  message: '',
};

export type SupportFormState =
  | { status: 'idle' }
  | { status: 'sent' }
  | {
      status: 'invalid';
      values: SupportFormValues;
      errors: SupportFieldErrors;
    }
  | { status: 'rate_limited'; values: SupportFormValues }
  | { status: 'expired'; values: SupportFormValues }
  | { status: 'failed'; values: SupportFormValues };

/** Reads the form's text fields; see `readTextFields`. */
export function readSupportValues(
  get: (field: SupportField) => unknown,
): SupportFormValues {
  return readTextFields(supportFields, get, supportLimits.messageMaxChars * 2);
}

const isSupportField = (key: unknown): key is SupportField =>
  (supportFields as readonly unknown[]).includes(key);

/** One message per field the schema refused, in the words the form shows. */
export function supportFieldErrors(error: z.ZodError): SupportFieldErrors {
  const errors: SupportFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (isSupportField(field)) errors[field] ??= supportFieldMessages[field];
  }
  return errors;
}
