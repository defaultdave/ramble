import { describe, expect, it } from 'vitest';
import {
  bookingCancellationData,
  bookingRefundData,
  guestConfirmationData,
  hostBookingNoticeData,
  paidAfterLapseData,
} from '@/lib/bookingEmails';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from '@/lib/bookingEmails.fixtures';
import { parseEmailRequest, type EmailRequest } from '@/lib/email/templates';
import { renderEmail } from './render';

// Behaviours under test, one per decision or risk. Each template renders from the fixture orders:
// - every booking email has the help link, absolute, in both parts, and no em dash
// - the guest confirmation shows what, when, where, party, the itemized total, the terms, the manage link, the
//   calendar link, and carries one calendar file; an order with a gift shows the gift and the charge
// - the host notice shows the guest and the party and no payment or link
// - the cancellation shows the refund and other dates to a guest, and neither to a host
// - the refund and S10 notices show the amount; S10 says the guest is not booked and links to browse
// - a stored name cannot inject markup
// - the plain-text part has no tags and still holds the links

const to = 'pat@example.com';
const input = { appUrl, manageToken: fakeManageToken };

function request(template: string, data: unknown): EmailRequest {
  return parseEmailRequest({
    template,
    to,
    data,
    idempotencyKey: `${template}:render`,
  });
}

const cancellationBase = {
  recipientName: orderA.leadGuestName,
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

const all: [string, EmailRequest][] = [
  [
    'guest-confirmation',
    request('guest-confirmation', guestConfirmationData(orderA, input)),
  ],
  [
    'guest-confirmation (gift order)',
    request('guest-confirmation', guestConfirmationData(orderB, input)),
  ],
  [
    'host-booking-notice',
    request('host-booking-notice', hostBookingNoticeData(orderA)),
  ],
  [
    'booking-cancellation (guest)',
    request(
      'booking-cancellation',
      bookingCancellationData({
        ...cancellationBase,
        audience: 'guest',
        cancelledBy: 'weather',
      }),
    ),
  ],
  [
    'booking-cancellation (host)',
    request(
      'booking-cancellation',
      bookingCancellationData({
        ...cancellationBase,
        audience: 'host',
        cancelledBy: 'guest',
      }),
    ),
  ],
  [
    'booking-refund',
    request(
      'booking-refund',
      bookingRefundData({
        recipientName: orderA.leadGuestName,
        reference: orderA.reference,
        experienceName: orderA.experienceName,
        refundMinor: 23412,
      }),
    ),
  ],
  [
    'paid-after-lapse',
    request(
      'paid-after-lapse',
      paidAfterLapseData({
        recipientName: orderA.leadGuestName,
        reference: orderA.reference,
        experienceName: orderA.experienceName,
        startsAt: orderA.startsAt,
        timeZone: orderA.timeZone,
        amountMinor: 23412,
        reason: 'sold_out_after_lapse',
        appUrl,
      }),
    ),
  ],
];

const render = (req: EmailRequest) => renderEmail(req, appUrl);
const byName = (name: string) => {
  const found = all.find(([n]) => n === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found[1];
};

describe('every booking email', () => {
  it.each(all)('%s links to help and uses no em dash', async (_name, req) => {
    const { html, text, subject } = await render(req);

    expect(html).toContain('href="https://ramble.example/help"');
    expect(text).toContain('https://ramble.example/help');
    for (const part of [html, text, subject]) {
      expect(part).not.toContain('—');
    }
  });

  it.each(all)(
    '%s has a plain-text part with no markup',
    async (_name, req) => {
      const { text } = await render(req);

      expect(text).not.toMatch(/<\/?[a-z]/i);
    },
  );
});

describe('guest confirmation', () => {
  it('shows the booking, the total, the terms, and both links', async () => {
    const { html, text, attachments } = await render(
      byName('guest-confirmation'),
    );

    for (const part of [
      'Sunset sail on the Hudson',
      'Saturday, November 7, 2026',
      '4:00 PM EST',
      'Pier 40, West Side Highway at Houston Street',
      '3 guests',
      'Adult x 2',
      '$170.00',
      'Sales tax',
      '$19.12',
      '$234.12',
      'Free cancellation until Fri, Nov 6, 4:00 PM EST.',
      'RMB-A3K7MN',
      'Harbor Light Sailing',
      'Hi Pat Rivera',
    ]) {
      expect(html).toContain(part);
      expect(text).toContain(part);
    }
    expect(html).toContain(
      `href="https://ramble.example/manage/${fakeManageToken}"`,
    );
    expect(text).toContain(`https://ramble.example/manage/${fakeManageToken}`);
    expect(html).toContain(
      'href="https://calendar.google.com/calendar/render?',
    );
    expect(text).toContain('https://calendar.google.com/calendar/render?');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe('ramble-booking.ics');
  });

  it('shows the gift and the charge for a gift-paid order', async () => {
    const { text } = await render(byName('guest-confirmation (gift order)'));

    expect(text).toContain('Paid with your gift');
    expect(text).toContain('$40.00');
    expect(text).toContain('Charged to your card');
    expect(text).toContain('$55.00');
    expect(text).not.toContain('Sales tax');
    expect(text).toContain('Hi there');
  });

  it('escapes a stored name', async () => {
    const hostile = request(
      'guest-confirmation',
      guestConfirmationData(
        { ...orderA, experienceName: '<script>alert(1)</script>' },
        input,
      ),
    );

    const { html } = await render(hostile);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('host booking notice', () => {
  it('shows the guest and the party, with no payment and no manage link', async () => {
    const { html, text, attachments } = await render(
      byName('host-booking-notice'),
    );

    expect(text).toContain(
      'Hi Harbor Light Sailing, Pat Rivera booked 3 guests',
    );
    expect(text).toContain('Saturday, November 7, 2026');
    expect(text).not.toMatch(/\$\d/);
    expect(html).not.toContain('/manage/');
    expect(attachments).toEqual([]);
  });
});

describe('booking cancellation', () => {
  it('tells a guest about the refund and other dates', async () => {
    const { text, subject } = await render(
      byName('booking-cancellation (guest)'),
    );

    expect(subject).toBe(
      'Your booking is cancelled: Sunset sail on the Hudson',
    );
    expect(text).toContain(
      'This session was cancelled because of the weather.',
    );
    expect(text).toContain('Your refund of $234.12');
    expect(text).toContain('See other dates');
    expect(text).toContain('https://ramble.example/experiences/sunset-sail-');
  });

  it('tells a host who cancelled, with no refund and no link', async () => {
    const { text, subject } = await render(
      byName('booking-cancellation (host)'),
    );

    expect(subject).toContain('Booking cancelled: Sunset sail on the Hudson');
    expect(text).toContain('The guest cancelled this booking.');
    expect(text).not.toContain('refund');
    expect(text).not.toContain('See other dates');
  });
});

describe('refund and S10 notices', () => {
  it('the refund notice shows the amount and when to expect it', async () => {
    const { text, subject } = await render(byName('booking-refund'));

    expect(subject).toBe('Refund issued: $234.12');
    expect(text).toContain('we refunded $234.12');
    expect(text).toContain('5 to 10 business days');
  });

  it('the S10 notice says the guest is not booked, why, and where to look next', async () => {
    const { text, html, subject } = await render(byName('paid-after-lapse'));

    expect(subject).toBe(
      'We refunded your payment for Sunset sail on the Hudson',
    );
    expect(text).toContain('you are not booked');
    expect(text).toContain(
      'Your hold ran out before your payment went through',
    );
    expect(text).toContain('We refunded $234.12 in full');
    expect(html).toContain('href="https://ramble.example/new-york/browse"');
  });
});
