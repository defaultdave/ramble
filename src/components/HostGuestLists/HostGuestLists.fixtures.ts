import {
  buildHostBookingList,
  type HostBookingListView,
} from '@/lib/hostGuestLists';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const bookings = [
  {
    id: id(11),
    reference: 'RMB-K7QX2M',
    leadGuestName: 'Ada Lovelace',
    experienceName: 'Sunset kayak',
    sessionId: id(1),
    sessionStartsAt: new Date(Date.UTC(2026, 10, 15, 21)),
    timeZone: 'America/New_York',
    seats: 3,
    status: 'confirmed',
  },
  {
    id: id(12),
    reference: 'RMB-P4ZT9C',
    leadGuestName: 'Grace Hopper',
    experienceName: 'Dawn paddle',
    sessionId: id(2),
    sessionStartsAt: new Date(Date.UTC(2026, 10, 16, 12)),
    timeZone: 'America/New_York',
    seats: 1,
    status: 'cancelled',
  },
] as const;

export const all: HostBookingListView = buildHostBookingList({ bookings }, '');
export const searched: HostBookingListView = buildHostBookingList(
  { bookings: bookings.slice(0, 1) },
  'ada',
);
export const noMatch: HostBookingListView = buildHostBookingList(
  { bookings: [] },
  'zed',
);
export const none: HostBookingListView = buildHostBookingList(
  { bookings: [] },
  '',
);
