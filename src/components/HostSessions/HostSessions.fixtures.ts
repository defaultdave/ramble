import type { HostWeekRowView, HostWeekView } from '@/lib/hostSessions';

const row = (overrides: Partial<HostWeekRowView>): HostWeekRowView => ({
  id: '00000000-0000-4000-8000-000000000001',
  experienceName: 'Sunset kayak',
  timeLabel: '4:00 PM EST',
  soldLabel: '0 of 10 seats sold',
  statusLabel: 'Scheduled',
  priceLabel: '$85 adult',
  version: 1,
  startTime: '16:00',
  durationMinutes: 120,
  allocation: 10,
  adultPrice: '85',
  editable: true,
  movable: true,
  ...overrides,
});

export const week: HostWeekView = {
  hostName: 'Harbor Kayak Co',
  weekStart: '2026-11-09',
  weekLabel: 'Mon, Nov 9 to Sun, Nov 15',
  timeZone: 'America/New_York',
  prevHref: '/host/sessions?week=2026-11-02',
  nextHref: '/host/sessions?week=2026-11-16',
  thisWeekHref: null,
  experiences: [
    { id: '00000000-0000-4000-8000-0000000000a1', name: 'Sunset kayak' },
    { id: '00000000-0000-4000-8000-0000000000a2', name: 'Harbor tour' },
  ],
  days: [
    {
      date: '2026-11-14',
      label: 'Sat, Nov 14',
      sessions: [
        row({}),
        row({
          id: '00000000-0000-4000-8000-000000000002',
          experienceName: 'Harbor tour',
          timeLabel: '10:00 AM EST',
          soldLabel: '4 of 8 seats sold',
          movable: false,
          allocation: 8,
        }),
      ],
    },
    {
      date: '2026-11-15',
      label: 'Sun, Nov 15',
      sessions: [
        row({
          id: '00000000-0000-4000-8000-000000000003',
          statusLabel: 'Cancelled',
          editable: false,
          movable: false,
        }),
      ],
    },
  ],
};

export const emptyWeek: HostWeekView = {
  ...week,
  prevHref: null,
  nextHref: null,
  thisWeekHref: '/host/sessions',
  days: [],
  experiences: [],
};
