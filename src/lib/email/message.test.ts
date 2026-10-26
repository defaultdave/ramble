import { describe, expect, it } from 'vitest';
import {
  IdempotencyKeySchema,
  RenderedEmailSchema,
  formatMailboxTimestamp,
  maxBodyLength,
  messageStatuses,
  messageStatusLabel,
  statusAfterDeliveryEvent,
  suppressionReasonFor,
  type DeliveryEventKind,
  type MessageStatus,
} from './message';

// Behaviours under test, one per decision or branch:
// - a delivery event moves a sent or captured message toward a worse outcome and never back
// - a message that never left (queued, failed, suppressed) takes no event
// - only a hard bounce and a complaint suppress an address
// - an idempotency key is 1 to 200 printable ASCII characters
// - a rendered email needs a one-line subject and non-empty parts under the size limit
// - every status has a label, and the mailbox time is read in UTC

describe('statusAfterDeliveryEvent', () => {
  it.each<[MessageStatus, DeliveryEventKind, MessageStatus | null]>([
    ['sent', 'delivered', 'delivered'],
    ['captured', 'delivered', 'delivered'],
    ['sent', 'hard_bounce', 'bounced'],
    ['delivered', 'hard_bounce', 'bounced'],
    ['sent', 'complaint', 'complained'],
    ['delivered', 'complaint', 'complained'],
    ['bounced', 'complaint', 'complained'],
    ['delivered', 'delivered', null],
    ['bounced', 'delivered', null],
    ['complained', 'delivered', null],
    ['complained', 'hard_bounce', null],
    ['bounced', 'hard_bounce', null],
    ['queued', 'delivered', null],
    ['failed', 'hard_bounce', null],
    ['suppressed', 'complaint', null],
  ])('%s after %s becomes %s', (current, event, expected) => {
    expect(statusAfterDeliveryEvent(current, event)).toBe(expected);
  });
});

describe('suppressionReasonFor', () => {
  it.each<[DeliveryEventKind, string | null]>([
    ['hard_bounce', 'hard_bounce'],
    ['complaint', 'complaint'],
    ['delivered', null],
  ])('%s gives %s', (event, expected) => {
    expect(suppressionReasonFor(event)).toBe(expected);
  });
});

describe('IdempotencyKeySchema', () => {
  it.each(['k', 'order-7f3a:confirmation', 'a'.repeat(200)])(
    'accepts %s',
    (key) => {
      expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['over 200 characters', 'a'.repeat(201)],
    ['a space', 'two words'],
    ['a line break', 'a\nb'],
    ['a non-ASCII character', 'clé'],
  ])('refuses %s', (_label, key) => {
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('RenderedEmailSchema', () => {
  const valid = { subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' };

  it('accepts a complete email', () => {
    expect(RenderedEmailSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['a multi-line subject', { subject: 'Hi\r\nBcc: x@example.com' }],
    ['an empty subject', { subject: '' }],
    ['a subject over 200 characters', { subject: 'a'.repeat(201) }],
    ['empty html', { html: '' }],
    ['empty text', { text: '' }],
    ['html over the limit', { html: 'a'.repeat(maxBodyLength + 1) }],
    ['text over the limit', { text: 'a'.repeat(maxBodyLength + 1) }],
  ])('refuses %s', (_label, override) => {
    expect(
      RenderedEmailSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});

describe('mailbox display', () => {
  it('labels every status', () => {
    for (const status of messageStatuses) {
      expect(messageStatusLabel(status)).not.toBe('');
    }
  });

  it('reads a timestamp in UTC whatever the machine zone', () => {
    expect(formatMailboxTimestamp(new Date('2026-10-26T18:05:00Z'))).toBe(
      'Oct 26, 2026, 6:05 PM UTC',
    );
  });
});
