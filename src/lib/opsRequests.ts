import { guestsLabel } from '@/lib/copy/format';
import { type AuditEntryInput } from './audit';
import { defaultHostTimeZone } from './hostSetup';
import { formatPrice } from './money';
import { opsAreaIds, opsAreaListEntry } from './opsAudit';
import { oneLineClipped } from './text';
import { zonedDayLabel, zonedDeadlineLabel } from './zonedLabels';

// The ops view of guests' private session requests (PRD-35): read-only, newest first. A request has
// no status of its own, so the queue lists them all.

export const opsRequestsPath = '/ops/requests';

/** The longest message the table shows before the rest sits behind a disclosure. */
export const requestMessagePreviewChars = 140;

export type OpsRequestRecord = {
  id: string;
  experienceName: string;
  /** The day the guest asked for, `YYYY-MM-DD`. */
  requestedDate: string;
  groupSize: number;
  budgetMinor: number;
  name: string;
  email: string;
  message: string | null;
  createdAt: Date;
};

export type OpsRequestMessage = {
  preview: string;
  /** The whole text, set only when the preview cut it. */
  full: string | null;
};

export type OpsRequestRow = {
  id: string;
  experienceName: string;
  requestedLabel: string;
  groupLabel: string;
  budgetLabel: string;
  name: string;
  email: string;
  /** Null when the guest wrote none. */
  message: OpsRequestMessage | null;
  receivedLabel: string;
};

/** A message cut to one line for the table; the whole text is kept only when something was cut. A blank message counts as none. */
export function requestMessageView(
  message: string | null,
): OpsRequestMessage | null {
  const whole = message?.trim() ?? '';
  if (whole === '') return null;
  const preview = oneLineClipped(whole, requestMessagePreviewChars);
  const cut =
    Array.from(whole.split(/\s+/).join(' ')).length >
    requestMessagePreviewChars;
  return { preview, full: cut ? whole : null };
}

/** The queue's rows as the table shows them: the requested day as asked, with no zone shift, and the received time in New York. */
export function buildOpsRequestRows(
  records: readonly OpsRequestRecord[],
): OpsRequestRow[] {
  return records.map((record) => ({
    id: record.id,
    experienceName: record.experienceName,
    // A date with no time is read at noon UTC so no zone moves it to another day.
    requestedLabel: zonedDayLabel(
      new Date(`${record.requestedDate}T12:00:00Z`),
      'UTC',
    ),
    groupLabel: guestsLabel(record.groupSize),
    budgetLabel: formatPrice(record.budgetMinor),
    name: record.name,
    email: record.email,
    message: requestMessageView(record.message),
    receivedLabel: zonedDeadlineLabel(record.createdAt, defaultHostTimeZone),
  }));
}

/** The queue was read. It shows guests' names and addresses. */
export const requestsListEntry = (userId: string): AuditEntryInput =>
  opsAreaListEntry(userId, 'requests.list_viewed', opsAreaIds.requests);
