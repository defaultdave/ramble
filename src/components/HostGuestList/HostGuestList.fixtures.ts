import {
  buildHostGuestList,
  type HostGuestListView,
} from '@/lib/hostGuestLists';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const session = {
  hostName: 'Harbor Kayak Co',
  id: id(1),
  experienceName: 'Sunset kayak',
  startsAt: new Date(Date.UTC(2026, 10, 14, 21)),
  timeZone: 'America/New_York',
  waiverRequired: true,
};

export const busy: HostGuestListView = buildHostGuestList({
  scope: 'owner',
  session,
  bookings: [
    {
      id: id(11),
      reference: 'RMB-K7QX2M',
      leadGuestName: 'Ada Lovelace',
      seats: 3,
      ageConfirmed: null,
      childrenAges: [8, 11],
      guardianName: 'Ada Lovelace',
      guardianContact: 'ada@example.com',
      waiverAccepted: true,
      contactEmail: 'ada@example.com',
      contactPhone: '+1 555 0100',
    },
    {
      id: id(12),
      reference: 'RMB-P4ZT9C',
      leadGuestName: 'Grace Hopper',
      seats: 1,
      ageConfirmed: true,
      childrenAges: null,
      guardianName: null,
      guardianContact: null,
      waiverAccepted: false,
      contactEmail: 'grace@example.com',
      contactPhone: null,
    },
  ],
});

export const empty: HostGuestListView = buildHostGuestList({
  scope: 'owner',
  session,
  bookings: [],
});
