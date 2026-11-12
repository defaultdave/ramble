import { describe, expect, it } from 'vitest';
import {
  AccountBookingRowSchema,
  buildAccountBookings,
  type AccountBookingRow,
} from './accountBookings';

// Behaviours under test, one per decision, branch or risk:
// - a confirmed booking whose session has not started is upcoming, soonest first
// - a confirmed booking whose session has started is past, as is a cancelled one even if its session is ahead; past is latest first
// - a session starting exactly now is still upcoming
// - a row reads the experience, the session's own day and clock, the status in words, the reference, and the manage link built from its token
// - nothing handed over gives two empty lists
// - the data layer's row refuses an id, time zone, or status it should not carry

const now = new Date('2026-11-10T12:00:00Z');
const token = 'a'.repeat(43);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (
  n: number,
  startsAt: string,
  overrides: Partial<AccountBookingRow> = {},
): AccountBookingRow => ({
  id: id(n),
  reference: `RMB-00000${String(n)}`,
  experienceName: 'Sunset kayak',
  sessionStartsAt: new Date(startsAt),
  timeZone: 'America/New_York',
  status: 'confirmed',
  manageToken: token,
  ...overrides,
});

describe('buildAccountBookings', () => {
  it('puts a confirmed booking still ahead in upcoming, soonest first', () => {
    const view = buildAccountBookings(
      [row(1, '2026-11-20T15:00:00Z'), row(2, '2026-11-12T15:00:00Z')],
      now,
    );
    expect(view.upcoming.map((b) => b.id)).toEqual([id(2), id(1)]);
    expect(view.past).toEqual([]);
  });

  it('puts a started or cancelled booking in past, latest first', () => {
    const view = buildAccountBookings(
      [
        row(1, '2026-11-01T15:00:00Z'),
        row(2, '2026-11-20T15:00:00Z', { status: 'cancelled' }),
        row(3, '2026-11-09T15:00:00Z'),
      ],
      now,
    );
    expect(view.upcoming).toEqual([]);
    expect(view.past.map((b) => b.id)).toEqual([id(2), id(3), id(1)]);
  });

  it('keeps a session that starts this instant upcoming', () => {
    const view = buildAccountBookings([row(1, now.toISOString())], now);
    expect(view.upcoming).toHaveLength(1);
  });

  it('says what each booking is in finished text with its manage link', () => {
    const view = buildAccountBookings(
      [row(1, '2026-11-14T19:00:00Z', { status: 'cancelled' })],
      now,
    );
    expect(view.past[0]).toEqual({
      id: id(1),
      reference: 'RMB-000001',
      experienceName: 'Sunset kayak',
      whenLabel: 'Sat, Nov 14 · 2:00 PM EST',
      statusLabel: 'Cancelled',
      manageHref: `/manage/${token}`,
    });
  });

  it('gives two empty lists for no bookings', () => {
    expect(buildAccountBookings([], now)).toEqual({ upcoming: [], past: [] });
  });
});

describe('AccountBookingRowSchema', () => {
  const valid = {
    id: id(1),
    reference: 'RMB-000001',
    experienceName: 'Sunset kayak',
    sessionStartsAt: now,
    timeZone: 'America/New_York',
    status: 'confirmed',
    manageTokenVersion: 1,
  };

  it('accepts a row the data layer reads', () => {
    expect(AccountBookingRowSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['an id that is no uuid', { id: 'nope' }],
    ['a status a guest is not shown', { status: 'pending_payment' }],
    ['a token version below 1', { manageTokenVersion: 0 }],
  ])('refuses %s', (_name, change) => {
    expect(
      AccountBookingRowSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });
});
