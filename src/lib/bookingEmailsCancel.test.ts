import { describe, expect, it } from 'vitest';
import { orderA } from './bookingEmails.fixtures';
import {
  bookingEmailKey,
  bookingCancellationData,
  bookingSummaryData,
  refundArrivalLine,
  refundArrivalWindow,
  cancellationDecision,
  guestConfirmationData,
  hostNoticeDecision,
  refundEmailDecision,
  refundEmailKey,
} from './bookingEmails';

// Behaviours under test, one per decision, branch, or risk:
// - the cancellation emails go out only for a cancelled booking; any other state or kind is a bug and is refused
// - the refund email goes out for a succeeded guest cancellation, is skipped for another reason, and is refused before success
// - the keys are one per order and email, and one per refund, so a retry sends once

describe('whether the cancellation emails go out', () => {
  it.each([
    ['a cancelled booking', 'booking', 'cancelled', 'send'],
    ['a confirmed booking', 'booking', 'confirmed', 'refuse'],
    ['a pending booking', 'booking', 'pending_payment', 'refuse'],
    ['a cancelled gift purchase', 'gift_purchase', 'cancelled', 'refuse'],
  ] as const)('for %s', (_name, kind, status, expected) => {
    expect(cancellationDecision({ kind, status })).toBe(expected);
  });
});

describe('whether the refund email goes out', () => {
  it.each([
    ['a succeeded guest cancellation', 'succeeded', 'guest_cancel', 'send'],
    [
      'a succeeded session cancellation',
      'succeeded',
      'session_cancelled',
      'skip',
    ],
    ['a pending guest cancellation', 'pending', 'guest_cancel', 'refuse'],
    ['a failed guest cancellation', 'failed', 'guest_cancel', 'refuse'],
  ])('for %s', (_name, status, reason, expected) => {
    expect(refundEmailDecision({ status, reason })).toBe(expected);
  });
});

describe('the keys', () => {
  const id = '0F6C9A52-3B8E-4F43-9A55-1A2B3C4D5E01';

  it('names one email of one order', () => {
    expect(bookingEmailKey('guest-cancellation', id)).toBe(
      `guest-cancellation:${id}`,
    );
    expect(bookingEmailKey('host-cancellation-notice', id)).toBe(
      `host-cancellation-notice:${id}`,
    );
  });

  it('names the refund email by the refund, in lower case', () => {
    expect(refundEmailKey(id)).toBe(`guest-refund:${id.toLowerCase()}`);
  });
});

describe('whether the host is told', () => {
  it('sends to the address the host gave', () => {
    expect(
      hostNoticeDecision({
        hostNotificationEmail: 'bookings@harborlight.example',
      }),
    ).toEqual({ kind: 'send', to: 'bookings@harborlight.example' });
  });

  it('refuses a host with no address', () => {
    expect(hostNoticeDecision({ hostNotificationEmail: null })).toEqual({
      kind: 'refuse',
    });
  });
});

describe('the booking summary', () => {
  it('is the same for a cancelled order with no confirmation time, which the confirmation email would refuse', () => {
    const cancelled = {
      ...orderA,
      status: 'cancelled' as const,
      confirmedAt: null,
    };

    expect(bookingSummaryData(cancelled)).toEqual(bookingSummaryData(orderA));
    expect(() =>
      guestConfirmationData(cancelled, {
        appUrl: 'https://ramble.example',
        manageToken: 'A'.repeat(43),
      }),
    ).toThrow('confirmed order');
  });

  it('is what the confirmation email starts from', () => {
    const data = guestConfirmationData(orderA, {
      appUrl: 'https://ramble.example',
      manageToken: 'A'.repeat(43),
    });

    expect(data).toMatchObject(bookingSummaryData(orderA));
  });

  it('cuts a long name, host, and meeting point to the limits the emails hold', () => {
    const summary = bookingSummaryData({
      ...orderA,
      experienceName: 'E'.repeat(500),
      hostName: 'H'.repeat(500),
      meetingPoint: 'M'.repeat(2_000),
    });

    expect(summary.experienceName).toHaveLength(200);
    expect(summary.hostName).toHaveLength(120);
    expect(summary.meetingPoint).toHaveLength(600);
  });
});

describe('who a cancellation email greets', () => {
  const input = {
    recipientName: null as string | null,
    reference: 'RMB-A3K7MN',
    experienceName: 'Sunset sail',
    startsAt: new Date('2026-11-07T21:00:00Z'),
    timeZone: 'America/New_York',
    items: orderA.items,
    cancelledBy: 'guest' as const,
    refundMinor: 0,
    otherDatesPath: null,
    appUrl: 'https://ramble.example',
  };

  it.each([
    ['no name', null, 'there'],
    ['a blank name', '   ', 'there'],
    ['a name', 'Pat Rivera', 'Pat Rivera'],
    ['a name with a line break', 'Pat\nRivera', 'Pat Rivera'],
  ])('greets %s as %s', (_name, recipientName, greeting) => {
    for (const audience of ['guest', 'host'] as const) {
      expect(
        bookingCancellationData({ ...input, audience, recipientName })
          .recipientName,
      ).toBe(greeting);
    }
  });

  it('says who cancelled, in the words of the audience', () => {
    expect(
      bookingCancellationData({
        ...input,
        audience: 'host',
        cancelledBy: 'weather',
      }).reasonLine,
    ).toBe('This session was cancelled because of the weather.');
    expect(
      bookingCancellationData({
        ...input,
        audience: 'host',
        cancelledBy: 'guest',
      }).reasonLine,
    ).toBe('The guest cancelled this booking.');
  });
});

describe('how long a refund takes', () => {
  it('is said once, in the refund email and on the manage page alike', () => {
    expect(refundArrivalWindow).toBe('5 to 10 business days');
    expect(refundArrivalLine).toBe(
      'Your bank usually shows it within 5 to 10 business days.',
    );
  });
});
