import { z } from 'zod';
import { oneLineClipped } from '../text';

// The notice Ramble sends its own operations address when something needs a person: a contact-form
// message today, a private session request later. It is generic on purpose: a subject and a few
// labelled fields, all finished text, so a unit adds a caller and not a template.

/** The job kind that sends one; the payload is the template's data. */
export const opsNoticeKind = 'ops-notice';

export const opsNoticeLimits = {
  subjectMaxChars: 150,
  labelMaxChars: 60,
  valueMaxChars: 2000,
  maxFields: 12,
} as const;

const OpsNoticeFieldSchema = z.object({
  label: z.string().min(1).max(opsNoticeLimits.labelMaxChars),
  value: z.string().min(1).max(opsNoticeLimits.valueMaxChars),
});

export const OpsNoticeDataSchema = z.object({
  subject: z.string().min(1).max(opsNoticeLimits.subjectMaxChars),
  fields: OpsNoticeFieldSchema.array().min(1).max(opsNoticeLimits.maxFields),
});

export type OpsNoticeData = z.infer<typeof OpsNoticeDataSchema>;

/** One line whatever the caller sent: a line break in a subject would break the header. */
export function opsNoticeSubject(data: OpsNoticeData): string {
  return oneLineClipped(data.subject, opsNoticeLimits.subjectMaxChars);
}
