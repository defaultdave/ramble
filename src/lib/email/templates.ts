import { z } from 'zod';
import { EmailAddressSchema, normalizeEmailAddress } from './address';
import { IdempotencyKeySchema } from './message';

/**
 * Every template's data shape and subject line. The markup for each lives in
 * src/server/ports/email/templates; a unit that adds an email adds a row here and a component there.
 */
const emailTemplates = {
  'dev-check': {
    dataSchema: z.object({ recipientName: z.string().min(1).max(80) }),
    subject: () => 'Ramble email check',
  },
} as const;

export type EmailTemplateName = keyof typeof emailTemplates;

export type EmailTemplateData<Name extends EmailTemplateName> = z.infer<
  (typeof emailTemplates)[Name]['dataSchema']
>;

const emailTemplateNames = Object.keys(emailTemplates) as EmailTemplateName[];

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
  const data = emailTemplates[envelope.template].dataSchema.parse(
    envelope.data,
  );
  return { ...envelope, data };
}

export function subjectFor(request: EmailRequest): string {
  return emailTemplates[request.template].subject();
}
