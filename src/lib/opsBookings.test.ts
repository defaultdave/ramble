import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import { opsAreaIds } from './opsAudit';
import type { CancelBookingResult, CancelFacts } from './cancelBooking';
import {
  bookingsListEntry,
  bookingViewedEntry,
  buildOpsBookingDetail,
  buildOpsBookingRow,
  cancelNoticeCode,
  confirmationResentEntry,
  linksVoidedEntry,
  opsBookingNotices,
  opsNoticeCodes,
  opsRefundDecision,
  opsRefundRequest,
  parseBookingFilter,
  parseBookingSearch,
  parseCancelForm,
  refundNoticeCode,
  refundRequestedEntry,
  resendNoticeCode,
  searchSummary,
  voidNoticeCode,
  type OpsBookingDetailRecord,
  type OpsBookingRecord,
} from './opsBookings';

// Behaviours under test:
// - the search reads an address (any case) or a booking reference (any case) and refuses every other term; it never matches loosely
// - the filter reads only the refund-failed queue
// - a row shows the session on its own clock, the total in dollars, a dash for a missing name, and a flag when its refund failed
// - each canceller is worded
// - a count of bookings is singular for one
// - an ops refund goes only for a cancelled booking with no failed refund to retry instead
// - the detail offers cancel with the refund the tier gives, refund, retry, and resend only when each can go
// - the history lists the order's own dates and what ops did, oldest first, and leaves out reads
// - the cancel form carries the refund ops was shown in digits only
// - every answer of the guest cancel and of the refund has a notice, and an ops cancel never meets the guest limit
// - every audit row is valid, names ids and codes only, and a list read names the bookings area

const get = (fields: Record<string, string>) => (name: string) => fields[name];
const orderId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';

const booking: OpsBookingRecord & OpsBookingDetailRecord['booking'] = {
  id: orderId,
  reference: 'RMB-ABC234',
  status: 'confirmed',
  refundFailed: false,
  leadGuestName: 'Pat Smith',
  contactEmail: 'pat@example.com',
  experienceName: 'Pottery',
  sessionStartsAt: new Date('2026-11-14T19:00:00Z'),
  timeZone: 'America/New_York',
  totalMinor: 10800,
  cancelledBy: null,
  createdAt: new Date('2026-11-10T15:00:00Z'),
  confirmedAt: new Date('2026-11-10T15:01:00Z'),
  cancelledAt: null,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
};

describe('parseBookingSearch', () => {
  it.each([
    ['no term', undefined, { kind: 'none' }],
    ['a blank term', '  ', { kind: 'none' }],
    ['a repeated term', ['a', 'b'], { kind: 'none' }],
    [
      'an address in any case',
      ' Pat@Example.COM ',
      { kind: 'email', email: 'pat@example.com' },
    ],
    [
      'a reference in any case',
      'rmb-abc234',
      { kind: 'reference', reference: 'RMB-ABC234' },
    ],
    ['half an address', '@example.com', { kind: 'invalid' }],
    ['a name', 'Pat Smith', { kind: 'invalid' }],
    [
      'a reference with a letter it never uses',
      'RMB-ABCI34',
      { kind: 'invalid' },
    ],
    ['a term over the limit', 'a'.repeat(101), { kind: 'none' }],
  ])('reads %s', (_name, raw, expected) => {
    expect(parseBookingSearch(raw)).toEqual(expected);
  });
});

describe('searchSummary', () => {
  it.each([
    [{ kind: 'none' }, 3, ''],
    [{ kind: 'invalid' }, 0, expect.stringContaining('booking reference')],
    [
      { kind: 'reference', reference: 'RMB-ABC234' },
      1,
      '1 booking for RMB-ABC234.',
    ],
    [{ kind: 'email', email: 'a@b.co' }, 0, '0 bookings for a@b.co.'],
  ] as const)('says what %j found', (search, count, expected) => {
    expect(searchSummary(search, count)).toEqual(expected);
  });
});

describe('parseBookingFilter', () => {
  it.each([
    ['refund_failed', 'refund_failed'],
    ['everything', null],
    [undefined, null],
    [['refund_failed', 'refund_failed'], null],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseBookingFilter(raw)).toBe(expected);
  });
});

describe('buildOpsBookingRow', () => {
  it('shows the session on its own clock, the total in dollars, and a dash for a missing name', () => {
    expect(
      buildOpsBookingRow({ ...booking, leadGuestName: null }),
    ).toMatchObject({
      guestName: '—',
      totalLabel: '$108.00',
      whenLabel: 'Sat, Nov 14 · 2:00 PM EST',
      href: `/ops/bookings/${orderId}`,
      refundFailedBadge: null,
    });
  });

  it('flags a booking whose refund failed', () => {
    expect(
      buildOpsBookingRow({ ...booking, refundFailed: true }).refundFailedBadge,
    ).toEqual({ tone: 'danger', label: 'Refund failed' });
  });
});

describe('who cancelled', () => {
  it.each([
    ['guest', 'Cancelled by guest'],
    ['host', 'Cancelled by host'],
    ['weather', 'Cancelled for weather'],
    ['ramble', 'Cancelled by Ramble'],
    [null, 'Cancelled'],
  ] as const)('words %s as %s', (cancelledBy, label) => {
    const detail = detailOf({
      booking: {
        ...booking,
        status: 'cancelled',
        cancelledBy,
        cancelledAt: new Date('2026-11-10T16:00:00Z'),
      },
    });
    expect(detail.events.at(-1)?.label).toBe(label);
  });
});

const facts: CancelFacts = {
  kind: 'booking',
  status: 'confirmed',
  giftAppliedMinor: 0,
  freeCancelUntil: new Date('2026-11-12T12:00:00Z'),
  manageTokenVersion: 1,
  sessionStartsAt: new Date('2026-11-14T19:00:00Z'),
  seats: 2,
  ticketSubtotalMinor: 10000,
  taxMinor: 800,
  totalMinor: 10800,
  amountDueMinor: 10800,
  commissionMinor: 1500,
  commissionRateBps: 1500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
};

const source = { kind: 'booking', status: 'confirmed' } as never;

function detailOf(overrides: Partial<OpsBookingDetailRecord> = {}) {
  return buildOpsBookingDetail({
    booking,
    facts,
    emailSource: source,
    refunds: [],
    history: [],
    now: new Date('2026-11-11T12:00:00Z'),
    ...overrides,
  });
}

describe('opsRefundDecision', () => {
  it.each([
    ['booking', 'cancelled', false, 'go'],
    ['booking', 'confirmed', false, 'refused'],
    ['booking', 'cancelled', true, 'refused'],
    ['gift_purchase', 'cancelled', false, 'refused'],
  ] as const)(
    '%s %s with refundFailed %s is %s',
    (kind, status, refundFailed, expected) => {
      expect(opsRefundDecision({ kind, status, refundFailed })).toBe(expected);
    },
  );
});

describe('opsRefundRequest', () => {
  it('asks for the whole rest under the one ops key, naming the ops user', () => {
    expect(opsRefundRequest(orderId, userId)).toEqual({
      orderId,
      reason: 'ops_adjustment',
      key: 'ops-refund',
      ticketMinor: 'remaining',
      initiatedBy: userId,
    });
  });
});

describe('buildOpsBookingDetail', () => {
  it('offers cancel with the refund the tier gives, and resend, for a confirmed booking in its window', () => {
    expect(detailOf()).toMatchObject({
      cancel: { refundMinor: 10800, basis: 'full' },
      canRefund: false,
      canRetryRefund: false,
      canResend: true,
    });
  });

  it('offers a refund, not cancel or resend, for a cancelled booking that still holds money', () => {
    expect(
      detailOf({
        booking: { ...booking, status: 'cancelled' },
        facts: { ...facts, status: 'cancelled' },
        emailSource: { kind: 'booking', status: 'cancelled' } as never,
      }),
    ).toMatchObject({ cancel: null, canRefund: true, canResend: false });
  });

  it('offers retry, not a new refund, for a booking whose refund failed', () => {
    expect(
      detailOf({
        booking: { ...booking, status: 'cancelled', refundFailed: true },
        facts: { ...facts, status: 'cancelled' },
      }),
    ).toMatchObject({ canRefund: false, canRetryRefund: true });
  });

  it('offers no refund when everything is already given back', () => {
    expect(
      detailOf({
        booking: {
          ...booking,
          status: 'cancelled',
          refundedTicketMinor: 10000,
          refundedTaxMinor: 800,
        },
        facts: {
          ...facts,
          status: 'cancelled',
          refundedTicketMinor: 10000,
          refundedTaxMinor: 800,
          commissionReturnedMinor: 1500,
        },
      }),
    ).toMatchObject({ canRefund: false, refundedLabel: '$108.00' });
  });

  it('lists the order dates and ops actions oldest first, leaving out reads and unknown actions', () => {
    const detail = detailOf({
      booking: {
        ...booking,
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: new Date('2026-11-10T16:00:00Z'),
      },
      history: [
        {
          action: 'booking.ops_links_voided',
          recordedAt: new Date('2026-11-10T17:00:00Z'),
        },
        {
          action: 'booking.viewed',
          recordedAt: new Date('2026-11-10T15:30:00Z'),
        },
      ],
    });
    expect(detail.events.map((event) => event.label)).toEqual([
      'Booking placed',
      'Booking confirmed',
      'Cancelled by guest',
      'Earlier links voided by ops',
    ]);
  });

  it('words each refund with its reason and status, and shows an unknown reason as it is', () => {
    const detail = detailOf({
      refunds: [
        {
          id: 'r1',
          amountMinor: 10800,
          reason: 'guest_cancel',
          status: 'failed',
          createdAt: new Date('2026-11-10T16:00:00Z'),
        },
        {
          id: 'r2',
          amountMinor: 500,
          reason: 'gift_unredeemed',
          status: 'pending',
          createdAt: new Date('2026-11-10T17:00:00Z'),
        },
      ],
    });
    expect(detail.refunds).toMatchObject([
      {
        amountLabel: '$108.00',
        reasonLabel: 'Guest cancelled',
        statusLabel: 'Failed',
      },
      { reasonLabel: 'gift_unredeemed', statusLabel: 'Pending' },
    ]);
  });
});

describe('parseCancelForm', () => {
  it.each([
    ['10800', 10800],
    ['0', 0],
    [' 500 ', 500],
  ])('carries the refund ops was shown, %j', (shown, expected) => {
    expect(parseCancelForm(get({ expectedRefundMinor: shown }))).toEqual({
      ok: true,
      expectedRefundMinor: expected,
    });
  });

  it.each([undefined, '', '-1', '1.5', '1e3', '12345678901', 'abc'])(
    'refuses a refund of %j',
    (shown) => {
      expect(
        parseCancelForm(
          get(shown === undefined ? {} : { expectedRefundMinor: shown }),
        ),
      ).toEqual({ ok: false });
    },
  );
});

describe('notices', () => {
  it.each([
    [
      {
        status: 'cancelled',
        refundMinor: 1,
        giftReinstated: false,
        refundEta: null,
      },
      'cancelled',
    ],
    [{ status: 'terms_changed', refundMinor: 1 }, 'terms_changed'],
    [{ status: 'not_refundable', freeCancelUntil: null }, 'not_cancellable'],
    [{ status: 'already_cancelled' }, 'already_cancelled'],
    [
      { status: 'refund_unavailable', reason: 'no_payment' },
      'refund_unavailable',
    ],
    [{ status: 'not_found' }, 'not_found'],
  ] as [CancelBookingResult, string][])(
    'names the cancel answer %j',
    (result, code) => {
      expect(cancelNoticeCode(result)).toBe(code);
    },
  );

  it('treats a guest rate-limit answer as a bug', () => {
    expect(() =>
      cancelNoticeCode({ status: 'rate_limited', retryAfterSeconds: 1 }),
    ).toThrow(RangeError);
  });

  it.each([
    ['requested', 'refund_requested'],
    ['already_requested', 'refund_already_requested'],
    ['refused', 'refund_refused'],
    ['not_found', 'not_found'],
  ] as const)('names the refund answer %s', (status, code) => {
    expect(refundNoticeCode(status)).toBe(code);
  });

  it.each([
    [resendNoticeCode('sent'), 'resent'],
    [resendNoticeCode('not_resendable'), 'not_resendable'],
    [resendNoticeCode('not_found'), 'not_found'],
    [voidNoticeCode({ version: 2 }), 'links_voided'],
    [voidNoticeCode(null), 'not_found'],
  ])('names %s as %s', (got, expected) => {
    expect(got).toBe(expected);
  });

  it('has a notice for every code', () => {
    expect(Object.keys(opsBookingNotices).toSorted()).toEqual(
      [...opsNoticeCodes].toSorted(),
    );
  });
});

describe('audit entries', () => {
  it.each([
    ['the list read', bookingsListEntry(userId)],
    ['a booking read', bookingViewedEntry(userId, orderId)],
    ['a refund', refundRequestedEntry(userId, orderId, orderId)],
    ['a void', linksVoidedEntry(userId, orderId, 2)],
    ['a resend', confirmationResentEntry(userId, orderId, orderId)],
  ])('writes %s as ids and codes the audit log accepts', (_name, entry) => {
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });

  it('names the bookings area for a list read', () => {
    expect(bookingsListEntry(userId)).toMatchObject({
      action: 'booking.list_viewed',
      subjectId: opsAreaIds.bookings,
    });
  });

  it('names the order and the ops user for an action', () => {
    expect(linksVoidedEntry(userId, orderId, 2)).toEqual({
      actorKind: 'user',
      actorId: userId,
      action: 'booking.ops_links_voided',
      subjectKind: 'order',
      subjectId: orderId,
      details: { token_version: 2 },
    });
  });
});
