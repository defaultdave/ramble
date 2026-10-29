import { describe, expect, it } from 'vitest';
import {
  bookingCalendarEvent,
  bookingCancellationData,
  bookingRefundData,
  cancellationReasonLine,
  cancellationRefundLine,
  cancellationTermsLabel,
  confirmationDecision,
  greetingName,
  guestConfirmationData,
  hostBookingNoticeData,
  lapseReasonLine,
  manageLink,
  paidAfterLapseData,
  partyLabel,
  refundArrivalLine,
  type BookingEmailSource,
  type CancelledBy,
} from './bookingEmails';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from './bookingEmails.fixtures';
import {
  BookingCancellationDataSchema,
  BookingRefundDataSchema,
  GuestConfirmationDataSchema,
  HostBookingNoticeDataSchema,
  PaidAfterLapseDataSchema,
} from './email/bookingTemplates';
import { orderStatuses } from './orders';

// Behaviours under test, one per decision, branch, or risk:
// - which orders get the confirmation and the host notice: a confirmed booking sends, a cancelled one is skipped,
//   every other status and a gift purchase are refused
// - the greeting falls back to "there"; the host's notice falls back to "A guest"; long names are cut
// - the party counts only items that use a space, and an empty party is refused
// - the cancellation terms read the booking-time clock: free until a deadline, already closed, or unknown
// - the manage link is the token on the app's origin, and a token of the wrong shape is refused
// - the calendar event uses the order as its UID, the meeting point as its place, and the confirmation time as its stamp
// - the confirmation's data is itemized, in the session's zone, with the gift lines only for a gift order, and passes its schema
// - an unconfirmed order cannot make a confirmation
// - the host notice names the guest and the party and carries no payment or link
// - the cancellation reason is worded for each reader and each canceller; only a guest's email carries a refund line
//   and, when the guest did not cancel, a link to other dates
// - the refund and S10 data hold the amounts and pass their schemas

describe('confirmationDecision', () => {
  it.each(
    orderStatuses.map((status) => [
      status,
      status === 'confirmed'
        ? 'send'
        : status === 'cancelled'
          ? 'skip'
          : 'refuse',
    ]),
  )('for a booking that is %s: %s', (status, expected) => {
    expect(confirmationDecision({ kind: 'booking', status })).toBe(expected);
  });

  it.each(orderStatuses)('refuses a gift purchase that is %s', (status) => {
    expect(confirmationDecision({ kind: 'gift_purchase', status })).toBe(
      'refuse',
    );
  });
});

describe('names', () => {
  it.each([
    ['a name', 'Pat Rivera', 'Pat Rivera'],
    ['no name', null, 'there'],
    ['a blank name', '  \n ', 'there'],
    ['a name with line breaks', 'Pat\nRivera', 'Pat Rivera'],
  ])('greets %s', (_label, name, expected) => {
    expect(greetingName(name)).toBe(expected);
  });

  it('cuts a name to the template limit', () => {
    expect(Array.from(greetingName('x'.repeat(500))).length).toBe(120);
  });

  it('calls a host notice guest with no name "A guest"', () => {
    expect(hostBookingNoticeData(orderB).guestName).toBe('A guest');
  });
});

describe('partyLabel', () => {
  it('counts the items that use a space', () => {
    expect(partyLabel(orderA.items)).toBe('3 guests');
    expect(partyLabel(orderB.items)).toBe('1 guest');
    expect(
      partyLabel([
        { label: 'Adult', quantity: 2, lineTotalMinor: 1, usesSpace: true },
        { label: 'Photo', quantity: 5, lineTotalMinor: 1, usesSpace: false },
      ]),
    ).toBe('2 guests');
  });

  it('refuses an order that takes no space', () => {
    expect(() =>
      partyLabel([
        { label: 'Photo', quantity: 1, lineTotalMinor: 1, usesSpace: false },
      ]),
    ).toThrow(RangeError);
  });
});

describe('cancellationTermsLabel', () => {
  const until = new Date('2026-11-06T21:00:00Z');

  it.each([
    [
      'free until a deadline still ahead',
      until,
      new Date('2026-10-29T15:30:00Z'),
      'Free cancellation until Fri, Nov 6, 4:00 PM EST.',
    ],
    [
      'free up to the instant of the deadline',
      until,
      until,
      'Free cancellation until Fri, Nov 6, 4:00 PM EST.',
    ],
    [
      'a deadline that had passed when it was booked',
      until,
      new Date('2026-11-06T21:00:01Z'),
      'The free cancellation window has closed, so a cancellation now is not refunded.',
    ],
    [
      'no deadline on the order',
      null,
      new Date('2026-10-29T15:30:00Z'),
      'The cancellation terms are on your booking page.',
    ],
  ])('says %s', (_label, freeCancelUntil, confirmedAt, expected) => {
    expect(
      cancellationTermsLabel(freeCancelUntil, confirmedAt, 'America/New_York'),
    ).toBe(expected);
  });
});

describe('manageLink', () => {
  it('puts the token on the app origin', () => {
    expect(manageLink(fakeManageToken, appUrl)).toBe(
      `https://ramble.example/manage/${fakeManageToken}`,
    );
  });

  it.each([
    ['too short', 'abc'],
    ['too long', `${fakeManageToken}x`],
    ['a path in it', `${fakeManageToken.slice(0, 40)}/..`],
    ['a space', `${fakeManageToken.slice(0, 40)}   `],
    ['empty', ''],
  ])('refuses a token that is %s', (_label, token) => {
    expect(() => manageLink(token, appUrl)).toThrow(RangeError);
  });
});

describe('bookingCalendarEvent', () => {
  it('names the order, the place, and the host', () => {
    expect(bookingCalendarEvent(orderA, appUrl)).toEqual({
      uid: `${orderA.orderId}@ramble.example`,
      startsAt: orderA.startsAt,
      endsAt: orderA.endsAt,
      stampedAt: orderA.confirmedAt,
      summary: 'Sunset sail on the Hudson',
      location: 'Pier 40, West Side Highway at Houston Street',
      description: 'Booking RMB-A3K7MN with Harbor Light Sailing.',
    });
  });

  it('has no place when the experience has no meeting point', () => {
    expect(bookingCalendarEvent(orderB, appUrl).location).toBeNull();
  });

  it('is the same for the same order, so a retry sends the same file', () => {
    expect(bookingCalendarEvent(orderA, appUrl)).toEqual(
      bookingCalendarEvent({ ...orderA }, appUrl),
    );
  });
});

describe('guestConfirmationData', () => {
  const input = { appUrl, manageToken: fakeManageToken };

  it('itemizes the order in the session zone and passes its schema', () => {
    const data = guestConfirmationData(orderA, input);

    expect(GuestConfirmationDataSchema.parse(data)).toEqual(data);
    expect(data).toMatchObject({
      recipientName: 'Pat Rivera',
      reference: 'RMB-A3K7MN',
      experienceName: 'Sunset sail on the Hudson',
      hostName: 'Harbor Light Sailing',
      dayLabel: 'Saturday, November 7, 2026',
      timeLabel: '4:00 PM EST',
      durationLabel: '2 hr',
      meetingPoint: 'Pier 40, West Side Highway at Houston Street',
      partyLabel: '3 guests',
      lines: [
        { label: 'Adult x 2', amount: '$170.00' },
        { label: 'Child x 1', amount: '$45.00' },
      ],
      taxLine: { label: 'Sales tax', amount: '$19.12' },
      total: '$234.12',
      giftApplied: null,
      charged: null,
      cancellationTerms: 'Free cancellation until Fri, Nov 6, 4:00 PM EST.',
      manageUrl: `https://ramble.example/manage/${fakeManageToken}`,
    });
    expect(data.calendarUrl).toContain('https://calendar.google.com/');
  });

  it('shows the gift and the charge for a gift-paid order, and no tax line when untaxed', () => {
    const data = guestConfirmationData(orderB, input);

    expect(data).toMatchObject({
      recipientName: 'there',
      durationLabel: null,
      meetingPoint: null,
      taxLine: null,
      total: '$95.00',
      giftApplied: '$40.00',
      charged: '$55.00',
      cancellationTerms: 'The cancellation terms are on your booking page.',
    });
  });

  it('refuses an order that is not confirmed', () => {
    expect(() =>
      guestConfirmationData({ ...orderA, confirmedAt: null }, input),
    ).toThrow(RangeError);
  });

  it('refuses lines that do not add up to the total', () => {
    expect(() =>
      guestConfirmationData({ ...orderA, totalMinor: 1 }, input),
    ).toThrow(RangeError);
  });

  it('cuts a stored name and meeting point to the template limits', () => {
    const long: BookingEmailSource = {
      ...orderA,
      experienceName: 'N'.repeat(900),
      meetingPoint: 'M'.repeat(5000),
    };

    const data = guestConfirmationData(long, input);

    expect(Array.from(data.experienceName)).toHaveLength(200);
    expect(Array.from(data.meetingPoint ?? '')).toHaveLength(600);
    expect(GuestConfirmationDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('hostBookingNoticeData', () => {
  it('names the guest and the party, and holds no payment or link', () => {
    const data = hostBookingNoticeData(orderA);

    expect(HostBookingNoticeDataSchema.parse(data)).toEqual(data);
    expect(data).toEqual({
      hostName: 'Harbor Light Sailing',
      reference: 'RMB-A3K7MN',
      experienceName: 'Sunset sail on the Hudson',
      dayLabel: 'Saturday, November 7, 2026',
      timeLabel: '4:00 PM EST',
      guestName: 'Pat Rivera',
      partyLabel: '3 guests',
    });
  });
});

describe('cancellation wording', () => {
  const cancellers: CancelledBy[] = ['guest', 'host', 'weather', 'ramble'];

  it.each([
    ['guest', 'guest', 'You cancelled this booking.'],
    ['guest', 'host', 'The host cancelled this session.'],
    ['guest', 'weather', 'This session was cancelled because of the weather.'],
    ['guest', 'ramble', 'Ramble cancelled this session.'],
    ['host', 'guest', 'The guest cancelled this booking.'],
    ['host', 'host', 'You cancelled this session.'],
    ['host', 'weather', 'This session was cancelled because of the weather.'],
    ['host', 'ramble', 'Ramble cancelled this session.'],
  ] as const)('tells a %s that %s cancelled', (audience, by, expected) => {
    expect(cancellationReasonLine(audience, by)).toBe(expected);
  });

  it.each([
    [
      17000,
      'Your refund of $170.00 goes back to your original payment method.',
    ],
    [0, 'No refund is due under the cancellation terms.'],
  ])('writes the refund line for %i', (refundMinor, expected) => {
    expect(cancellationRefundLine(refundMinor)).toBe(expected);
  });

  const base = {
    recipientName: 'Pat Rivera',
    reference: orderA.reference,
    experienceName: orderA.experienceName,
    startsAt: orderA.startsAt,
    timeZone: orderA.timeZone,
    items: orderA.items,
    refundMinor: 23412,
    otherDatesPath:
      '/experiences/sunset-sail-0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
    appUrl,
  };

  it('gives a guest the refund line, and a link to other dates when the guest did not cancel', () => {
    const data = bookingCancellationData({
      ...base,
      audience: 'guest',
      cancelledBy: 'weather',
    });

    expect(BookingCancellationDataSchema.parse(data)).toEqual(data);
    expect(data.refundLine).toBe(
      'Your refund of $234.12 goes back to your original payment method.',
    );
    expect(data.otherDatesUrl).toBe(
      'https://ramble.example/experiences/sunset-sail-0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
    );
  });

  it('gives a guest who cancelled no link to other dates', () => {
    const data = bookingCancellationData({
      ...base,
      audience: 'guest',
      cancelledBy: 'guest',
    });

    expect(data.otherDatesUrl).toBeNull();
    expect(data.refundLine).not.toBeNull();
  });

  it('gives a host neither a refund line nor a link', () => {
    for (const cancelledBy of cancellers) {
      const data = bookingCancellationData({
        ...base,
        audience: 'host',
        cancelledBy,
      });

      expect(data.refundLine).toBeNull();
      expect(data.otherDatesUrl).toBeNull();
    }
  });

  it('has no link when the caller passes no experience address', () => {
    expect(
      bookingCancellationData({
        ...base,
        audience: 'guest',
        cancelledBy: 'host',
        otherDatesPath: null,
      }).otherDatesUrl,
    ).toBeNull();
  });
});

describe('bookingRefundData', () => {
  it('holds the amount and when to expect it', () => {
    const data = bookingRefundData({
      recipientName: null,
      reference: orderA.reference,
      experienceName: orderA.experienceName,
      refundMinor: 17000,
    });

    expect(BookingRefundDataSchema.parse(data)).toEqual(data);
    expect(data).toMatchObject({
      recipientName: 'there',
      amount: '$170.00',
      arrivalLine: refundArrivalLine,
    });
  });
});

describe('paidAfterLapseData', () => {
  it.each([
    [
      'sold_out_after_lapse',
      'Your hold ran out before your payment went through, and the spaces were taken.',
    ],
    [
      'session_cancelled',
      'The session was cancelled before your payment went through.',
    ],
  ] as const)('says why for %s', (reason, expected) => {
    expect(lapseReasonLine(reason)).toBe(expected);
  });

  it('holds the amount, the session, and a link to browse', () => {
    const data = paidAfterLapseData({
      recipientName: 'Pat Rivera',
      reference: orderA.reference,
      experienceName: orderA.experienceName,
      startsAt: orderA.startsAt,
      timeZone: orderA.timeZone,
      amountMinor: 23412,
      reason: 'sold_out_after_lapse',
      appUrl,
    });

    expect(PaidAfterLapseDataSchema.parse(data)).toEqual(data);
    expect(data).toMatchObject({
      amount: '$234.12',
      dayLabel: 'Saturday, November 7, 2026',
      timeLabel: '4:00 PM EST',
      browseUrl: 'https://ramble.example/new-york/browse',
    });
  });
});
