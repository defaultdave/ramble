import { z } from 'zod';
import { EmailAddressSchema, normalizeEmailAddress } from './address';
import {
  BookingCancellationDataSchema,
  BookingRefundDataSchema,
  GuestConfirmationDataSchema,
  HostBookingNoticeDataSchema,
  PaidAfterLapseDataSchema,
  bookingSubjects,
  confirmationAttachments,
} from './bookingTemplates';
import { IdempotencyKeySchema, type EmailAttachment } from './message';

/**
 * Every template's data shape, subject line, and attachments. The markup for each lives in
 * src/server/ports/email/templates; a unit that adds an email adds a row to each table here and a
 * component there.
 */
const templateSchemas = {
  'dev-check': z.object({ recipientName: z.string().min(1).max(80) }),
  'guest-confirmation': GuestConfirmationDataSchema,
  'host-booking-notice': HostBookingNoticeDataSchema,
  'booking-cancellation': BookingCancellationDataSchema,
  'booking-refund': BookingRefundDataSchema,
  'paid-after-lapse': PaidAfterLapseDataSchema,
} as const;

export type EmailTemplateName = keyof typeof templateSchemas;

export type EmailTemplateData<Name extends EmailTemplateName> = z.infer<
  (typeof templateSchemas)[Name]
>;

const emailTemplateNames = Object.keys(templateSchemas) as EmailTemplateName[];

const subjects: {
  [Name in EmailTemplateName]: (data: EmailTemplateData<Name>) => string;
} = {
  'dev-check': () => 'Ramble email check',
  'guest-confirmation': bookingSubjects.guestConfirmation,
  'host-booking-notice': bookingSubjects.hostBookingNotice,
  'booking-cancellation': bookingSubjects.bookingCancellation,
  'booking-refund': bookingSubjects.bookingRefund,
  'paid-after-lapse': bookingSubjects.paidAfterLapse,
};

const attachments: {
  [Name in EmailTemplateName]: (
    data: EmailTemplateData<Name>,
  ) => EmailAttachment[];
} = {
  'dev-check': () => [],
  'guest-confirmation': confirmationAttachments,
  'host-booking-notice': () => [],
  'booking-cancellation': () => [],
  'booking-refund': () => [],
  'paid-after-lapse': () => [],
};

export type EmailRequest = {
  [Name in EmailTemplateName]: {
    template: Name;
    to: string;
    data: EmailTemplateData<Name>;
    idempotencyKey: string;
  };
}[EmailTemplateName];

const RequestEnvelopeSchema = z.object({
  template: z.enum(emailTemplateNames),
  to: z.string().transform(normalizeEmailAddress).pipe(EmailAddressSchema),
  data: z.unknown(),
  idempotencyKey: IdempotencyKeySchema,
});

/** Throws a ZodError for anything malformed: a bad request is a bug in the caller, not a message to repair. */
export function parseEmailRequest(input: unknown): EmailRequest {
  const envelope = RequestEnvelopeSchema.parse(input);
  const data: unknown = templateSchemas[envelope.template].parse(envelope.data);
  // The data was parsed by the schema of this very template, which TypeScript cannot follow across the union.
  return { ...envelope, data } as EmailRequest;
}

type RequestOf<Name extends EmailTemplateName> = {
  [N in Name]: { template: N; data: EmailTemplateData<N> };
}[Name];

// Generic so each template's table entry receives exactly that template's data.
function subjectOf<Name extends EmailTemplateName>(
  request: RequestOf<Name>,
): string {
  return subjects[request.template](request.data);
}

function attachmentsOf<Name extends EmailTemplateName>(
  request: RequestOf<Name>,
): EmailAttachment[] {
  return attachments[request.template](request.data);
}

export function subjectFor(request: EmailRequest): string {
  return subjectOf(request);
}

/** The files that travel with this message, built from its data alone so a retry sends the same bytes. */
export function attachmentsFor(request: EmailRequest): EmailAttachment[] {
  return attachmentsOf(request);
}
