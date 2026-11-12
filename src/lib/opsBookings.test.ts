import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import { opsAreaIds } from './opsAudit';
import {
  bookingsListEntry,
  bookingViewedEntry,
  buildOpsBookingDetail,
  buildOpsBookingRow,
  parseBookingFilter,
  parseBookingSearch,
  searchSummary,
  type OpsBookingDetailRecord,
  type OpsBookingRecord,
} from './opsBookings';

// Behaviours under test:
// - the search reads an address (any case) or a booking reference (any case) and refuses every other term; it never matches loosely
// - the filter reads only the refund-failed queue
// - a row shows the session on its own clock, the total in dollars, a dash for a missing name, and a flag when its refund failed
// - each canceller is worded
// - a count of bookings is singular for one
// - the detail words each refund with its reason and status (an unknown reason as it is), totals what was refunded, and lists the order's dates oldest first
// - the audit rows are valid, name ids and codes only, and a list read names the bookings area

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
    ['no term', '', { kind: 'none' }],
    [
      'an address in any case',
      'Pat@Example.COM',
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
    const detail = buildOpsBookingDetail({
      booking: {
        ...booking,
        status: 'cancelled',
        cancelledBy,
        cancelledAt: new Date('2026-11-10T16:00:00Z'),
      },
      refunds: [],
    });
    expect(detail.events.at(-1)?.label).toBe(label);
  });
});

describe('buildOpsBookingDetail', () => {
  it('lists the order dates oldest first, with who cancelled', () => {
    const detail = buildOpsBookingDetail({
      booking: {
        ...booking,
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: new Date('2026-11-10T16:00:00Z'),
      },
      refunds: [],
    });
    expect(detail.events.map((event) => event.label)).toEqual([
      'Booking placed',
      'Booking confirmed',
      'Cancelled by guest',
    ]);
  });

  it('totals what was refunded and words each refund with its reason and status', () => {
    const detail = buildOpsBookingDetail({
      booking: {
        ...booking,
        refundedTicketMinor: 10000,
        refundedTaxMinor: 800,
      },
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
    expect(detail.refundedLabel).toBe('$108.00');
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

describe('audit entries', () => {
  it.each([
    ['the list read', bookingsListEntry(userId)],
    ['a booking read', bookingViewedEntry(userId, orderId)],
  ])('writes %s as ids and codes the audit log accepts', (_name, entry) => {
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });

  it('names the bookings area for a list read', () => {
    expect(bookingsListEntry(userId)).toMatchObject({
      action: 'booking.list_viewed',
      subjectId: opsAreaIds.bookings,
    });
  });

  it('names the order and the ops user for a booking read', () => {
    expect(bookingViewedEntry(userId, orderId)).toEqual({
      actorKind: 'user',
      actorId: userId,
      action: 'booking.viewed',
      subjectKind: 'order',
      subjectId: orderId,
    });
  });
});
