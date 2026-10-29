import { z } from 'zod';
import { buildIcs } from '../ics';
import { isOrderReference } from '../orders';
import { oneLineClipped } from '../text';
import type { EmailAttachment } from './message';

// The data each booking email takes, its subject, and its calendar file. The values are finished
// text: src/lib/bookingEmails.ts decides what to say, the markup only lays it out. Every field has a
// size limit, so a stored name of any length cannot make a message the log would refuse.

const subjectNameMax = 70;

const line = (max: number) => z.string().min(1).max(max);
const instant = z.iso.datetime();
const link = z.url({ protocol: /^https?$/ }).max(2048);

const Reference = z.string().max(10).refine(isOrderReference);
const Money = z.object({ label: line(120), amount: line(20) });

export const maxMoneyLines = 4;

const cancellationAudiences = ['guest', 'host'] as const;

const CalendarSchema = z.object({
  uid: line(200),
  startsAt: instant,
  endsAt: instant,
  stampedAt: instant,
  summary: line(200),
  location: line(300).nullable(),
  description: line(1000).nullable(),
});

export const GuestConfirmationDataSchema = z.object({
  recipientName: line(120),
  reference: Reference,
  experienceName: line(200),
  hostName: line(120),
  dayLabel: line(60),
  timeLabel: line(40),
  durationLabel: line(40).nullable(),
  meetingPoint: line(600).nullable(),
  partyLabel: line(40),
  lines: Money.array().min(1).max(maxMoneyLines),
  taxLine: Money.nullable(),
  total: line(20),
  giftApplied: line(20).nullable(),
  charged: line(20).nullable(),
  cancellationTerms: line(300),
  manageUrl: link,
  calendarUrl: link,
  calendar: CalendarSchema,
});

export const HostBookingNoticeDataSchema = z.object({
  hostName: line(120),
  reference: Reference,
  experienceName: line(200),
  dayLabel: line(60),
  timeLabel: line(40),
  guestName: line(120),
  partyLabel: line(40),
});

export const BookingCancellationDataSchema = z.object({
  audience: z.enum(cancellationAudiences),
  recipientName: line(120),
  reference: Reference,
  experienceName: line(200),
  dayLabel: line(60),
  timeLabel: line(40),
  partyLabel: line(40),
  reasonLine: line(200),
  refundLine: line(200).nullable(),
  otherDatesUrl: link.nullable(),
});

export const BookingRefundDataSchema = z.object({
  recipientName: line(120),
  reference: Reference,
  experienceName: line(200),
  amount: line(20),
  arrivalLine: line(200),
});

export const PaidAfterLapseDataSchema = z.object({
  recipientName: line(120),
  reference: Reference,
  experienceName: line(200),
  dayLabel: line(60),
  timeLabel: line(40),
  amount: line(20),
  reasonLine: line(200),
  browseUrl: link,
});

export type GuestConfirmationData = z.infer<typeof GuestConfirmationDataSchema>;
export type HostBookingNoticeData = z.infer<typeof HostBookingNoticeDataSchema>;
export type BookingCancellationData = z.infer<
  typeof BookingCancellationDataSchema
>;
export type BookingRefundData = z.infer<typeof BookingRefundDataSchema>;
export type PaidAfterLapseData = z.infer<typeof PaidAfterLapseDataSchema>;

const named = (name: string) => oneLineClipped(name, subjectNameMax);

export const bookingSubjects = {
  guestConfirmation: (data: GuestConfirmationData) =>
    `You're booked: ${named(data.experienceName)}`,
  hostBookingNotice: (data: HostBookingNoticeData) =>
    `New booking: ${named(data.experienceName)}, ${data.dayLabel}`,
  bookingCancellation: (data: BookingCancellationData) =>
    data.audience === 'guest'
      ? `Your booking is cancelled: ${named(data.experienceName)}`
      : `Booking cancelled: ${named(data.experienceName)}, ${data.dayLabel}`,
  bookingRefund: (data: BookingRefundData) => `Refund issued: ${data.amount}`,
  paidAfterLapse: (data: PaidAfterLapseData) =>
    `We refunded your payment for ${named(data.experienceName)}`,
};

export const calendarFilename = 'ramble-booking.ics';

/** The `.ics` that goes with the guest confirmation: the same event the add-to-calendar link opens. */
export function confirmationAttachments(
  data: GuestConfirmationData,
): EmailAttachment[] {
  const { calendar } = data;
  return [
    {
      filename: calendarFilename,
      contentType: 'text/calendar; charset=utf-8',
      content: buildIcs({
        uid: calendar.uid,
        startsAt: new Date(calendar.startsAt),
        endsAt: new Date(calendar.endsAt),
        stampedAt: new Date(calendar.stampedAt),
        summary: calendar.summary,
        location: calendar.location,
        description: calendar.description,
      }),
    },
  ];
}
