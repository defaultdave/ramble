import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import type { HostAccess } from './hostAccess';
import {
  bookingStatusLabels,
  hostDashboardBookingStatuses,
  seatsLabel,
  whenLabel,
} from './hostDashboard';
import { TimeZoneSchema } from './sessions';
import { SEARCH_MAX_LENGTH } from './tableQuery';

// What a host sees of their own guests (PRD-45, PRD-73): per booking the lead guest, the party, the
// ages the booking holds, the waiver, and the contact details the booker gave. Never another host's.

export const hostBookingsPath = '/host/bookings';

/** The most bookings the list shows at once; a search narrows it. */
export const hostBookingListLimit = 50;

export const hostGuestListHref = (sessionId: string) =>
  `${hostBookingsPath}/session/${sessionId}`;

/** A search term as the data layer takes it: trimmed and capped, so no address can send a long one. */
export const HostBookingSearchSchema = z.string().trim().max(SEARCH_MAX_LENGTH);

/** A session id from an address, or null when it is no id, which reads as a session that is not there. */
export function parseSessionId(raw: string): string | null {
  const parsed = EntityIdSchema.safeParse(raw);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/** What every list of bookings reads of one: the order, its experience and session, and its status. */
export const BookingListRowSchema = z.object({
  id: EntityIdSchema,
  reference: z.string().min(1),
  experienceName: z.string().min(1),
  sessionStartsAt: z.date(),
  timeZone: TimeZoneSchema,
  status: z.enum(hostDashboardBookingStatuses),
});

export const HostBookingListRowSchema = BookingListRowSchema.extend({
  leadGuestName: z.string().min(1),
  sessionId: EntityIdSchema,
  seats: z.int().min(0),
});
export type HostBookingListRow = z.infer<typeof HostBookingListRowSchema>;

export const HostGuestListSessionSchema = z.object({
  hostName: z.string().min(1),
  id: EntityIdSchema,
  experienceName: z.string().min(1),
  startsAt: z.date(),
  timeZone: TimeZoneSchema,
  /** The experience asks every booker to accept a waiver. */
  waiverRequired: z.boolean(),
});

export const HostGuestListBookingSchema = z.object({
  id: EntityIdSchema,
  reference: z.string().min(1),
  leadGuestName: z.string().min(1),
  seats: z.int().min(0),
  /** True when the booker confirmed every attendee is of age; null when the experience asks no such thing. */
  ageConfirmed: z.boolean().nullable(),
  childrenAges: z.array(z.int().min(0)).nullable(),
  guardianName: z.string().nullable(),
  guardianContact: z.string().nullable(),
  waiverAccepted: z.boolean(),
  contactEmail: z.string().min(1),
  contactPhone: z.string().nullable(),
});

export type HostBookingListData = {
  bookings: readonly HostBookingListRow[];
};

export type HostGuestListData = {
  session: z.infer<typeof HostGuestListSessionSchema>;
  bookings: readonly z.infer<typeof HostGuestListBookingSchema>[];
};

export type HostBookingListItemView = {
  id: string;
  reference: string;
  guestName: string;
  experienceName: string;
  whenLabel: string;
  seatsLabel: string;
  statusLabel: string;
  guestListHref: string;
};

export type HostBookingListView = {
  /** The term searched for, empty for the whole list. */
  term: string;
  /** "2 bookings match "ada"", "No bookings match "ada"", or the list's own heading when not searching. */
  summary: string;
  rows: readonly HostBookingListItemView[];
};

export type HostGuestRowView = {
  id: string;
  reference: string;
  guestName: string;
  seatsLabel: string;
  agesLabel: string;
  waiverLabel: string;
  /** Contact lines as label and value, for a description list. */
  contacts: readonly { label: string; value: string }[];
};

export type HostGuestListView = {
  hostName: string;
  experienceName: string;
  whenLabel: string;
  /** "5 seats across 2 bookings". */
  totalLabel: string;
  rows: readonly HostGuestRowView[];
};

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function summaryFor(count: number, term: string): string {
  if (term === '') {
    return count === 0
      ? 'No bookings yet'
      : `Latest ${plural(count, 'booking', 'bookings')}`;
  }
  const quoted = `“${term}”`;
  if (count === 0) return `No bookings match ${quoted}`;
  return `${plural(count, 'booking', 'bookings')} ${count === 1 ? 'matches' : 'match'} ${quoted}`;
}

/** The rows the bookings page draws, never more than the limit, whatever the data layer returns. */
export function buildHostBookingList(
  data: HostBookingListData,
  term: string,
): HostBookingListView {
  const rows = data.bookings.slice(0, hostBookingListLimit).map((b) => ({
    id: b.id,
    reference: b.reference,
    guestName: b.leadGuestName,
    experienceName: b.experienceName,
    whenLabel: whenLabel(b.sessionStartsAt, b.timeZone),
    seatsLabel: seatsLabel(b.seats),
    statusLabel: bookingStatusLabels[b.status],
    guestListHref: hostGuestListHref(b.sessionId),
  }));
  return { term, summary: summaryFor(rows.length, term), rows };
}

/** What the booking holds about ages: the children's, or the booker's confirmation that all attendees are of age. */
export function agesLabel(
  childrenAges: readonly number[] | null,
  ageConfirmed: boolean | null,
): string {
  if (childrenAges !== null && childrenAges.length > 0) {
    return `${childrenAges.length === 1 ? 'Child aged' : 'Children aged'} ${childrenAges.join(', ')}`;
  }
  if (ageConfirmed === true) return 'All attendees confirmed of age';
  return 'No age details';
}

/** Accepted, or the waiver the experience asks for and the booking lacks, or none asked for. */
export function waiverLabel(required: boolean, accepted: boolean): string {
  if (accepted) return 'Accepted';
  return required ? 'Not accepted' : 'Not required';
}

export function buildHostGuestList(data: HostGuestListData): HostGuestListView {
  const { session } = data;
  const seats = data.bookings.reduce((sum, b) => sum + b.seats, 0);
  return {
    hostName: session.hostName,
    experienceName: session.experienceName,
    whenLabel: whenLabel(session.startsAt, session.timeZone),
    totalLabel: `${seatsLabel(seats)} across ${plural(data.bookings.length, 'booking', 'bookings')}`,
    rows: data.bookings.map((b) => {
      const contacts = [{ label: 'Email', value: b.contactEmail }];
      if (b.contactPhone !== null) {
        contacts.push({ label: 'Phone', value: b.contactPhone });
      }
      if (b.guardianName !== null && b.guardianContact !== null) {
        contacts.push({
          label: 'Guardian',
          value: `${b.guardianName}, ${b.guardianContact}`,
        });
      }
      return {
        id: b.id,
        reference: b.reference,
        guestName: b.leadGuestName,
        seatsLabel: seatsLabel(b.seats),
        agesLabel: agesLabel(b.childrenAges, b.ageConfirmed),
        waiverLabel: waiverLabel(session.waiverRequired, b.waiverAccepted),
        contacts,
      };
    }),
  };
}

export type HostBookingListResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostBookingListView };

export type HostGuestListResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostGuestListView };

/** Nobody signed in signs in; a signed-in non-owner is refused, as is an owner whose host (`data` null) is gone. */
export function hostBookingListResult(
  access: HostAccess,
  data: HostBookingListData | null,
  term: string,
): HostBookingListResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner' || data === null) {
    return { status: 'refused' };
  }
  return { status: 'ok', view: buildHostBookingList(data, term) };
}

/** As above; a session that is missing or another host's is `data` null, so it is refused the same way as no session at all. */
export function hostGuestListResult(
  access: HostAccess,
  data: HostGuestListData | null,
): HostGuestListResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner' || data === null) {
    return { status: 'refused' };
  }
  return { status: 'ok', view: buildHostGuestList(data) };
}
