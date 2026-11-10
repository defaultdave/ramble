import { describe, expect, it } from 'vitest';
import {
  bookingEmailKey,
  cancellationDecision,
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
