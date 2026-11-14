import { describe, expect, it } from 'vitest';
import { subjectFor, type EmailRequest } from '../email/templates';
import { declineNotice, refusedNotice } from '../fakePayment';
import { demoLabel } from '../pages/legal';
import { commonCopy } from './common';

// Strings that matter outside the code: a person, a mail client, or a legal reader depends on the
// exact words. They are pinned here as literals on purpose, so changing one is a decision made in
// this file and not a side effect of editing the dictionary.
//
// Behaviours under test, one per string:
// - the legal pages are labelled as demo text
// - every email template's subject line, as a mail client shows it
// - the payment-failure message a guest reads after a declined card, and after a refused payment
// - the 404 heading

const subject = (template: string, data: Record<string, unknown>) =>
  subjectFor({
    template,
    to: 'guest@example.com',
    data,
    idempotencyKey: 'contract',
  } as unknown as EmailRequest);

const booked = {
  experienceName: 'Pottery wheel night',
  dayLabel: 'Saturday, November 14, 2026',
};

describe('the legal demo label', () => {
  it('says demo text', () => {
    expect(demoLabel).toBe('Demo text');
  });
});

describe('email subjects', () => {
  it.each([
    ['dev-check', {}, 'Ramble email check'],
    ['sign-in-link', {}, 'Your Ramble sign-in link'],
    ['guest-confirmation', booked, "You're booked: Pottery wheel night"],
    [
      'booking-moved',
      booked,
      'Your booking has moved: Pottery wheel night, Saturday, November 14, 2026',
    ],
    [
      'host-booking-notice',
      booked,
      'New booking: Pottery wheel night, Saturday, November 14, 2026',
    ],
    [
      'session-reminder',
      booked,
      'Coming up: Pottery wheel night, Saturday, November 14, 2026',
    ],
    [
      'booking-cancellation',
      { ...booked, audience: 'guest' },
      'Your booking is cancelled: Pottery wheel night',
    ],
    [
      'booking-cancellation',
      { ...booked, audience: 'host' },
      'Booking cancelled: Pottery wheel night, Saturday, November 14, 2026',
    ],
    ['booking-refund', { amount: '$85.00' }, 'Refund issued: $85.00'],
    [
      'paid-after-lapse',
      booked,
      'We refunded your payment for Pottery wheel night',
    ],
    [
      'host-invite',
      { hostName: 'Fort Greene Pottery' },
      'You are set up on Ramble: Fort Greene Pottery',
    ],
    ['ops-notice', { subject: 'New contact message' }, 'New contact message'],
  ])('%s reads the same', (template, data, expected) => {
    expect(subject(template, data)).toBe(expected);
  });
});

describe('the payment-failure message', () => {
  it('tells a guest whose card was declined that the spaces are still held', () => {
    expect(declineNotice('card_declined')).toEqual({
      tone: 'danger',
      title: 'Your card was declined',
      body: "Your bank didn't approve this payment. Your spaces are still held. Try another card or a wallet.",
    });
  });

  it('tells a guest whose payment was refused to reload', () => {
    expect(refusedNotice.title).toBe("We couldn't take this payment");
  });
});

describe('the 404 heading', () => {
  it('says the page cannot be found', () => {
    expect(commonCopy.notFound.title).toBe("We can't find that page");
  });
});
