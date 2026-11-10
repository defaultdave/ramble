import {
  buildHostDashboard,
  type HostDashboardView,
} from '@/lib/hostDashboard';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const startsAt = (day: number, hour: number) =>
  new Date(Date.UTC(2026, 10, day, hour));

export const busy: HostDashboardView = buildHostDashboard({
  hostName: 'Harbor Kayak Co',
  sessions: [
    {
      id: id(1),
      experienceName: 'Sunset kayak',
      startsAt: startsAt(14, 21),
      timeZone: 'America/New_York',
      allocation: 12,
      seatsSold: 5,
    },
    {
      id: id(2),
      experienceName: 'Sunset kayak',
      startsAt: startsAt(15, 21),
      timeZone: 'America/New_York',
      allocation: 12,
      seatsSold: 10,
    },
    {
      id: id(3),
      experienceName: 'Dawn paddle',
      startsAt: startsAt(16, 12),
      timeZone: 'America/New_York',
      allocation: 8,
      seatsSold: 8,
    },
  ],
  bookings: [
    {
      id: id(11),
      reference: 'RMB-K7QX2M',
      leadGuestName: 'Ada Lovelace',
      experienceName: 'Sunset kayak',
      sessionStartsAt: startsAt(15, 21),
      timeZone: 'America/New_York',
      seats: 3,
      totalMinor: 25500,
      status: 'confirmed',
    },
    {
      id: id(12),
      reference: 'RMB-P4ZT9C',
      leadGuestName: 'Grace Hopper',
      experienceName: 'Dawn paddle',
      sessionStartsAt: startsAt(16, 12),
      timeZone: 'America/New_York',
      seats: 1,
      totalMinor: 7500,
      status: 'cancelled',
    },
  ],
});

export const empty: HostDashboardView = buildHostDashboard({
  hostName: 'Harbor Kayak Co',
  sessions: [],
  bookings: [],
});
