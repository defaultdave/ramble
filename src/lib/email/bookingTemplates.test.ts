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
import { attachmentsFor, parseEmailRequest, subjectFor } from './templates';
import { calendarFilename } from './bookingTemplates';
import { EmailAttachmentSchema, subjectPattern } from './message';

// Behaviours under test, one per decision or risk:
// - each booking template parses through the request envelope, and a field over its limit or a link that is not
//   http(s) is refused
// - each subject names the experience (cut to one short line), and the cancellation subject is worded per reader
// - a subject cannot carry a line break, whatever the stored name holds
// - only the guest confirmation carries a file: a valid .ics for the booking, the same bytes on a second build
// - the other templates carry none

const to = 'pat@example.com';

const confirmation = guestConfirmationData(orderA, {
  appUrl,
  manageToken: fakeManageToken,
});

const lapse = {
  recipientName: 'Pat',
  reference: orderA.reference,
  experienceName: orderA.experienceName,
  startsAt: orderA.startsAt,
  timeZone: orderA.timeZone,
  amountMinor: 23412,
  reason: 'sold_out_after_lapse' as const,
  appUrl,
};

const cancellation = {
  recipientName: 'Pat',
  reference: orderA.reference,
  experienceName: orderA.experienceName,
  startsAt: orderA.startsAt,
  timeZone: orderA.timeZone,
  items: orderA.items,
  refundMinor: 23412,
  otherDatesPath: null,
  appUrl,
};

const requests = [
  ['guest-confirmation', confirmation],
  ['host-booking-notice', hostBookingNoticeData(orderA)],
  [
    'booking-cancellation',
    bookingCancellationData({
      ...cancellation,
      audience: 'guest',
      cancelledBy: 'guest',
    }),
  ],
  [
    'booking-refund',
    bookingRefundData({
      recipientName: 'Pat',
      reference: orderA.reference,
      experienceName: orderA.experienceName,
      refundMinor: 17000,
    }),
  ],
  ['paid-after-lapse', paidAfterLapseData(lapse)],
] as const;

const request = (template: string, data: unknown) =>
  parseEmailRequest({
    template,
    to,
    data,
    idempotencyKey: `${template}:1`,
  });

describe('booking template requests', () => {
  it.each(requests)('%s parses', (template, data) => {
    expect(request(template, data).template).toBe(template);
  });

  it.each([
    ['a manage link that is not http(s)', { manageUrl: 'javascript:alert(1)' }],
    ['a calendar link that is a data URL', { calendarUrl: 'data:text/html,x' }],
    ['a reference that is not an order reference', { reference: 'ABC' }],
    [
      'an experience name over 200 characters',
      { experienceName: 'x'.repeat(201) },
    ],
    ['no party', { partyLabel: '' }],
    [
      'five money lines',
      { lines: Array(5).fill({ label: 'a', amount: '$1' }) },
    ],
    ['no money line', { lines: [] }],
    [
      'a calendar that ends not as a date',
      { calendar: { ...confirmation.calendar, endsAt: 'soon' } },
    ],
  ])('guest-confirmation refuses %s', (_label, override) => {
    expect(() =>
      request('guest-confirmation', { ...confirmation, ...override }),
    ).toThrow();
  });

  it('refuses a cancellation for a reader who is neither the guest nor the host', () => {
    expect(() =>
      request('booking-cancellation', {
        ...bookingCancellationData({
          ...cancellation,
          audience: 'guest',
          cancelledBy: 'guest',
        }),
        audience: 'ops',
      }),
    ).toThrow();
  });
});

describe('subjects', () => {
  it.each([
    [
      'guest-confirmation',
      confirmation,
      "You're booked: Sunset sail on the Hudson",
    ],
    [
      'host-booking-notice',
      hostBookingNoticeData(orderA),
      'New booking: Sunset sail on the Hudson, Saturday, November 7, 2026',
    ],
    ['booking-refund', requests[3][1], 'Refund issued: $170.00'],
    [
      'paid-after-lapse',
      paidAfterLapseData(lapse),
      'We refunded your payment for Sunset sail on the Hudson',
    ],
  ])('%s', (template, data, expected) => {
    expect(subjectFor(request(template, data))).toBe(expected);
  });

  it.each([
    ['guest', 'Your booking is cancelled: Sunset sail on the Hudson'],
    [
      'host',
      'Booking cancelled: Sunset sail on the Hudson, Saturday, November 7, 2026',
    ],
  ] as const)('cancellation is worded for the %s', (audience, expected) => {
    const data = bookingCancellationData({
      ...cancellation,
      audience,
      cancelledBy: 'guest',
    });

    expect(subjectFor(request('booking-cancellation', data))).toBe(expected);
  });

  it('cuts a long name and keeps the subject on one line', () => {
    const data = guestConfirmationData(
      {
        ...orderA,
        experienceName: `Line one\r\nBcc: x@example.com ${'x'.repeat(300)}`,
      },
      { appUrl, manageToken: fakeManageToken },
    );

    const subject = subjectFor(request('guest-confirmation', data));

    expect(subject).toMatch(new RegExp(subjectPattern));
    expect(subject.length).toBeLessThanOrEqual(100);
    expect(subject.endsWith('…')).toBe(true);
  });
});

describe('attachments', () => {
  it('sends a calendar file with the guest confirmation', () => {
    const [file, ...rest] = attachmentsFor(
      request('guest-confirmation', confirmation),
    );

    expect(rest).toHaveLength(0);
    expect(EmailAttachmentSchema.parse(file)).toEqual(file);
    expect(file?.filename).toBe(calendarFilename);
    expect(file?.content).toContain('BEGIN:VCALENDAR\r\n');
    expect(file?.content).toContain(`UID:${orderA.orderId}@ramble.example\r\n`);
    expect(file?.content).toContain('DTSTART:20261107T210000Z\r\n');
    expect(file?.content).toContain('SUMMARY:Sunset sail on the Hudson\r\n');
  });

  it('holds no capability link', () => {
    const [file] = attachmentsFor(request('guest-confirmation', confirmation));

    expect(file?.content).not.toContain(fakeManageToken);
    expect(file?.content).not.toContain('/manage/');
  });

  it('gives the same bytes when built again, so a retry sends the same file', () => {
    const again = guestConfirmationData(orderA, {
      appUrl,
      manageToken: fakeManageToken,
    });

    expect(attachmentsFor(request('guest-confirmation', again))).toEqual(
      attachmentsFor(request('guest-confirmation', confirmation)),
    );
  });

  it('leaves out the place for an experience with no meeting point', () => {
    const data = guestConfirmationData(orderB, {
      appUrl,
      manageToken: fakeManageToken,
    });

    const [file] = attachmentsFor(request('guest-confirmation', data));

    expect(file?.content).not.toContain('LOCATION');
  });

  it.each(requests.filter(([name]) => name !== 'guest-confirmation'))(
    '%s carries no file',
    (template, data) => {
      expect(attachmentsFor(request(template, data))).toEqual([]);
    },
  );
});
