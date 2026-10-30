import { describe, expect, it } from 'vitest';
import {
  bookingCancellationData,
  bookingRefundData,
  guestConfirmationData,
  hostBookingNoticeData,
  paidAfterLapseData,
} from '../bookingEmails';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from '../bookingEmails.fixtures';
import {
  bookingCancellationBody,
  bookingRefundBody,
  guestConfirmationBody,
  hostBookingNoticeBody,
  paidAfterLapseBody,
} from './bookingBody';

// Behaviours under test, one per decision or risk:
// - the confirmation lists the booking rows, leaving out length and meeting point when there are none
// - the payment rows run lines, tax, total, then the gift and the charge only for a gift order
// - the cancellation greeting is its own sentence, so the reason starts with a capital after a full stop
// - the cancellation carries the refund line for a guest and none for a host
// - the host notice, refund, and S10 intros name the recipient, the amount, and the reason
// - no body uses an em dash

const input = { appUrl, manageToken: fakeManageToken };
const labels = (rows: { label: string }[]) => rows.map((row) => row.label);

describe('guestConfirmationBody', () => {
  it('lists every booking row for a full order', () => {
    const body = guestConfirmationBody(guestConfirmationData(orderA, input));

    expect(body.heading).toBe("You're booked");
    expect(body.intro).toBe(
      'Hi Pat Rivera, your booking is confirmed. A calendar file is attached.',
    );
    expect(labels(body.rows)).toEqual([
      'Experience',
      'Date',
      'Time',
      'Length',
      'Meeting point',
      'Guests',
      'Host',
      'Reference',
    ]);
    expect(labels(body.paymentRows)).toEqual([
      'Adult x 2',
      'Child x 1',
      'Sales tax',
      'Total',
    ]);
  });

  it('leaves out the length and the meeting point, and adds the gift rows', () => {
    const body = guestConfirmationBody(guestConfirmationData(orderB, input));

    expect(labels(body.rows)).not.toContain('Length');
    expect(labels(body.rows)).not.toContain('Meeting point');
    expect(body.paymentRows).toEqual([
      { label: 'Adult x 1', value: '$95.00' },
      { label: 'Total', value: '$95.00' },
      { label: 'Paid with your gift', value: '$40.00' },
      { label: 'Charged to your card', value: '$55.00' },
    ]);
  });
});

describe('hostBookingNoticeBody', () => {
  it('names the guest, the party, and the time', () => {
    const body = hostBookingNoticeBody(hostBookingNoticeData(orderA));

    expect(body.intro).toBe(
      'Hi Harbor Light Sailing, Pat Rivera booked 3 guests on Saturday, November 7, 2026 at 4:00 PM EST.',
    );
    expect(labels(body.rows)).toEqual([
      'Experience',
      'Date',
      'Time',
      'Guests',
      'Lead guest',
      'Reference',
    ]);
  });
});

describe('bookingCancellationBody', () => {
  const base = {
    recipientName: 'Pat Rivera',
    reference: orderA.reference,
    experienceName: orderA.experienceName,
    startsAt: orderA.startsAt,
    timeZone: orderA.timeZone,
    items: orderA.items,
    cancelledBy: 'weather' as const,
    refundMinor: 1000,
    otherDatesPath: null,
    appUrl,
  };

  it('greets in its own sentence, so the reason is not joined with a comma', () => {
    const body = bookingCancellationBody(
      bookingCancellationData({ ...base, audience: 'guest' }),
    );

    expect(body.intro).toBe(
      'Hi Pat Rivera. This session was cancelled because of the weather.',
    );
    expect(body.intro).not.toMatch(/, [A-Z]/);
  });

  it('has the refund line for a guest and none for a host', () => {
    expect(
      bookingCancellationBody(
        bookingCancellationData({ ...base, audience: 'guest' }),
      ).refundLine,
    ).toBe('Your refund of $10.00 goes back to your original payment method.');
    expect(
      bookingCancellationBody(
        bookingCancellationData({ ...base, audience: 'host' }),
      ).refundLine,
    ).toBeNull();
  });
});

describe('bookingRefundBody and paidAfterLapseBody', () => {
  it('the refund names the amount and when it arrives', () => {
    const body = bookingRefundBody(
      bookingRefundData({
        recipientName: 'Pat',
        reference: orderA.reference,
        experienceName: orderA.experienceName,
        refundMinor: 17000,
      }),
    );

    expect(body.heading).toBe('Your refund is on its way');
    expect(body.intro).toBe(
      'Hi Pat, we refunded $170.00 to your original payment method. Your bank usually shows it within 5 to 10 business days.',
    );
  });

  it('the S10 notice says the guest is not booked and why', () => {
    const body = paidAfterLapseBody(
      paidAfterLapseData({
        recipientName: 'Pat',
        reference: orderA.reference,
        experienceName: orderA.experienceName,
        startsAt: orderA.startsAt,
        timeZone: orderA.timeZone,
        amountMinor: 17000,
        reason: 'session_cancelled',
        appUrl,
      }),
    );

    expect(body.intro).toBe(
      'Hi Pat, you are not booked. The session was cancelled before your payment went through. We refunded $170.00 in full to your original payment method.',
    );
    expect(body.browseLabel).toBe('Find another date');
  });
});

describe('every body', () => {
  it('uses no em dash', () => {
    const bodies = [
      guestConfirmationBody(guestConfirmationData(orderA, input)),
      hostBookingNoticeBody(hostBookingNoticeData(orderA)),
    ];

    expect(JSON.stringify(bodies)).not.toContain('—');
  });
});
