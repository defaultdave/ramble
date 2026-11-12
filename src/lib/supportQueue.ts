import { z } from 'zod';
import { userActor, type AuditEntryInput } from './audit';
import { WriteIdSchema } from './catalog';
import { defaultHostTimeZone } from './hostSetup';
import { opsAreaIds } from './opsAudit';
import { pickKnown } from './pickKnown';
import {
  formText,
  oversizedFields,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import {
  supportLimits,
  supportTopicLabels,
  type SupportTopic,
} from './support';
import { parseStatusFilter, type StatusTone } from './statusBadge';
import { requiredText } from './text';
import { zonedDeadlineLabel } from './zonedLabels';

// The ops support queue (PRD-54): the guest's contact-form requests, their reason tag and status,
// and marking one resolved with a note. The database CHECKs on `support_requests` repeat the note's limit.

export const supportQueuePath = '/ops/support';
export const supportQueuePageSize = 25;

const supportStatuses = ['open', 'resolved'] as const;
export type SupportStatus = (typeof supportStatuses)[number];

export const supportStatusLabels = {
  open: 'Open',
  resolved: 'Resolved',
} satisfies Record<SupportStatus, string>;

export const supportStatusTones = {
  open: 'warning',
  resolved: 'success',
} satisfies Record<SupportStatus, StatusTone>;

export const supportStatusOptions = supportStatuses.map((value) => ({
  value,
  label: supportStatusLabels[value],
}));

/** The status the address names, or null (every request) for none, a repeated one, or one the queue does not have. */
export function parseSupportStatus(
  raw: string | readonly string[] | undefined,
): SupportStatus | null {
  return pickKnown(
    parseStatusFilter(raw, supportStatusOptions),
    supportStatuses,
    null,
  );
}

/** A request is open until it has a resolution time. */
export function supportStatusOf(row: {
  resolvedAt: Date | null;
}): SupportStatus {
  return row.resolvedAt === null ? 'open' : 'resolved';
}

export type SupportQueueRecord = {
  id: string;
  name: string;
  email: string;
  topic: SupportTopic;
  message: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
};

export type SupportQueueRow = {
  id: string;
  name: string;
  email: string;
  reason: string;
  message: string;
  receivedLabel: string;
  status: SupportStatus;
  /** Present once resolved: the note and when. */
  resolution: { note: string; whenLabel: string } | null;
};

/** The queue's rows as the table shows them: the reason in words and the times in New York. */
export function buildSupportQueueRows(
  records: readonly SupportQueueRecord[],
): SupportQueueRow[] {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    email: record.email,
    reason: supportTopicLabels[record.topic],
    message: record.message,
    receivedLabel: zonedDeadlineLabel(record.createdAt, defaultHostTimeZone),
    status: supportStatusOf(record),
    resolution:
      record.resolvedAt === null || record.resolutionNote === null
        ? null
        : {
            note: record.resolutionNote,
            whenLabel: zonedDeadlineLabel(
              record.resolvedAt,
              defaultHostTimeZone,
            ),
          },
  }));
}

export type SupportResolveInput = { id: string; note: string };

export type SupportResolveForm =
  { ok: true; value: SupportResolveInput } | { ok: false };

const resolveFields = ['id', 'note'] as const;

const ResolveSchema = z.strictObject({
  id: WriteIdSchema,
  note: requiredText(supportLimits.resolutionNoteMaxChars),
});

/** The posted resolve form: a request id and a note that is not blank. Nothing is repaired; a refused form resolves nothing. */
export function parseSupportResolveForm(get: FormGetter): SupportResolveForm {
  if (oversizedFields(get, resolveFields, supportLimits.rawField).length > 0) {
    return { ok: false };
  }
  const parsed = ResolveSchema.safeParse({
    id: formText(get, 'id'),
    note: formText(get, 'note'),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export type SupportResolveOutcome =
  'resolved' | 'already_resolved' | 'not_found';

/** What marking a request resolved does with the row as it stands under the lock: nothing for a missing or resolved one. */
export function supportResolveOutcome(
  row: { resolvedAt: Date | null } | undefined,
): SupportResolveOutcome {
  if (row === undefined) return 'not_found';
  return row.resolvedAt === null ? 'resolved' : 'already_resolved';
}

export const supportNoticeCodes = [
  'resolved',
  'already_resolved',
  'not_found',
  'invalid',
] as const;
export type SupportNoticeCode = (typeof supportNoticeCodes)[number];

export const supportNotices = {
  resolved: { tone: 'success', title: 'Request marked resolved.' },
  already_resolved: {
    tone: 'info',
    title: 'That request was already resolved.',
  },
  not_found: {
    tone: 'warning',
    title: 'That request could not be found.',
  },
  invalid: {
    tone: 'warning',
    title: `Add a note of up to ${String(supportLimits.resolutionNoteMaxChars)} characters to resolve a request.`,
  },
} satisfies Record<SupportNoticeCode, NoticeText>;

/** The queue was read. It shows guests' names and addresses. */
export function supportListEntry(userId: string): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'support.list_viewed',
    subjectKind: 'ops_area',
    subjectId: opsAreaIds.support,
  };
}

/** A request was resolved. The note is not written: the audit log holds ids, never text. */
export function supportResolvedEntry(
  userId: string,
  requestId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'support.resolved',
    subjectKind: 'support_request',
    subjectId: requestId,
  };
}
