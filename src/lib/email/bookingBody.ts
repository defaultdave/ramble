import type {
  BookingCancellationData,
  BookingRefundData,
  GuestConfirmationData,
  HostBookingNoticeData,
  PaidAfterLapseData,
} from './bookingTemplates';

// The words in each booking email, apart from the layout's footer: preview line, heading, opening
// paragraph, and the label and value rows. The markup renders what these return and adds nothing.

export type DetailRow = { label: string; value: string };

type Body = {
  preview: string;
  heading: string;
  intro: string;
  rows: DetailRow[];
};

export type ConfirmationBody = Body & {
  paymentRows: DetailRow[];
  terms: string;
  manageLabel: string;
  calendarLabel: string;
  forwardWarning: string;
};

export function guestConfirmationBody(
  data: GuestConfirmationData,
): ConfirmationBody {
  return {
    preview: `You're booked for ${data.experienceName}.`,
    heading: "You're booked",
    intro: `Hi ${data.recipientName}, your booking is confirmed. A calendar file is attached.`,
    rows: [
      { label: 'Experience', value: data.experienceName },
      { label: 'Date', value: data.dayLabel },
      { label: 'Time', value: data.timeLabel },
      ...(data.durationLabel
        ? [{ label: 'Length', value: data.durationLabel }]
        : []),
      ...(data.meetingPoint
        ? [{ label: 'Meeting point', value: data.meetingPoint }]
        : []),
      { label: 'Guests', value: data.partyLabel },
      { label: 'Host', value: data.hostName },
      { label: 'Reference', value: data.reference },
    ],
    paymentRows: [
      ...data.lines.map((line) => ({ label: line.label, value: line.amount })),
      ...(data.taxLine
        ? [{ label: data.taxLine.label, value: data.taxLine.amount }]
        : []),
      { label: 'Total', value: data.total },
      ...(data.giftApplied
        ? [{ label: 'Paid with your gift', value: data.giftApplied }]
        : []),
      ...(data.charged
        ? [{ label: 'Charged to your card', value: data.charged }]
        : []),
    ],
    terms: data.cancellationTerms,
    manageLabel: 'Manage your booking',
    calendarLabel: 'Add to Google Calendar',
    forwardWarning:
      'Keep this email. The manage link works for anyone who has it, so do not forward it.',
  };
}

export function hostBookingNoticeBody(data: HostBookingNoticeData): Body {
  return {
    preview: `New booking for ${data.experienceName}.`,
    heading: 'New booking',
    intro: `Hi ${data.hostName}, ${data.guestName} booked ${data.partyLabel} on ${data.dayLabel} at ${data.timeLabel}.`,
    rows: [
      { label: 'Experience', value: data.experienceName },
      { label: 'Date', value: data.dayLabel },
      { label: 'Time', value: data.timeLabel },
      { label: 'Guests', value: data.partyLabel },
      { label: 'Lead guest', value: data.guestName },
      { label: 'Reference', value: data.reference },
    ],
  };
}

export type CancellationBody = Body & {
  refundLine: string | null;
  otherDatesLabel: string;
};

export function bookingCancellationBody(
  data: BookingCancellationData,
): CancellationBody {
  return {
    preview: `Cancelled: ${data.experienceName}.`,
    heading: 'Booking cancelled',
    intro: `Hi ${data.recipientName}, ${data.reasonLine}`,
    rows: [
      { label: 'Experience', value: data.experienceName },
      { label: 'Date', value: data.dayLabel },
      { label: 'Time', value: data.timeLabel },
      { label: 'Guests', value: data.partyLabel },
      { label: 'Reference', value: data.reference },
    ],
    refundLine: data.refundLine,
    otherDatesLabel: 'See other dates',
  };
}

export function bookingRefundBody(data: BookingRefundData): Body {
  return {
    preview: `Your refund of ${data.amount} has been issued.`,
    heading: 'Your refund is on its way',
    intro: `Hi ${data.recipientName}, we refunded ${data.amount} to your original payment method. ${data.arrivalLine}`,
    rows: [
      { label: 'Experience', value: data.experienceName },
      { label: 'Refunded', value: data.amount },
      { label: 'Reference', value: data.reference },
    ],
  };
}

export type LapseBody = Body & { browseLabel: string };

export function paidAfterLapseBody(data: PaidAfterLapseData): LapseBody {
  return {
    preview: `We refunded your payment for ${data.experienceName}.`,
    heading: 'We refunded your payment',
    intro: `Hi ${data.recipientName}, you are not booked. ${data.reasonLine} We refunded ${data.amount} in full to your original payment method.`,
    rows: [
      { label: 'Experience', value: data.experienceName },
      { label: 'Date', value: data.dayLabel },
      { label: 'Time', value: data.timeLabel },
      { label: 'Refunded', value: data.amount },
      { label: 'Reference', value: data.reference },
    ],
    browseLabel: 'Find another date',
  };
}
