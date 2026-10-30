import { describe, expect, it } from 'vitest';
import type { BookingEmailSource } from './bookingEmails';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from './bookingEmails.fixtures';
import {
  confirmationHeading,
  mapsSearchUrl,
  orderPageView,
  sellerOfRecordLine,
} from './orderReceipt';
import { orderStatuses } from './orders';

// Behaviours under test, one per decision, branch, or risk.
// - a confirmed order gets the receipt: its date and time in the session's zone, party, lines, totals, and terms
// - the receipt gives the calendar link, a .ics data link, a maps link, and the manage link, built from the token passed in
// - an order with no meeting point gets no maps link; one paid with a gift shows both amounts
// - every state other than confirmed offers no manage link, no calendar, and no maps link
// - a pending order is told apart from a failed, refunded, and closed one, each with its own words
// - the heading greets by first name and not at all without one
// - the seller-of-record line names the host as the seller and Ramble as its agent

const input = { manageToken: fakeManageToken, appUrl };

function view(source: BookingEmailSource) {
  return orderPageView(source, input);
}

describe('orderPageView, confirmed', () => {
  const page = view(orderA);
  if (page.kind !== 'confirmed') throw new Error('expected a receipt');
  const { receipt } = page;

  it('shows when, who, and how many in the session zone', () => {
    expect(receipt).toMatchObject({
      heading: "You're booked, Pat",
      reference: 'RMB-A3K7MN',
      experienceName: 'Sunset sail on the Hudson',
      dayLabel: 'Saturday, November 7, 2026',
      timeLabel: '4:00 PM EST',
      partyLabel: '3 guests',
      meetingPoint: 'Pier 40, West Side Highway at Houston Street',
    });
  });

  it('itemizes what was paid', () => {
    expect(receipt.lines.map((line) => line.amount)).toEqual([
      '$170.00',
      '$45.00',
    ]);
    expect(receipt.taxLine?.amount).toBe('$19.12');
    expect(receipt.total).toBe('$234.12');
    expect(receipt.giftApplied).toBeNull();
    expect(receipt.charged).toBeNull();
  });

  it('links the manage page with the token it was given', () => {
    expect(receipt.manageHref).toBe(`/manage/${fakeManageToken}`);
  });

  it('adds to Google Calendar and as a .ics file of the same event', () => {
    expect(receipt.calendarUrl).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/render\?/,
    );
    expect(receipt.icsHref).toMatch(/^data:text\/calendar;charset=utf-8,/);
    const ics = decodeURIComponent(receipt.icsHref.split(',')[1] ?? '');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Sunset sail on the Hudson');
    expect(receipt.icsFileName).toBe('ramble-booking.ics');
  });

  it('opens the meeting point in a maps search', () => {
    expect(receipt.mapsUrl).toBe(
      'https://www.google.com/maps/search/?api=1&query=Pier+40%2C+West+Side+Highway+at+Houston+Street',
    );
  });

  it('says the host is the seller and Ramble its agent', () => {
    expect(receipt.sellerOfRecord).toBe(
      "Harbor Light Sailing is the seller of this experience. Ramble collected your payment as Harbor Light Sailing's agent.",
    );
  });

  it('states the cancellation terms as they stood at confirmation', () => {
    expect(receipt.cancellationTerms).toMatch(/^Free cancellation until /);
  });
});

describe('orderPageView, a gift-paid order with no meeting point', () => {
  const page = view(orderB);
  if (page.kind !== 'confirmed') throw new Error('expected a receipt');

  it('offers no maps link, greets without a name, and shows the gift and the charge', () => {
    expect(page.receipt.mapsUrl).toBeNull();
    expect(page.receipt.heading).toBe("You're booked");
    expect(page.receipt.giftApplied).toBe('$40.00');
    expect(page.receipt.charged).toBe('$55.00');
  });
});

describe('orderPageView, any other state', () => {
  it('is pending for a payment still being checked', () => {
    expect(view({ ...orderA, status: 'pending_payment' })).toEqual({
      kind: 'pending',
      reference: 'RMB-A3K7MN',
      experienceName: 'Sunset sail on the Hudson',
    });
  });

  it.each([
    ['payment_failed', /didn't go through/],
    ['refunded_after_lapse', /refunded you/],
    ['void', /no longer active/],
    ['cancelled', /no longer active/],
  ] as const)('is a notice for %s', (status, title) => {
    const page = view({ ...orderA, status });
    expect(page.kind).toBe('notice');
    if (page.kind === 'notice') expect(page.notice.title).toMatch(title);
  });

  it.each(orderStatuses.filter((status) => status !== 'confirmed'))(
    'leaves a %s order no manage link, calendar, or map',
    (status) => {
      const text = JSON.stringify(
        view({ ...orderA, status, confirmedAt: null }),
      );
      expect(text).not.toContain('/manage/');
      expect(text).not.toContain('calendar.google.com');
      expect(text).not.toContain('data:text/calendar');
      expect(text).not.toContain('google.com/maps');
    },
  );
});

describe('confirmationHeading', () => {
  it.each([
    ['Pat Rivera', "You're booked, Pat"],
    ['  Alex  ', "You're booked, Alex"],
    [null, "You're booked"],
    ['', "You're booked"],
  ])('greets %j as %j', (name, expected) => {
    expect(confirmationHeading(name)).toBe(expected);
  });
});

describe('mapsSearchUrl', () => {
  it.each([null, '', '   '])('is null for %j', (point) => {
    expect(mapsSearchUrl(point)).toBeNull();
  });

  it('clips a meeting point that runs long', () => {
    const url = new URL(mapsSearchUrl('x'.repeat(1000)) ?? '');
    expect(url.searchParams.get('query')?.length).toBeLessThanOrEqual(300);
  });
});

describe('sellerOfRecordLine', () => {
  it('names the host twice and Ramble once', () => {
    const line = sellerOfRecordLine('Clay & Co');
    expect(line.match(/Clay & Co/g)).toHaveLength(2);
    expect(line.match(/Ramble/g)).toHaveLength(1);
  });
});
