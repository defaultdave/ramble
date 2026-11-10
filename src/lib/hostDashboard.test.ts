import { describe, expect, it } from 'vitest';
import {
  buildHostDashboard,
  hostDashboardLimits,
  soldFillStep,
  soldPercent,
  type HostDashboardBooking,
  type HostDashboardSession,
} from './hostDashboard';

// Behaviours under test, one per decision, branch or risk:
// - a session row says how many seats are sold against the allocation, on the session's own clock
// - the session's status follows the seats left (open, few left, sold out)
// - the percent sold is floored and reads 100 only when the session is full (or has no allocation)
// - a booking row shows the guest, the experience, the session time, the seats, the total, and the status in words
// - one seat is singular, and a cancelled booking says so
// - neither list is longer than its limit, whatever is handed over
// - nothing handed over gives empty lists, not an error

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const session = (
  overrides: Partial<HostDashboardSession> = {},
): HostDashboardSession => ({
  id: id(1),
  experienceName: 'Sunset kayak',
  startsAt: new Date('2026-11-14T19:00:00.000Z'),
  timeZone: 'America/New_York',
  allocation: 10,
  seatsSold: 6,
  ...overrides,
});

const booking = (
  overrides: Partial<HostDashboardBooking> = {},
): HostDashboardBooking => ({
  id: id(2),
  reference: 'RMB-ABC234',
  leadGuestName: 'Ada Lovelace',
  experienceName: 'Sunset kayak',
  sessionStartsAt: new Date('2026-11-14T19:00:00.000Z'),
  timeZone: 'America/New_York',
  seats: 3,
  totalMinor: 25500,
  status: 'confirmed',
  ...overrides,
});

const build = (
  sessions: HostDashboardSession[] = [],
  bookings: HostDashboardBooking[] = [],
) => buildHostDashboard({ hostName: 'Harbor Co', sessions, bookings });

describe('buildHostDashboard', () => {
  it('shows seats sold against the allocation at the session time', () => {
    const [row] = build([session()]).sessions;
    expect(row).toMatchObject({
      experienceName: 'Sunset kayak',
      whenLabel: 'Sat, Nov 14 · 2:00 PM EST',
      soldLabel: '6 of 10 seats sold',
      soldPercent: 60,
      status: 'open',
    });
  });

  it.each([
    { seatsSold: 8, allocation: 10, status: 'few-left' },
    { seatsSold: 10, allocation: 10, status: 'sold-out' },
    { seatsSold: 0, allocation: 0, status: 'sold-out' },
  ])('marks $seatsSold of $allocation as $status', ({ status, ...seats }) => {
    expect(build([session(seats)]).sessions[0]?.status).toBe(status);
  });

  it('shows a booking with its guest, seats, total, and status', () => {
    const [row] = build([], [booking()]).bookings;
    expect(row).toMatchObject({
      reference: 'RMB-ABC234',
      guestName: 'Ada Lovelace',
      whenLabel: 'Sat, Nov 14 · 2:00 PM EST',
      seatsLabel: '3 seats',
      totalLabel: '$255.00',
      statusLabel: 'Confirmed',
    });
  });

  it('says one seat in the singular and a cancelled booking in words', () => {
    const [row] = build(
      [],
      [booking({ seats: 1, status: 'cancelled' })],
    ).bookings;
    expect(row).toMatchObject({
      seatsLabel: '1 seat',
      statusLabel: 'Cancelled',
    });
  });

  it('keeps each list within its limit', () => {
    const view = build(
      Array.from({ length: 15 }, (_, n) => session({ id: id(100 + n) })),
      Array.from({ length: 15 }, (_, n) => booking({ id: id(200 + n) })),
    );
    expect(view.sessions).toHaveLength(hostDashboardLimits.sessions);
    expect(view.bookings).toHaveLength(hostDashboardLimits.bookings);
  });

  it('gives empty lists when there is nothing', () => {
    expect(build()).toEqual({
      hostName: 'Harbor Co',
      sessions: [],
      bookings: [],
    });
  });
});

describe('soldPercent', () => {
  it.each([
    [0, 10, 0],
    [1, 3, 33],
    [2, 3, 66],
    [999, 1000, 99],
    [10, 10, 100],
    [12, 10, 100],
    [0, 0, 100],
  ])('%i of %i is %i percent', (sold, allocation, expected) => {
    expect(soldPercent(sold, allocation)).toBe(expected);
  });
});

describe('soldFillStep', () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 1],
    [99, 9],
    [100, 10],
  ])('%i percent fills %i tenths', (percent, step) => {
    expect(soldFillStep(percent)).toBe(step);
  });
});
