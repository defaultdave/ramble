import { describe, expect, it } from 'vitest';
import {
  IdempotencyKeySchema,
  declaredLengthExceeds,
  failureReasonFor,
  isFreshTimestamp,
  isPermanentBounce,
  isRetryableStatus,
  mailboxAccess,
  outcomeForAdapter,
  planExistingMessage,
  sendAttemptsExhausted,
  summarizeRefusal,
  RenderedEmailSchema,
  formatMailboxTimestamp,
  maxBodyLength,
  messageStatuses,
  messageStatusLabel,
  statusAfterDeliveryEvent,
  suppressionReasonFor,
  maxFailureReasonLength,
  maxSendAttempts,
  type DeliveryEventKind,
  type EmailAdapterName,
  type ExistingMessagePlan,
  type MessageStatus,
} from './message';

// Behaviours under test, one per decision or branch:
// - a delivery event moves a sent or captured message toward a worse outcome and never back
// - a message that never left (queued, failed, suppressed) takes no event
// - only a hard bounce and a complaint suppress an address
// - an idempotency key is 1 to 200 printable ASCII characters
// - a rendered email needs a one-line subject and non-empty parts under the size limit
// - an existing key is a conflict for another template or recipient, settled past queued or failed, and resumed only on the adapter it started on
// - attempts are exhausted only for a failed message at the cap
// - a failure reason is the message cut to the column limit, and never empty
// - only the fake adapter keeps a body and takes the captured status
// - only a provider's permanent bounce types suppress an address
// - 429 and 5xx are retryable and other statuses are not
// - a refusal is summarized on one line and cut
// - a declared length over the limit is flagged, an absent or unreadable header is not
// - a timestamp is fresh within the tolerance either way
// - the mailbox is disabled in live mode or without a secret, locked without a matching cookie, open with one
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

describe('planExistingMessage', () => {
  const existing = {
    status: 'failed' as MessageStatus,
    template: 'dev-check',
    recipient: 'guest@example.com',
    adapter: 'resend' as EmailAdapterName,
  };
  const request = {
    template: 'dev-check',
    to: 'guest@example.com',
    adapter: 'resend' as EmailAdapterName,
  };

  it.each<
    [
      string,
      Partial<typeof existing>,
      Partial<typeof request>,
      ExistingMessagePlan,
    ]
  >([
    ['a failed message on the same adapter resumes', {}, {}, 'resume'],
    [
      'a queued message on the same adapter resumes',
      { status: 'queued' },
      {},
      'resume',
    ],
    [
      'a failed message whose adapter changed is refused',
      {},
      { adapter: 'fake' },
      'adapter_changed',
    ],
    [
      'a queued message whose adapter changed is refused',
      { status: 'queued' },
      { adapter: 'postmark' },
      'adapter_changed',
    ],
    [
      'another recipient conflicts',
      {},
      { to: 'other@example.com' },
      'conflict',
    ],
    ['another template conflicts', {}, { template: 'other' }, 'conflict'],
    [
      'a conflict wins over a changed adapter',
      {},
      { to: 'other@example.com', adapter: 'fake' },
      'conflict',
    ],
    ['a sent message is settled', { status: 'sent' }, {}, 'settled'],
    [
      'a captured message is settled',
      { status: 'captured', adapter: 'fake' },
      { adapter: 'fake' },
      'settled',
    ],
    [
      'a suppressed message is settled',
      { status: 'suppressed' },
      {},
      'settled',
    ],
    [
      'a bounced message is settled even if the adapter changed',
      { status: 'bounced' },
      { adapter: 'fake' },
      'settled',
    ],
  ])('%s', (_label, existingOverride, requestOverride, expected) => {
    expect(
      planExistingMessage(
        { ...existing, ...existingOverride },
        { ...request, ...requestOverride },
      ),
    ).toBe(expected);
  });
});

describe('sendAttemptsExhausted', () => {
  it.each<[MessageStatus, number, boolean]>([
    ['failed', maxSendAttempts, true],
    ['failed', maxSendAttempts - 1, false],
    ['queued', maxSendAttempts, false],
    ['sent', maxSendAttempts, false],
  ])('%s after %i attempts is exhausted: %s', (status, attempts, expected) => {
    expect(sendAttemptsExhausted({ status, attempts })).toBe(expected);
  });
});

describe('failureReasonFor', () => {
  it('uses an error message', () => {
    expect(failureReasonFor(new Error('resend responded 503'))).toBe(
      'resend responded 503',
    );
  });

  it('cuts a long message to the column limit', () => {
    expect(
      failureReasonFor(new Error('x'.repeat(maxFailureReasonLength + 50))),
    ).toHaveLength(maxFailureReasonLength);
  });

  it.each([
    ['an empty message', new Error('')],
    ['a thrown string', 'boom'],
    ['undefined', undefined],
  ])('falls back for %s', (_label, error) => {
    expect(failureReasonFor(error)).toBe('Unknown error');
  });
});

describe('outcomeForAdapter', () => {
  it.each<[EmailAdapterName, string, boolean]>([
    ['fake', 'captured', true],
    ['resend', 'sent', false],
    ['postmark', 'sent', false],
  ])('%s gives %s and keeps a body: %s', (adapter, status, keepsBody) => {
    expect(outcomeForAdapter(adapter)).toEqual({ status, keepsBody });
  });
});

describe('isPermanentBounce', () => {
  it.each([
    ['resend', 'Permanent', true],
    ['resend', 'Transient', false],
    ['resend', 'Undetermined', false],
    ['resend', undefined, false],
    ['resend', 'HardBounce', false],
    ['postmark', 'HardBounce', true],
    ['postmark', 'BadEmailAddress', true],
    ['postmark', 'Transient', false],
    ['postmark', 'SoftBounce', false],
    ['postmark', undefined, false],
    ['postmark', 'Permanent', false],
  ] as const)('%s type %s is permanent: %s', (provider, type, expected) => {
    expect(isPermanentBounce(provider, type)).toBe(expected);
  });
});

describe('isRetryableStatus', () => {
  it.each([
    [400, false],
    [401, false],
    [404, false],
    [422, false],
    [429, true],
    [500, true],
    [503, true],
    [200, false],
  ])('%i is retryable: %s', (status, expected) => {
    expect(isRetryableStatus(status)).toBe(expected);
  });
});

describe('summarizeRefusal', () => {
  it('puts a refusal on one line and cuts it', () => {
    expect(summarizeRefusal('  bad\n\n  request\t here ', 100)).toBe(
      'bad request here',
    );
    expect(summarizeRefusal('x'.repeat(500), 200)).toHaveLength(200);
  });

  it('is empty for an empty body', () => {
    expect(summarizeRefusal('', 200)).toBe('');
  });
});

describe('declaredLengthExceeds', () => {
  it.each([
    ['70000', true],
    ['65536', false],
    ['65537', true],
    [null, false],
    ['abc', false],
    ['', false],
  ])('%j over 65536 is %s', (header, expected) => {
    expect(declaredLengthExceeds(header, 65_536)).toBe(expected);
  });
});

describe('isFreshTimestamp', () => {
  it.each([
    [1000, 1000, true],
    [700, 1000, true],
    [699, 1000, false],
    [1300, 1000, true],
    [1301, 1000, false],
  ])('%i against now %i within 300 s: %s', (timestamp, now, expected) => {
    expect(isFreshTimestamp(timestamp, now, 300)).toBe(expected);
  });
});

describe('mailboxAccess', () => {
  const on = {
    liveMode: false,
    secretConfigured: true,
    hasCookie: true,
    cookieMatches: true,
  };

  it.each([
    ['open with a matching cookie', {}, 'open'],
    [
      'locked with no cookie',
      { hasCookie: false, cookieMatches: false },
      'locked',
    ],
    ['locked with a wrong cookie', { cookieMatches: false }, 'locked'],
    [
      'disabled in live mode, whatever the cookie',
      { liveMode: true },
      'disabled',
    ],
    ['disabled without a secret', { secretConfigured: false }, 'disabled'],
  ])('is %s', (_label, override, expected) => {
    expect(mailboxAccess({ ...on, ...override })).toBe(expected);
  });
});
